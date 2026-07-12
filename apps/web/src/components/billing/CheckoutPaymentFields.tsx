"use client";

export type CheckoutPaymentDetails = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  city: string;
  country: string;
  operator: string;
};

export const DEFAULT_PAYMENT_DETAILS: CheckoutPaymentDetails = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  address: "",
  city: "",
  country: "RDC",
  operator: "airtel_money",
};

export const MOBILE_MONEY_OPERATORS = [
  { value: "airtel_money", label: "Airtel Money" },
  { value: "orange_money", label: "Orange Money" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "afrimoney", label: "Afrimoney" },
] as const;

export function CheckoutPaymentFields({
  value,
  onChange,
  disabled,
}: {
  value: CheckoutPaymentDetails;
  onChange: (next: CheckoutPaymentDetails) => void;
  disabled?: boolean;
}) {
  function set<K extends keyof CheckoutPaymentDetails>(key: K, next: CheckoutPaymentDetails[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Nom complet</span>
        <input
          className="moboko-input mt-2"
          value={value.customerName}
          onChange={(e) => set("customerName", e.target.value)}
          autoComplete="name"
          disabled={disabled}
          required
        />
      </label>
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Email</span>
        <input
          className="moboko-input mt-2"
          type="email"
          inputMode="email"
          value={value.customerEmail}
          onChange={(e) => set("customerEmail", e.target.value)}
          autoComplete="email"
          disabled={disabled}
          required
        />
      </label>
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Numero Mobile Money</span>
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
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Operateur</span>
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
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Adresse</span>
        <input
          className="moboko-input mt-2"
          value={value.address}
          onChange={(e) => set("address", e.target.value)}
          autoComplete="street-address"
          disabled={disabled}
          required
        />
      </label>
      <label className="block text-sm font-medium text-[var(--foreground)]">
        <span className="text-[var(--muted)]">Ville</span>
        <input
          className="moboko-input mt-2"
          value={value.city}
          onChange={(e) => set("city", e.target.value)}
          autoComplete="address-level2"
          disabled={disabled}
          required
        />
      </label>
      <label className="block text-sm font-medium text-[var(--foreground)] sm:col-span-2">
        <span className="text-[var(--muted)]">Pays</span>
        <input
          className="moboko-input mt-2"
          value={value.country}
          onChange={(e) => set("country", e.target.value)}
          autoComplete="country-name"
          disabled={disabled}
          required
        />
      </label>
    </div>
  );
}
