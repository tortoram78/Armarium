"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    // square-ish, letter-spaced label — a machined control, not a pill
    "relative inline-flex items-center justify-center gap-2 rounded-sm",
    "text-sm font-semibold uppercase tracking-legend",
    "transition-[transform,background-color,box-shadow,border-color,color] duration-150 ease-crisp",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    // crisp tactile press: tiny scale + inset ink, no bounce
    "active:scale-[0.985] active:shadow-press-in",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-letterpress hover:brightness-110",
        outline:
          "border border-border bg-transparent text-foreground hover:border-accent hover:text-accent",
        ghost:
          "text-foreground hover:bg-secondary",
        subtle:
          "bg-secondary text-secondary-foreground border border-border hover:border-foreground/30",
        destructive:
          "bg-destructive text-destructive-foreground shadow-letterpress hover:brightness-110",
        link:
          "underline-offset-4 hover:underline text-accent p-0 h-auto normal-case tracking-normal font-medium",
      },
      size: {
        default: "h-10 px-4 py-2 text-xs",
        sm:      "h-8 px-3 text-[0.6875rem]",
        lg:      "h-11 px-6 text-sm",
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
