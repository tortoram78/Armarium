"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Submit button that reflects the parent <form>'s pending state. The classify
 * and trip-parse server actions call the LLM and take a few seconds; without a
 * pending state the button gives no feedback and the page reads as frozen
 * ("bricked") while the in-flight POST blocks the tab. This makes the wait
 * legible: the button disables and swaps to its pending label.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}
