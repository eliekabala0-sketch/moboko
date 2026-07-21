import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SERMON_ROOT = "D:\\AUDIO\\SERMENT WMB";
const PRAYER_ROOT = "D:\\AUDIO\\PREDICATION\\LIGNE_DE_PRIERE_DU_PROPHETE";
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"]);
const DEFAULT_LIMIT = 50 * 1024 * 1024;

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

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function formatBytes(bytes) {
  return `${bytes} (${(bytes / 1024 / 1024).toFixed(2)} MiB)`;
}

function readUInt24BE(buffer, offset) {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function parseMp3(file, size) {
  const buffer = readFileSync(file, { flag: "r" });
  let offset = 0;
  if (buffer.slice(0, 3).toString("latin1") === "ID3") {
    offset = 10 + ((buffer[6] & 0x7f) << 21) + ((buffer[7] & 0x7f) << 14) + ((buffer[8] & 0x7f) << 7) + (buffer[9] & 0x7f);
  }
  const bitrates = {
    "3-1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "3-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    "3-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  for (let i = offset; i < Math.min(buffer.length - 4, offset + 1024 * 1024); i += 1) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (buffer[i + 1] >> 3) & 0x03;
    const layerBits = (buffer[i + 1] >> 1) & 0x03;
    const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
    const version = versionBits === 3 ? 3 : versionBits === 2 ? 2 : versionBits === 0 ? 2 : null;
    const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : layerBits === 1 ? 3 : null;
    if (!version || !layer || bitrateIndex === 0 || bitrateIndex === 15) continue;
    const bitrateKbps = bitrates[`${version}-${layer}`]?.[bitrateIndex] ?? null;
    const audioBytes = Math.max(0, size - offset);
    const durationSeconds = bitrateKbps ? Math.round((audioBytes * 8) / (bitrateKbps * 1000)) : null;
    return { codec: `MPEG Layer ${layer}`, bitrateKbps, durationSeconds };
  }
  return { codec: "mp3", bitrateKbps: null, durationSeconds: null };
}

function readAtomHeader(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  let size = buffer.readUInt32BE(offset);
  const type = buffer.slice(offset + 4, offset + 8).toString("latin1");
  let headerSize = 8;
  if (size === 1 && offset + 16 <= buffer.length) {
    size = Number(buffer.readBigUInt64BE(offset + 8));
    headerSize = 16;
  }
  if (size < headerSize) return null;
  return { size, type, headerSize };
}

function findAtom(buffer, pathParts, start = 0, end = buffer.length) {
  if (!pathParts.length) return null;
  let offset = start;
  while (offset + 8 <= end) {
    const atom = readAtomHeader(buffer, offset);
    if (!atom) break;
    const atomEnd = Math.min(end, offset + atom.size);
    if (atom.type === pathParts[0]) {
      if (pathParts.length === 1) return { ...atom, offset, end: atomEnd };
      return findAtom(buffer, pathParts.slice(1), offset + atom.headerSize, atomEnd);
    }
    offset = atomEnd;
  }
  return null;
}

function parseM4a(file, size) {
  const buffer = readFileSync(file);
  const mdhd = findAtom(buffer, ["moov", "trak", "mdia", "mdhd"]);
  let durationSeconds = null;
  if (mdhd) {
    const base = mdhd.offset + mdhd.headerSize;
    const version = buffer[base];
    if (version === 1 && base + 32 <= buffer.length) {
      const timescale = buffer.readUInt32BE(base + 20);
      const duration = Number(buffer.readBigUInt64BE(base + 24));
      durationSeconds = timescale ? Math.round(duration / timescale) : null;
    } else if (base + 20 <= buffer.length) {
      const timescale = buffer.readUInt32BE(base + 12);
      const duration = buffer.readUInt32BE(base + 16);
      durationSeconds = timescale ? Math.round(duration / timescale) : null;
    }
  }
  const stsd = findAtom(buffer, ["moov", "trak", "mdia", "minf", "stbl", "stsd"]);
  let codec = "m4a";
  if (stsd) {
    const entryOffset = stsd.offset + stsd.headerSize + 8;
    if (entryOffset + 8 <= buffer.length) codec = buffer.slice(entryOffset + 4, entryOffset + 8).toString("latin1");
  }
  const bitrateKbps = durationSeconds ? Math.round((size * 8) / durationSeconds / 1000) : null;
  return { codec, bitrateKbps, durationSeconds };
}

function mediaInfo(file, size) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === ".mp3") return parseMp3(file, size);
    if (ext === ".m4a" || ext === ".mp4" || ext === ".aac") return parseM4a(file, size);
  } catch (error) {
    return { codec: `parse_error:${error.message}`, bitrateKbps: null, durationSeconds: null };
  }
  return { codec: ext.slice(1), bitrateKbps: null, durationSeconds: null };
}

let bucketLimit = DEFAULT_LIMIT;
let bucketInfo = null;
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await admin.storage.getBucket("sermon-audio");
  bucketInfo = data;
  const rawLimit = data?.file_size_limit ?? data?.fileSizeLimit;
  if (Number.isFinite(Number(rawLimit))) bucketLimit = Number(rawLimit);
}

console.log(`bucket_limit=${formatBytes(bucketLimit)}`);
if (bucketInfo) console.log(`bucket_public=${bucketInfo.public}`);

const sources = [
  { category: "sermon", root: SERMON_ROOT },
  { category: "prayer_line", root: PRAYER_ROOT },
];

const rows = [];
for (const source of sources) {
  const files = await walk(source.root);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const size = statSync(file).size;
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    const info = mediaInfo(file, size);
    rows.push({
      category: source.category,
      name: path.basename(file),
      fullPath: file,
      ext,
      size,
      overLimit: size > bucketLimit,
      ...info,
    });
  }
}

const over = rows.filter((row) => row.overLimit).sort((a, b) => b.size - a.size);
const totalBytes = rows.reduce((sum, row) => sum + row.size, 0);
const overBytes = over.reduce((sum, row) => sum + row.size, 0);
const max = rows.reduce((best, row) => (row.size > best.size ? row : best), rows[0]);

console.log(`audio_count=${rows.length}`);
console.log(`audio_total=${formatBytes(totalBytes)}`);
console.log(`over_limit_count=${over.length}`);
console.log(`over_limit_total=${formatBytes(overBytes)}`);
console.log(`max_file=${max.name}|${max.category}|${formatBytes(max.size)}`);

for (const row of over) {
  console.log(
    [
      "over",
      row.category,
      row.name,
      row.ext,
      row.size,
      `${(row.size / 1024 / 1024).toFixed(2)}MiB`,
      row.durationSeconds ?? "",
      row.bitrateKbps ?? "",
      row.codec ?? "",
    ].join("|"),
  );
}
