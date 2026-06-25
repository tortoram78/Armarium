import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — a quiet editorial facet chip. Sentence-case Inter, soft tint,
 * gentle radius, hairline. Reads like a refined tag in a field journal,
 * not a loud SaaS pill or a stamped tactical marker.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center rounded-md border px-2 py-0.5",
    "font-sans text-[0.6875rem] font-medium leading-tight",
    "transition-colors",
  ].join(" "),
  {
    variants: {
      variant: {
        default:  "border-primary/20 bg-primary/8 text-primary",
        outline:  "border-border bg-transparent text-muted-foreground",
        subtle:   "border-border/60 bg-muted/40 text-muted-foreground",
        success:  "border-primary/20 bg-primary/8 text-primary",
        critical: "border-destructive/25 bg-destructive/8 text-destructive",
        high:     "border-accent/25 bg-accent/8 text-accent",
        medium:   "border-accent/20 bg-accent/6 text-accent",
        low:      "border-border bg-secondary/70 text-muted-foreground",
        /* verify = the restrained terracotta accent: an honest unknown/uncertain flag */
        verify:   "border-accent/30 bg-accent/8 text-accent",
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
