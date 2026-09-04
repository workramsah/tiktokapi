// app/api/tiktok/video/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  TikTokPublishError,
  describeTikTokPublishError,
  fetchPostStatus,
} from "@/lib/tiktok/publish";

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("tiktok_access_token")?.value;
  if (!accessToken) {
    return NextResponse.json(
      {
        error: "not_connected",
        message: "Connect with TikTok before checking a video status.",
      },
      { status: 401 }
    );
  }

  let publishId: string | null = null;
  try {
    const body = (await req.json()) as { publish_id?: string };
    publishId = body?.publish_id ?? null;
  } catch {
    // fall through to the missing publish_id response
  }

  if (!publishId) {
    return NextResponse.json(
      { error: "missing_publish_id", message: "publish_id is required." },
      { status: 400 }
    );
  }

  try {
    const { status, failReason } = await fetchPostStatus(
      accessToken,
      publishId
    );
    return NextResponse.json({ status, fail_reason: failReason });
  } catch (err) {
    if (err instanceof TikTokPublishError) {
      return NextResponse.json(
        { error: err.code, message: describeTikTokPublishError(err) },
        { status: 502 }
      );
    }
    console.error("TikTok status check failed:", err);
    return NextResponse.json(
      {
        error: "status_check_failed",
        message: "Unexpected error while checking the video status.",
      },
      { status: 500 }
    );
  }
}