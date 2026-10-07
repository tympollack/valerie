import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import { extractSSOToken } from "@/lib/auth/ssoHandshake";

export async function createClient() {
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  const hasSupabaseSession = allCookies.some(
    (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
  );

  // Let Supabase SSR supply its own session bearer when present; only attach
  // separate SSO bearer when no native Supabase session exists.
  const ssoToken = !hasSupabaseSession ? extractSSOToken(cookieStore) : null;

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
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as any)
            );
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
