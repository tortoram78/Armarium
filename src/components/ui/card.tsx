import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — a flat, machined panel.
 * Square corners + a 1px hairline border + a subtle letterpress edge.
 * No soft drop-shadow: depth comes from precise edges, not blur.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-none border border-border bg-card text-card-foreground shadow-letterpress",
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
