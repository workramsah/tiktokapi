// app/api/tiktok/video/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  MAX_VIDEO_SIZE_BYTES,
  PRIVACY_LEVELS,
  SUPPORTED_VIDEO_MIME_TYPES,
  TikTokPublishError,
  describeTikTokPublishError,
  initDirectPost,
  planVideoChunks,
  uploadVideoToTikTok,
  type PrivacyLevel,
} from "@/lib/tiktok/publish";

// TikTok allows captions up to 2200 UTF-16 runes.
const MAX_TITLE_LENGTH = 2200;

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("tiktok_access_token")?.value;
  if (!accessToken) {
    return NextResponse.json(
      {
        error: "not_connected",
        message: "Connect with TikTok before uploading a video.",
      },
      { status: 401 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid_form", message: "Expected multipart/form-data." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "missing_file", message: "No video file was provided." },
      { status: 400 }
    );
  }

  const mimeType = file.type || "video/mp4";
  if (!(SUPPORTED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return NextResponse.json(
      {
        error: "unsupported_format",
        message: "Unsupported video format. Use MP4, WebM or MOV.",
      },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: "empty_file", message: "The selected video file is empty." },
      { status: 400 }
    );
  }
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `The video is too large. The limit is ${MAX_VIDEO_SIZE_BYTES} bytes.`,
      },
      { status: 413 }
    );
  }

  const title = (form.get("title") as string | null)?.trim() ?? "";
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      {
        error: "title_too_long",
        message: `The caption is too long (max ${MAX_TITLE_LENGTH} characters).`,
      },
      { status: 400 }
    );
  }

  const privacyLevelRaw =
    (form.get("privacy_level") as string | null) ?? "SELF_ONLY";
  if (!(PRIVACY_LEVELS as readonly string[]).includes(privacyLevelRaw)) {
    return NextResponse.json(
      { error: "invalid_privacy_level", message: "Unknown privacy level." },
      { status: 400 }
    );
  }
  const privacyLevel = privacyLevelRaw as PrivacyLevel;

  try {
    const video = Buffer.from(await file.arrayBuffer());
    const plan = planVideoChunks(video.length);

    const { publishId, uploadUrl } = await initDirectPost(accessToken, {
      title,
      privacyLevel,
      videoSize: video.length,
      chunkSize: plan.chunkSize,
      totalChunkCount: plan.totalChunkCount,
    });

    await uploadVideoToTikTok(uploadUrl, video, mimeType, plan);

    return NextResponse.json({ publish_id: publishId });
  } catch (err) {
    if (err instanceof TikTokPublishError) {
      return NextResponse.json(
        {
          error: err.code,
          message: describeTikTokPublishError(err),
        },
        { status: 502 }
      );
    }
    console.error("TikTok video upload failed:", err);
    return NextResponse.json(
      {
        error: "upload_failed",
        message: "Unexpected error while uploading the video.",
      },
      { status: 500 }
    );
  }
}