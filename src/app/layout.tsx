import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "claude-relay",
  description: "Multi-account Claude Code subscription relay",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
