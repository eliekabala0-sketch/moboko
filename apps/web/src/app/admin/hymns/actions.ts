"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function adminSession() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Non authentifie");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifie");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("Acces reserve aux administrateurs");
  return { supabase };
}

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function splitHymnText(raw: string): { verses: string[]; chorus: string | null } {
  const blocks = raw
    .split(/\r?\n\s*\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  let chorus: string | null = null;
  const verses: string[] = [];
  for (const block of blocks) {
    if (/^(refrain|choeur|chœur|chorus)\s*[:.-]?/i.test(block.trim())) {
      chorus = block;
    } else {
      verses.push(block);
    }
  }
  return { verses, chorus };
}

function parseHymnBook(raw: string): { number: string; title: string; lyrics: string; verses: string[]; chorus: string | null }[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const starts: { index: number; number: string; title: string }[] = [];
  const heading = /^\s*(?:n[°o.]?\s*)?(\d{1,4})\s*(?:[.):-]|\s+-\s+)?\s+(.+?)\s*$/i;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]?.match(heading);
    if (!m) continue;
    const title = (m[2] ?? "").trim();
    if (title.length < 2) continue;
    starts.push({ index: i, number: m[1] ?? "", title });
  }
  const hymns = [];
  for (let i = 0; i < starts.length; i += 1) {
    const current = starts[i]!;
    const next = starts[i + 1]?.index ?? lines.length;
    const body = lines.slice(current.index + 1, next).join("\n").trim();
    if (!body) continue;
    const split = splitHymnText(body);
    hymns.push({
      number: current.number,
      title: current.title,
      lyrics: body,
      verses: split.verses,
      chorus: split.chorus,
    });
  }
  return hymns;
}

function readForm(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const number = String(formData.get("number") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim() || null;
  const bookId = String(formData.get("book_id") ?? "").trim() || null;
  const lyrics = String(formData.get("lyrics") ?? "").trim();
  const isPublished = formData.get("is_published") === "on";
  if (!title) throw new Error("Titre requis");
  if (!lyrics) throw new Error("Texte requis");
  const slugBase = number ? `${number}-${title}` : title;
  const split = splitHymnText(lyrics);
  return {
    title,
    number,
    category,
    book_id: bookId,
    lyrics,
    verses: split.verses as never,
    chorus: split.chorus,
    is_published: isPublished,
    slug: slugify(slugBase) || slugify(title),
  };
}

async function readImportText(formData: FormData) {
  const pasted = String(formData.get("book_text") ?? "").trim();
  const file = formData.get("book_file");
  if (file && typeof file === "object" && "name" in file && "size" in file) {
    const upload = file as File;
    if (upload.size > 0) {
      const name = upload.name.toLowerCase();
      const type = upload.type.toLowerCase();
      if (name.endsWith(".pdf") || type.includes("pdf")) {
        throw new Error("PDF detecte: exportez le livre en TXT. Un PDF scanne doit etre OCRise avant import.");
      }
      if (name.endsWith(".docx") || type.includes("word")) {
        throw new Error("DOCX detecte: convertissez le document en TXT pour cet import.");
      }
      if (!name.endsWith(".txt") && type && !type.startsWith("text/")) {
        throw new Error("Format non pris en charge. Utilisez un fichier TXT structure ou collez le texte.");
      }
      return upload.text().then((text) => text.trim());
    }
  }
  return pasted;
}

export async function createHymnAction(formData: FormData) {
  const { supabase } = await adminSession();
  const hymn = readForm(formData);
  const { error } = await supabase.from("hymns").insert(hymn);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

export async function updateHymnAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Cantique introuvable");
  const hymn = readForm(formData);
  const { error } = await supabase.from("hymns").update(hymn).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

export async function deleteHymnAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Cantique introuvable");
  const { error } = await supabase.from("hymns").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

export async function updateHymnBookStatusAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  const isPublished = formData.get("is_published") === "on";
  if (!id) throw new Error("Livre introuvable");
  const { error } = await supabase.from("hymn_books").update({ is_published: isPublished }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

export async function importHymnBookAction(formData: FormData) {
  const { supabase } = await adminSession();
  const name = String(formData.get("book_name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const raw = await readImportText(formData);
  const isPublished = formData.get("is_published") === "on";
  if (!name) throw new Error("Nom du livre requis");
  if (!raw) throw new Error("Fichier TXT ou texte du livre requis");
  const parsed = parseHymnBook(raw);
  if (parsed.length === 0) throw new Error("Aucun cantique numerote detecte");
  const bookSlug = slugify(name);
  const { data: book, error: bookErr } = await supabase
    .from("hymn_books")
    .upsert(
      { name, slug: bookSlug, description, is_published: isPublished },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (bookErr || !book?.id) throw new Error(bookErr?.message ?? "Livre introuvable");
  const rows = parsed.map((h) => ({
    book_id: book.id as string,
    title: h.title,
    number: h.number,
    category: name,
    lyrics: h.lyrics,
    verses: h.verses as never,
    chorus: h.chorus,
    is_published: isPublished,
    slug: slugify(`${bookSlug}-${h.number}-${h.title}`),
  }));
  const { error } = await supabase.from("hymns").upsert(rows, { onConflict: "slug" });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/projection");
}

function parseReviewedVerses(raw: string) {
  return raw
    .split(/\r?\n\s*---\s*\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((text, index) => ({ number: index + 1, text }));
}

export async function saveHymnStructureReviewAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  const versesRaw = String(formData.get("verses_text") ?? "").trim();
  const chorus = String(formData.get("chorus") ?? "").trim() || null;
  if (!id) throw new Error("Cantique introuvable");
  if (!versesRaw) throw new Error("Au moins un couplet est requis");

  const { data: current, error: currentError } = await supabase
    .from("hymns")
    .select("id, verses, chorus, number, book_id")
    .eq("id", id)
    .single();
  if (currentError || !current?.id) throw new Error(currentError?.message ?? "Cantique introuvable");

  const verses = parseReviewedVerses(versesRaw);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("hymn_structure_history").insert({
    hymn_id: id,
    previous_verses: current.verses ?? [],
    previous_chorus: current.chorus ?? null,
    changed_by: user?.id ?? null,
    source: "admin_review",
    snapshot: { number: current.number, book_id: current.book_id },
  });

  const { error } = await supabase
    .from("hymns")
    .update({
      verses: verses as never,
      chorus,
      validation_status: "valid",
      validation_notes: [] as never,
      confidence_score: "admin_validated",
      structure_anomalies: [] as never,
      structure_checked_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/admin/hymns/review");
  revalidatePath("/hymns");
  revalidatePath("/projection");
}

export async function restorePreviousHymnStructureAction(formData: FormData) {
  const { supabase } = await adminSession();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Cantique introuvable");
  const { data: history, error: historyError } = await supabase
    .from("hymn_structure_history")
    .select("previous_verses, previous_chorus")
    .eq("hymn_id", id)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (historyError || !history) throw new Error(historyError?.message ?? "Aucune version precedente");

  const { error } = await supabase
    .from("hymns")
    .update({
      verses: history.previous_verses as never,
      chorus: history.previous_chorus,
      validation_status: "needs_review",
      confidence_score: "restored",
      structure_anomalies: ["restored_previous_structure"] as never,
      structure_checked_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/hymns");
  revalidatePath("/admin/hymns/review");
  revalidatePath("/hymns");
  revalidatePath("/projection");
}
