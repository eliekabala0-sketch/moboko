import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text } from "react-native";
import { Button, Card, Field, Notice, Screen, textStyles } from "../components/ui";
import { supabase } from "../lib/supabase";

type Verse = { id?: string; translation: string; book: string; chapter: number; verse: number; text: string };

export function BibleScreen() {
  const [book, setBook] = useState("Jean");
  const [chapter, setChapter] = useState("3");
  const [q, setQ] = useState("");
  const [verses, setVerses] = useState<Verse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadChapter();
  }, []);

  async function loadChapter(nextChapter = Number(chapter)) {
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("bible_passages")
        .select("id, translation, book, chapter, verse, text")
        .eq("book", book.trim())
        .eq("chapter", nextChapter)
        .order("verse", { ascending: true })
        .limit(180);
      if (e) throw e;
      setChapter(String(nextChapter));
      setVerses((data ?? []) as Verse[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passage indisponible");
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    const term = q.trim();
    if (!term) return loadChapter();
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("bible_passages")
        .select("id, translation, book, chapter, verse, text")
        .ilike("text", `%${term}%`)
        .order("book_number", { ascending: true })
        .order("chapter", { ascending: true })
        .order("verse", { ascending: true })
        .limit(80);
      if (e) throw e;
      setVerses((data ?? []) as Verse[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recherche impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Bible" kicker="Bibliotheque">
      <Field value={book} onChangeText={setBook} placeholder="Livre" />
      <Field value={chapter} onChangeText={setChapter} placeholder="Chapitre" keyboardType="number-pad" />
      <Field value={q} onChangeText={setQ} placeholder="Recherche biblique" />
      <Button label="Ouvrir / rechercher" onPress={() => void search()} loading={busy} />
      <Button label="Chapitre precedent" secondary onPress={() => void loadChapter(Math.max(1, Number(chapter) - 1))} />
      <Button label="Chapitre suivant" secondary onPress={() => void loadChapter(Number(chapter) + 1)} />
      <Notice text={error} kind="error" />
      {busy ? <ActivityIndicator /> : null}
      <FlatList
        data={verses}
        keyExtractor={(item, index) => item.id ?? `${item.book}-${item.chapter}-${item.verse}-${index}`}
        renderItem={({ item }) => (
          <Card>
            <Text style={textStyles.label}>
              {item.translation} / {item.book} {item.chapter}:{item.verse}
            </Text>
            <Text style={[textStyles.body, { marginTop: 8 }]}>{item.text}</Text>
          </Card>
        )}
      />
    </Screen>
  );
}
