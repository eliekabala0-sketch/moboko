import { mobokoTheme } from "@moboko/shared";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { publicApiJson } from "../lib/api";
import { supabase } from "../lib/supabase";
import { Button, Field, Notice } from "../components/ui";

type RegisterResponse = { ok: true; authEmail: string };
type ResolveResponse = { ok: true; authEmail: string; type: "email" | "phone" };

function friendly(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("invalid") || lower.includes("credentials")) return "Identifiant ou mot de passe incorrect.";
  if (lower.includes("rate") || lower.includes("too many")) return "Trop de tentatives. Reessayez dans quelques minutes.";
  return message || "Connexion indisponible pour le moment.";
}

export function SignInScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setInfo(null);
    if (!identifier.trim()) {
      setError("Indiquez votre email ou votre numero de telephone.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caracteres.");
      return;
    }
    if (mode === "signup" && (!fullName.trim() || !sex.trim() || !city.trim() || !age.trim())) {
      setError("Completez les informations d'inscription.");
      return;
    }

    setBusy(true);
    try {
      let authEmail = "";
      if (mode === "signup") {
        const created = await publicApiJson<RegisterResponse>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ identifier, password, fullName, sex, city, age }),
        });
        authEmail = created.authEmail;
      } else {
        const resolved = await publicApiJson<ResolveResponse>("/api/auth/resolve-identifier", {
          method: "POST",
          body: JSON.stringify({ identifier }),
        });
        authEmail = resolved.authEmail;
      }

      const { error: signErr } = await supabase.auth.signInWithPassword({ email: authEmail, password });
      if (signErr) {
        setError(friendly(signErr.message));
        return;
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : "Connexion impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: mobokoTheme.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>Moboko</Text>
        <Text style={styles.title}>Connexion</Text>
        <Text style={styles.lead}>Un acces simple par email ou telephone, synchronise avec Moboko web.</Text>

        <View style={styles.toggleRow}>
          <Pressable style={[styles.toggle, mode === "signin" && styles.toggleOn]} onPress={() => setMode("signin")}>
            <Text style={[styles.toggleText, mode !== "signin" && styles.toggleMuted]}>Connexion</Text>
          </Pressable>
          <Pressable style={[styles.toggle, mode === "signup" && styles.toggleOn]} onPress={() => setMode("signup")}>
            <Text style={[styles.toggleText, mode !== "signup" && styles.toggleMuted]}>Inscription</Text>
          </Pressable>
        </View>

        {mode === "signup" ? (
          <View>
            <Field value={fullName} onChangeText={setFullName} placeholder="Nom complet" />
            <Field value={city} onChangeText={setCity} placeholder="Ville" />
            <Field value={sex} onChangeText={setSex} placeholder="Sexe" />
            <Field value={age} onChangeText={setAge} placeholder="Age" keyboardType="number-pad" />
          </View>
        ) : null}

        <Field value={identifier} onChangeText={setIdentifier} placeholder="Email ou telephone" keyboardType="email-address" />
        <Field value={password} onChangeText={setPassword} placeholder="Mot de passe" secureTextEntry />
        <Button label={mode === "signin" ? "Se connecter" : "Creer le compte"} onPress={() => void submit()} loading={busy} />
        {mode === "signin" ? (
          <Button
            label="Mot de passe oublie ?"
            secondary
            onPress={() => setInfo("Pour recuperer votre acces, contactez le soutien Moboko avec votre email ou numero.")}
          />
        ) : null}
        <Notice text={error} kind="error" />
        <Notice text={info} />
      </ScrollView>
      <StatusBar style="light" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 44 },
  kicker: {
    color: mobokoTheme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  title: { marginTop: 10, color: mobokoTheme.colors.text, fontSize: 30, fontWeight: "700", textAlign: "center" },
  lead: { marginTop: 10, marginBottom: 22, color: mobokoTheme.colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  toggleRow: {
    flexDirection: "row",
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: mobokoTheme.colors.border,
    borderRadius: mobokoTheme.radii.full,
    backgroundColor: mobokoTheme.colors.surface,
  },
  toggle: { flex: 1, alignItems: "center", borderRadius: mobokoTheme.radii.full, paddingVertical: 10 },
  toggleOn: { backgroundColor: mobokoTheme.colors.surfaceElevated },
  toggleText: { color: mobokoTheme.colors.text, fontWeight: "700" },
  toggleMuted: { color: mobokoTheme.colors.textMuted },
});
