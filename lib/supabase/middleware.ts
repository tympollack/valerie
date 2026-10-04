import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getCrossDomainCookieOptions,
  extractAntiSybilProof,
  validateSSOHandshake,
  isVotingRoute,
  buildSSOLoginRedirect,
  buildSSOVerifyRedirect,
  type VerificationTier,
  type TrustState,
} from "@/lib/auth/ssoHandshake";

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  let supabaseResponse = NextResponse.next({
    request,
  });

  const cookieDomainOpts = getCrossDomainCookieOptions(request.nextUrl.hostname);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let userId: string | null = null;
  let isHumanVerified = false;
  let verificationTier: VerificationTier = "UNVERIFIED";
  let trustState: TrustState = "active";

  // 1. Supabase SSR Session Refresh & User Validation
  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
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
    });

    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!error && user) {
        const proof = extractAntiSybilProof(user);
        userId = user.id;
        isHumanVerified = proof.isHuman && proof.trustState === "active";
        verificationTier = proof.verificationTier;
        trustState = proof.trustState;
      }
    } catch {
      // Offline fallback to direct SSO handshake token parsing
    }
  }

  // 2. Fallback: Parse Wildcard .sunshade.icu SSO Cookies / JWTs directly
  if (!userId) {
    try {
      const handshake = await validateSSOHandshake(request);
      if (handshake.authenticated && handshake.userId) {
        userId = handshake.userId;
        isHumanVerified = handshake.isHumanVerified;
        verificationTier = handshake.proof?.verificationTier || "UNVERIFIED";
        trustState = handshake.proof?.trustState || "active";
      }
    } catch {
      // Unauthenticated request
    }
  }

  // 3. Inject Verified User Context into Request Headers for Server Actions & Components
  if (userId) {
    requestHeaders.set("x-user-id", userId);
    requestHeaders.set("x-is-human-verified", String(isHumanVerified));
    requestHeaders.set("x-verification-tier", String(verificationTier));
    requestHeaders.set("x-trust-state", String(trustState));

    try {
      request.headers.set("x-user-id", userId);
      request.headers.set("x-is-human-verified", String(isHumanVerified));
      request.headers.set("x-verification-tier", String(verificationTier));
      request.headers.set("x-trust-state", String(trustState));
    } catch {
      // In environments where request.headers is read-only
    }
  } else {
    requestHeaders.delete("x-user-id");
    requestHeaders.delete("x-is-human-verified");
    requestHeaders.delete("x-verification-tier");
    requestHeaders.delete("x-trust-state");

    try {
      request.headers.delete("x-user-id");
      request.headers.delete("x-is-human-verified");
      request.headers.delete("x-verification-tier");
      request.headers.delete("x-trust-state");
    } catch {
      // In environments where request.headers is read-only
    }
  }

  // 4. Protected Voting Routes & Actions Gate
  const pathname = request.nextUrl.pathname;
  if (isVotingRoute(pathname, request.method, request.headers)) {
    const isApiOrAction =
      request.method !== "GET" ||
      request.headers.has("next-action") ||
      request.headers.get("accept")?.includes("application/json") ||
      pathname.startsWith("/api/");

    // Unauthenticated rejection
    if (!userId) {
      if (isApiOrAction) {
        return NextResponse.json(
          { error: "Unauthorized: Authentication required to vote." },
          { status: 401 }
        );
      }
      return NextResponse.redirect(new URL(buildSSOLoginRedirect(request.url)));
    }

    // Unverified anti-Sybil rejection
    if (!isHumanVerified || trustState !== "active") {
      if (isApiOrAction) {
        return NextResponse.json(
          { error: "Forbidden: Single-human anti-Sybil verification required." },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL(buildSSOVerifyRedirect(request.url)));
    }
  }

  // 5. Construct final response with updated request headers and synced cookies
  const finalResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  supabaseResponse.cookies.getAll().forEach((cookie) => {
    finalResponse.cookies.set(cookie.name, cookie.value, {
      ...cookie,
      ...cookieDomainOpts,
    });
  });

  return finalResponse;
}
