import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, Text, View } from "react-native";
import { Button, Card, Field, Notice, Screen, textStyles } from "../components/ui";
import { apiJson } from "../lib/api";
import { dateLabel } from "../lib/format";
import { supabase } from "../lib/supabase";
import { getApiBaseUrl } from "../lib/auth-config";

type Conversation = { id: string; title: string | null; updated_at: string | null; created_at: string | null };
type Message = { id: string; role: string; content: string | null; kind?: string | null; created_at: string; metadata?: Record<string, unknown> | null };

type ChatResponse = {
  ok?: boolean;
  balance_after?: number;
  credits_charged?: number;
};

export function ChatScreen({ userId }: { userId: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("conversations")
      .select("id, title, updated_at, created_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(30);
    if (e) throw e;
    const rows = (data ?? []) as Conversation[];
    setConversations(rows);
    if (!conversationId && rows[0]) setConversationId(rows[0].id);
  }, [conversationId, userId]);

  const loadMessages = useCallback(async (cid: string) => {
    const { data, error: e } = await supabase
      .from("messages")
      .select("id, role, content, kind, created_at, metadata")
      .eq("conversation_id", cid)
      .order("created_at", { ascending: true });
    if (e) throw e;
    setMessages((data ?? []) as Message[]);
  }, []);

  const loadBalance = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("credit_balance").eq("id", userId).single();
    setBalance(data?.credit_balance ?? 0);
  }, [userId]);

  useEffect(() => {
    void Promise.all([loadConversations(), loadBalance()]).catch((err) => setError(err.message));
  }, [loadConversations, loadBalance]);

  useEffect(() => {
    if (conversationId) void loadMessages(conversationId).catch((err) => setError(err.message));
  }, [conversationId, loadMessages]);

  async function newChat() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("conversations")
        .insert({ user_id: userId, title: "Nouveau chat" })
        .select("id")
        .single();
      if (e || !data) throw e ?? new Error("Creation impossible");
      setConversationId(data.id);
      setMessages([]);
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Creation impossible");
    } finally {
      setBusy(false);
    }
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const { data, error: e } = await supabase
      .from("conversations")
      .insert({ user_id: userId, title: "Nouveau chat" })
      .select("id")
      .single();
    if (e || !data) throw e ?? new Error("Conversation impossible");
    setConversationId(data.id);
    return data.id as string;
  }

  async function send() {
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const cid = await ensureConversation();
      setText("");
      const res = await apiJson<ChatResponse>("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: cid, mode: "text", text: value }),
      });
      if (typeof res.balance_after === "number") setBalance(res.balance_after);
      await Promise.all([loadMessages(cid), loadConversations()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Assistant" kicker={balance == null ? "Moboko" : `${balance} credits`}>
      <Notice text={error} kind="error" />
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Button label="Nouveau chat" secondary onPress={() => void newChat()} loading={busy} />
        </View>
      </View>
      <FlatList
        horizontal
        data={conversations}
        keyExtractor={(item) => item.id}
        style={{ maxHeight: 52, marginBottom: 10 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => setConversationId(item.id)}>
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, backgroundColor: item.id === conversationId ? "#1A2338" : "#12192B" }}>
              <Text style={{ color: item.id === conversationId ? "#C9A962" : "#8B95A8", fontSize: 12, fontWeight: "700" }}>
                {item.title || dateLabel(item.created_at) || "Chat"}
              </Text>
            </View>
          </Pressable>
        )}
      />
      {busy && messages.length === 0 ? <ActivityIndicator /> : null}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        renderItem={({ item }) => {
          const meta = item.metadata && typeof item.metadata === "object" ? item.metadata : null;
          const sermonResults = meta && Array.isArray(meta.results) ? meta.results as Array<Record<string, unknown>> : [];
          const audioResults = meta && Array.isArray(meta.audio_results) ? meta.audio_results as Array<Record<string, unknown>> : [];
          return (
            <Card>
              <Text style={textStyles.label}>{item.role === "user" ? "Vous" : "Moboko"}</Text>
              {item.content ? <Text style={[textStyles.body, { marginTop: 8 }]}>{item.content}</Text> : null}
              {sermonResults.map((result, index) => (
                <View key={`${String(result.slug)}-${String(result.paragraph_number)}-${index}`} style={{ marginTop: 12 }}>
                  <Text style={textStyles.heading}>{String(result.sermon_title_fr ?? result.title ?? "Sermon")}</Text>
                  <Text style={[textStyles.muted, { marginTop: 4 }]}>Paragraphe {String(result.paragraph_number)}{Number(result.segment_count ?? 1) > 1 ? ` — segment ${String(result.segment_index ?? 1)}/${String(result.segment_count)}` : ""}</Text>
                  <Text style={[textStyles.body, { marginTop: 8 }]}>{String(result.paragraph_text ?? "")}</Text>
                  {typeof result.audio_id === "string" ? <Button label="Écouter l'audio" secondary onPress={() => void Linking.openURL(`${getApiBaseUrl()}/audio/${result.audio_id}`)} /> : null}
                </View>
              ))}
              {audioResults.map((result) => (
                <View key={String(result.audio_id)} style={{ marginTop: 12 }}>
                  <Text style={textStyles.heading}>{String(result.sermon_title_fr ?? "Sermon audio")}</Text>
                  {result.sermon_title_original ? <Text style={[textStyles.muted, { marginTop: 4 }]}>Titre original : {String(result.sermon_title_original)}</Text> : null}
                  <Button label="Écouter" onPress={() => void Linking.openURL(`${getApiBaseUrl()}/audio/${String(result.audio_id)}`)} />
                </View>
              ))}
            </Card>
          );
        }}
      />
      <Field value={text} onChangeText={setText} placeholder="Votre question..." multiline />
      <Button label="Envoyer" onPress={() => void send()} loading={busy} disabled={!text.trim()} />
    </Screen>
  );
}
