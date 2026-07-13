import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function readEnv(file) {
  const out = {};
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/g)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function signature(row) {
  return crypto
    .createHash("sha256")
    .update([row.title ?? "", row.lyrics ?? "", row.chorus ?? ""].join("\u001f"))
    .digest("hex");
}

async function hasColumn(supabase, column) {
  const { error } = await supabase.from("hymns").select(column).limit(1);
  return !error;
}

async function main() {
  const env = readEnv("apps/web/.env.local");
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const hasValidationStatus = await hasColumn(supabase, "validation_status");
  const hasValidationNotes = await hasColumn(supabase, "validation_notes");
  const selectColumns = [
    "id",
    "book_id",
    "number",
    "title",
    "lyrics",
    "chorus",
    "created_at",
    "hymn_books(name)",
    hasValidationNotes ? "validation_notes" : null,
  ]
    .filter(Boolean)
    .join(",");

  const { data, error } = await supabase
    .from("hymns")
    .select(selectColumns)
    .not("book_id", "is", null)
    .not("number", "is", null)
    .order("book_id", { ascending: true })
    .order("number", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const groups = new Map();
  for (const row of data ?? []) {
    const key = `${row.book_id}::${row.number}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const identicalDeletes = [];
  const conflicts = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const bySignature = new Map();
    for (const row of group) {
      const sig = signature(row);
      const same = bySignature.get(sig) ?? [];
      same.push(row);
      bySignature.set(sig, same);
    }
    for (const same of bySignature.values()) {
      identicalDeletes.push(...same.slice(1));
    }
    const survivors = group.filter((row) => !identicalDeletes.some((deleted) => deleted.id === row.id));
    if (new Set(survivors.map(signature)).size > 1) conflicts.push(survivors);
  }

  for (const row of identicalDeletes) {
    const { error: deleteError } = await supabase.from("hymns").delete().eq("id", row.id);
    if (deleteError) throw deleteError;
  }

  for (const group of conflicts) {
    const sorted = [...group].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
    const original = sorted[0]?.number;
    for (let index = 0; index < sorted.length; index += 1) {
      const row = sorted[index];
      const rank = index + 1;
      const notes = Array.isArray(row.validation_notes) ? row.validation_notes : [];
      const nextNotes = [
        ...notes,
        {
          type: "duplicate_number_conflict",
          original_number: original,
          conflict_rank: rank,
          conflict_count: sorted.length,
          note: "Different hymns shared the same book number; text preserved and conflict requires review.",
        },
      ];
      const payload = {
        number: rank === 1 ? row.number : `${original}-conflit-${rank}`,
      };
      if (hasValidationStatus) payload.validation_status = "needs_review";
      if (hasValidationNotes) payload.validation_notes = nextNotes;
      const { error: updateError } = await supabase.from("hymns").update(payload).eq("id", row.id);
      if (updateError) throw updateError;
    }
  }

  const { data: after, error: afterError } = await supabase
    .from("hymns")
    .select("id, book_id, number")
    .not("book_id", "is", null)
    .not("number", "is", null);
  if (afterError) throw afterError;
  const afterGroups = new Map();
  for (const row of after ?? []) {
    const key = `${row.book_id}::${row.number}`;
    afterGroups.set(key, (afterGroups.get(key) ?? 0) + 1);
  }
  const remaining = [...afterGroups.entries()].filter(([, count]) => count > 1);
  console.log(
    JSON.stringify(
      {
        identical_deleted: identicalDeletes.length,
        conflict_groups: conflicts.length,
        conflict_rows: conflicts.reduce((sum, group) => sum + group.length, 0),
        remaining_duplicates: remaining.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
