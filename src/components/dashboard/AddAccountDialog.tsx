"use client";

import { useEffect, useState } from "react";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, jsonInit, PROVIDERS, type ProviderId } from "./shared";

interface LoginState {
  provider: ProviderId;
  loginId: string;
  authorizeUrl: string;
}

export function AddAccountDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [label, setLabel] = useState("");
  const [login, setLogin] = useState<LoginState | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setLogin(null);
    setLabel("");
    setPaste("");
  }

  function finish() {
    reset();
    setOpen(false);
    toast.success("Account added");
    onAdded();
  }

  async function start() {
    setBusy(true);
    try {
      const res = await api<Omit<LoginState, "provider">>(
        "/api/accounts",
        jsonInit("POST", { provider, label: label || PROVIDERS[provider].defaultLabel }),
      );
      setLogin({ ...res, provider });
      setPaste("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The relay's temporary callback listener may finish the login on its own
  // (browser can reach the relay's callback port); poll so the dialog follows.
  useEffect(() => {
    if (!login) return;
    const id = login.loginId;
    const timer = setInterval(async () => {
      try {
        const res = await api<{ status: string; message?: string }>(
          `/api/accounts/login/${id}`,
        );
        if (res.status === "complete") finish();
        else if (res.status === "error") {
          reset();
          toast.error(res.message ?? "Login failed");
        }
      } catch {
        // transient; keep polling
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login]);

  async function complete(input: string = paste) {
    if (!login) return;
    setBusy(true);
    try {
      await api(`/api/accounts/login/${login.loginId}`, jsonInit("POST", { input }));
      finish();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const p = login ? PROVIDERS[login.provider] : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button><PlusIcon /> Add account</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            {login
              ? `Sign in to the ${p!.name} account, then paste the redirect URL.`
              : "Pool another subscription seat behind the relay."}
          </DialogDescription>
        </DialogHeader>

        {!login ? (
          <>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as ProviderId)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
                      <SelectItem key={id} value={id}>{PROVIDERS[id].name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="acct-label">Label</Label>
                <Input
                  id="acct-label"
                  placeholder="e.g. office-max-1"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void start()}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => void start()} disabled={busy}>Start login</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <ol className="grid gap-4 text-sm">
              <li className="grid gap-2">
                <span className="font-medium">1. Sign in</span>
                <Button variant="outline" asChild className="w-fit">
                  <a href={login.authorizeUrl} target="_blank" rel="noreferrer">
                    Open {p!.name} sign-in <ExternalLinkIcon />
                  </a>
                </Button>
                <span className="text-muted-foreground">
                  If the next page says “This site can’t be reached” (
                  <code className="font-mono text-xs">{new URL(p!.redirect).host}</code>), that
                  is expected when your browser isn’t on the relay host. Copy the URL from the
                  address bar.
                </span>
              </li>
              <li className="grid gap-2">
                <span className="font-medium">2. Paste the redirect URL</span>
                <Input
                  className="font-mono text-xs"
                  placeholder={`${p!.redirect}?code=…`}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (text.includes("code=") && !busy) {
                      e.preventDefault();
                      setPaste(text);
                      void complete(text);
                    }
                  }}
                />
                <span className="text-muted-foreground">Pasting a full URL completes the login automatically.</span>
              </li>
            </ol>
            <DialogFooter>
              <Button variant="ghost" onClick={reset} disabled={busy}>Back</Button>
              <Button onClick={() => void complete()} disabled={busy || !paste}>Complete</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
