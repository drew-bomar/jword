import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/sign-in", "/auth/callback"];
/** JSON endpoints answer a signed-out caller with 401 themselves instead of a sign-in redirect. */
const API_PATHS = ["/api/extension/", "/api/watchlist/"];

/** Refreshes the auth cookie on every request and redirects signed-out visitors. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const isApi = API_PATHS.some((path) => pathname.startsWith(path));
  if (!user && !isPublic && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Keep the query so the page the owner asked for survives sign-in.
    const target = pathname + request.nextUrl.search;
    url.search = target === "/" ? "" : `?next=${encodeURIComponent(target)}`;
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Authenticated pages must never be served from a shared cache.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
