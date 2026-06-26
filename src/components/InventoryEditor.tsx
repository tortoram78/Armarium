"use client";

// Inline inventory editor — lets the user patch ownership/physical metadata for an item.
// "use client" because it manages open/closed toggle state; the form action is a server action
// passed as a prop. Plain <form> with server action — no client JS needed for the submit itself.

import { useState } from "react";
import type { InventoryMeta } from "@/core/inventory";
import { OWNERSHIP_STATUS, CONDITION } from "@/core/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface InventoryEditorProps {
  itemId: string;
  inventory: InventoryMeta;
  action: (formData: FormData) => void | Promise<void>;
  /** If true, the editor opens immediately. */
  defaultOpen?: boolean;
}

export function InventoryEditor({ itemId, inventory, action, defaultOpen }: InventoryEditorProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit inventory
      </Button>
    );
  }

  // Convert stored cents to a dollars display value.
  const priceDollarsDefault =
    inventory.pricePaidCents !== null
      ? (inventory.pricePaidCents / 100).toFixed(2)
      : "";

  return (
    <div className="panel bg-muted/40 p-5 sm:p-6">
      <div className="mb-5 flex items-baseline gap-4 border-b border-border pb-3">
        <h3 className="display-md text-foreground">Edit inventory</h3>
        <span className="h-px flex-1 bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <form action={action} className="space-y-6">
        <input type="hidden" name="id" value={itemId} />

        {/* Status + quantity row */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ownership status</Label>
            <Select name="ownershipStatus" defaultValue={inventory.ownershipStatus} className="h-10">
              {OWNERSHIP_STATUS.map((s) => (
                <option key={s} value={s}>{titleize(s)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Quantity</Label>
            <Input
              type="number"
              name="quantity"
              min={1}
              step={1}
              defaultValue={inventory.quantity}
              className="data-mono h-10"
            />
          </div>
        </div>

        {/* Condition + acquired date */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Condition</Label>
            <Select name="condition" defaultValue={inventory.condition ?? ""} className="h-10">
              <option value="">Not recorded</option>
              {CONDITION.map((c) => (
                <option key={c} value={c}>{titleize(c)}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Acquired date</Label>
            <Input
              type="date"
              name="acquiredAt"
              defaultValue={inventory.acquiredAt ?? ""}
              className="data-mono h-10"
            />
          </div>
        </div>

        {/* Price + acquired from */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Price paid ($)</Label>
            <Input
              type="number"
              name="pricePaidDollars"
              min={0}
              step={0.01}
              placeholder="e.g. 249.00"
              defaultValue={priceDollarsDefault}
              className="data-mono h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Acquired from</Label>
            <Input
              type="text"
              name="acquiredFrom"
              placeholder="e.g. REI, eBay"
              defaultValue={inventory.acquiredFrom ?? ""}
              className="h-10"
            />
          </div>
        </div>

        {/* Storage location + size + color */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Storage location</Label>
            <Input
              type="text"
              name="storageLocation"
              placeholder="e.g. garage shelf A"
              defaultValue={inventory.storageLocation ?? ""}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Size</Label>
            <Input
              type="text"
              name="size"
              placeholder="e.g. M, 10.5"
              defaultValue={inventory.size ?? ""}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Color</Label>
            <Input
              type="text"
              name="color"
              placeholder="e.g. navy"
              defaultValue={inventory.color ?? ""}
              className="h-10"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Notes</Label>
          <Textarea
            name="userNotes"
            placeholder="Any notes about this item…"
            defaultValue={inventory.userNotes ?? ""}
            className="min-h-[80px]"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm">
            Save changes
          </Button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
