import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-neutral-900 text-white",
        outline: "border-neutral-300 text-neutral-700",
        subtle: "border-transparent bg-neutral-100 text-neutral-700",
        success: "border-transparent bg-green-100 text-green-800",
        critical: "border-transparent bg-red-100 text-red-800",
        high: "border-transparent bg-orange-100 text-orange-800",
        medium: "border-transparent bg-amber-100 text-amber-800",
        low: "border-transparent bg-neutral-100 text-neutral-700",
        verify: "border-transparent bg-yellow-100 text-yellow-900",
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
