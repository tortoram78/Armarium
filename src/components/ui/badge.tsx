import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — a square spec-stamp / data tag, not a rounded pill.
 * Monospace, uppercase, hairline-bordered: reads like a field-manual
 * legend chip or a stamped capability marker.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center rounded-sm border px-1.5 py-0.5",
    "font-mono text-[0.625rem] font-medium uppercase tracking-wide leading-none",
    "transition-colors",
  ].join(" "),
  {
    variants: {
      variant: {
        default:     "border-primary/40 bg-primary/15 text-primary",
        outline:     "border-border text-foreground",
        subtle:      "border-border bg-secondary/60 text-muted-foreground",
        success:     "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
        critical:    "border-red-600/50 bg-red-600/10 text-red-700 dark:text-red-400",
        high:        "border-orange-600/50 bg-orange-600/10 text-orange-700 dark:text-orange-400",
        medium:      "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400",
        low:         "border-border bg-secondary/60 text-muted-foreground",
        /* verify = blaze-orange punctuation: an unknown/uncertain flag */
        verify:      "border-blaze/70 bg-blaze/15 text-blaze",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
