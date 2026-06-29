"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The read-only share link for a trip (ADR-0033) + a copy control. The full absolute URL is resolved on
 * the client (origin isn't known server-side); we start from the relative path so the first render matches
 * the server, then upgrade to the absolute URL after mount (no hydration mismatch).
 */
export function ShareLink({ token }: { token: string }) {
  const [url, setUrl] = useState(`/t/${token}`);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/t/${token}`);
  }, [token]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the input is selectable as a fallback */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Shareable trip link"
        className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[0.8125rem] text-foreground"
      />
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
