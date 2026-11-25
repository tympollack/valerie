import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { extractSSOToken, getCrossDomainCookieOptions } from "@/lib/auth/ssoHandshake";

export async function createClient(tokenOverride?: string | null) {
  const cookieStore = await cookies();
  let host = "";
  try {
    const headerList = await headers();
    host = headerList.get("host") || "";
  } catch {
    // Outside request header context
  }
  const cookieDomainOpts = getCrossDomainCookieOptions(host);
  const allCookies = cookieStore.getAll();
  const hasSupabaseSession = allCookies.some(
    (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
  );

  // Let Supabase SSR supply its own session bearer when present; only attach
  // separate SSO bearer when no native Supabase session exists or when explicitly overridden.
  const ssoToken =
    tokenOverride !== undefined
      ? tokenOverride
      : !hasSupabaseSession
      ? extractSSOToken(cookieStore)
      : null;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const isSbAuth = name.startsWith("sb-") && name.includes("-auth-token");
              cookieStore.set(name, value, {
                ...options,
                ...(cookieDomainOpts.domain ? { domain: cookieDomainOpts.domain } : {}),
                path: options?.path || "/",
                sameSite: options?.sameSite || "lax",
                secure: options?.secure ?? cookieDomainOpts.secure,
                ...(isSbAuth ? { httpOnly: options?.httpOnly ?? false } : {}),
              } as any);
            });
          } catch {
            // Server Components cannot write cookies. The middleware refreshes
            // the session on the way back to the browser.
          }
        },
      } satisfies CookieMethodsServer,
      global: {
        headers: ssoToken ? { Authorization: `Bearer ${ssoToken}` } : {},
      },
    }
  );
}
