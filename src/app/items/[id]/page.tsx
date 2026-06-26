import { notFound, redirect } from "next/navigation";
import { getItem, resolveItem, isItemGear } from "@/server/app-service";
import { getSignedItemImageUrl } from "@/server/item-images";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/core/capabilities";
import {
  setInventoryAction,
  deleteItemAction,
  updateFacetsAction,
  setItemImageAction,
  removeItemImageAction,
  updateInventoryAction,
  classifyNowAction,
} from "@/app/actions";
import { FacetEditor } from "@/components/FacetEditor";
import { InventoryEditor } from "@/components/InventoryEditor";
import { ItemImageUploader } from "@/components/ItemImageUploader";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { getUserIdOrGuest } from "@/lib/auth";

export const dynamic = "force-dynamic";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A serif section heading with a hairline rule and an optional mono count — the established
 *  closet/plan masthead pattern, reused here for the spec-sheet sections. */
function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-baseline gap-4">
      <h2 className="display-md text-foreground">{title}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
      {count !== undefined && (
        <span className="data-mono text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

type EvidenceAny =
  | { value: string | number | boolean | null; confidence?: string; source?: string; evidence?: string }
  | null
  | undefined;

/** A single spec row: label · value (mono for data) · quiet provenance, or an honest "unknown". */
function SpecRow({ e, label }: { e: EvidenceAny; label: string }) {
  if (!e || e.value === null) {
    return (
      <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm italic text-accent">Unknown — verify</span>
      </div>
    );
  }
  const displayVal =
    typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : String(e.value).replace(/_/g, " ");
  const provenance = [
    e.confidence && e.confidence !== "unknown" ? `${e.confidence} confidence` : "",
    e.source && e.source !== "unknown" ? e.source : "",
    e.evidence ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="data-mono text-[0.8125rem] capitalize text-foreground">{displayVal}</span>
        {provenance && (
          <span className="text-[0.6875rem] leading-snug text-muted-foreground/70">{provenance}</span>
        )}
      </div>
    </div>
  );
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { facetError?: string; edit?: string; imageError?: string; inventoryError?: string };
}) {
  // READ gate — never redirects. A guest views a sample item from the seeded closet; the write affordances
  // (inventory toggle, delete, facet editor, photo upload) are hidden for a guest since their actions are
  // write-gated.
  const { userId, isGuest } = await getUserIdOrGuest();
  const item = await getItem(params.id, userId);
  if (!item) notFound();
  // If still a draft, send to review
  if (item.draft) redirect(`/items/${params.id}/review`);

  // Sign the item's private photo path (ADR-0018 §D). null when there's no photo, OR storage is
  // unconfigured (the hermetic build / dev), OR the object is missing — the lead-image block is then
  // skipped and the spec sheet renders text-first (no broken image).
  const imageUrl = await getSignedItemImageUrl(item.imagePath ?? null);

  const resolved = resolveItem(item);

  // Domain gate — gear-specific UI is shown only when the item is classified into the gear domain.
  const isGear = isItemGear(item);

  const c = item.classification;

  // Only evaluate capabilities for gear items (they have no facets otherwise).
  const capResults = isGear
    ? CAPABILITY_KEYS.map((cap) => ({
        cap,
        label: CAPABILITY_LABELS[cap],
        result: evaluateCapability(resolved, cap),
      }))
    : [];
  const satisfied = capResults.filter((r) => r.result === "satisfies");
  const verify = capResults.filter((r) => r.result === "blocked_unknown");
  const verifyCount = verify.length;

  // A confident brand · model subhead when those identity facts are known (and not just an echo of the
  // item name) — gives the spec sheet a premium product-page header.
  const brand = c.identity.brand.value;
  const model = c.identity.model.value;
  const identityLine = [brand, model].filter(Boolean).join(" · ");
  const showIdentityLine = identityLine.length > 0 && identityLine !== item.name;

  const priceDollars =
    c.identity.price_cents.value !== null ? c.identity.price_cents.value / 100 : null;

  // Header meta line differs by domain: gear shows capability count; non-gear shows honest "not yet classified"
  const metaCapabilityNode = isGear ? (
    <>
      <span aria-hidden className="text-muted-foreground/40">·</span>
      <span>
        <span className="data-mono text-foreground">{satisfied.length}</span>{" "}
        {satisfied.length === 1 ? "capability" : "capabilities"}
      </span>
      {verifyCount > 0 && (
        <>
          <span aria-hidden className="text-muted-foreground/40">·</span>
          <span className="text-accent">
            <span className="data-mono">{verifyCount}</span> to verify
          </span>
        </>
      )}
    </>
  ) : (
    <>
      <span aria-hidden className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground italic">Not yet classified</span>
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Closet
      </Link>

      {/* ── Masthead — the spec-sheet header ── */}
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            <p className="eyebrow mb-3">{isGear ? "Gear" : "Possession"}</p>
            <h1 className="display-xl text-foreground">{item.name}</h1>
            {showIdentityLine && (
              <p className="mt-3 text-[0.975rem] text-muted-foreground">{identityLine}</p>
            )}
            <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.95rem] text-muted-foreground">
              <span>
                Added{" "}
                <span className="data-mono text-foreground">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span aria-hidden className="text-muted-foreground/40">·</span>
              <span className={item.inInventory ? "text-foreground" : "text-muted-foreground"}>
                {item.inInventory ? "In inventory" : "Catalog only"}
              </span>
              {metaCapabilityNode}
              {priceDollars !== null && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span className="data-mono text-foreground">${priceDollars.toFixed(2)}</span>
                </>
              )}
            </p>
          </div>

          {/* Write affordances — hidden for a guest (their actions are write-gated behind requireUserId). */}
          {!isGuest && (
            <div className="flex shrink-0 gap-2">
              <form action={setInventoryAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="inInventory" value={item.inInventory ? "false" : "true"} />
                <Button type="submit" variant="outline" size="sm">
                  {item.inInventory ? "Remove from inventory" : "Add to inventory"}
                </Button>
              </form>
              <form action={deleteItemAction}>
                <input type="hidden" name="id" value={item.id} />
                <ConfirmButton
                  message="Delete this item?"
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  Delete
                </ConfirmButton>
              </form>
            </div>
          )}
        </div>

        {searchParams.facetError && (
          <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
            {searchParams.facetError}
          </p>
        )}
        {searchParams.imageError && (
          <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
            That photo couldn&apos;t be saved. Use a JPEG, PNG, or WebP under 5 MB and try again.
          </p>
        )}
        {searchParams.inventoryError && (
          <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
            Inventory couldn&apos;t be saved — please try again.
          </p>
        )}
      </header>

      {/* ── Lead photo (display-only — ADR-0018) + upload control. The hero shows only when a signed URL
            resolved; otherwise the spec sheet is text-first (graceful, no broken image). The uploader is
            hidden for a guest (its write action is gated) and self-hides when storage is unconfigured. ── */}
      {(imageUrl || !isGuest) && (
        <section className="space-y-4">
          {imageUrl && (
            <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={item.name}
                className="max-h-[28rem] w-full object-cover"
              />
            </div>
          )}
          {!isGuest && (
            <ItemImageUploader
              itemId={item.id}
              userId={userId}
              hasImage={Boolean(imageUrl)}
              setAction={setItemImageAction}
              removeAction={removeItemImageAction}
            />
          )}
        </section>
      )}

      {/* ── Capabilities — GEAR ONLY ── */}
      {isGear && (
        <section>
          <SectionHead title="Capabilities" count={satisfied.length} />
          {satisfied.length > 0 && (
            <div className="mb-4">
              <p className="eyebrow mb-2.5">Satisfies</p>
              <div className="flex flex-wrap gap-1.5">
                {satisfied.map(({ cap, label }) => (
                  <Badge key={cap} variant="success">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {verify.length > 0 && (
            <div>
              <p className="eyebrow mb-2.5 text-accent">Unknown — verify before relying on</p>
              <div className="flex flex-wrap gap-1.5">
                {verify.map(({ cap, label }) => (
                  <Badge key={cap} variant="verify">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {satisfied.length === 0 && verify.length === 0 && (
            <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
              No capabilities confirmed yet — many facets may be unknown. Correct them below to unlock more.
            </p>
          )}
        </section>
      )}

      {/* ── Identity — always shown ── */}
      <section>
        <SectionHead title="Identity" />
        <div className="panel px-5 py-1">
          <SpecRow e={c.identity.brand} label="Brand" />
          <SpecRow e={c.identity.model} label="Model" />
          {priceDollars !== null && (
            <SpecRow
              e={{ ...c.identity.price_cents, value: `$${priceDollars.toFixed(2)}` }}
              label="Price"
            />
          )}
          <SpecRow e={c.identity.weight_grams} label="Weight (g)" />
        </div>
      </section>

      {/* ── Materials & composition — GEAR ONLY (non-gear items typically have no material breakdown) ── */}
      {isGear && (c.materials.length > 0 || c.treatments.length > 0) && (
        <section>
          <SectionHead
            title="Material & composition"
            count={c.materials.length + c.treatments.length || undefined}
          />
          {c.materials.length > 0 && (
            <div className="panel mb-4 px-5 py-1">
              {c.materials.map((m, i) => (
                <div
                  key={i}
                  className="border-b border-border/60 py-3 text-sm leading-relaxed text-foreground last:border-0"
                >
                  <span className="font-medium capitalize">{m.role}</span>
                  {m.name ? <span className="text-muted-foreground"> — {m.name}</span> : ""}
                  {m.fiber_components.length > 0 && (
                    <span className="data-mono text-[0.8125rem] text-muted-foreground">
                      {" "}
                      ({m.fiber_components
                        .map((fc) => `${fc.fiber}${fc.pct != null ? ` ${fc.pct}%` : ""}`)
                        .join(", ")})
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {c.treatments.length > 0 && (
            <div className="panel px-5 py-1">
              {c.treatments.map((t, i) => (
                <div
                  key={i}
                  className="border-b border-border/60 py-3 text-sm leading-relaxed text-foreground last:border-0"
                >
                  <span className="font-medium capitalize">{t.kind.replace(/_/g, " ")}</span>
                  {t.condition ? (
                    <span className="text-muted-foreground"> ({t.condition.replace(/_/g, " ")})</span>
                  ) : (
                    ""
                  )}
                  <span className="text-muted-foreground"> — {t.evidence}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Universal facets — GEAR ONLY ── */}
      {isGear && (
        <section>
          <SectionHead title="Universal facets" />
          <div className="panel px-5 py-1">
            <SpecRow e={c.universal.waterproofness} label="Waterproofness" />
            <SpecRow e={c.universal.wind_resistance} label="Wind resistance" />
            <SpecRow e={c.universal.breathability} label="Breathability" />
            <SpecRow e={c.universal.moisture_management} label="Moisture management" />
            <SpecRow e={c.universal.dry_speed} label="Dry speed" />
            <SpecRow e={c.universal.warmth_when_wet} label="Warmth when wet" />
            <SpecRow e={c.universal.warmth} label="Warmth" />
            <SpecRow e={c.universal.packability} label="Packability" />
            <SpecRow e={c.universal.technical_vs_lifestyle} label="Technical vs lifestyle" />
            <SpecRow e={c.universal.upf} label="UPF" />
          </div>
        </section>
      )}

      {/* ── Multi-label facets (Function & fit) — GEAR ONLY ── */}
      {isGear && (
        <section>
          <SectionHead title="Function & fit" />
          <div className="panel space-y-4 p-5">
            {(
              [
                ["Layering role", c.multilabel.layering_role],
                ["Function / purpose", c.multilabel.function_purpose],
                ["Body zone", c.multilabel.body_zone_covered],
                ["Activity fit", c.multilabel.activity_fit],
                ["Conditions fit", c.multilabel.conditions_fit],
              ] as [string, readonly string[]][]
            ).map(([label, vals]) => (
              <div key={label}>
                <p className="eyebrow mb-2">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {vals.length === 0 ? (
                    <span className="text-sm italic text-accent">None — verify</span>
                  ) : (
                    vals.map((v) => (
                      <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Domain groups — group-specific specs — GEAR ONLY ── */}
      {isGear && c.applicable_groups.length > 0 && (
        <section>
          <SectionHead title="Group-specific specs" />
          <div className="space-y-6">
            {c.applicable_groups.map((gk) => {
              const grp = c.groups[gk as keyof typeof c.groups];
              if (!grp) return null;
              return (
                <div key={gk}>
                  <p className="eyebrow mb-2">{titleize(gk)}</p>
                  <div className="panel px-5 py-1">
                    {Object.entries(grp).map(([fk, fv]) => (
                      <SpecRow key={fk} e={fv as EvidenceAny} label={titleize(fk)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Inventory — ownership/physical metadata layer (ADR-0021) — always shown ── */}
      <section>
        <SectionHead title="Inventory" />

        {/* Display: show all fields, "—" for nulls honestly (unknown-is-first-class). */}
        <div className="panel mb-4 px-5 py-1">
          {/* Status */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Ownership status</span>
            <span className="data-mono text-[0.8125rem] capitalize text-foreground">
              {item.inventory.ownershipStatus}
            </span>
          </div>
          {/* Quantity */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Quantity</span>
            <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.quantity}</span>
          </div>
          {/* Condition */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Condition</span>
            {item.inventory.condition ? (
              <span className="data-mono text-[0.8125rem] capitalize text-foreground">
                {item.inventory.condition.replace(/_/g, " ")}
              </span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Acquired date */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Acquired</span>
            {item.inventory.acquiredAt ? (
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.acquiredAt}</span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Price paid */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Price paid</span>
            {item.inventory.pricePaidCents !== null ? (
              <span className="data-mono text-[0.8125rem] text-foreground">
                ${(item.inventory.pricePaidCents / 100).toFixed(2)}
              </span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Acquired from */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Acquired from</span>
            {item.inventory.acquiredFrom ? (
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.acquiredFrom}</span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Storage location */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Storage location</span>
            {item.inventory.storageLocation ? (
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.storageLocation}</span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Size */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Size</span>
            {item.inventory.size ? (
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.size}</span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Color */}
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Color</span>
            {item.inventory.color ? (
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.color}</span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
          {/* Notes */}
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <span className="text-sm text-muted-foreground">Notes</span>
            {item.inventory.userNotes ? (
              <span className="max-w-xs text-right text-[0.8125rem] text-foreground">
                {item.inventory.userNotes}
              </span>
            ) : (
              <span className="text-sm italic text-accent">—</span>
            )}
          </div>
        </div>

        {/* Edit affordance — write-gated */}
        {!isGuest ? (
          <InventoryEditor
            itemId={item.id}
            inventory={item.inventory}
            action={updateInventoryAction}
          />
        ) : (
          <div className="panel flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-5">
            <p className="text-sm text-muted-foreground">Editing inventory requires an account.</p>
            <Link
              href={`/login?next=${encodeURIComponent(`/items/${item.id}`)}`}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
            >
              Log in to edit
            </Link>
          </div>
        )}
      </section>

      {/* ── Classify affordance — shown for non-gear items (no behavioral facets yet) ── */}
      {item.inventory.domains.length === 0 && (
        <section>
          <div className="panel flex flex-wrap items-center justify-between gap-4 bg-muted/30 p-5">
            <div>
              <p className="text-sm font-medium text-foreground">Add details and classify</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                This item was recorded quickly. Classify it now to unlock capabilities, or add specs and
                a manufacturer link for richer results.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {!isGuest && (
                <form action={classifyNowAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <Button type="submit" size="sm">
                    Classify now
                  </Button>
                </form>
              )}
              <Link
                href={`/items/new?name=${encodeURIComponent(item.name)}`}
                className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-secondary"
              >
                Add specs / link
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Facet editor — GEAR ONLY; correction is a write; hidden for a guest. ── */}
      {isGear && (
        <section>
          <SectionHead title="Correct facets" />
          {!isGuest ? (
            <FacetEditor
              itemId={item.id}
              classification={c}
              action={updateFacetsAction}
              defaultOpen={searchParams.edit === "1"}
            />
          ) : (
            <div className="panel flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-5">
              <p className="text-sm text-muted-foreground">Correcting facets requires an account.</p>
              <Link
                href={`/login?next=${encodeURIComponent(`/items/${item.id}`)}`}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
              >
                Log in to edit
              </Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
