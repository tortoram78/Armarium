import Link from "next/link";
import { getCloset } from "@/server/app-service";
import { GROUPINGS, GROUPING_LABELS, type GroupingKey } from "@/core/closet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ClosetPage({ searchParams }: { searchParams: { group?: string } }) {
  const userId = await requireUserId();
  const dimension: GroupingKey = (GROUPINGS as readonly string[]).includes(searchParams.group ?? "")
    ? (searchParams.group as GroupingKey)
    : "capability";
  const { items, byId, groups } = await getCloset(dimension, userId);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Closet</h1>
          <p className="text-sm text-neutral-500">
            {items.length} item{items.length === 1 ? "" : "s"} · grouped by emergent facet queries, not fixed categories.
          </p>
        </div>
        <Link href="/items/new" className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Add item
        </Link>
      </div>

      <div className="flex flex-wrap gap-1">
        {GROUPINGS.map((g) => (
          <Link
            key={g}
            href={`/?group=${g}`}
            className={
              g === dimension
                ? "rounded-full border border-neutral-900 bg-neutral-900 px-3 py-1 text-xs text-white"
                : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
            }
          >
            {GROUPING_LABELS[g]}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-neutral-500">
            Your closet is empty. <Link href="/items/new" className="underline">Add your first item</Link>.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => (
            <section key={grp.key}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {grp.label} <span className="text-neutral-400">({grp.itemIds.length})</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grp.itemIds.map((id) => {
                  const it = byId.get(id);
                  if (!it) return null;
                  return (
                    <Link key={id} href={`/items/${id}`}>
                      <Card className="h-full transition hover:border-neutral-400">
                        <CardHeader>
                          <CardTitle className="text-base">{it.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-1">
                            {it.classification.multilabel.function_purpose.slice(0, 3).map((f) => (
                              <Badge key={f} variant="subtle">{f.replace(/_/g, " ")}</Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
