import type { SupabaseClient } from "@supabase/supabase-js";

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Récupère la conversation la plus récente pour l’utilisateur, ou en crée une.
 * Après migration `conversations_user_id_unique`, deux appareils en course critique :
 * le second insert échoue en 23505 → on relit la ligne créée par le premier.
 */
export async function getOrCreatePrimaryConversationId(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ conversationId: string | null; error: Error | null }> {
  const selectLatest = () =>
    supabase
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1);

  const { data: convs, error: selErr } = await selectLatest();
  if (selErr) {
    return { conversationId: null, error: new Error(selErr.message) };
  }
  const existing = convs?.[0]?.id;
  if (existing) {
    return { conversationId: String(existing), error: null };
  }

  const { data: created, error: insErr } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "Assistant Moboko" })
    .select("id")
    .single();

  if (!insErr && created?.id) {
    return { conversationId: String(created.id), error: null };
  }

  const code =
    insErr && typeof insErr === "object" && "code" in insErr
      ? String((insErr as { code?: string }).code)
      : "";
  const msg = insErr?.message ?? "";
  if (code === PG_UNIQUE_VIOLATION || msg.toLowerCase().includes("duplicate key")) {
    const { data: again, error: againErr } = await selectLatest();
    if (againErr) {
      return { conversationId: null, error: new Error(againErr.message) };
    }
    const id = again?.[0]?.id;
    if (id) {
      return { conversationId: String(id), error: null };
    }
  }

  return {
    conversationId: null,
    error: insErr ? new Error(insErr.message) : new Error("conversation_create_failed"),
  };
}
