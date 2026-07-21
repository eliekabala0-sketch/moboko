import type { SupabaseClient } from "@supabase/supabase-js";

export type AudioManifest = {
  kind: "moboko-audio-chunks";
  version: 1;
  bucket: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  chunks: { path: string; offset: number; size: number; index: number }[];
};

export function isManifestPath(path: string) {
  return path.endsWith(".manifest.json");
}

export async function loadAudioManifest(admin: SupabaseClient, bucket: string, storagePath: string) {
  const { data, error } = await admin.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error("manifest_audio_indisponible");
  return JSON.parse(await data.text()) as AudioManifest;
}

function parseRange(value: string | null, size: number) {
  if (!value?.startsWith("bytes=")) return { start: 0, end: size - 1, partial: false };
  const [rawStart, rawEnd] = value.slice(6).split("-", 2);
  const start = rawStart ? Number(rawStart) : 0;
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1), partial: true };
}

export async function streamManifestRange(admin: SupabaseClient, manifest: AudioManifest, rangeHeader: string | null, downloadName?: string) {
  const range = parseRange(rangeHeader, manifest.size);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${manifest.size}` } });

  const chunks = manifest.chunks.filter((chunk) => {
    const chunkEnd = chunk.offset + chunk.size - 1;
    return chunk.offset <= range.end && chunkEnd >= range.start;
  });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of chunks) {
          const { data, error } = await admin.storage.from(manifest.bucket).download(chunk.path);
          if (error || !data) throw new Error("chunk_audio_indisponible");
          const bytes = new Uint8Array(await data.arrayBuffer());
          const localStart = Math.max(0, range.start - chunk.offset);
          const localEnd = Math.min(bytes.length, range.end - chunk.offset + 1);
          controller.enqueue(bytes.slice(localStart, localEnd));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const length = range.end - range.start + 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, no-store",
    "Content-Length": String(length),
    "Content-Type": manifest.mimeType || "audio/mpeg",
  });
  if (downloadName) headers.set("Content-Disposition", `attachment; filename="${downloadName.replace(/"/g, "")}"`);
  if (range.partial) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${manifest.size}`);

  return new Response(body, { status: range.partial ? 206 : 200, headers });
}
