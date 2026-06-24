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
