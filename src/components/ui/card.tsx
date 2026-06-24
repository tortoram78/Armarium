import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — a machined panel.
 *
 * variant:
 *   "flat"  (default) — the original look: hairline border + letterpress edge.
 *                       Unchanged so existing pages are unaffected.
 *   "bezel" — a raised plate proud of the deck: 1px bright milled top-left edge,
 *             1px dark cut bottom-right edge, hard 0-blur cast shadow down-right.
 *   "well"  — a recessed inset panel: darker surface, hard inset top-left shadow.
 *
 * Depth comes from precise milled edges + hard directional casts, never soft blur.
 */
type CardVariant = "flat" | "bezel" | "well";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const CARD_VARIANT: Record<CardVariant, string> = {
  flat: "border border-border bg-card text-card-foreground shadow-letterpress",
  bezel: "surface-bezel",
  well: "surface-well",
};

export function Card({ className, variant = "flat", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-none",
        CARD_VARIANT[variant],
        "transition-[border-color,background-color] duration-150 ease-crisp",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1 p-3.5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-semibold leading-tight tracking-tight text-card-foreground", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3.5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-3.5 pt-0", className)} {...props} />;
}
