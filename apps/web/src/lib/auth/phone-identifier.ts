export function normalizePhoneIdentifier(raw: string) {
  const compact = raw.trim().replace(/[^\d+]/g, "");
  if (!compact) return "";
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  const withPlus = international.startsWith("+") ? international : `+${international}`;
  const digits = withPlus.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return `+${digits}`;
}

export function internalEmailForPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@phone.moboko.local`;
}

export function isEmailIdentifier(raw: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}
