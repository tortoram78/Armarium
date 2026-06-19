"use client";

import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof Button> & { message: string };

// A submit button that asks for confirmation on the CLIENT before the form's server action runs.
// Keeping the handler inside a client component avoids passing an event handler across the
// server→client boundary (which crashes a Server Component at render time).
export function ConfirmButton({ message, children, ...props }: Props) {
  return (
    <Button
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
