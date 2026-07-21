import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SERMON_ROOT = "D:\\AUDIO\\SERMENT WMB";
const DEFAULT_PRAYER_ROOT = "D:\\AUDIO\\PREDICATION\\LIGNE_DE_PRIERE_DU_PROPHETE";
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"]);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) args.set(key, "true");
  else {
    args.set(key, next);
    i += 1;
  }
}

const dryRun = args.get("dry-run") !== "false";
const category = args.get("category") === "prayer_line" ? "prayer_line" : "sermon";
const root = args.get("root") ?? (category === "sermon" ? DEFAULT_SERMON_ROOT : DEFAULT_PRAYER_ROOT);
const limit = Number(args.get("limit") ?? 10);
const singleFile = args.get("file") ?? "";
const verify = args.get("verify") === "true";
const bucketLimit = Number(args.get("bucket-limit") ?? 50 * 1024 * 1024);
const chunkSize = Number(args.get("chunk-size") ?? 45 * 1024 * 1024);
const maxRetries = Number(args.get("retries") ?? 4);
const onlyFailed = args.get("only-failed") === "true";
const onlyInventoried = args.get("only-inventoried") === "true";

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), "apps", "web", ".env.local"));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquant`);
  return value;
}

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeFilename(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

function parseCode(name) {
  const match = name.match(/FRN(?<yy>\d{2})-(?<md>\d{4})(?<suffix>[A-Z]?)/i);
  if (!match?.groups) return { code: null, year: null, date: null };
  const yy = Number(match.groups.yy);
  const year = yy < 30 ? 2000 + yy : 1900 + yy;
  const month = Number(match.groups.md.slice(0, 2));
  const day = Number(match.groups.md.slice(2, 4));
  const date = month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
  return { code: match[0].toUpperCase(), year, date };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function findSermon(admin, item) {
  if (category !== "sermon") return { sermon_id: null, sermon_match_status: "unmatched", sermon_match_score: null };
  let query = admin.from("sermons").select("id, title, preached_on, year, location").eq("is_published", true).limit(20);
  if (item.date) query = query.eq("preached_on", item.date);
  else if (item.year) query = query.eq("year", item.year);
  const { data } = await retry("find sermon", () => query);
  const title = normalize(item.title);
  let best = null;
  for (const sermon of data ?? []) {
    const st = normalize(sermon.title ?? "");
    const words = title.split(" ").filter((word) => word.length >= 4);
    const matched = words.filter((word) => st.includes(word)).length;
    const score = words.length ? matched / words.length : 0;
    if (!best || score > best.score) best = { sermon, score };
  }
  if (!best || best.score < 0.45) return { sermon_id: null, sermon_match_status: "unmatched", sermon_match_score: null };
  return {
    sermon_id: best.sermon.id,
    sermon_match_status: best.score >= 0.82 ? "matched" : "probable_match",
    sermon_match_score: Number(best.score.toFixed(4)),
  };
}

function mimeFor(ext) {
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".opus") return "audio/opus";
  return "application/octet-stream";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, fn) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await fn();
      if (!result?.error) return result;
      lastError = result.error;
      const message = errorMessage(result.error).toLowerCase();
      if (message.includes("already exists")) return result;
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxRetries) {
      await sleep(Math.min(1500 * 2 ** attempt, 12000));
    }
  }
  throw new Error(`${label}: ${errorMessage(lastError)}`);
}

function chunkStorageParts(category, yearSegment, checksum, original) {
  const safe = safeFilename(original);
  const base = `chunks/${category === "sermon" ? "sermons" : "prayer-lines"}/${yearSegment}/${checksum.slice(0, 12)}-${safe}`;
  return {
    base,
    manifestPath: `${base}.manifest.json`,
    chunkPath(index) {
      return `${base}.part-${String(index).padStart(4, "0")}`;
    },
  };
}

async function uploadFileOrChunks(admin, file, row, checksum, yearSegment, original) {
  if (row.file_size <= bucketLimit) {
    const body = readFileSync(file);
    const upload = await retry(`upload ${row.storage_path}`, () =>
      admin.storage.from("sermon-audio").upload(row.storage_path, body, {
        contentType: row.mime_type,
        upsert: false,
      }),
    );
    if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists")) throw upload.error;
    if (verify) {
      const remote = await retry(`verify ${row.storage_path}`, () =>
        admin.storage.from("sermon-audio").list(path.dirname(row.storage_path), { search: path.basename(row.storage_path), limit: 1 }),
      );
      if (remote.error || !remote.data?.length) throw new Error("verification_upload_echouee");
    }
    return { storagePath: row.storage_path, chunked: false, chunks: 0 };
  }

  const parts = chunkStorageParts(row.category, yearSegment, checksum, original);
  const body = readFileSync(file);
  const chunks = [];
  for (let offset = 0, index = 0; offset < body.length; offset += chunkSize, index += 1) {
    const bytes = body.subarray(offset, Math.min(offset + chunkSize, body.length));
    const chunkPath = parts.chunkPath(index);
    const upload = await retry(`upload ${chunkPath}`, () =>
      admin.storage.from("sermon-audio").upload(chunkPath, bytes, {
        contentType: "application/octet-stream",
        upsert: false,
      }),
    );
    if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists")) throw upload.error;
    chunks.push({ path: chunkPath, offset, size: bytes.length, index });
  }
  const manifest = {
    kind: "moboko-audio-chunks",
    version: 1,
    bucket: "sermon-audio",
    originalFilename: original,
    mimeType: row.mime_type,
    size: row.file_size,
    checksum,
    chunks,
  };
  const manifestUpload = await retry(`upload ${parts.manifestPath}`, () =>
    admin.storage.from("sermon-audio").upload(parts.manifestPath, JSON.stringify(manifest), {
      contentType: "application/json",
      upsert: true,
    }),
  );
  if (manifestUpload.error) throw manifestUpload.error;
  if (verify) {
    const remote = await retry(`verify ${parts.manifestPath}`, () =>
      admin.storage.from("sermon-audio").list(path.dirname(parts.manifestPath), { search: path.basename(parts.manifestPath), limit: 1 }),
    );
    if (remote.error || !remote.data?.length) throw new Error("verification_manifest_echouee");
  }
  return { storagePath: parts.manifestPath, chunked: true, chunks: chunks.length };
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const parts = [error.code, error.message, error.details, error.hint].filter(Boolean);
    if (parts.length) return parts.join(" | ");
  }
  return String(error);
}

async function main() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`Chemin source invalide: ${root}`);

  const allFiles = singleFile ? [singleFile] : await walk(root);
  let files = allFiles
    .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .slice(0, limit > 0 ? limit : undefined);

  if (onlyFailed && !singleFile) {
    const { data: failedEvents } = await retry("load failed audio events", () =>
      admin
        .from("audio_import_events")
        .select("source_path")
        .eq("event_type", "failed")
        .order("created_at", { ascending: false })
        .limit(1000),
    );
    const failedPaths = new Set(
      (failedEvents ?? [])
        .map((event) => String(event.source_path ?? ""))
        .filter((sourcePath) => sourcePath && existsSync(sourcePath) && path.resolve(sourcePath).startsWith(path.resolve(root))),
    );
    files = files.filter((file) => failedPaths.has(file));
  }

  if (onlyInventoried && !singleFile) {
    const { data: inventoriedItems } = await retry("load inventoried audio items", () =>
      admin
        .from("audio_items")
        .select("original_relative_path")
        .eq("category", category)
        .eq("import_status", "inventoried")
        .limit(1000),
    );
    const inventoriedPaths = new Set(
      (inventoriedItems ?? [])
        .map((item) => path.join(root, String(item.original_relative_path ?? "")))
        .filter((sourcePath) => sourcePath && existsSync(sourcePath)),
    );
    files = files.filter((file) => inventoriedPaths.has(file));
  }

  const { data: run } = await retry("create import run", () =>
    admin
      .from("audio_import_runs")
      .insert({ source_root: root, category, dry_run: dryRun, total_files: files.length })
      .select("id")
      .single(),
  );

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const fileStat = await stat(file);
      const ext = path.extname(file).toLowerCase();
      const original = path.basename(file);
      const relative = path.relative(root, file);
      const parsed = parseCode(original);
      const title = original.replace(/\.[^.]+$/, "").replace(/^FRN\d{2}-\d{4}[A-Z]?\s*/i, "").replace(/\s*VGR$/i, "").trim() || original;
      const checksum = await sha256(file);
      const yearSegment = parsed.year ? String(parsed.year) : "unknown";
      const storagePath = `${category === "sermon" ? "sermons" : "prayer-lines"}/${yearSegment}/${checksum.slice(0, 12)}-${safeFilename(original)}`;
      const match = await findSermon(admin, { title, year: parsed.year, date: parsed.date });
      const row = {
        media_type: "audio",
        category,
        title,
        normalized_title: normalize(`${parsed.code ?? ""} ${title}`),
        original_filename: original,
        original_relative_path: relative,
        storage_bucket: "sermon-audio",
        storage_path: storagePath,
        mime_type: mimeFor(ext),
        file_size: fileStat.size,
        checksum_sha256: checksum,
        sermon_id: match.sermon_id,
        sermon_match_status: match.sermon_match_status,
        sermon_match_score: match.sermon_match_score,
        sermon_date: parsed.date,
        sermon_year: parsed.year,
        language: "fr",
        is_active: false,
        streaming_enabled: true,
        offline_enabled: false,
        full_download_enabled: false,
        import_status: dryRun ? "inventoried" : "uploaded",
        imported_at: dryRun ? null : new Date().toISOString(),
      };

      if (!dryRun) {
        const uploadedFile = await uploadFileOrChunks(admin, file, row, checksum, yearSegment, original);
        row.storage_path = uploadedFile.storagePath;
        uploaded += 1;
        row.import_status = uploadedFile.chunked ? "verified" : row.import_status;
      } else {
        skipped += 1;
      }

      const { data: existing } = await retry(`select audio item ${relative}`, () =>
        admin
          .from("audio_items")
          .select("id")
          .eq("category", category)
          .eq("original_relative_path", relative)
          .maybeSingle(),
      );
      const write = existing?.id
        ? await retry(`update audio item ${relative}`, () => admin.from("audio_items").update(row).eq("id", existing.id))
        : await retry(`insert audio item ${relative}`, () => admin.from("audio_items").insert(row));
      if (write.error) throw write.error;
      await retry(`event audio item ${relative}`, () => admin.from("audio_import_events").insert({
        run_id: run?.id ?? null,
        level: "info",
        event_type: dryRun ? "inventoried" : "uploaded",
        message: original,
        source_path: file,
        storage_path: row.storage_path,
        payload: { checksum, match, chunked: row.storage_path.endsWith(".manifest.json") },
      }));
      console.log(`${dryRun ? "DRY" : "OK"} ${category} ${relative}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${file}: ${errorMessage(error)}`);
      await retry(`failed event ${file}`, () => admin.from("audio_import_events").insert({
        run_id: run?.id ?? null,
        level: "error",
        event_type: "failed",
        message: errorMessage(error),
        source_path: file,
      }));
    }
  }

  await retry("finish import run", () =>
    admin
      .from("audio_import_runs")
      .update({
        status: failed > 0 ? "failed" : "completed",
        processed_files: files.length,
        uploaded_files: uploaded,
        skipped_files: skipped,
        failed_files: failed,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run?.id),
  );

  console.log(`Import termine dryRun=${dryRun} processed=${files.length} uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
