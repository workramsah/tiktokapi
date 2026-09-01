// app/api/tiktok/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  getAppUrl,
  getTikTokRedirectUri,
} from "@/lib/tiktok/auth";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.error("TikTok authorization error:", error, errorDescription);
    const params = new URLSearchParams({ error });
    if (errorDescription) params.set("error_description", errorDescription);
    return NextResponse.redirect(`${getAppUrl()}/login?${params.toString()}`);
  }

  const savedState = req.cookies.get("tiktok_oauth_state")?.value;
  const codeVerifier = req.cookies.get("tiktok_code_verifier")?.value;

  if (!code || !state || !codeVerifier || state !== savedState) {
    return NextResponse.redirect(
      `${getAppUrl()}/login?error=invalid_state`
    );
  }

  try {
    const redirectUri = getTikTokRedirectUri();
    const tokenData = await exchangeCodeForToken(code, redirectUri, codeVerifier);

    // TODO: persist tokenData (access_token, refresh_token, open_id, etc.)
    // to your DB / session, associated with the current user.

    const response = NextResponse.redirect(
      `${getAppUrl()}/dashboard?tiktok=connected`
    );
    response.cookies.delete("tiktok_oauth_state");
    response.cookies.delete("tiktok_code_verifier");
    return response;
  } catch (err) {
    console.error("TikTok OAuth callback error:", err);
    return NextResponse.redirect(
      `${getAppUrl()}/login?error=token_exchange_failed`
    );
  }
}
