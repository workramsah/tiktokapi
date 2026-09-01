// app/api/tiktok/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticationUrl } from "@/lib/tiktok/auth";

export async function GET(req: NextRequest) {
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/tiktok/callback`;

  const { url, state, codeVerifier } = getAuthenticationUrl(redirectUri);

  const response = NextResponse.redirect(url);

  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  };

  // store state in an httpOnly cookie so the callback can verify it
  response.cookies.set("tiktok_oauth_state", state, cookieOptions);

  // store the PKCE code verifier so the callback can send it during the
  // token exchange (it must match the code_challenge sent on this request)
  response.cookies.set("tiktok_code_verifier", codeVerifier, cookieOptions);

  return response;
}
