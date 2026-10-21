"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Alert, Spinner } from "@/components/ui";

const MAX_SIDE = 1600;

/**
 * Shrinks a photo to at most 1600 px on its long side as a JPEG, so uploads
 * stay small on mobile data. Anything the browser cannot draw is sent as is.
 */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_000_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Adds photos or a video to a complaint (ClickUp EP-15 T5), from a member's
 * page or a worker's job link.
 */
export function MediaUpload({
  endpoint,
  stage = "report",
  label = "Add photos or a video",
}: {
  endpoint: string;
  stage?: "report" | "completion";
  label?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setDone(null);
    let added = 0;
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.set("file", await shrink(file));
      body.set("stage", stage);
      const response = await fetch(endpoint, { method: "POST", body });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        setError(result.error ?? "The file could not be uploaded. Try again.");
        break;
      }
      added += 1;
    }
    setBusy(false);
    if (added > 0) {
      setDone(added === 1 ? "File added." : `${added} files added.`);
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand-500"
      >
        {busy && <Spinner />}
        {busy ? "Uploading…" : label}
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void upload(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      <p className="text-xs text-slate-500">Up to 5 photos and 1 short video (20 MB).</p>
      {error && <Alert tone="error">{error}</Alert>}
      {done && (
        <p role="status" className="text-sm text-emerald-700">
          {done}
        </p>
      )}
    </div>
  );
}
