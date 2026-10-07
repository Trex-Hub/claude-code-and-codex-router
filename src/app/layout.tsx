import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/geist-mono";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata = {
  title: "claude-relay",
  description: "Multi-account Claude and ChatGPT Codex subscription relay",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
