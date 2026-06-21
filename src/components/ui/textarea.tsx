"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground shadow-press-in",
      "placeholder:text-muted-foreground placeholder:font-mono placeholder:text-xs",
      "transition-[border-color,box-shadow] duration-150 ease-crisp",
      "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "resize-y",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
