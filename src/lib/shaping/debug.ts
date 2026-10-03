type DebugMode = "off" | "all" | "tool-use";

function getDebugMode(value: string | undefined): DebugMode {
  if (!value) return "off";

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
    case "debug":
    case "all":
      return "all";
    case "tool":
    case "tools":
    case "tool-use":
    case "tool_use":
      return "tool-use";
    default:
      return "off";
  }
}

export function isDebugEnabled(): boolean {
  return getDebugMode(process.env.RELAY_DEBUG) !== "off";
}

export function isToolUseOnlyDebugEnabled(): boolean {
  return getDebugMode(process.env.RELAY_DEBUG) === "tool-use";
}

export function debugLog(scope: string, data: unknown): void {
  if (!isDebugEnabled()) {
    return;
  }

  console.error(`[claude-relay][shaping-debug] ${scope} ${JSON.stringify(data)}`);
}
