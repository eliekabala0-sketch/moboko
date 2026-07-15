import { mobokoTheme } from "@moboko/shared";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Screen, textStyles } from "../components/ui";
import { supabase } from "../lib/supabase";

export type MobileRoute =
  | "home"
  | "chat"
  | "sermons"
  | "bible"
  | "hymns"
  | "journal"
  | "engagement"
  | "billing"
  | "profile";

const tiles: Array<{ route: MobileRoute; title: string; body: string }> = [
  { route: "chat", title: "Assistant", body: "Questions, sources et historique." },
  { route: "sermons", title: "Sermons", body: "Recherche normale et lecture." },
  { route: "bible", title: "Bible", body: "Chapitres, references et recherche." },
  { route: "hymns", title: "Cantiques", body: "Numero, titre et paroles." },
  { route: "journal", title: "Journal", body: "Publications et notifications." },
  { route: "engagement", title: "Requetes", body: "Priere et temoignages." },
  { route: "billing", title: "Credits", body: "Recharge, soutien, abonnement." },
  { route: "profile", title: "Profil", body: "Compte et deconnexion." },
];

export function HomeScreen({ accountLabel, onNavigate }: { accountLabel: string | null; onNavigate: (route: MobileRoute) => void }) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from("profiles").select("credit_balance").eq("id", data.user.id).single();
      setBalance(profile?.credit_balance ?? 0);
    });
  }, []);

  return (
    <Screen title="Moboko" kicker="Accueil">
      <ScrollView showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={textStyles.label}>Compte</Text>
          <Text style={[textStyles.heading, { marginTop: 6 }]}>{accountLabel ?? "Votre compte"}</Text>
          <Text style={[textStyles.muted, { marginTop: 8 }]}>
            {balance == null ? "Solde en cours de lecture" : `${balance} credits disponibles`}
          </Text>
        </Card>
        <View style={styles.grid}>
          {tiles.map((tile) => (
            <Pressable key={tile.route} style={styles.tile} onPress={() => onNavigate(tile.route)}>
              <Text style={styles.tileTitle}>{tile.title}</Text>
              <Text style={styles.tileBody}>{tile.body}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    width: "48%",
    minHeight: 112,
    borderWidth: 1,
    borderColor: mobokoTheme.colors.border,
    backgroundColor: mobokoTheme.colors.surface,
    borderRadius: mobokoTheme.radii.md,
    padding: 14,
  },
  tileTitle: { color: mobokoTheme.colors.text, fontSize: 16, fontWeight: "700" },
  tileBody: { marginTop: 8, color: mobokoTheme.colors.textMuted, fontSize: 12, lineHeight: 17 },
});
