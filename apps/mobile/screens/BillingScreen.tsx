import { useEffect, useMemo, useState } from "react";
import { Linking, Text } from "react-native";
import { Button, Card, Field, Notice, Screen, textStyles } from "../components/ui";
import { apiJson } from "../lib/api";
import { money } from "../lib/format";
import { supabase } from "../lib/supabase";

type Plan = { id: string; name: string; description: string | null; price: number; currency: string; monthly_ai_credits?: number | null };
type Pack = { id: string; name: string; description: string | null; credits: number; bonus_credits: number; price: number; currency: string };

export function BillingScreen({ userId }: { userId: string }) {
  const [balance, setBalance] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [country, setCountry] = useState("");
  const [operator, setOperator] = useState("airtel_money");
  const [supportAmount, setSupportAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const payment = useMemo(
    () => ({ customerName: name, customerEmail: email, customerPhone: phone, address, city, country, operator }),
    [name, email, phone, address, city, country, operator],
  );

  useEffect(() => {
    void load();
  }, [userId]);

  async function load() {
    const [{ data: profile }, { data: planRows }, { data: packRows }] = await Promise.all([
      supabase.from("profiles").select("credit_balance").eq("id", userId).single(),
      supabase.from("billing_subscription_plans").select("id, name, description, price, currency, monthly_ai_credits").eq("is_active", true).order("display_order", { ascending: true }),
      supabase.from("billing_credit_packs").select("id, name, description, credits, bonus_credits, price, currency").eq("is_active", true).order("display_order", { ascending: true }),
    ]);
    setBalance(profile?.credit_balance ?? 0);
    setPlans((planRows ?? []) as Plan[]);
    setPacks((packRows ?? []) as Pack[]);
  }

  async function checkout(kind: "subscription" | "credits" | "support_donation", idOrAmount: string | number) {
    setBusy(`${kind}-${idOrAmount}`);
    setError(null);
    setMessage(null);
    try {
      const body =
        kind === "subscription"
          ? { purpose: kind, planId: idOrAmount, payment, returnUrl: "moboko://billing", idempotencyKey: `${kind}-${idOrAmount}-${Date.now()}` }
          : kind === "credits"
            ? { purpose: kind, packId: idOrAmount, payment, returnUrl: "moboko://billing", idempotencyKey: `${kind}-${idOrAmount}-${Date.now()}` }
            : { purpose: kind, amount: Number(idOrAmount), payment, returnUrl: "moboko://billing", idempotencyKey: `${kind}-${idOrAmount}-${Date.now()}` };
      const res = await apiJson<{ ok: true; checkout_url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMessage("Checkout ouvert. Revenez dans Moboko apres confirmation.");
      await Linking.openURL(res.checkout_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paiement indisponible");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen title="Credits" kicker={`${balance} credits`}>
      <Notice text={message} kind="success" />
      <Notice text={error} kind="error" />
      <Card>
        <Text style={textStyles.heading}>Informations paiement</Text>
        <Field value={name} onChangeText={setName} placeholder="Nom complet" />
        <Field value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" />
        <Field value={phone} onChangeText={setPhone} placeholder="Telephone paiement" keyboardType="phone-pad" />
        <Field value={address} onChangeText={setAddress} placeholder="Adresse" />
        <Field value={city} onChangeText={setCity} placeholder="Ville" />
        <Field value={country} onChangeText={setCountry} placeholder="Pays" />
        <Field value={operator} onChangeText={setOperator} placeholder="Operateur: airtel_money, orange_money, mpesa..." />
      </Card>
      <Card>
        <Text style={textStyles.heading}>Packs de credits</Text>
        {packs.map((pack) => (
          <Button
            key={pack.id}
            label={`${pack.name} - ${pack.credits + pack.bonus_credits} credits - ${money(pack.price, pack.currency)}`}
            onPress={() => void checkout("credits", pack.id)}
            loading={busy === `credits-${pack.id}`}
          />
        ))}
      </Card>
      <Card>
        <Text style={textStyles.heading}>Abonnement</Text>
        {plans.map((plan) => (
          <Button key={plan.id} label={`${plan.name} - ${money(plan.price, plan.currency)}`} onPress={() => void checkout("subscription", plan.id)} loading={busy === `subscription-${plan.id}`} />
        ))}
      </Card>
      <Card>
        <Text style={textStyles.heading}>Soutien</Text>
        <Text style={[textStyles.muted, { marginTop: 6 }]}>Un don simple, sans avantage automatique.</Text>
        <Field value={supportAmount} onChangeText={setSupportAmount} placeholder="Montant USD" keyboardType="number-pad" />
        <Button label="Envoyer un soutien" onPress={() => void checkout("support_donation", Number(supportAmount))} loading={busy === `support_donation-${supportAmount}`} />
      </Card>
    </Screen>
  );
}
