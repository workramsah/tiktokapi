// lib/tiktok/auth.ts
import crypto from "crypto";

const TIKTOK_AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET!;

/**
 * Scopes that are actually enabled for this app in the TikTok developer
 * portal. Requesting any other scope (e.g. video.list) makes TikTok's OAuth
 * authorize page reject the request with a scope error. Only add scopes
 * here after they have been enabled in the portal.
 */
export const TIKTOK_SCOPES = [
  "user.info.basic",
];

/**
 * Validates and returns the app's base URL (no trailing slash).
 *
 * This MUST be a single URL that exactly matches a redirect URL registered in
 * the TikTok developer portal (Login Kit settings, in the mode - sandbox or
 * production - you are testing in). A wrong value causes TikTok's
 * "We couldn't log in with TikTok - redirect_uri" error screen.
 */
export function getAppUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();

  if (!raw || /\s/.test(raw) || raw.includes("|")) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is missing or malformed. It must be ONE base URL, e.g. " +
        "http://localhost:3000 or https://your-app.vercel.app, exactly matching a " +
        "redirect URL registered in the TikTok developer portal. " +
        "(Env files do not support the '||' fallback syntax.)"
    );
  }

  return raw.replace(/\/+$/, "");
}

/** The callback path that must be registered as a redirect URL with TikTok. */
const TIKTOK_REDIRECT_PATH = "/api/tiktok/callback";

/**
 * Builds the redirect_uri sent to TikTok. The authorize request and the token
 * exchange must send the exact same value, so both routes use this helper.
 */
export function getTikTokRedirectUri(): string {
  return `${getAppUrl()}${TIKTOK_REDIRECT_PATH}`;
}

/**
 * Generates a PKCE code verifier (43-128 unreserved chars, RFC 7636).
 * Must be kept secret server-side (we store it in a cookie) and sent
 * with the token exchange request.
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url"); // 43 chars
}

/**
 * Derives the S256 code challenge from a code verifier (RFC 7636):
 * BASE64URL(SHA256(code_verifier)), padding stripped.
 */
export function generateCodeChallenge(codeVerifier: string): string {
  return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Builds the TikTok login/authorization URL.
 * `state` is used as CSRF protection - generate it, store it (cookie),
 * and verify it again in the callback.
 *
 * TikTok REQUIRES PKCE on the web flow: the authorize request must carry
 * a `code_challenge` + `code_challenge_method`, otherwise the consent
 * screen fails with a "code_challenge" error. The matching `code_verifier`
 * must be sent later in the token exchange (see exchangeCodeForToken).
 */
export function getAuthenticationUrl(
  redirectUri: string,
  scopes: string[] = TIKTOK_SCOPES,
  state?: string
) {
  const csrfState = state ?? crypto.randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    scope: scopes.join(","),
    response_type: "code",
    redirect_uri: redirectUri,
    state: csrfState,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    url: `${TIKTOK_AUTH_BASE}?${params.toString()}`,
    state: csrfState,
    codeVerifier,
  };
}

/**
 * Exchanges the ?code=... you get back on the redirect for an access token.
 * `codeVerifier` is the PKCE verifier generated together with the auth URL
 * (TikTok requires it to match the code_challenge sent on login).
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier: string
) {
  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`TikTok token exchange failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
    open_id: string;
    refresh_token: string;
    refresh_expires_in: number;
    scope: string;
    token_type: string;
  }>;
}
