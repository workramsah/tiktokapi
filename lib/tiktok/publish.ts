// lib/tiktok/publish.ts
//
// Helpers for the TikTok Content Posting API - Direct Post flow:
// 1. initDirectPost()      -> /v2/post/publish/video/init/ (returns upload_url)
// 2. uploadVideoToTikTok() -> PUT the video bytes to that upload_url
// 3. fetchPostStatus()     -> /v2/post/publish/status/fetch/ (poll until done)
//
// Transfer rules per TikTok's Media Transfer Guide:
// - videos up to 64MB are uploaded whole in a single PUT
// - larger videos are split into sequential chunks (each 5-64MB, trailing
//   bytes merged into the final chunk, up to 128MB, max 1000 chunks)

const TIKTOK_PUBLISH_INIT_URL =
  "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_PUBLISH_STATUS_URL =
  "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

/**
 * Guardrail below TikTok's own 4GB limit so buffering the file on the
 * Node.js server cannot exhaust its memory.
 */
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

/** Chunk size used for videos larger than 64MB (5-64MB range). */
const CHUNK_SIZE = 32 * 1024 * 1024; // 32MB

/** Videos larger than this must be uploaded in multiple chunks. */
const MAX_SINGLE_UPLOAD_BYTES = 64 * 1024 * 1024; // 64MB

export const SUPPORTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov
] as const;

export const PRIVACY_LEVELS = [
  "SELF_ONLY",
  "MUTUAL_FOLLOW_FRIENDS",
  "PUBLIC_TO_EVERYONE",
] as const;

export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

/** Error raised for a failed TikTok publish/status API call. */
export class TikTokPublishError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = "TikTokPublishError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

interface TikTokErrorBody {
  error?: { code?: string; message?: string; log_id?: string };
}

async function throwTikTokError(res: Response): Promise<never> {
  let code = `tiktok_http_${res.status}`;
  let message = `TikTok request failed with HTTP ${res.status}`;
  try {
    const body = (await res.json()) as TikTokErrorBody;
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // non-JSON error body - keep the generic message
  }
  throw new TikTokPublishError(res.status, code, message);
}

/** Human-friendly explanations for the error codes TikTok documents. */
const ERROR_HINTS: Record<string, string> = {
  scope_not_authorized:
    "Your TikTok connection is missing the video.publish scope. Enable the Content Posting API (Direct Post) for the app in the TikTok developer portal, then reconnect from the dashboard.",
  access_token_invalid:
    "Your TikTok session has expired. Reconnect with TikTok from the dashboard.",
  unaudited_client_can_only_post_to_private_accounts:
    "Your app is not audited yet, so TikTok only allows private (Only me) posts.",
  spam_risk_too_many_posts:
    "The daily post cap for this TikTok user has been reached. Try again tomorrow.",
  spam_risk_user_banned_from_posting:
    "This TikTok user is currently banned from posting.",
  reached_active_user_cap:
    "The daily quota of active publishing users for this app has been reached.",
  rate_limit_exceeded: "Too many requests - wait a moment and try again.",
  invalid_param:
    "TikTok rejected the video parameters (format, size or privacy level).",
};

export function describeTikTokPublishError(err: TikTokPublishError): string {
  return ERROR_HINTS[err.code] ?? err.message;
}

export type VideoChunkPlan = {
  /** Bytes per chunk (the final chunk may be larger). */
  chunkSize: number;
  totalChunkCount: number;
};

/**
 * Computes the chunk layout sent as source_info during initialization.
 * - <= 64MB: upload whole (chunk_size = full video size)
 * - > 64MB: sequential 32MB chunks (trailing bytes merged into the final one)
 */
export function planVideoChunks(videoSize: number): VideoChunkPlan {
  if (videoSize <= MAX_SINGLE_UPLOAD_BYTES) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  return {
    chunkSize: CHUNK_SIZE,
    totalChunkCount: Math.floor(videoSize / CHUNK_SIZE),
  };
}

export type InitDirectPostResult = {
  publishId: string;
  uploadUrl: string;
};

/**
 * Initializes a direct post and returns the publish_id plus the upload_url
 * the video bytes must be PUT to. Rate limit: 6 requests/minute per token.
 */
export async function initDirectPost(
  accessToken: string,
  input: {
    title: string;
    privacyLevel: PrivacyLevel;
    videoSize: number;
    chunkSize: number;
    totalChunkCount: number;
  }
): Promise<InitDirectPostResult> {
  const res = await fetch(TIKTOK_PUBLISH_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: input.title,
        privacy_level: input.privacyLevel,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: input.videoSize,
        chunk_size: input.chunkSize,
        total_chunk_count: input.totalChunkCount,
      },
    }),
  });

  if (!res.ok) await throwTikTokError(res);

  const body = (await res.json()) as TikTokErrorBody & {
    data?: { publish_id?: string; upload_url?: string };
  };

  if (body.error?.code && body.error.code !== "ok") {
    throw new TikTokPublishError(
      res.status,
      body.error.code,
      body.error.message ?? "TikTok rejected the publish request."
    );
  }
  if (!body.data?.publish_id || !body.data?.upload_url) {
    throw new TikTokPublishError(
      res.status,
      "missing_upload_url",
      "TikTok did not return an upload URL."
    );
  }

  return { publishId: body.data.publish_id, uploadUrl: body.data.upload_url };
}

/**
 * Uploads the video bytes to the upload_url returned by init. Chunks are
 * uploaded sequentially; TikTok answers 206 per chunk and 201 for the last.
 */
export async function uploadVideoToTikTok(
  uploadUrl: string,
  video: Buffer,
  mimeType: string,
  plan: VideoChunkPlan
): Promise<void> {
  for (let index = 0; index < plan.totalChunkCount; index += 1) {
    const start = index * plan.chunkSize;
    const end = Math.min(start + plan.chunkSize, video.length) - 1;
    const chunk = video.subarray(start, end + 1);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Range": `bytes ${start}-${end}/${video.length}`,
      },
      body: new Uint8Array(chunk),
    });

    if (!res.ok) await throwTikTokError(res);
  }
}

export type PostStatusResult = {
  status: string | null;
  failReason: string[];
};

/**
 * Polls the publishing status of a direct post. Possible statuses include
 * PROCESSING_UPLOAD, SEND_TO_INBOX, PUBLISH_PROCESSING, PUBLISH_COMPLETE
 * and PUBLISH_FAILED (with fail_reason details).
 */
export async function fetchPostStatus(
  accessToken: string,
  publishId: string
): Promise<PostStatusResult> {
  const res = await fetch(TIKTOK_PUBLISH_STATUS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });

  if (!res.ok) await throwTikTokError(res);

  const body = (await res.json()) as TikTokErrorBody & {
    data?: { status?: string; fail_reason?: unknown };
  };

  if (body.error?.code && body.error.code !== "ok") {
    throw new TikTokPublishError(
      res.status,
      body.error.code,
      body.error.message ?? "TikTok status check failed."
    );
  }

  return {
    status: body.data?.status ?? null,
    failReason: Array.isArray(body.data?.fail_reason)
      ? body.data.fail_reason.map((reason) =>
          typeof reason === "string" ? reason : JSON.stringify(reason)
        )
      : [],
  };
}