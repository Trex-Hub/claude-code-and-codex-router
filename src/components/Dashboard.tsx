"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActivityIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LogOutIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AddAccountDialog } from "./dashboard/AddAccountDialog";
import { ConfirmDelete } from "./dashboard/ConfirmDelete";
import { ThemeToggle } from "./dashboard/ThemeToggle";
import {
  api,
  fmtAgo,
  fmtCompact,
  fmtFull,
  fmtInt,
  fmtUntil,
  jsonInit,
  maskKey,
  planLabel,
  PROVIDERS,
  totalInput,
  type AccountView,
  type KeyView,
  type UsageEvent,
  type UsageRow,
} from "./dashboard/shared";

const STATE_STYLE: Record<string, string> = {
  active: "bg-success/15 text-success",
  cooling: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
  disabled: "bg-muted text-muted-foreground",
};

function StateBadge({ account }: { account: AccountView }) {
  const detail =
    account.state === "cooling" && account.cooldownUntil
      ? `resets in ${fmtUntil(account.cooldownUntil)}`
      : null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant="ghost" className={cn("gap-1.5 capitalize", STATE_STYLE[account.state])}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {account.state}
      </Badge>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      {account.lastError ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="max-w-48 truncate text-xs text-muted-foreground">{account.lastError}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">{account.lastError}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function ProviderBadge({ provider }: { provider: AccountView["provider"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-heading uppercase tracking-wider",
        provider === "openai-codex" ? "text-chart-2" : "text-primary",
      )}
    >
      {PROVIDERS[provider].name}
    </Badge>
  );
}

function Ago({ ms }: { ms: number | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground">{fmtAgo(ms)}</span>
      </TooltipTrigger>
      <TooltipContent>{fmtFull(ms)}</TooltipContent>
    </Tooltip>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: typeof ActivityIcon;
  label: string;
  value: string;
  hint: string;
  loading: boolean;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-2">
        <CardDescription className="font-heading text-xs uppercase tracking-wider">{label}</CardDescription>
        <Icon className="size-4 text-primary" aria-hidden />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="font-heading text-3xl font-semibold tabular-nums">{value}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Empty({ icon: Icon, title, hint }: { icon: typeof ActivityIcon; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-accent p-3 text-accent-foreground">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="font-heading font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function KeyCell({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <code className="font-mono text-xs">{shown ? value : maskKey(value)}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={shown ? "Hide key" : "Reveal key"}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copy key"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            toast.success("Key copied");
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      </Button>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [keys, setKeys] = useState<KeyView[]>([]);
  const [usage, setUsage] = useState<{ byAccount: UsageRow[]; recent: UsageEvent[] }>({
    byAccount: [],
    recent: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [a, k, u] = await Promise.all([
        api<{ accounts: AccountView[] }>("/api/accounts"),
        api<{ keys: KeyView[] }>("/api/keys"),
        api<{ byAccount: UsageRow[]; recent: UsageEvent[] }>("/api/usage"),
      ]);
      setAccounts(a.accounts);
      setKeys(k.keys);
      setUsage(u);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      try {
        await fn();
        if (success) toast.success(success);
        await load();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/login");
  }

  const usageById = useMemo(() => new Map(usage.byAccount.map((u) => [u.accountId, u])), [usage]);
  const labelById = useMemo(() => new Map(accounts.map((a) => [a.id, a.label])), [accounts]);

  const totals = useMemo(() => {
    const requests = usage.byAccount.reduce((n, u) => n + u.requests, 0);
    const input = usage.byAccount.reduce((n, u) => n + totalInput(u), 0);
    const cached = usage.byAccount.reduce((n, u) => n + u.cacheReadTokens, 0);
    const output = usage.byAccount.reduce((n, u) => n + u.outputTokens, 0);
    const failed = usage.recent.filter((e) => (e.status ?? 0) >= 400).length;
    return { requests, input, cached, output, failed };
  }, [usage]);

  const active = accounts.filter((a) => a.state === "active").length;
  const cooling = accounts.filter((a) => a.state === "cooling").length;
  const errRate = usage.recent.length ? Math.round((totals.failed / usage.recent.length) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ZapIcon className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-heading text-xl font-semibold leading-none">claude-relay</h1>
            <p className="mt-1 text-xs text-muted-foreground">Claude + ChatGPT Codex seat pool</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Refresh" disabled={busy} onClick={() => void load()}>
            <RefreshCwIcon />
          </Button>
          <ThemeToggle />
          <Button variant="outline" onClick={() => void logout()}>
            <LogOutIcon /> Sign out
          </Button>
        </div>
      </header>

      {loadError ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>Couldn’t load data: {loadError}</span>
          <Button variant="destructive" size="sm" onClick={() => void load()}>Retry</Button>
        </div>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={ServerIcon}
          label="Seats"
          value={`${active}/${accounts.length}`}
          hint={cooling ? `${cooling} cooling down` : "active / total"}
          loading={!loaded}
        />
        <Stat icon={ActivityIcon} label="Requests" value={fmtCompact(totals.requests)} hint={`${errRate}% errors in last ${usage.recent.length}`} loading={!loaded} />
        <Stat icon={ZapIcon} label="Tokens" value={fmtCompact(totals.input + totals.output)} hint={`${fmtCompact(totals.input)} in (${fmtCompact(totals.cached)} cached) · ${fmtCompact(totals.output)} out`} loading={!loaded} />
        <Stat icon={KeyRoundIcon} label="Relay keys" value={String(keys.length)} hint="issued to clients" loading={!loaded} />
      </section>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="keys">Relay keys</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <Card>
            <CardHeader className="grid-cols-[1fr_auto] items-center">
              <div>
                <CardTitle className="font-heading">Accounts</CardTitle>
                <CardDescription>Subscription seats the relay rotates through.</CardDescription>
              </div>
              <AddAccountDialog onAdded={() => void load()} />
            </CardHeader>
            <CardContent className="px-0">
              {!loaded ? (
                <div className="grid gap-2 px-6">
                  <Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" />
                </div>
              ) : accounts.length === 0 ? (
                <Empty icon={ServerIcon} title="No accounts yet" hint="Add a Claude or ChatGPT seat to start relaying requests." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Account</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Tokens in / cached / out</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="pr-6"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((a) => {
                      const u = usageById.get(a.id);
                      const disabled = a.state === "disabled";
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="pl-6">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{a.label}</span>
                              <ProviderBadge provider={a.provider} />
                            </div>
                            <div className="text-xs text-muted-foreground">{a.email ?? "—"}</div>
                          </TableCell>
                          <TableCell>
                            <div>{planLabel(a) ?? "—"}</div>
                          </TableCell>
                          <TableCell><StateBadge account={a} /></TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{fmtInt(u?.requests)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {u ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    {fmtCompact(totalInput(u))} / {fmtCompact(u.cacheReadTokens)} / {fmtCompact(u.outputTokens)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {fmtInt(totalInput(u))} in ({fmtInt(u.cacheReadTokens)} cached, {fmtInt(u.cacheWriteTokens)} written) · {fmtInt(u.outputTokens)} out
                                </TooltipContent>
                              </Tooltip>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-sm"><Ago ms={u?.lastUsedAt ?? a.lastSelectedAt} /></TableCell>
                          <TableCell className="pr-6">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${disabled ? "Enable" : "Disable"} ${a.label}`}
                                title={disabled ? "Enable" : "Disable"}
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () => api(`/api/accounts/${a.id}`, jsonInit("PATCH", { state: disabled ? "active" : "disabled" })),
                                    disabled ? `${a.label} enabled` : `${a.label} disabled`,
                                  )
                                }
                              >
                                {disabled ? <PlayIcon /> : <PauseIcon />}
                              </Button>
                              <ConfirmDelete
                                trigger={
                                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.label}`} className="text-destructive hover:text-destructive">
                                    <Trash2Icon />
                                  </Button>
                                }
                                title={`Delete ${a.label}?`}
                                description="The seat is removed from the pool and its stored tokens are discarded. Past usage rows stay. You can re-add it by signing in again."
                                onConfirm={() => void run(() => api(`/api/accounts/${a.id}`, { method: "DELETE" }), `${a.label} deleted`)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Relay keys</CardTitle>
              <CardDescription>
                Clients authenticate to the relay with these. One key works for both providers.
              </CardDescription>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/api/keys", jsonInit("POST", { label: keyLabel }));
                    setKeyLabel("");
                  }, "Key created");
                }}
              >
                <Input
                  className="max-w-sm"
                  placeholder="Name this key, e.g. alice-laptop"
                  aria-label="New key label"
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                />
                <Button type="submit" disabled={busy}><KeyRoundIcon /> Create key</Button>
              </form>
            </CardHeader>
            <CardContent className="px-0">
              {!loaded ? (
                <div className="grid gap-2 px-6"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : keys.length === 0 ? (
                <Empty icon={KeyRoundIcon} title="No relay keys" hint="Create a key above, then put it in your client’s models.json as the apiKey." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="pr-6"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="pl-6 font-medium">{k.label ?? "—"}</TableCell>
                        <TableCell><KeyCell value={k.key} /></TableCell>
                        <TableCell className="text-sm"><Ago ms={k.createdAt} /></TableCell>
                        <TableCell className="text-sm"><Ago ms={k.lastUsedAt} /></TableCell>
                        <TableCell className="pr-6">
                          <div className="flex justify-end">
                            <ConfirmDelete
                              trigger={
                                <Button variant="ghost" size="icon-sm" aria-label={`Delete key ${k.label ?? k.id}`} className="text-destructive hover:text-destructive">
                                  <Trash2Icon />
                                </Button>
                              }
                              title={`Delete key “${k.label ?? "unnamed"}”?`}
                              description="Any client still using this key will immediately get 401 errors. This can’t be undone."
                              onConfirm={() => void run(() => api(`/api/keys/${k.id}`, { method: "DELETE" }), "Key deleted")}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Recent requests</CardTitle>
              <CardDescription>Latest calls through the relay, newest first.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {!loaded ? (
                <div className="grid gap-2 px-6"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
              ) : usage.recent.length === 0 ? (
                <Empty icon={ActivityIcon} title="No requests yet" hint="Point a client at the relay and requests will show up here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Time</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Tokens in / cached / out</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Latency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.recent.map((e) => {
                      const bad = (e.status ?? 0) >= 400;
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="pl-6 text-sm"><Ago ms={e.createdAt} /></TableCell>
                          <TableCell className="font-mono text-xs">{e.model ?? "—"}</TableCell>
                          <TableCell className="text-sm">
                            {labelById.get(e.accountId) ?? <span className="font-mono text-xs text-muted-foreground">{e.accountId.slice(0, 8)}</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {fmtInt(totalInput(e))} / {fmtInt(e.cacheReadTokens)} / {fmtInt(e.outputTokens)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="ghost" className={cn("font-mono", bad ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success")}>
                              {e.status ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-6 text-right font-mono text-sm tabular-nums">
                            {e.latencyMs ? `${fmtInt(e.latencyMs)} ms` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
