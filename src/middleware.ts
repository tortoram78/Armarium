import { NextResponse, type NextRequest } from "next/server";
import { isAuthConfigured } from "@/lib/auth";
import { updateSession } from "@/lib/supabase/middleware";

// Paths that are always public — never redirect to /login.
// /forgot-password and /update-password must be reachable while logged-out so
// an unauthenticated user following a recovery link isn't bounced to /login.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/forgot-password", "/update-password"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Guest-READABLE routes — the demo → "log in to save" funnel. A logged-out visitor may GET these to
 * browse the sample closet, open a sample item, plan (preview), and view a saved-trip surface. They are
 * NOT public (an authenticated user sees their own data here); they simply don't bounce a guest at the
 * edge. The actual save WALL is inside the server actions on these pages: every write calls
 * `requireUserId()`, which redirects a guest to /login. So a guest can read here but cannot persist.
 *
 * Matched PRECISELY so no write route leaks:
 *   - "/"                exact closet root only.
 *   - "/plan"            the planner + "/plan/preview" (guest preview result) — read/preview, never saves.
 *   - "/items/:id"       a single item detail. Deliberately EXCLUDES "/items/new" (the add form, a write
 *     entry) and "/items/:id/review" (a draft-review write surface) — both stay gated.
 *   - "/trips/:id"       a single saved-trip dossier. EXCLUDES "/trips" (the user's own trip log).
 *
 * Only safe (GET/HEAD) requests are allowed through; a POST / server-action invocation to any of these
 * paths is NOT exempted here and still reaches the action's `requireUserId()`. Belt-and-suspenders: the
 * action gate is the real wall, this matcher just avoids an unhelpful pre-emptive redirect on reads.
 */
function isGuestReadablePath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/plan" || pathname === "/plan/preview") return true;
  // "/items/<id>" but NOT "/items/new" and NOT "/items/<id>/<sub>" (e.g. /review).
  const itemMatch = /^\/items\/([^/]+)$/.exec(pathname);
  if (itemMatch && itemMatch[1] !== "new") return true;
  // "/trips/<id>" but NOT "/trips" itself and NOT deeper sub-routes.
  if (/^\/trips\/[^/]+$/.test(pathname)) return true;
  return false;
}

/** GET/HEAD only — never exempt a mutating method (server actions POST). */
function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/**
 * The ONE guest-readable path whose server actions are all read-only and MUST be reachable by a guest
 * POST: `/plan`. The planner's read/preview funnel runs through server actions, which Next.js dispatches
 * as POSTs to the page route (`/plan`). EVERY action on `/plan` self-gates correctly:
 *   - `getWeatherConditionsAction` (pull a forecast to prefill) → `getUserIdOrGuest()` — read-only, no
 *     persist; a guest SHOULD reach it.
 *   - `planPreviewAction` (no-save preview → /plan/preview)      → `getUserIdOrGuest()` — read-only; a
 *     guest SHOULD reach it.
 *   - `planTripAction` / `planFromDescriptionAction` (save)      → `requireUserId()` — STILL redirects a
 *     guest to /login. No write leaks.
 * So pre-emptively 307→/login on a guest POST to /plan is BOTH over-aggressive AND breaks the legitimate
 * read-only forecast/preview funnel. The action layer (`requireUserId` on every write) is the real wall;
 * the matcher must not bounce these reads at the edge. Scoped to `/plan` ONLY — the other guest-readable
 * paths (`/items/<id>`, `/trips/<id>`) have no read-only POST action (only writes, which self-gate via
 * `requireUserId`), so they stay GET/HEAD-only and need no guest POST.
 */
function isGuestPostablePath(pathname: string): boolean {
  return pathname === "/plan";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Dev / in-memory mode — no auth configured, pass everything through.
  // Forward the pathname as a header so the layout can set the correct
  // initial data-skin server-side (no hydration flash on first paint).
  if (!isAuthConfigured()) {
    const res = NextResponse.next();
    res.headers.set("x-armarium-pathname", pathname);
    return res;
  }

  // Refresh the session AND read the user from one client/response object.
  const { response, user } = await updateSession(req);

  // Forward pathname for skin selection in layout.
  response.headers.set("x-armarium-pathname", pathname);

  // Public pages always pass through even when authenticated.
  if (isPublicPath(pathname)) {
    return response;
  }

  // Guest funnel: a logged-out visitor may READ the sample closet / planner / a single item or trip.
  // Allow SAFE methods (a server-action POST to these paths is NOT exempt by THIS clause — it still
  // hits the action's requireUserId(), which is the real save wall). The header was already set above.
  if (!user && isGuestReadablePath(pathname) && isSafeMethod(req.method)) {
    return response;
  }

  // Guest funnel — read-only POST exception: the planner's forecast-pull + no-save preview are server
  // actions, which POST to `/plan`. Every action on `/plan` self-gates (the read ones via
  // getUserIdOrGuest, the SAVE ones via requireUserId), so this exemption reaches the reads while a save
  // attempt still redirects to /login INSIDE the action. Without this, a guest could never pull a
  // forecast or see a preview — the core demo funnel. Scoped to `/plan` POST only; no write is relaxed.
  if (!user && isGuestPostablePath(pathname) && req.method === "POST") {
    return response;
  }

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Carry the refreshed session cookies onto the redirect. A bare
    // NextResponse.redirect() drops the Set-Cookie headers updateSession just
    // wrote, which on mobile Safari (more frequent token refresh) bounced users
    // back to /login in a loop — the documented @supabase/ssr pitfall.
    const redirectRes = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirectRes.cookies.set(c));
    redirectRes.headers.set("x-armarium-pathname", pathname);
    return redirectRes;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match everything except:
     *   - _next/static  (static files)
     *   - _next/image   (image optimisation)
     *   - favicon.ico
     *   - Files with an extension (e.g. .svg, .png, .jpg, .css, .js)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
