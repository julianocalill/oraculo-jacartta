import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (
    PUBLIC_PATHS.some((path) => pathname.startsWith(path)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get("oraculo_access_token")?.value;
  const refreshToken = request.cookies.get("oraculo_refresh_token")?.value;
  if (!accessToken) {
    return redirectToLogin(request);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return redirectToLogin(request);
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    if (!refreshToken) return redirectToLogin(request);

    const refreshResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!refreshResponse.ok) {
      const redirect = redirectToLogin(request);
      redirect.cookies.delete("oraculo_access_token");
      redirect.cookies.delete("oraculo_refresh_token");
      return redirect;
    }

    const refreshed = await refreshResponse.json() as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!refreshed.access_token || !refreshed.refresh_token) {
      return redirectToLogin(request);
    }

    const next = NextResponse.next();
    const secure = process.env.NODE_ENV === "production";
    next.cookies.set("oraculo_access_token", refreshed.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60
    });
    next.cookies.set("oraculo_refresh_token", refreshed.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
    return next;
  }

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
