import { useEffect, useState } from "react";
import { FlatList, Pressable, Text } from "react-native";
import { Card, Field, Screen, textStyles } from "../components/ui";
import { supabase } from "../lib/supabase";

type Hymn = { id: string; title: string; number: string | number | null; lyrics?: string | null; full_text?: string | null };

export function HymnsScreen() {
  const [q, setQ] = useState("");
  const [hymns, setHymns] = useState<Hymn[]>([]);
  const [selected, setSelected] = useState<Hymn | null>(null);

  useEffect(() => {
    void load("");
  }, []);

  async function load(term: string) {
    let query = supabase.from("hymns").select("id, title, number, lyrics, full_text").eq("is_published", true).limit(60);
    const t = term.trim();
    if (t) query = query.or(`title.ilike.%${t}%,lyrics.ilike.%${t}%,full_text.ilike.%${t}%,number.eq.${t}`);
    const { data } = await query.order("number", { ascending: true });
    setHymns((data ?? []) as Hymn[]);
  }

  if (selected) {
    return (
      <Screen title={selected.title} kicker={`Cantique ${selected.number ?? ""}`}>
        <Pressable onPress={() => setSelected(null)}>
          <Text style={[textStyles.label, { marginBottom: 12 }]}>Retour</Text>
        </Pressable>
        <Card>
          <Text style={textStyles.body}>{selected.full_text || selected.lyrics || ""}</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="Cantiques" kicker="Lecture">
      <Field
        value={q}
        onChangeText={(value) => {
          setQ(value);
          void load(value);
        }}
        placeholder="Numero, titre ou paroles"
      />
      <FlatList
        data={hymns}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelected(item)}>
            <Card>
              <Text style={textStyles.label}>N {item.number ?? "-"}</Text>
              <Text style={[textStyles.heading, { marginTop: 6 }]}>{item.title}</Text>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
