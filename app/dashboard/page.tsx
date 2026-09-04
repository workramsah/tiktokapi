"use client"

import Link from "next/link";
import { useEffect, useState } from "react";

const ACCESS_TOKEN_COOKIE = "tiktok_access_token";

function getCookie(name: string): string | null {
    const match = document.cookie.match(
        new RegExp(`(?:^|; )${name}=([^;]*)`)
    );
    return match ? decodeURIComponent(match[1]) : null;
}

function maskToken(token: string): string {
    if (token.length <= 12) return "•".repeat(token.length);
    return `${token.slice(0, 8)}${"•".repeat(12)}${token.slice(-4)}`;
}

export default function Page() {
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [showToken, setShowToken] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setAccessToken(getCookie(ACCESS_TOKEN_COOKIE));
    }, []);

    async function handleCopy() {
        if (!accessToken) return;
        try {
            await navigator.clipboard.writeText(accessToken);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            console.error("Failed to copy access token");
        }
    }

    return (
        <div style={{ padding: "2rem", maxWidth: 640 }}>
            <h1>Dashboard</h1>

            {accessToken ? (
                <section>
                    <p>✅ Connected with TikTok</p>
                    <div>
                        <label>Access token</label>
                        <code style={{ display: "block", wordBreak: "break-all" }}>
                            {showToken ? accessToken : maskToken(accessToken)}
                        </code>
                    </div>
                    <button onClick={handleCopy}>
                        {copied ? "Copied!" : "Copy"}
                    </button>
                    <button onClick={() => setShowToken((v) => !v)}>
                        {showToken ? "Hide" : "Show"}
                    </button>
                </section>
            ) : (
                <section>
                    <p>You are not connected yet.</p>
                    <a href="/api/tiktok/login">Continue With TikTok</a>
                </section>
            )}

            <div style={{ marginTop: "2rem" }}>
                <Link href="/term&conditon">Terms and Conditions</Link>
                <Link href="/privacy-policy">Privacy Policy</Link>
            </div>
        </div>
    );
}