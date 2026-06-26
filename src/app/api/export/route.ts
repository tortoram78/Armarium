// GET /api/export — stream the user's full closet as a CSV download (ADR-0024 anti-lock-in).
// Write-gated: requireUserId() redirects a guest to /login before any data is exported.
// Content-Disposition: attachment ensures browsers download rather than display the file.

import { requireUserId } from "@/lib/auth";
import { exportClosetCsv } from "@/server/app-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await requireUserId();
  const csv = await exportClosetCsv(userId);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="armarium-closet.csv"',
    },
  });
}
