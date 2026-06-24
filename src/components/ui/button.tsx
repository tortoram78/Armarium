"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — editorial, calm. Sentence-case Inter label, gentle radius,
 * generous padding, quiet hover. No machined bezel, no uppercase shouting.
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 rounded-md",
    "font-sans text-sm font-medium leading-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-crisp",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/92 shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-secondary hover:border-foreground/20",
        ghost:
          "text-foreground hover:bg-secondary",
        subtle:
          "bg-secondary text-secondary-foreground hover:bg-muted",
        accent:
          "bg-accent text-accent-foreground hover:bg-accent/92 shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/92",
        link:
          "text-primary underline-offset-4 hover:underline p-0 h-auto font-medium",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm:      "h-9 px-4 text-[0.8125rem]",
        lg:      "h-12 px-7 text-[0.9375rem]",
        icon:    "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
