import { notFound, redirect } from "next/navigation";
import { getItem, resolveItem, isItemGear, isItemApparel, listCollections, collectionsForItem } from "@/server/app-service";
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
  setItemTagsAction,
  addItemToCollectionAction,
  removeItemFromCollectionAction,
  createCollectionAction,
} from "@/app/actions";
import { FacetEditor } from "@/components/FacetEditor";
import { InventoryEditor } from "@/components/InventoryEditor";
import { ItemImageUploader } from "@/components/ItemImageUploader";
import { TagsEditor } from "@/components/TagsEditor";
import { CollectionPicker } from "@/components/CollectionPicker";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { getUserIdOrGuest } from "@/lib/auth";

export const dynamic = "force-dynamic";
// "Classify now" (classifyNowAction) runs the live classifier from THIS route, so it needs the same
// raised serverless ceiling as /items/new — without it the action times out at the ~15s default and the
// page 500s ("bricks"). (Vercel Hobby allows up to 60s.)
export const maxDuration = 60;

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A serif section heading with a hairline rule and an optional mono count — the established
 *  closet/plan masthead pattern, reused here for the spec-sheet sections. */
function SectionHead({ title, count, muted = false }: { title: string; count?: number; muted?: boolean }) {
  return (
    <div className="mb-4 flex items-baseline gap-4">
      <h2 className={muted ? "display-md text-muted-foreground" : "display-md text-foreground"}>{title}</h2>
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

/** Is a facet actually known? Unknown is first-class — we simply DON'T render it (absence = unknown),
 *  rather than fabricating a value OR shouting "verify" at a normal user. */
const known = (e: EvidenceAny): boolean => !!(e && e.value !== null && e.value !== undefined);

/**
 * A single spec row — KNOWN values only. Unknown facets render nothing (the caller filters them out
 * and hides empty sections), so the page reads as a calm sheet of what we actually know, never a wall
 * of "verify" prompts. Specs are optional enrichment, not a chore.
 */
function SpecRow({ e, label }: { e: EvidenceAny; label: string }) {
  if (!known(e)) return null;
  const ev = e as { value: string | number | boolean; confidence?: string; source?: string; evidence?: string };
  const displayVal =
    typeof ev.value === "boolean" ? (ev.value ? "Yes" : "No") : String(ev.value).replace(/_/g, " ");
  const provenance = [
    ev.confidence && ev.confidence !== "unknown" ? `${ev.confidence} confidence` : "",
    ev.source && ev.source !== "unknown" ? ev.source : "",
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
  searchParams: { facetError?: string; edit?: string; imageError?: string; inventoryError?: string; tagsError?: string };
}) {
  // READ gate — never redirects. A guest views a sample item from the seeded closet; the write affordances
  // (inventory toggle, delete, facet editor, photo upload) are hidden for a guest since their actions are
  // write-gated.
  const { userId, isGuest } = await getUserIdOrGuest();
  const item = await getItem(params.id, userId);
  if (!item) notFound();
  // If still a draft, send to review
  if (item.draft) redirect(`/items/${params.id}/review`);

  const imageUrl = await getSignedItemImageUrl(item.imagePath ?? null);

  const [allCollections, itemCollections] = isGuest
    ? [[], []]
    : await Promise.all([listCollections(userId), collectionsForItem(params.id, userId)]);

  const resolved = resolveItem(item);
  const isGear = isItemGear(item);
  const isApparel = isItemApparel(item);
  const c = item.classification;

  // Confirmed capabilities only — what this item CAN do. Unknown/blocked capabilities are not shown as
  // red "verify" badges; instead a single calm hint invites enrichment (below).
  const capResults = isGear
    ? CAPABILITY_KEYS.map((cap) => ({ cap, label: CAPABILITY_LABELS[cap], result: evaluateCapability(resolved, cap) }))
    : [];
  const satisfied = capResults.filter((r) => r.result === "satisfies");
  const blockedCount = capResults.filter((r) => r.result === "blocked_unknown").length;

  const brand = c.identity.brand.value;
  const model = c.identity.model.value;
  const identityLine = [brand, model].filter(Boolean).join(" · ");
  const showIdentityLine = identityLine.length > 0 && identityLine !== item.name;
  const priceDollars = c.identity.price_cents.value !== null ? c.identity.price_cents.value / 100 : null;

  const eyebrowLabel = isGear && isApparel ? "Gear · apparel" : isGear ? "Gear" : isApparel ? "Apparel" : "Possession";

  // ── Which spec sections actually have KNOWN content (so we never render an empty bordered box) ──
  const identityKnown = known(c.identity.brand) || known(c.identity.model) || priceDollars !== null || known(c.identity.weight_grams);

  const universalRows: [string, EvidenceAny][] = [
    ["Waterproofness", c.universal.waterproofness],
    ["Wind resistance", c.universal.wind_resistance],
    ["Breathability", c.universal.breathability],
    ["Moisture management", c.universal.moisture_management],
    ["Dry speed", c.universal.dry_speed],
    ["Warmth when wet", c.universal.warmth_when_wet],
    ["Warmth", c.universal.warmth],
    ["Packability", c.universal.packability],
    ["Technical vs lifestyle", c.universal.technical_vs_lifestyle],
    ["UPF", c.universal.upf],
  ];
  const universalKnown = universalRows.filter(([, e]) => known(e));

  const multilabelRows: [string, readonly string[]][] = [
    ["Layering role", c.multilabel.layering_role],
    ["Function / purpose", c.multilabel.function_purpose],
    ["Body zone", c.multilabel.body_zone_covered],
    ["Activity fit", c.multilabel.activity_fit],
    ["Conditions fit", c.multilabel.conditions_fit],
  ];
  const multilabelKnown = multilabelRows.filter(([, vals]) => vals.length > 0);

  const groupSections = (
    isGear
      ? c.applicable_groups.map((gk) => {
          const grp = c.groups[gk as keyof typeof c.groups];
          if (!grp) return null;
          const rows = Object.entries(grp).filter(([, fv]) => known(fv as EvidenceAny));
          return rows.length > 0 ? { gk, rows } : null;
        })
      : []
  ).filter((g): g is NonNullable<typeof g> => g !== null);

  const ap = c.groups.apparel;
  const apparelKnown =
    isApparel &&
    !!ap &&
    (ap.garment_role.length > 0 ||
      known(ap.formality) ||
      known(ap.fit) ||
      known(ap.pattern) ||
      ap.care.length > 0 ||
      ap.occasion.length > 0);

  const materialsKnown = (isGear || isApparel) && (c.materials.length > 0 || c.treatments.length > 0);

  const hasAnyKnownSpec =
    satisfied.length > 0 ||
    identityKnown ||
    universalKnown.length > 0 ||
    multilabelKnown.length > 0 ||
    groupSections.length > 0 ||
    apparelKnown ||
    materialsKnown;

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Closet
      </Link>

      {/* ── Masthead ── */}
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            <p className="eyebrow mb-3">{eyebrowLabel}</p>
            <h1 className="display-xl text-foreground">{item.name}</h1>
            {showIdentityLine && <p className="mt-3 text-[0.975rem] text-muted-foreground">{identityLine}</p>}
            <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.95rem] text-muted-foreground">
              <span className={item.inventory.ownershipStatus === "owned" ? "text-foreground" : "text-muted-foreground"}>
                {titleize(item.inventory.ownershipStatus)}
              </span>
              {item.inventory.quantity > 1 && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span>
                    Qty <span className="data-mono text-foreground">{item.inventory.quantity}</span>
                  </span>
                </>
              )}
              {isGear && satisfied.length > 0 && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span>
                    <span className="data-mono text-foreground">{satisfied.length}</span>{" "}
                    {satisfied.length === 1 ? "capability" : "capabilities"}
                  </span>
                </>
              )}
              {priceDollars !== null && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span className="data-mono text-foreground">${priceDollars.toFixed(2)}</span>
                </>
              )}
            </p>
          </div>

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

      {/* ── Lead photo (display-only — ADR-0018) + upload control ── */}
      {(imageUrl || !isGuest) && (
        <section className="space-y-4">
          {imageUrl && (
            <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={item.name} className="max-h-[28rem] w-full object-cover" />
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

      {/* ════════════════════════════════════════════════════════════════════════════════════════
          YOUR STUFF FIRST — the facts a normal user cares about (ownership, tags, kits). These come
          before specs, and an item is "complete" with just these. Specs are optional enrichment below.
          ════════════════════════════════════════════════════════════════════════════════════════ */}

      {/* ── Inventory — ownership/physical metadata layer (ADR-0021) ── */}
      <section>
        <SectionHead title="Your item" />
        <div className="panel mb-4 px-5 py-1">
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Status</span>
            <span className="data-mono text-[0.8125rem] capitalize text-foreground">{item.inventory.ownershipStatus}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
            <span className="text-sm text-muted-foreground">Quantity</span>
            <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.quantity}</span>
          </div>
          {item.inventory.condition && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
              <span className="text-sm text-muted-foreground">Condition</span>
              <span className="data-mono text-[0.8125rem] capitalize text-foreground">{item.inventory.condition.replace(/_/g, " ")}</span>
            </div>
          )}
          {item.inventory.size && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
              <span className="text-sm text-muted-foreground">Size</span>
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.size}</span>
            </div>
          )}
          {item.inventory.color && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
              <span className="text-sm text-muted-foreground">Color</span>
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.color}</span>
            </div>
          )}
          {item.inventory.storageLocation && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
              <span className="text-sm text-muted-foreground">Storage</span>
              <span className="data-mono text-[0.8125rem] text-foreground">{item.inventory.storageLocation}</span>
            </div>
          )}
          {item.inventory.pricePaidCents !== null && (
            <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5">
              <span className="text-sm text-muted-foreground">Price paid</span>
              <span className="data-mono text-[0.8125rem] text-foreground">${(item.inventory.pricePaidCents / 100).toFixed(2)}</span>
            </div>
          )}
          {item.inventory.userNotes && (
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <span className="text-sm text-muted-foreground">Notes</span>
              <span className="max-w-xs text-right text-[0.8125rem] text-foreground">{item.inventory.userNotes}</span>
            </div>
          )}
        </div>

        {!isGuest ? (
          <InventoryEditor itemId={item.id} inventory={item.inventory} action={updateInventoryAction} />
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

      {/* ── Tags ── */}
      <section>
        <SectionHead title="Tags" />
        {searchParams.tagsError && (
          <p className="mb-3 panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
            Tags could not be saved — please try again.
          </p>
        )}
        {isGuest && item.inventory.userTags.length === 0 ? (
          <p className="text-[0.95rem] text-muted-foreground italic">No tags.</p>
        ) : (
          <TagsEditor itemId={item.id} tags={item.inventory.userTags} isGuest={isGuest} action={setItemTagsAction} />
        )}
      </section>

      {/* ── Collections (kits) ── */}
      {!isGuest && (
        <section>
          <SectionHead title="Collections" />
          <CollectionPicker
            itemId={item.id}
            collections={allCollections}
            memberOf={itemCollections}
            addAction={addItemToCollectionAction}
            removeAction={removeItemFromCollectionAction}
            createCollectionAction={createCollectionAction}
          />
        </section>
      )}

      {/* ════════════════════════════════════════════════════════════════════════════════════════
          SPECS — optional enrichment. Shown KNOWN-ONLY; unknown facets are simply absent. If nothing is
          known yet, a calm invitation to auto-fill (no wall of "verify").
          ════════════════════════════════════════════════════════════════════════════════════════ */}

      {hasAnyKnownSpec && (
        <section className="space-y-8">
          <SectionHead title="Specs" muted />

          {/* Capabilities — confirmed only */}
          {isGear && satisfied.length > 0 && (
            <div>
              <p className="eyebrow mb-2.5">What it can do</p>
              <div className="flex flex-wrap gap-1.5">
                {satisfied.map(({ cap, label }) => (
                  <Badge key={cap} variant="success">{label}</Badge>
                ))}
              </div>
            </div>
          )}

          {identityKnown && (
            <div>
              <p className="eyebrow mb-2.5">Identity</p>
              <div className="panel px-5 py-1">
                <SpecRow e={c.identity.brand} label="Brand" />
                <SpecRow e={c.identity.model} label="Model" />
                {priceDollars !== null && (
                  <SpecRow e={{ ...c.identity.price_cents, value: `$${priceDollars.toFixed(2)}` }} label="Price" />
                )}
                <SpecRow e={c.identity.weight_grams} label="Weight (g)" />
              </div>
            </div>
          )}

          {materialsKnown && (
            <div>
              <p className="eyebrow mb-2.5">Material &amp; composition</p>
              {c.materials.length > 0 && (
                <div className="panel mb-4 px-5 py-1">
                  {c.materials.map((m, i) => (
                    <div key={i} className="border-b border-border/60 py-3 text-sm leading-relaxed text-foreground last:border-0">
                      <span className="font-medium capitalize">{m.role}</span>
                      {m.name ? <span className="text-muted-foreground"> — {m.name}</span> : ""}
                      {m.fiber_components.length > 0 && (
                        <span className="data-mono text-[0.8125rem] text-muted-foreground">
                          {" "}
                          ({m.fiber_components.map((fc) => `${fc.fiber}${fc.pct != null ? ` ${fc.pct}%` : ""}`).join(", ")})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {c.treatments.length > 0 && (
                <div className="panel px-5 py-1">
                  {c.treatments.map((t, i) => (
                    <div key={i} className="border-b border-border/60 py-3 text-sm leading-relaxed text-foreground last:border-0">
                      <span className="font-medium capitalize">{t.kind.replace(/_/g, " ")}</span>
                      {t.condition ? <span className="text-muted-foreground"> ({t.condition.replace(/_/g, " ")})</span> : ""}
                      <span className="text-muted-foreground"> — {t.evidence}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {universalKnown.length > 0 && (
            <div>
              <p className="eyebrow mb-2.5">Performance</p>
              <div className="panel px-5 py-1">
                {universalKnown.map(([label, e]) => (
                  <SpecRow key={label} e={e} label={label} />
                ))}
              </div>
            </div>
          )}

          {isGear && multilabelKnown.length > 0 && (
            <div>
              <p className="eyebrow mb-2.5">Function &amp; fit</p>
              <div className="panel space-y-4 p-5">
                {multilabelKnown.map(([label, vals]) => (
                  <div key={label}>
                    <p className="eyebrow mb-2">{label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {vals.map((v) => (
                        <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupSections.length > 0 && (
            <div className="space-y-6">
              {groupSections.map(({ gk, rows }) => (
                <div key={gk}>
                  <p className="eyebrow mb-2">{titleize(gk)}</p>
                  <div className="panel px-5 py-1">
                    {rows.map(([fk, fv]) => (
                      <SpecRow key={fk} e={fv as EvidenceAny} label={titleize(fk)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {apparelKnown && ap && (
            <div>
              <p className="eyebrow mb-2.5">Apparel</p>
              <div className="panel space-y-4 p-5">
                {ap.garment_role.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Garment role</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ap.garment_role.map((v) => (
                        <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(known(ap.formality) || known(ap.fit) || known(ap.pattern)) && (
                  <div className="border-t border-border/60 pt-4">
                    <SpecRow e={ap.formality} label="Formality" />
                    <SpecRow e={ap.fit} label="Fit" />
                    <SpecRow e={ap.pattern} label="Pattern" />
                  </div>
                )}
                {ap.care.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Care</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ap.care.map((v) => (
                        <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {ap.occasion.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Occasion</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ap.occasion.map((v) => (
                        <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Enrich / edit affordance — calm, optional. Auto-fill from the name, or edit by hand. The
            "verify" framing is gone: missing specs are an opportunity, not an error. ── */}
      {!isGuest && (
        <section>
          <div className="panel flex flex-wrap items-center justify-between gap-4 bg-muted/30 p-5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {hasAnyKnownSpec ? "Improve this item" : "Add specs"}
              </p>
              <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">
                {hasAnyKnownSpec
                  ? "Auto-fill missing specs from the product name, or edit any detail by hand. Optional — your item is already in your closet."
                  : "Your item is saved. Auto-fill its specs from the product name to unlock packing recommendations — or skip it; the closet works fine without them."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <form action={classifyNowAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button type="submit" size="sm">Auto-fill from name</Button>
              </form>
              <Link
                href={`/items/new?name=${encodeURIComponent(item.name)}`}
                className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-secondary"
              >
                Add a product link
              </Link>
            </div>
          </div>
          {isGear && blockedCount > 0 && hasAnyKnownSpec && (
            <p className="mt-2 text-xs text-muted-foreground/80">
              {blockedCount} more {blockedCount === 1 ? "capability" : "capabilities"} could be confirmed with a few more specs.
            </p>
          )}
        </section>
      )}

      {/* ── Manual spec editor — GEAR ONLY; tucked at the bottom for power users. Hidden for guests. ── */}
      {isGear && !isGuest && (
        <section>
          <SectionHead title="Edit specs" muted />
          <FacetEditor
            itemId={item.id}
            classification={c}
            action={updateFacetsAction}
            defaultOpen={searchParams.edit === "1"}
          />
        </section>
      )}
    </div>
  );
}
