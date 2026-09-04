"use client";

import { useRef, useState } from "react";

// Keep in sync with MAX_VIDEO_SIZE_BYTES in lib/tiktok/publish.ts.
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const ACCEPTED_FILES = ".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime";
const MAX_TITLE_LENGTH = 2200;

const PRIVACY_OPTIONS = [
  { value: "SELF_ONLY", label: "Only me (private)" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
];

// TikTok post statuses considered final while polling.
const TERMINAL_OK_STATUSES = ["PUBLISH_COMPLETE", "SEND_TO_INBOX"];
const TERMINAL_FAIL_STATUSES = ["PUBLISH_FAILED"];
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;

type Phase = "idle" | "uploading" | "processing" | "done" | "failed";

interface UploadResponse {
  publish_id?: string;
  error?: string;
  message?: string;
}

interface StatusResponse {
  status?: string | null;
  fail_reason?: string[];
  error?: string;
  message?: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function VideoUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState("SELF_ONLY");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "uploading" || phase === "processing";

  function pickFile(selected: File | null) {
    setError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size > MAX_VIDEO_SIZE_BYTES) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setError(
        `"${selected.name}" is ${formatBytes(selected.size)} - the limit is ${formatBytes(MAX_VIDEO_SIZE_BYTES)}.`
      );
      return;
    }
    setFile(selected);
  }

  function reset() {
    setPhase("idle");
    setProgress(0);
    setStatusMessage(null);
    setError(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleUpload() {
    if (!file || busy) return;

    setPhase("uploading");
    setProgress(0);
    setError(null);
    setStatusMessage("Uploading video to TikTok…");

    const form = new FormData();
    form.set("file", file);
    if (title.trim()) form.set("title", title.trim());
    form.set("privacy_level", privacyLevel);

    // XHR instead of fetch so we get upload progress events.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/tiktok/video/upload");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => {
      setPhase("failed");
      setError("Network error while uploading the video.");
    };
    xhr.onload = () => {
      const body = (xhr.response ?? null) as UploadResponse | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.publish_id) {
        setPhase("processing");
        setStatusMessage("Upload complete - TikTok is processing the video…");
        pollStatus(body.publish_id, 0);
      } else {
        setPhase("failed");
        setError(body?.message ?? `Upload failed (HTTP ${xhr.status}).`);
      }
    };

    xhr.send(form);
  }

  function pollStatus(publishId: string, attempt: number) {
    if (attempt >= MAX_POLL_ATTEMPTS) {
      setPhase("failed");
      setError(
        "Timed out waiting for TikTok to process the video. Check the TikTok app later."
      );
      return;
    }

    setTimeout(async () => {
      try {
        const res = await fetch("/api/tiktok/video/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publish_id: publishId }),
        });
        const body = (await res.json()) as StatusResponse;

        if (!res.ok) {
          setPhase("failed");
          setError(body?.message ?? "TikTok status check failed.");
          return;
        }

        const status = body?.status ?? null;
        if (status && TERMINAL_OK_STATUSES.includes(status)) {
          setPhase("done");
          setStatusMessage(
            status === "SEND_TO_INBOX"
              ? "Done - the video was sent to your TikTok inbox (unaudited apps publish privately)."
              : "Done - the video was published to TikTok! 🎉"
          );
          return;
        }
        if (status && TERMINAL_FAIL_STATUSES.includes(status)) {
          setPhase("failed");
          const reasons =
            body?.fail_reason && body.fail_reason.length > 0
              ? ` (${body.fail_reason.join(", ")})`
              : "";
          setError(`TikTok failed to publish the video${reasons}.`);
          return;
        }

        setStatusMessage(
          status
            ? `TikTok is processing the video (${status.toLowerCase().replaceAll("_", " ")})…`
            : "TikTok is processing the video…"
        );
        pollStatus(publishId, attempt + 1);
      } catch {
        setPhase("failed");
        setError("Network error while checking the video status.");
      }
    }, POLL_INTERVAL_MS);
  }

  return (
    <section className="mt-8 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <h2 className="text-lg font-semibold">Upload a video</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Posts directly to TikTok via the Content Posting API. Unaudited apps
        can only publish privately.
      </p>

      <div className="mt-4 grid gap-4">
        <div>
          <label className="block text-sm font-medium" htmlFor="video-file">
            Video file (MP4, WebM or MOV)
          </label>
          <input
            id="video-file"
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FILES}
            onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
            disabled={busy}
            className="mt-1 block w-full text-sm"
          />
          {file && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {file.name} ({formatBytes(file.size)})
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="video-title">
            Caption
          </label>
          <input
            id="video-title"
            type="text"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Describe your video… #hashtags and @mentions work"
            disabled={busy}
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="video-privacy">
            Who can watch
          </label>
          <select
            id="video-privacy"
            value={privacyLevel}
            onChange={(event) => setPrivacyLevel(event.target.value)}
            disabled={busy}
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {PRIVACY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {phase === "uploading" && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-700">
              <div
                className="h-full bg-[#FE2C55] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {progress}% uploaded
            </p>
          </div>
        )}

        {statusMessage && (
          <p className="text-sm" aria-live="polite">
            {statusMessage}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            disabled={!file || busy}
            className="rounded-md bg-[#FE2C55] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "uploading"
              ? "Uploading…"
              : phase === "processing"
                ? "Processing…"
                : "Upload to TikTok"}
          </button>
          {(phase === "done" || phase === "failed") && (
            <button
              onClick={reset}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </section>
  );
}