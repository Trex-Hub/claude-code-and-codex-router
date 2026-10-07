"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Invalid password");
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ZapIcon className="size-5" aria-hidden />
          </div>
          <CardTitle className="font-heading text-xl">claude-relay</CardTitle>
          <CardDescription>Sign in to manage accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3">
            <Input
              type="password"
              placeholder="Admin password"
              aria-label="Admin password"
              aria-invalid={error ? true : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
