"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground shadow-press-in",
      "transition-[border-color,box-shadow] duration-150 ease-crisp",
      "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
