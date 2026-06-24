"use client";

// ROOT error boundary (ops-hardening wave B2). Next renders THIS when the root layout itself throws, so it
// REPLACES the entire document — the root <html>/<body>/chrome is gone and unavailable. It therefore must
// render its own <html>/<body> and stand alone (no NavShell, no fonts, no globals guaranteed). `reset()` is
// an event handler → this MUST be a client component (the RSC lesson: an onClick on a Server Component
// builds but 500s at render). Styling is INLINE so the screen renders even if the stylesheet never loaded —
// dark, square, mono, blaze accent: the tactical instrument look in its most minimal, self-contained form.

import { useEffect } from "react";

const MONO =
  "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("global error boundary", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#15130f",
          color: "#e7e2d8",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1.5rem",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "26rem",
            border: "1px solid #3a352b",
            backgroundColor: "#1c1a15",
            boxShadow:
              "inset 1px 1px 0 rgba(255,255,255,0.04), 2px 3px 0 rgba(0,0,0,0.45)",
            padding: "2rem 1.75rem",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: MONO,
              fontSize: "0.625rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d4622a",
              margin: "0 0 0.75rem",
            }}
          >
            Fault · System
          </p>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              margin: "0 0 0.75rem",
            }}
          >
            Total signal loss
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              lineHeight: 1.5,
              color: "#a9a394",
              margin: "0 0 1.5rem",
            }}
          >
            The app hit an unexpected error and couldn&apos;t recover this view. Reload to try again.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: MONO,
                fontSize: "0.5625rem",
                letterSpacing: "0.18em",
                color: "#7a7464",
                margin: "0 0 1.25rem",
              }}
            >
              ref {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              border: "none",
              backgroundColor: "#d4622a",
              color: "#15130f",
              fontWeight: 600,
              fontSize: "0.75rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "0.625rem 1.25rem",
              borderRadius: "2px",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
