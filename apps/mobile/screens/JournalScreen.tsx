import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, Text } from "react-native";
import { Card, Screen, textStyles } from "../components/ui";
import { dateLabel, excerpt } from "../lib/format";
import { supabase } from "../lib/supabase";

type JournalItem = { id: string; type: string; title: string; body: string; date: string | null };

export function JournalScreen() {
  const [items, setItems] = useState<JournalItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [{ data: posts }, { data: prayers }, { data: testimonies }] = await Promise.all([
        supabase.from("posts").select("id, title, excerpt, body, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(20),
        supabase.from("prayer_requests").select("id, name, request_text, updated_at").eq("status", "reviewed").eq("is_public", true).order("updated_at", { ascending: false }).limit(20),
        supabase.from("testimonies").select("id, name, title, testimony_text, updated_at").eq("status", "published").order("updated_at", { ascending: false }).limit(20),
      ]);
      const next: JournalItem[] = [
        ...(posts ?? []).map((p) => ({ id: `post-${p.id}`, type: "Publication", title: String(p.title ?? "Publication"), body: String(p.excerpt || p.body || ""), date: p.published_at })),
        ...(prayers ?? []).map((p) => ({ id: `prayer-${p.id}`, type: "Requete", title: "Requete de priere", body: String(p.request_text ?? ""), date: p.updated_at })),
        ...(testimonies ?? []).map((t) => ({ id: `testimony-${t.id}`, type: "Temoignage", title: String(t.title ?? "Temoignage"), body: String(t.testimony_text ?? ""), date: t.updated_at })),
      ];
      next.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
      setItems(next);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Journal" kicker={items.length ? `${items.length} nouvelles` : "Publications"}>
      <FlatList
        data={items}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card>
            <Text style={textStyles.label}>{item.type} - {dateLabel(item.date)}</Text>
            <Text style={[textStyles.heading, { marginTop: 6 }]}>{item.title}</Text>
            <Text style={[textStyles.body, { marginTop: 8 }]}>{excerpt(item.body, 260)}</Text>
          </Card>
        )}
      />
    </Screen>
  );
}
