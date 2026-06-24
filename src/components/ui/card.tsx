import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — an editorial panel: warm white, hairline border, gentle radius,
 * generous padding. Depth is restraint, not skeuomorphism.
 *
 * variant:
 *   "flat"  (default) — hairline border on warm card, no shadow.
 *   "raised" — adds one soft low shadow for a standout panel.
 *   "muted"  — a quiet warm-tinted recess (no inset shadow; just tone).
 *
 * "bezel"/"well" are RETAINED legacy aliases (not-yet-migrated screens use
 * them). They now resolve to the flat editorial language — "bezel" → raised,
 * "well" → muted — so those pages recolor cleanly until they're redesigned.
 */
type CardVariant = "flat" | "raised" | "muted" | "bezel" | "well";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const CARD_VARIANT: Record<CardVariant, string> = {
  flat:   "border border-border bg-card text-card-foreground",
  raised: "border border-border bg-card text-card-foreground elev-soft",
  muted:  "border border-border bg-muted/50 text-card-foreground",
  bezel:  "border border-border bg-card text-card-foreground elev-soft",
  well:   "border border-border bg-muted/50 text-card-foreground",
};

export function Card({ className, variant = "flat", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg",
        CARD_VARIANT[variant],
        "transition-[border-color,box-shadow] duration-200 ease-crisp",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("subhead text-lg text-card-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
