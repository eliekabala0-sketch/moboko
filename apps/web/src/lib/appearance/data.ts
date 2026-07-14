import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  defaultAppearancePayload,
  normalizeAppearancePayload,
  type AppearanceRevision,
} from "./config";

type RevisionRow = {
  id: string;
  status: "draft" | "published" | "archived";
  title: string | null;
  payload: unknown;
  restored_from: string | null;
  published_at: string | null;
  updated_at: string;
};

function toRevision(row: RevisionRow): AppearanceRevision {
  return {
    id: row.id,
    status: row.status,
    title: row.title ?? "Apparence",
    payload: normalizeAppearancePayload(row.payload),
    restored_from: row.restored_from,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
}

export async function fetchPublishedAppearance() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return defaultAppearancePayload;

  const { data } = await supabase
    .from("appearance_revisions")
    .select("id, status, title, payload, restored_from, published_at, updated_at")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? toRevision(data as RevisionRow).payload : defaultAppearancePayload;
}

export async function fetchAdminAppearanceState() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { draft: null, published: null, history: [] as AppearanceRevision[] };
  }

  const { data } = await supabase
    .from("appearance_revisions")
    .select("id, status, title, payload, restored_from, published_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  const rows = ((data ?? []) as RevisionRow[]).map(toRevision);
  return {
    draft: rows.find((r) => r.status === "draft") ?? null,
    published: rows.find((r) => r.status === "published") ?? null,
    history: rows,
  };
}
