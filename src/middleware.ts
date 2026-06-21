import { NextResponse, type NextRequest } from "next/server";
import { isAuthConfigured } from "@/lib/auth";
import { updateSession } from "@/lib/supabase/middleware";

// Paths that are always public — never redirect to /login.
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

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

  // Refresh the Supabase session cookie (keeps tokens alive).
  const response = await updateSession(req);

  // Forward pathname for skin selection in layout.
  response.headers.set("x-armarium-pathname", pathname);

  // Public pages always pass through even when authenticated.
  if (isPublicPath(pathname)) {
    return response;
  }

  // Check authentication: re-read the user from the refreshed session.
  // We re-create the client here to read from the updated cookies in `response`.
  const { createServerClient } = await import("@supabase/ssr");
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          // no-op: cookies are already set in `response`
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
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
