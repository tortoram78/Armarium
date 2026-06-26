import Link from "next/link";
import { listCollections } from "@/server/app-service";
import { getUserIdOrGuest } from "@/lib/auth";
import {
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
} from "@/app/actions";
import { CollectionsView } from "@/components/CollectionsView";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: { error?: string; renameError?: string; deleteError?: string };
}) {
  const { userId, isGuest } = await getUserIdOrGuest();
  const collections = await listCollections(userId);

  return (
    <div className="space-y-10">
      {/* ── Masthead ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <p className="eyebrow mb-3">Your gear</p>
          <h1 className="display-xl text-foreground">Collections</h1>
          <p className="mt-4 max-w-xl text-[0.975rem] leading-relaxed text-muted-foreground">
            Group your gear into named kits or themed sets. Collections are personal curation — they
            don&apos;t affect capabilities or trip recommendations.
          </p>
        </div>
      </header>

      {searchParams.error && (
        <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
          {searchParams.error}
        </p>
      )}
      {(searchParams.renameError || searchParams.deleteError) && (
        <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
          That action couldn&apos;t complete — please try again.
        </p>
      )}

      {isGuest ? (
        /* Guest: read-only invite */
        <div className="panel flex flex-wrap items-center justify-between gap-4 bg-muted/40 p-6">
          <div>
            <p className="text-sm font-medium text-foreground">Creating collections requires an account.</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Log in to organise your gear into named kits.
            </p>
          </div>
          <Link
            href="/login?next=/collections"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors hover:bg-primary/92"
          >
            Log in
          </Link>
        </div>
      ) : (
        <CollectionsView
          collections={collections}
          createAction={createCollectionAction}
          renameAction={renameCollectionAction}
          deleteAction={deleteCollectionAction}
        />
      )}
    </div>
  );
}
