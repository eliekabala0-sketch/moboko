import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, Notice, Screen, textStyles } from "../components/ui";
import { supabase } from "../lib/supabase";

export function EngagementScreen({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [requestText, setRequestText] = useState("");
  const [testimonyTitle, setTestimonyTitle] = useState("");
  const [testimonyText, setTestimonyText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitPrayer() {
    setBusy("prayer");
    setError(null);
    setMessage(null);
    try {
      const { error: e } = await supabase.from("prayer_requests").insert({
        user_id: userId,
        name: name.trim() || null,
        email: email.trim() || null,
        request_text: requestText.trim(),
      });
      if (e) throw e;
      setRequestText("");
      setMessage("Requete envoyee.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setBusy(null);
    }
  }

  async function submitTestimony() {
    setBusy("testimony");
    setError(null);
    setMessage(null);
    try {
      const { error: e } = await supabase.from("testimonies").insert({
        user_id: userId,
        name: name.trim() || null,
        title: testimonyTitle.trim(),
        testimony_text: testimonyText.trim(),
      });
      if (e) throw e;
      setTestimonyTitle("");
      setTestimonyText("");
      setMessage("Temoignage recu.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Requetes" kicker="Priere et temoignage">
      <Notice text={message} kind="success" />
      <Notice text={error} kind="error" />
      <Card>
        <Text style={textStyles.heading}>Vos informations</Text>
        <Field value={name} onChangeText={setName} placeholder="Nom (optionnel)" />
        <Field value={email} onChangeText={setEmail} placeholder="Email (optionnel)" keyboardType="email-address" />
      </Card>
      <Card>
        <Text style={textStyles.heading}>Requete de priere</Text>
        <Field value={requestText} onChangeText={setRequestText} placeholder="Votre requete" multiline />
        <Button label="Envoyer la requete" onPress={() => void submitPrayer()} loading={busy === "prayer"} disabled={requestText.trim().length < 3} />
      </Card>
      <Card>
        <Text style={textStyles.heading}>Temoignage</Text>
        <Field value={testimonyTitle} onChangeText={setTestimonyTitle} placeholder="Titre" />
        <Field value={testimonyText} onChangeText={setTestimonyText} placeholder="Votre temoignage" multiline />
        <Button label="Envoyer le temoignage" onPress={() => void submitTestimony()} loading={busy === "testimony"} disabled={testimonyTitle.trim().length < 2 || testimonyText.trim().length < 3} />
      </Card>
    </Screen>
  );
}
