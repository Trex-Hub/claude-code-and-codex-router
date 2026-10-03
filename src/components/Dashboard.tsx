"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface AccountView {
  id: string;
  label: string;
  email: string | null;
  planTier: string | null;
  rateLimitTier: string | null;
  subscriptionStatus: string | null;
  hasExtraUsageEnabled: boolean | null;
  state: string;
  cooldownUntil: number | null;
  lastError: string | null;
  lastSelectedAt: number | null;
}

interface KeyView {
  id: string;
  key: string;
  label: string | null;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

interface UsageRow {
  accountId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  lastUsedAt: number | null;
}

interface UsageEvent {
  id: number;
  accountId: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: number | null;
  latencyMs: number | null;
  createdAt: number;
}

interface LoginState {
  loginId: string;
  authorizeUrl: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body;
}

function fmtTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function Dashboard() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [keys, setKeys] = useState<KeyView[]>([]);
  const [usage, setUsage] = useState<{ byAccount: UsageRow[]; recent: UsageEvent[] }>(
    { byAccount: [], recent: [] },
  );
  const [error, setError] = useState<string | null>(null);

  const [addLabel, setAddLabel] = useState("");
  const [login, setLogin] = useState<LoginState | null>(null);
  const [pasteInput, setPasteInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, k, u] = await Promise.all([
        api<{ accounts: AccountView[] }>("/api/accounts"),
        api<{ keys: KeyView[] }>("/api/keys"),
        api<{ byAccount: UsageRow[]; recent: UsageEvent[] }>("/api/usage"),
      ]);
      setAccounts(a.accounts);
      setKeys(k.keys);
      setUsage(u);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        setError(null);
        await fn();
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  async function startAdd() {
    await run(async () => {
      const res = await api<LoginState>("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: addLabel || "Claude account" }),
      });
      setLogin(res);
      setPasteInput("");
    });
  }

  async function completeAdd() {
    if (!login) return;
    await run(async () => {
      await api(`/api/accounts/login/${login.loginId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: pasteInput }),
      });
      setLogin(null);
      setAddLabel("");
      setPasteInput("");
    });
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/login");
  }

  const usageById = new Map(usage.byAccount.map((u) => [u.accountId, u]));

  return (
    <div className="wrap">
      <header className="bar">
        <h1>claude-relay</h1>
        <div className="row">
          <button onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
          <button onClick={() => void logout()}>Sign out</button>
        </div>
      </header>

      {error ? <div className="banner err">{error}</div> : null}

      <h2>Accounts</h2>
      <div className="panel">
        {accounts.length === 0 ? (
          <p className="muted">No accounts yet. Add one below.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Plan</th>
                <th>State</th>
                <th>Requests</th>
                <th>Tokens (in/out)</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const u = usageById.get(a.id);
                return (
                  <tr key={a.id}>
                    <td>
                      <div>{a.label}</div>
                      <div className="muted">{a.email ?? "—"}</div>
                    </td>
                    <td>
                      <div>{a.planTier ?? "—"}</div>
                      <div className="muted">{a.rateLimitTier ?? ""}</div>
                    </td>
                    <td>
                      <span className={`state ${a.state}`}>{a.state}</span>
                      {a.lastError ? (
                        <div className="muted">{a.lastError}</div>
                      ) : null}
                    </td>
                    <td>{u?.requests ?? 0}</td>
                    <td>
                      {u ? `${u.inputTokens} / ${u.outputTokens}` : "—"}
                    </td>
                    <td className="muted">
                      {fmtTime(u?.lastUsedAt ?? a.lastSelectedAt)}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          onClick={() =>
                            void run(() =>
                              api(`/api/accounts/${a.id}`, {
                                method: "PATCH",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({
                                  state: a.state === "disabled" ? "active" : "disabled",
                                }),
                              }),
                            )
                          }
                        >
                          {a.state === "disabled" ? "Enable" : "Disable"}
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            if (confirm(`Delete ${a.label}?`)) {
                              void run(() =>
                                api(`/api/accounts/${a.id}`, { method: "DELETE" }),
                              );
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2>Add account</h2>
      <div className="panel">
        {!login ? (
          <div className="row">
            <input
              className="grow"
              placeholder="Label (e.g. office-max-1)"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
            />
            <button className="primary" onClick={() => void startAdd()} disabled={busy}>
              Start login
            </button>
          </div>
        ) : (
          <div>
            <p>
              1. Open this URL, sign in to the Claude account, then copy the code
              or the final redirect URL:
            </p>
            <p>
              <a href={login.authorizeUrl} target="_blank" rel="noreferrer">
                Open Claude sign-in ↗
              </a>
            </p>
            <p className="muted" style={{ wordBreak: "break-all" }}>
              {login.authorizeUrl}
            </p>
            <p>2. Paste the code or redirect URL here:</p>
            <div className="row">
              <input
                className="grow"
                placeholder="code or http://localhost:53692/callback?code=…"
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
              />
              <button
                className="primary"
                onClick={() => void completeAdd()}
                disabled={busy || !pasteInput}
              >
                Complete
              </button>
              <button onClick={() => setLogin(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <h2>Relay keys</h2>
      <div className="panel">
        <div className="row gap">
          <input
            className="grow"
            placeholder="Key label (e.g. alice-laptop)"
            id="new-key-label"
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const el = document.getElementById("new-key-label") as HTMLInputElement | null;
              void run(() =>
                api("/api/keys", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ label: el?.value ?? "" }),
                }),
              );
            }}
          >
            Create key
          </button>
        </div>
        <table className="gap">
          <thead>
            <tr>
              <th>Label</th>
              <th>Key</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.label ?? "—"}</td>
                <td className="mono" style={{ wordBreak: "break-all" }}>
                  {k.key}
                </td>
                <td className="muted">{fmtTime(k.lastUsedAt)}</td>
                <td>
                  <div className="row">
                    <button
                      onClick={() => void navigator.clipboard.writeText(k.key)}
                    >
                      Copy
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm("Delete this key?")) {
                          void run(() =>
                            api(`/api/keys/${k.id}`, { method: "DELETE" }),
                          );
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent requests</h2>
      <div className="panel">
        {usage.recent.length === 0 ? (
          <p className="muted">No requests recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Account</th>
                <th>Tokens (in/out)</th>
                <th>Status</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {usage.recent.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{fmtTime(e.createdAt)}</td>
                  <td>{e.model ?? "—"}</td>
                  <td className="mono">{e.accountId.slice(0, 8)}</td>
                  <td>
                    {e.inputTokens ?? 0} / {e.outputTokens ?? 0}
                  </td>
                  <td>{e.status ?? "—"}</td>
                  <td>{e.latencyMs ? `${e.latencyMs} ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
