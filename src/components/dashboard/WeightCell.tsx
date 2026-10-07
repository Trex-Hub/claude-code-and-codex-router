"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accountWeight, planWeight, type AccountView } from "./shared";

/**
 * Inline editor for an account's selection weight.
 *
 * Weight is the relative share of *new* conversations this seat attracts; it
 * never rebalances conversations already pinned to a seat. Blank clears the
 * override so the plan-derived default applies again.
 */
export function WeightCell({
  account,
  disabled,
  onCommit,
}: {
  account: AccountView;
  disabled: boolean;
  onCommit: (weight: number | null) => void;
}) {
  const effective = accountWeight(account);
  const derived = planWeight(account);
  const [draft, setDraft] = useState<string>(
    account.weight == null ? "" : String(account.weight),
  );

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (account.weight != null) onCommit(null);
      return;
    }
    const next = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(next) || next <= 0) {
      setDraft(account.weight == null ? "" : String(account.weight));
      return;
    }
    if (next !== account.weight) onCommit(next);
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Input
          className="h-7 w-14 px-2 text-center font-mono tabular-nums"
          inputMode="numeric"
          placeholder={String(derived)}
          value={draft}
          disabled={disabled}
          aria-label={`Weight for ${account.label}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(account.weight == null ? "" : String(account.weight));
              e.currentTarget.blur();
            }
          }}
        />
      </TooltipTrigger>
      <TooltipContent>
        {account.weight == null
          ? `Plan default: ${derived}. Set a number to override.`
          : `Overridden (plan default ${derived}). Clear to reset.`}{" "}
        Current: {effective}.
      </TooltipContent>
    </Tooltip>
  );
}
