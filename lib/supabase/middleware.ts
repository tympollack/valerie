import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getCrossDomainCookieOptions } from "@/lib/auth/ssoHandshake";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const cookieDomainOpts = getCrossDomainCookieOptions(request.nextUrl.hostname);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              ...cookieDomainOpts,
            } as any)
          );
        },
      } satisfies CookieMethodsServer,
    }
  );

  // Refresh the auth token on every request. This must be called before
  // rendering the page so the refreshed session is available downstream.
  await supabase.auth.getUser();

  return supabaseResponse;
}
