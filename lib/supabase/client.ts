import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import { getCrossDomainCookieOptions } from "@/lib/auth/ssoHandshake";

const isBrowser = () =>
  typeof window !== "undefined" && typeof document !== "undefined";

function parseCookies(): { name: string; value: string }[] {
  if (!isBrowser()) return [];

  const raw = document.cookie;
  if (!raw) return [];

  return raw.split("; ").map((chunk) => {
    const eqIdx = chunk.indexOf("=");
    if (eqIdx === -1) return { name: chunk, value: "" };
    const name = chunk.slice(0, eqIdx);
    const value = chunk.slice(eqIdx + 1);
    try {
      return { name, value: decodeURIComponent(value) };
    } catch {
      return { name, value };
    }
  });
}

export function setAllBrowserCookies(
  cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
  hostnameOverride?: string
) {
  if (!isBrowser()) return;

  const isHttps = window.location.protocol === "https:";
  const domainOpts = getCrossDomainCookieOptions(
    hostnameOverride ?? window.location.hostname
  );

  cookiesToSet.forEach(({ name, value, options = {} }) => {
    const encoded = encodeURIComponent(value);
    const isDeletion =
      value === "" ||
      options.maxAge === 0 ||
      (options.expires ? new Date(options.expires).getTime() <= Date.now() : false);

    const buildCookieString = (domain?: string) => {
      const parts = [`${name}=${encoded}`, `Path=${options.path || "/"}`];
      if (typeof options.maxAge === "number") {
        parts.push(`Max-Age=${options.maxAge}`);
      }
      if (options.expires) {
        parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
      }
      if (domain) {
        parts.push(`domain=${domain}`);
      }
      parts.push("SameSite=Lax");
      if (isHttps) {
        parts.push("Secure");
      }
      return parts.join("; ");
    };

    if (isDeletion && domainOpts.domain) {
      // Expire both legacy host-only and apex-domain cookies so old sessions cannot survive sign-out
      document.cookie = buildCookieString(undefined);
      document.cookie = buildCookieString(domainOpts.domain);
    } else {
      document.cookie = buildCookieString(domainOpts.domain);
    }
  });
}

let browserClient: ReturnType<typeof createBrowserClient<any, any>> | null = null;

export function createClient() {
  if (browserClient) return browserClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    const isLocal =
      typeof window === "undefined" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!isLocal) {
      throw new Error(
        "[Supabase] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set."
      );
    }
  }

  const domainOpts = isBrowser()
    ? getCrossDomainCookieOptions(window.location.hostname)
    : { domain: undefined };

  browserClient = createBrowserClient<any, any>(
    supabaseUrl ?? "http://127.0.0.1:54321",
    supabaseAnonKey ?? "local-anon-key-placeholder",
    {
      auth: {
        // Explicit callback handling in /auth/callback prevents auto-exchanging PKCE codes twice
        detectSessionInUrl: false,
      },
      cookieOptions: {
        path: "/",
        ...(domainOpts.domain ? { domain: domainOpts.domain } : {}),
        sameSite: "lax",
        secure: isBrowser() && window.location.protocol === "https:",
      },
      cookies: {
        getAll: parseCookies,
        setAll: (
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) => setAllBrowserCookies(cookiesToSet),
      },
    }
  );

  return browserClient;
}
