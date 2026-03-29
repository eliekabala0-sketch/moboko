/**
 * Détection placeholders / formats de secrets (sans journaliser les valeurs).
 */
export function isPlaceholderSecret(value) {
  const v = (value ?? "").trim();
  if (!v) return true;
  if (/COLLER_ICI|VOTRE_CLE|VOTRE_CLÉ|REPLACE_ME|CHANGEME|PASTE_HERE|xxx+/i.test(v)) {
    return true;
  }
  return false;
}

/** JWT service_role Supabase (souvent commence par eyJ). */
export function looksLikeSupabaseServiceRoleKey(value) {
  const v = (value ?? "").trim();
  return v.startsWith("eyJ") && v.length > 80;
}

/** Clé API OpenAI courante. */
export function looksLikeOpenAIApiKey(value) {
  const v = (value ?? "").trim();
  return v.startsWith("sk-") && v.length > 20;
}

export function describeSecretProblem(name, value) {
  if (!value?.trim()) return `${name} est vide`;
  if (isPlaceholderSecret(value)) {
    return `${name} contient encore un marqueur type COLLER_ICI — remplacer par la vraie clé`;
  }
  if (name === "SUPABASE_SERVICE_ROLE_KEY" && !looksLikeSupabaseServiceRoleKey(value)) {
    return `${name} ne ressemble pas à un JWT Supabase (attendu : chaîne longue commençant par eyJ)`;
  }
  if (name === "OPENAI_API_KEY" && !looksLikeOpenAIApiKey(value)) {
    return `${name} ne ressemble pas à une clé OpenAI (attendu : préfixe sk-)`;
  }
  return null;
}
