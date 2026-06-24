"use client";

// ROOT error boundary (ops-hardening wave B2). Next renders THIS when the root layout itself throws, so it
// REPLACES the entire document — the root <html>/<body>/chrome is gone and unavailable. It therefore must
// render its own <html>/<body> and stand alone (no NavShell, no fonts, no globals guaranteed). `reset()` is
// an event handler → this MUST be a client component (the RSC lesson: an onClick on a Server Component
// builds but 500s at render). Styling is INLINE so the screen renders even if the stylesheet never loaded.
// The palette mirrors the editorial design tokens' literal values (warm bone paper, warm charcoal ink,
// evergreen button, terracotta eyebrow) with a serif heading + clean sans body — the premium outdoor-
// editorial look in its most minimal, self-contained form.

import { useEffect } from "react";

const SERIF = "Georgia, 'Times New Roman', 'Iowan Old Style', serif";
const SANS =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

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
          backgroundColor: "#f7f4ee",
          color: "#29241f",
          fontFamily: SANS,
          WebkitFontSmoothing: "antialiased",
          padding: "1.5rem",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "27rem",
            border: "1px solid #dcd6cc",
            borderRadius: "0.5rem",
            backgroundColor: "#fdfbf6",
            boxShadow: "0 1px 2px rgba(43,38,32,0.06), 0 12px 32px -18px rgba(43,38,32,0.10)",
            padding: "2.5rem 2.25rem",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: SANS,
              fontSize: "0.6875rem",
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: "#c85a30",
              margin: "0 0 1rem",
            }}
          >
            Something interrupted
          </p>
          <h1
            style={{
              fontFamily: SERIF,
              fontSize: "1.7rem",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              lineHeight: 1.15,
              margin: "0 0 0.75rem",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontFamily: SANS,
              fontSize: "0.95rem",
              lineHeight: 1.6,
              color: "#6b655e",
              margin: "0 auto 1.75rem",
              maxWidth: "22rem",
            }}
          >
            The app hit an unexpected error and couldn&apos;t recover this view. Reload to try again.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: SANS,
                fontSize: "0.75rem",
                color: "#9a9388",
                margin: "0 0 1.5rem",
              }}
            >
              Reference{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {error.digest}
              </span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              border: "none",
              backgroundColor: "#21493a",
              color: "#fbf9f3",
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: "0.875rem",
              padding: "0.7rem 1.5rem",
              borderRadius: "0.375rem",
              boxShadow: "0 1px 2px rgba(43,38,32,0.06)",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
