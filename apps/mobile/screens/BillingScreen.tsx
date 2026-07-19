import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, Notice, Screen, textStyles } from "../components/ui";
import { apiJson } from "../lib/api";
import { money } from "../lib/format";
import { supabase } from "../lib/supabase";

type Plan = { id: string; name: string; description: string | null; price: number; currency: string; monthly_ai_credits?: number | null };
type Pack = { id: string; name: string; description: string | null; credits: number; bonus_credits: number; price: number; currency: string };
type Offer =
  | { kind: "subscription"; idOrAmount: string; label: string; amount: string }
  | { kind: "credits"; idOrAmount: string; label: string; amount: string }
  | { kind: "support_donation"; idOrAmount: number; label: string; amount: string };
type PaymentStatus = { ok: true; status: "none" | "pending" | "success" | "refused" | "expired" | "error"; message?: string };

const operators = [
  { value: "airtel_money", label: "Airtel Money" },
  { value: "orange_money", label: "Orange Money" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "afrimoney", label: "Afrimoney" },
];

function operatorLabel(value: string) {
  return operators.find((operator) => operator.value === value)?.label ?? "Mobile Money";
}

export function BillingScreen({ userId }: { userId: string }) {
  const [balance, setBalance] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [profilePhone, setProfilePhone] = useState("");
  const [operator, setOperator] = useState("airtel_money");
  const [useOtherPhone, setUseOtherPhone] = useState(false);
  const [otherPhone, setOtherPhone] = useState("");
  const [supportAmount, setSupportAmount] = useState("10");
  const [pendingOffer, setPendingOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [userId]);

  useEffect(() => {
    if (!statusKey) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void apiJson<PaymentStatus>(`/api/billing/status?idempotencyKey=${encodeURIComponent(statusKey)}`)
        .then((res) => {
          if (cancelled) return;
          if (res.status === "success") {
            setMessage(res.message ?? "Paiement confirme.");
            setStatusKey(null);
            void load();
          } else if (res.status === "refused" || res.status === "expired" || res.status === "error") {
            setError(res.message ?? "Le paiement n'a pas abouti.");
            setStatusKey(null);
          } else {
            setMessage(res.message ?? "Veuillez valider la transaction sur votre telephone.");
          }
        })
        .catch(() => {
          if (!cancelled) setMessage("Paiement lance. Verification en cours...");
        });
      if (attempts >= 24) {
        setMessage("Paiement lance. Vous pouvez revenir ici apres validation.");
        setStatusKey(null);
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [statusKey]);

  async function load() {
    const [{ data: profile }, { data: planRows }, { data: packRows }] = await Promise.all([
      supabase.from("profiles").select("credit_balance, phone").eq("id", userId).single(),
      supabase.from("billing_subscription_plans").select("id, name, description, price, currency, monthly_ai_credits").eq("is_active", true).order("display_order", { ascending: true }),
      supabase.from("billing_credit_packs").select("id, name, description, credits, bonus_credits, price, currency").eq("is_active", true).order("display_order", { ascending: true }),
    ]);
    setBalance(profile?.credit_balance ?? 0);
    setProfilePhone(typeof profile?.phone === "string" ? profile.phone : "");
    setPlans((planRows ?? []) as Plan[]);
    setPacks((packRows ?? []) as Pack[]);
  }

  function selectOffer(offer: Offer) {
    setPendingOffer(offer);
    setError(null);
    setMessage(null);
  }

  async function checkout() {
    if (!pendingOffer) return;
    const phone = useOtherPhone ? otherPhone.trim() : profilePhone.trim();
    if (!phone) {
      setError("Indiquez un numero Mobile Money pour lancer le paiement.");
      return;
    }
    setBusy(`${pendingOffer.kind}-${pendingOffer.idOrAmount}`);
    setError(null);
    setMessage(null);
    try {
      const payment = { operator, customerPhone: phone };
      const idempotencyKey = `${pendingOffer.kind}-${pendingOffer.idOrAmount}-${Date.now()}`;
      const body =
        pendingOffer.kind === "subscription"
          ? { purpose: pendingOffer.kind, planId: pendingOffer.idOrAmount, payment, returnUrl: "moboko://billing", idempotencyKey }
          : pendingOffer.kind === "credits"
            ? { purpose: pendingOffer.kind, packId: pendingOffer.idOrAmount, payment, returnUrl: "moboko://billing", idempotencyKey }
            : { purpose: pendingOffer.kind, amount: Number(pendingOffer.idOrAmount), payment, returnUrl: "moboko://billing", idempotencyKey };
      const res = await apiJson<{ ok: true; checkout_url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMessage("Demande envoyee. Confirmez le paiement sur votre telephone.");
      setStatusKey(idempotencyKey);
      await Linking.openURL(res.checkout_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paiement indisponible");
    } finally {
      setBusy(null);
    }
  }

  const phone = useOtherPhone ? otherPhone : profilePhone;

  return (
    <Screen title="Credits" kicker={`${balance} credits`}>
      <Notice text={message} kind="success" />
      <Notice text={error} kind="error" />
      <Card>
        <Text style={textStyles.heading}>Paiement Mobile Money</Text>
        <Text style={[textStyles.muted, { marginTop: 6 }]}>Choisissez une offre, un operateur, puis confirmez.</Text>
        <View style={styles.operatorGrid}>
          {operators.map((item) => (
            <Pressable key={item.value} onPress={() => setOperator(item.value)} style={[styles.choice, operator === item.value && styles.choiceActive]}>
              <Text style={[styles.choiceText, operator === item.value && styles.choiceTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.phoneBox}>
          <Text style={textStyles.label}>Numero Mobile Money</Text>
          <Text style={styles.phoneText}>{profilePhone || "Aucun numero enregistre"}</Text>
          <Button label={useOtherPhone ? "Utiliser le numero enregistre" : "Utiliser un autre numero"} secondary onPress={() => setUseOtherPhone((v) => !v)} />
        </View>
        {useOtherPhone || !profilePhone ? <Field value={otherPhone} onChangeText={setOtherPhone} placeholder="Autre numero Mobile Money" keyboardType="phone-pad" /> : null}
      </Card>
      <Card>
        <Text style={textStyles.heading}>Packs de credits</Text>
        {packs.map((pack) => (
          <Button
            key={pack.id}
            label={`${pack.name} - ${pack.credits + pack.bonus_credits} credits - ${money(pack.price, pack.currency)}`}
            secondary={pendingOffer?.kind !== "credits" || pendingOffer.idOrAmount !== pack.id}
            onPress={() => selectOffer({ kind: "credits", idOrAmount: pack.id, label: pack.name, amount: money(pack.price, pack.currency) })}
          />
        ))}
      </Card>
      <Card>
        <Text style={textStyles.heading}>Abonnement</Text>
        {plans.map((plan) => (
          <Button key={plan.id} label={`${plan.name} - ${money(plan.price, plan.currency)}`} secondary={pendingOffer?.kind !== "subscription" || pendingOffer.idOrAmount !== plan.id} onPress={() => selectOffer({ kind: "subscription", idOrAmount: plan.id, label: plan.name, amount: money(plan.price, plan.currency) })} />
        ))}
      </Card>
      <Card>
        <Text style={textStyles.heading}>Soutien</Text>
        <Text style={[textStyles.muted, { marginTop: 6 }]}>Un don simple, sans avantage automatique.</Text>
        <Field value={supportAmount} onChangeText={setSupportAmount} placeholder="Montant USD" keyboardType="number-pad" />
        <Button label="Choisir ce montant" secondary onPress={() => selectOffer({ kind: "support_donation", idOrAmount: Number(supportAmount), label: "Soutien Moboko", amount: `${Number(supportAmount) || 0} USD` })} />
      </Card>
      {pendingOffer ? (
        <Card>
          <Text style={textStyles.heading}>Resume</Text>
          <Text style={styles.summaryLine}>Offre : {pendingOffer.label}</Text>
          <Text style={styles.summaryLine}>Montant : {pendingOffer.amount}</Text>
          <Text style={styles.summaryLine}>Operateur : {operatorLabel(operator)}</Text>
          <Text style={styles.summaryLine}>Numero : {phone || "A indiquer"}</Text>
          <Button label="Confirmer le paiement" onPress={() => void checkout()} loading={busy === `${pendingOffer.kind}-${pendingOffer.idOrAmount}`} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  operatorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  choice: { borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  choiceActive: { borderColor: "#72a8ff", backgroundColor: "rgba(114,168,255,0.12)" },
  choiceText: { color: "#9aa4b7", fontSize: 13, fontWeight: "700" },
  choiceTextActive: { color: "#f4f6fb" },
  phoneBox: { borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, marginTop: 14, marginBottom: 8 },
  phoneText: { color: "#f4f6fb", fontSize: 16, fontWeight: "700", marginTop: 4 },
  summaryLine: { color: "#c4ccda", fontSize: 14, lineHeight: 22, marginTop: 4 },
});
