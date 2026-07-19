import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Button, Card, Field, Notice, Screen, textStyles } from "../components/ui";
import { excerpt } from "../lib/format";
import { publicApiJson } from "../lib/api";
import { supabase } from "../lib/supabase";

type SearchHit = {
  sermon_id?: string;
  slug: string;
  title: string;
  preached_on?: string | null;
  year?: number | null;
  location?: string | null;
  paragraph_number: number;
  paragraph_text: string;
  prev_paragraph_text?: string | null;
  next_paragraph_text?: string | null;
};

type Sermon = { id: string; slug: string; title: string; preached_on: string | null; year: number | null; location: string | null };
type Paragraph = { id: string; paragraph_number: number; text: string };
type SuggestResponse = { ok: true; suggestions: Sermon[] };

export function SermonsScreen() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [suggestions, setSuggestions] = useState<Sermon[]>([]);
  const [sort, setSort] = useState<"oldest" | "recent">("oldest");
  const [selected, setSelected] = useState<Sermon | null>(null);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSermons();
  }, [sort]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: term, limit: "8" });
      void publicApiJson<SuggestResponse>(`/api/sermons/suggest?${params.toString()}`)
        .then((res) => setSuggestions(res.suggestions))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  async function loadSermons() {
    const { data } = await supabase
      .from("sermons")
      .select("id, slug, title, preached_on, year, location")
      .eq("is_published", true)
      .order("preached_on", { ascending: sort === "oldest", nullsFirst: false })
      .limit(80);
    setSermons((data ?? []) as Sermon[]);
  }

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("moboko_search_sermon_paragraphs", {
        p_query: q.trim(),
        p_sermon_slug: null,
        p_limit: 30,
        p_offset: 0,
      });
      if (rpcError) throw rpcError;
      setHits((data ?? []) as SearchHit[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }

  async function openSermon(sermon: Sermon) {
    setSelected(sermon);
    setBusy(true);
    setError(null);
    try {
      const { data, error: pErr } = await supabase
        .from("sermon_paragraphs")
        .select("id, paragraph_number, text")
        .eq("sermon_id", sermon.id)
        .order("paragraph_number", { ascending: true })
        .limit(500);
      if (pErr) throw pErr;
      setParagraphs((data ?? []) as Paragraph[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lecture impossible");
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <Screen title={selected.title} kicker="Sermon">
        <Button label="Retour aux sermons" secondary onPress={() => setSelected(null)} />
        <Notice text={error} kind="error" />
        {busy ? <ActivityIndicator /> : null}
        <FlatList
          data={paragraphs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Card>
              <Text style={textStyles.label}>Paragraphe {item.paragraph_number}</Text>
              <Text style={[textStyles.body, { marginTop: 8 }]}>{item.text}</Text>
            </Card>
          )}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Sermons" kicker="Recherche">
      <Field value={q} onChangeText={setQ} placeholder="Phrase, paragraphe, theme..." />
      <Button label="Rechercher" onPress={() => void search()} loading={busy} disabled={!q.trim()} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label="Anciens" secondary={sort !== "oldest"} onPress={() => setSort("oldest")} />
        <Button label="Recents" secondary={sort !== "recent"} onPress={() => setSort("recent")} />
      </View>
      <Notice text={error} kind="error" />
      {hits.length > 0 ? (
        <FlatList
          data={hits}
          keyExtractor={(item, index) => `${item.slug}-${item.paragraph_number}-${index}`}
          renderItem={({ item }) => (
            <Card>
              <Text style={textStyles.label}>{item.title}</Text>
              <Text style={[textStyles.muted, { marginTop: 4 }]}>Paragraphe {item.paragraph_number}</Text>
              <Text style={[textStyles.body, { marginTop: 8 }]}>{item.paragraph_text}</Text>
            </Card>
          )}
        />
      ) : suggestions.length > 0 ? (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => void openSermon(item)}>
              <Card>
                <Text style={textStyles.heading}>{item.title}</Text>
                <Text style={[textStyles.muted, { marginTop: 6 }]}>
                  {item.year ?? ""} {item.location ? `- ${item.location}` : ""}
                </Text>
              </Card>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={sermons}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => void openSermon(item)}>
              <Card>
                <Text style={textStyles.heading}>{item.title}</Text>
                <Text style={[textStyles.muted, { marginTop: 6 }]}>
                  {item.year ?? ""} {item.location ? `- ${item.location}` : ""}
                </Text>
                <Text style={[textStyles.muted, { marginTop: 6 }]}>{excerpt(item.slug, 80)}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
