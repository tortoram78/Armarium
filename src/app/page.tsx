export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-3xl font-semibold tracking-tight">Armarium</h1>
      <p className="mt-3 text-neutral-600">
        A faceted gear closet that reasons about what to pack for a trip. Phase 1 ships the data
        foundation and the LLM classification pipeline; the closet and trip-planning UI arrive in
        Phase 2.
      </p>
    </main>
  );
}
