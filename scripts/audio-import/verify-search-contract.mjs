import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const siteUrl = (process.argv[2] || "https://moboko-production.up.railway.app").replace(/\/$/, "");

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const index = text.indexOf("=");
    const key = text.slice(0, index).trim();
    if (!process.env[key]) process.env[key] = text.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(`ECHEC: ${label}`);
  console.log(`OK ${label}`);
}

loadEnv(path.resolve("apps/web/.env.local"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function assisted(token, query) {
  const response = await fetch(`${siteUrl}/api/ai/sermons-search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, pageSize: 20 }),
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 200, `Assistant HTTP 200: ${query}`);
  return body;
}

async function audioSearch(query) {
  const response = await fetch(`${siteUrl}/api/audio?category=sermon&q=${encodeURIComponent(query)}&limit=20`);
  const body = await response.json();
  assert(response.status === 200, `recherche audio HTTP 200: ${query}`);
  return body.results ?? [];
}

async function chat(token, conversationId, text) {
  const response = await fetch(`${siteUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversationId, mode: "text", text }),
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 200, `Chat HTTP 200: ${text}`);
  return body;
}

const email = `moboko-search-contract-${Date.now()}@example.com`;
const password = `MobokoContract!${Date.now()}`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("utilisateur test absent");
const userId = created.data.user.id;
let conversationId = null;
let freeAudioRestore = null;
let inactiveAudioRestore = null;

try {
  await admin.from("profiles").update({ credit_balance: 9999, is_free_access: true }).eq("id", userId);
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("session test absente");
  const token = signed.data.session.access_token;

  const textOnly = await assisted(token, "Messages texte uniquement : petites chaussures blanches");
  assert(textOnly.result_kind === "text" && textOnly.requested_media === "text", "demande texte uniquement");
  assert(Array.isArray(textOnly.results) && textOnly.results.length > 0, "citations texte exactes présentes");
  assert(textOnly.results.every((row) => typeof row.sermon_id === "string" && typeof row.paragraph_id === "string"), "identifiants sermon/paragraphe présents");

  const audioOnly = await assisted(token, "Audio uniquement Marriage And Divorce");
  assert(audioOnly.result_kind === "audio" && audioOnly.requested_media === "audio", "demande audio uniquement");
  assert(Array.isArray(audioOnly.audio_results) && audioOnly.audio_results.length > 0, "audio Marriage And Divorce trouvé");
  assert(audioOnly.audio_results.every((row) => row.audio_available === true && typeof row.audio_id === "string"), "uniquement des audios actifs réels");

  const unspecified = await assisted(token, "petites chaussures blanches");
  assert(unspecified.result_kind === "text" && unspecified.requested_media === "text", "demande sans précision retourne le texte");

  const empty = await assisted(token, "Messages texte uniquement xylophonequasar zorbium introuvable 998877");
  assert(empty.total_count === 0 && empty.message === "Aucun sermon texte trouvé dans la base Moboko.", "absence de résultat honnête");

  const filteredEmpty = await assisted(token, "Messages texte uniquement petites chaussures blanches en 1940");
  assert(filteredEmpty.total_count === 0 && filteredEmpty.message === "Aucun sermon texte trouvé dans la base Moboko.", "filtre année sans résultat honnête");

  const segmented = textOnly.results.filter((row) => row.paragraph_number === 75);
  assert(segmented.length >= 3 && segmented.some((row) => row.segment_index === 2 && row.segment_count >= 3), "paragraphe 75 segmenté sans renumérotation");

  const french = await audioSearch("Mariage et le Divorce");
  const english = await audioSearch("Marriage And Divorce");
  const frenchIds = new Set(french.map((row) => row.audio_id));
  assert(english.some((row) => frenchIds.has(row.audio_id)), "titres français et anglais retrouvent le même audio");
  assert(french.some((row) => /MARIAGE ET LE DIVORCE/i.test(row.sermon_title_fr ?? "")), "titre français officiel affiché");

  const html = await fetch(`${siteUrl}/sermons?st=${encodeURIComponent("MARIAGE ET LE DIVORCE")}`).then((response) => response.text());
  assert(/Écouter l(?:'|&#x27;)audio/i.test(html), "bouton Écouter l'audio rendu dans la recherche normale");
  const audioId = english[0]?.audio_id;
  assert(typeof audioId === "string", "identifiant audio témoin");
  const detailHtml = await fetch(`${siteUrl}/audio/${audioId}`).then((response) => response.text());
  assert(/LE MARIAGE ET LE DIVORCE/i.test(detailHtml), "page audio affiche le titre français");

  let { data: freeAudio } = await admin
    .from("audio_items")
    .select("id")
    .eq("category", "sermon")
    .eq("is_active", true)
    .eq("streaming_enabled", true)
    .in("access_policy", ["free", "excerpt"])
    .limit(1)
    .maybeSingle();
  if (!freeAudio?.id) {
    const originalPolicy = await admin.from("audio_items").select("id,access_policy").eq("id", audioId).single();
    if (originalPolicy.error || !originalPolicy.data) throw originalPolicy.error ?? new Error("audio témoin absent");
    freeAudioRestore = originalPolicy.data;
    const madeFree = await admin.from("audio_items").update({ access_policy: "free" }).eq("id", audioId);
    if (madeFree.error) throw madeFree.error;
    freeAudio = { id: audioId };
  }
  assert(Boolean(freeAudio?.id), "audio gratuit actif disponible pour le test");
  const freeResponse = await fetch(`${siteUrl}/api/audio/${freeAudio.id}/stream`, { method: "POST" });
  assert(freeResponse.status === 200, "audio gratuit lisible sans abonnement");

  let { data: inactiveAudio } = await admin
    .from("audio_items")
    .select("id,title")
    .eq("category", "sermon")
    .eq("is_active", false)
    .limit(1)
    .maybeSingle();
  if (!inactiveAudio?.id) {
    const activeWitness = await admin.from("audio_items").select("id,title,is_active").eq("id", audioId).single();
    if (activeWitness.error || !activeWitness.data) throw activeWitness.error ?? new Error("audio actif témoin absent");
    inactiveAudioRestore = activeWitness.data;
    const disabled = await admin.from("audio_items").update({ is_active: false }).eq("id", audioId);
    if (disabled.error) throw disabled.error;
    inactiveAudio = { id: audioId, title: activeWitness.data.title };
  }
  assert(Boolean(inactiveAudio?.id), "audio inactif disponible pour le test");
  const inactiveResponse = await fetch(`${siteUrl}/api/audio/${inactiveAudio.id}/stream`, { method: "POST" });
  assert(inactiveResponse.status === 404, "audio inactif exclu de la lecture");
  const inactiveResults = await audioSearch(inactiveAudio.title);
  assert(inactiveResults.every((row) => row.audio_id !== inactiveAudio.id), "audio inactif exclu des recherches");
  if (inactiveAudioRestore) {
    await admin.from("audio_items").update({ is_active: inactiveAudioRestore.is_active }).eq("id", inactiveAudioRestore.id);
    inactiveAudioRestore = null;
  }

  const { data: activeLinks } = await admin
    .from("audio_items")
    .select("sermon_id")
    .eq("category", "sermon")
    .eq("is_active", true)
    .eq("streaming_enabled", true)
    .not("sermon_id", "is", null)
    .limit(2000);
  const linkedIds = new Set((activeLinks ?? []).map((row) => row.sermon_id));
  const { data: sermonCandidates } = await admin.from("sermons").select("id,title").limit(500);
  const sermonWithoutAudio = (sermonCandidates ?? [])
    .filter((row) => row.title && !linkedIds.has(row.id))
    .sort((a, b) => b.title.length - a.title.length)[0];
  assert(Boolean(sermonWithoutAudio), "sermon texte sans audio disponible pour le test");
  const noAudioHtml = await fetch(`${siteUrl}/sermons?st=${encodeURIComponent(sermonWithoutAudio.title)}`).then((response) => response.text());
  assert(!/Écouter l(?:'|&#x27;)audio/i.test(noAudioHtml), "aucun bouton audio pour un sermon sans audio actif");

  const insertedConversation = await admin
    .from("conversations")
    .insert({ user_id: userId, title: "Contrat historique audio" })
    .select("id")
    .single();
  if (insertedConversation.error || !insertedConversation.data) throw insertedConversation.error ?? new Error("conversation test absente");
  conversationId = insertedConversation.data.id;
  await chat(token, conversationId, "Audio uniquement Marriage And Divorce");
  const { data: historyRows, error: historyError } = await admin
    .from("messages")
    .select("role,metadata")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (historyError) throw historyError;
  const persistedAudio = (historyRows ?? []).find((row) => row.role === "assistant" && row.metadata?.moboko_kind === "audio_search");
  assert(Array.isArray(persistedAudio?.metadata?.audio_results) && persistedAudio.metadata.audio_results.length > 0, "résultats audio persistés et réhydratables dans l'historique");

  const { count: prayerCount } = await admin.from("audio_items").select("id", { count: "exact", head: true }).eq("category", "prayer_line").in("id", audioOnly.audio_results.map((row) => row.audio_id));
  assert((prayerCount ?? 0) === 0, "lignes de prière exclues des résultats doctrinaux");
} finally {
  if (inactiveAudioRestore) {
    await admin.from("audio_items").update({ is_active: inactiveAudioRestore.is_active }).eq("id", inactiveAudioRestore.id);
  }
  if (freeAudioRestore) {
    await admin.from("audio_items").update({ access_policy: freeAudioRestore.access_policy }).eq("id", freeAudioRestore.id);
  }
  if (conversationId) await admin.from("conversations").delete().eq("id", conversationId);
  await admin.auth.admin.deleteUser(userId);
}

console.log("CONTRAT_RECHERCHE_AUDIO_OK");
