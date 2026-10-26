import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { handleEmailActionTokenMiddleware } from "@/lib/auth/emailTokens";

export async function middleware(request: NextRequest) {
  // 1-Click Ephemeral Email Action Token Bridge for /poll/* and /digest/*
  const actionRedirect = await handleEmailActionTokenMiddleware(request);
  if (actionRedirect) {
    return actionRedirect;
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
