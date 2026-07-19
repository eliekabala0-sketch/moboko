"use client";

export type CheckoutPaymentDetails = {
  operator: string;
  customerPhone: string;
  useDifferentPhone: boolean;
};

export type CheckoutProfile = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
};

export const DEFAULT_PAYMENT_DETAILS: CheckoutPaymentDetails = {
  operator: "airtel_money",
  customerPhone: "",
  useDifferentPhone: false,
};

export const MOBILE_MONEY_OPERATORS = [
  { value: "airtel_money", label: "Airtel Money" },
  { value: "orange_money", label: "Orange Money" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "afrimoney", label: "Afrimoney" },
] as const;

export function paymentPayload(value: CheckoutPaymentDetails, profile?: CheckoutProfile | null) {
  return {
    operator: value.operator,
    customerPhone: value.useDifferentPhone ? value.customerPhone : profile?.phone || "",
  };
}

export function paymentPhoneLabel(value: CheckoutPaymentDetails, profile?: CheckoutProfile | null) {
  return value.useDifferentPhone ? value.customerPhone : profile?.phone || "Numero a indiquer";
}

export function operatorLabel(value: string) {
  return MOBILE_MONEY_OPERATORS.find((operator) => operator.value === value)?.label ?? "Mobile Money";
}

export function CheckoutPaymentFields({
  value,
  onChange,
  profile,
  disabled,
}: {
  value: CheckoutPaymentDetails;
  onChange: (next: CheckoutPaymentDetails) => void;
  profile?: CheckoutProfile | null;
  disabled?: boolean;
}) {
  function set<K extends keyof CheckoutPaymentDetails>(key: K, next: CheckoutPaymentDetails[K]) {
    onChange({ ...value, [key]: next });
  }

  const registeredPhone = profile?.phone?.trim() || "";

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Operateur Mobile Money</span>
        <select
          className="moboko-input mt-2"
          value={value.operator}
          onChange={(e) => set("operator", e.target.value)}
          disabled={disabled}
          required
        >
          {MOBILE_MONEY_OPERATORS.map((operator) => (
            <option key={operator.value} value={operator.value}>
              {operator.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--foreground)]">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Numero Mobile Money</p>
        <p className="mt-1 font-semibold tabular-nums">{registeredPhone || "Aucun numero enregistre"}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...value, useDifferentPhone: !value.useDifferentPhone, customerPhone: "" })}
          className="mt-3 text-sm font-semibold text-[var(--accent)] disabled:opacity-45"
        >
          {value.useDifferentPhone ? "Utiliser le numero enregistre" : "Utiliser un autre numero"}
        </button>
      </div>

      {value.useDifferentPhone || !registeredPhone ? (
        <label className="block text-sm font-medium text-[var(--foreground)]">
          <span className="text-[var(--muted)]">Autre numero Mobile Money</span>
          <input
            className="moboko-input mt-2"
            type="tel"
            inputMode="tel"
            value={value.customerPhone}
            onChange={(e) => set("customerPhone", e.target.value)}
            autoComplete="tel"
            placeholder="+243..."
            disabled={disabled}
            required
          />
        </label>
      ) : null}
    </div>
  );
}
