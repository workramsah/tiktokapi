// app/api/tiktok/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  getAppUrl,
  getAuthenticationUrl,
  getTikTokRedirectUri,
} from "@/lib/tiktok/auth";

export async function GET(req: NextRequest) {
  const redirectUri = getTikTokRedirectUri();

  const { url, state, codeVerifier } = getAuthenticationUrl(redirectUri);

  const response = NextResponse.redirect(url);

  const cookieOptions = {
    httpOnly: true,
    // Secure cookies are rejected over plain HTTP by some browsers (e.g.
    // Safari), so only set the flag when the app itself runs on https.
    secure: getAppUrl().startsWith("https://"),
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
