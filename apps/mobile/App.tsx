import { mobokoTheme } from "@moboko/shared";
import type { Session, User } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Linking } from "react-native";
import { BibleScreen } from "./screens/BibleScreen";
import { BillingScreen } from "./screens/BillingScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { EngagementScreen } from "./screens/EngagementScreen";
import { HomeScreen, type MobileRoute } from "./screens/HomeScreen";
import { HymnsScreen } from "./screens/HymnsScreen";
import { JournalScreen } from "./screens/JournalScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SermonsScreen } from "./screens/SermonsScreen";
import { SignInScreen } from "./screens/SignInScreen";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

function accountLabel(user: User): string | null {
  return (
    user.email ??
    user.phone ??
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null) ??
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null)
  );
}

const tabs: Array<{ route: MobileRoute; label: string }> = [
  { route: "home", label: "Accueil" },
  { route: "chat", label: "Assistant" },
  { route: "sermons", label: "Sermons" },
  { route: "billing", label: "Credits" },
  { route: "profile", label: "Profil" },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<MobileRoute>("home");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setRoute("home");
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function applyUrl(url: string | null) {
      if (!url) return;
      if (url.startsWith("moboko://billing")) setRoute("billing");
      if (url.startsWith("moboko://chat")) setRoute("chat");
      if (url.startsWith("moboko://sermons")) setRoute("sermons");
    }
    void Linking.getInitialURL().then(applyUrl);
    const sub = Linking.addEventListener("url", (event) => applyUrl(event.url));
    return () => sub.remove();
  }, []);

  const user = session?.user ?? null;
  const label = useMemo(() => (user ? accountLabel(user) : null), [user]);

  async function onSignOut() {
    setBusy(true);
    try {
      await supabase.auth.signOut();
      setRoute("home");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: mobokoTheme.colors.background }]}>
        <ActivityIndicator color={mobokoTheme.colors.accent} size="large" />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <View style={[styles.center, styles.pad, { backgroundColor: mobokoTheme.colors.background }]}>
        <Text style={styles.kicker}>Moboko</Text>
        <Text style={styles.title}>Configuration</Text>
        <Text style={styles.subtitle}>
          Ajoutez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY dans apps/mobile/.env.local.
        </Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!user) return <SignInScreen />;

  let content = <HomeScreen accountLabel={label} onNavigate={setRoute} />;
  if (route === "chat") content = <ChatScreen userId={user.id} />;
  if (route === "sermons") content = <SermonsScreen />;
  if (route === "bible") content = <BibleScreen />;
  if (route === "hymns") content = <HymnsScreen />;
  if (route === "journal") content = <JournalScreen />;
  if (route === "engagement") content = <EngagementScreen userId={user.id} />;
  if (route === "billing") content = <BillingScreen userId={user.id} />;
  if (route === "profile") content = <ProfileScreen accountLabel={label} onSignOut={() => void onSignOut()} busy={busy} />;

  return (
    <SafeAreaView style={styles.app}>
      <View style={styles.header}>
        {route !== "home" ? (
          <Pressable onPress={() => setRoute("home")} hitSlop={12}>
            <Text style={styles.headerLink}>Accueil</Text>
          </Pressable>
        ) : (
          <Text style={styles.headerLink}>Moboko</Text>
        )}
        <Text style={styles.headerTitle}>{tabs.find((tab) => tab.route === route)?.label ?? "Moboko"}</Text>
        <Pressable onPress={() => setRoute("journal")} hitSlop={12}>
          <Text style={styles.headerLink}>Journal</Text>
        </Pressable>
      </View>
      <View style={styles.body}>{content}</View>
      <View style={styles.bottomNav}>
        {tabs.map((tab) => (
          <Pressable key={tab.route} style={[styles.navItem, route === tab.route && styles.navItemOn]} onPress={() => setRoute(tab.route)}>
            <Text style={[styles.navText, route === tab.route && styles.navTextOn]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: mobokoTheme.colors.background },
  body: { flex: 1 },
  header: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: mobokoTheme.colors.border,
    backgroundColor: mobokoTheme.colors.surface,
  },
  headerLink: { minWidth: 64, color: mobokoTheme.colors.accent, fontWeight: "700", fontSize: 13 },
  headerTitle: { color: mobokoTheme.colors.text, fontSize: 15, fontWeight: "800" },
  bottomNav: {
    minHeight: 62,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: mobokoTheme.colors.border,
    backgroundColor: mobokoTheme.colors.surface,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: mobokoTheme.radii.md },
  navItemOn: { backgroundColor: mobokoTheme.colors.surfaceElevated },
  navText: { color: mobokoTheme.colors.textMuted, fontSize: 11, fontWeight: "700" },
  navTextOn: { color: mobokoTheme.colors.accent },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  pad: { paddingHorizontal: mobokoTheme.space.lg },
  kicker: { fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: mobokoTheme.colors.accent, fontWeight: "700", textAlign: "center" },
  title: { fontSize: 26, fontWeight: "600", color: mobokoTheme.colors.text, textAlign: "center" },
  subtitle: { marginTop: mobokoTheme.space.md, fontSize: 15, lineHeight: 22, color: mobokoTheme.colors.textMuted, textAlign: "center", maxWidth: 320 },
});
