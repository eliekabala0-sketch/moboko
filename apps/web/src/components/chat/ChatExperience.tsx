"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  defaultPublicHomePageSettings,
  getOrCreatePrimaryConversationId,
  PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  type PublicHomePageSettings,
} from "@moboko/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Composer } from "./Composer";
import { mapRowToUiMessage, MessageList, type UiMessage } from "./MessageList";

type Props = {
  userId: string;
};

async function postAiChat(body: Record<string, unknown>) {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: string;
    detail?: string;
    message?: string;
    balance?: number;
    required?: number;
  };
  if (!res.ok) {
    if (res.status === 402) {
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : `Crédits insuffisants (solde ${data.balance ?? "?"}, requis ${data.required ?? "?"})`,
      );
    }
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : typeof data.error === "string"
          ? data.error
          : `Erreur ${res.status}`,
    );
  }
  return data as {
    ok: true;
    reply: string;
    balance_after?: number;
    credits_charged?: number;
    credit_cost?: number;
    billing_skipped?: boolean;
  };
}

function WalletBanner({
  wallet,
  flags,
}: {
  wallet: { balance: number; isPremium: boolean; isFreeAccess: boolean };
  flags: PublicHomePageSettings;
}) {
  if (wallet.isFreeAccess) {
    return (
      <div className="rounded-2xl border border-[var(--success)]/30 bg-[var(--success-soft)] px-4 py-3 shadow-sm ring-1 ring-[var(--success)]/15">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--success)]">
          Accès offert
        </p>
        <p className="mt-1 text-sm font-medium text-[var(--foreground)]">Aucun débit de crédits</p>
      </div>
    );
  }
  if (wallet.isPremium) {
    return (
      <div className="rounded-2xl border border-[var(--border-strong)] bg-gradient-to-br from-[var(--accent-soft)] to-transparent px-4 py-3 shadow-sm ring-1 ring-[var(--accent)]/20">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
          Premium
        </p>
        <p className="mt-1 text-sm font-medium text-[var(--foreground)]">Crédits non débités sur ce compte</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)]/90 px-4 py-3 shadow-sm backdrop-blur-sm">
      <p className="text-xs text-[var(--muted)]">Solde</p>
      <p className="font-display text-2xl font-semibold tabular-nums text-[var(--foreground)]">
        {wallet.balance}{" "}
        <span className="text-sm font-normal text-[var(--muted)]">crédits</span>
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
        Coût : texte {flags.textCreditCost} · image {flags.imageCreditCost}
        {flags.chatVoiceEnabled ? ` · voix ${flags.voiceCreditCost}` : ""}
      </p>
    </div>
  );
}

export function ChatExperience({ userId }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [flags, setFlags] = useState<PublicHomePageSettings>(defaultPublicHomePageSettings);
  const [wallet, setWallet] = useState<{
    balance: number;
    isPremium: boolean;
    isFreeAccess: boolean;
  } | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    const keys = [
      PUBLIC_APP_SETTING_KEYS.chatTextEnabled,
      PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled,
      PUBLIC_APP_SETTING_KEYS.chatImageEnabled,
      PUBLIC_APP_SETTING_KEYS.textCreditCost,
      PUBLIC_APP_SETTING_KEYS.voiceCreditCost,
      PUBLIC_APP_SETTING_KEYS.imageCreditCost,
      PUBLIC_APP_SETTING_KEYS.initialFreeCredits,
    ] as const;
    const { data } = await supabase.from("app_settings").select("key, value").in("key", keys);
    const next = { ...defaultPublicHomePageSettings };
    for (const row of data ?? []) {
      const v = parseAppSettingScalar(row.value);
      if (row.key === PUBLIC_APP_SETTING_KEYS.chatTextEnabled)
        next.chatTextEnabled = Boolean(v);
      if (row.key === PUBLIC_APP_SETTING_KEYS.chatVoiceEnabled)
        next.chatVoiceEnabled = Boolean(v);
      if (row.key === PUBLIC_APP_SETTING_KEYS.chatImageEnabled)
        next.chatImageEnabled = Boolean(v);
      if (row.key === PUBLIC_APP_SETTING_KEYS.textCreditCost)
        next.textCreditCost = Math.max(0, Math.floor(Number(v ?? 1)));
      if (row.key === PUBLIC_APP_SETTING_KEYS.voiceCreditCost)
        next.voiceCreditCost = Math.max(0, Math.floor(Number(v ?? 2)));
      if (row.key === PUBLIC_APP_SETTING_KEYS.imageCreditCost)
        next.imageCreditCost = Math.max(0, Math.floor(Number(v ?? 3)));
      if (row.key === PUBLIC_APP_SETTING_KEYS.initialFreeCredits)
        next.initialFreeCredits = Math.max(0, Math.floor(Number(v ?? 5)));
    }
    setFlags((f) => ({ ...f, ...next }));
  }, [supabase]);

  const loadWallet = useCallback(async () => {
    const { data, error: wErr } = await supabase
      .from("profiles")
      .select("credit_balance, is_premium, is_free_access")
      .eq("id", userId)
      .single();
    if (wErr || !data) return;
    setWallet({
      balance: data.credit_balance ?? 0,
      isPremium: Boolean(data.is_premium),
      isFreeAccess: Boolean(data.is_free_access),
    });
  }, [supabase, userId]);

  const loadMessages = useCallback(
    async (convId: string) => {
      const { data, error: e } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      if (e) throw e;
      setMessages((data ?? []).map((r) => mapRowToUiMessage(r as Record<string, unknown>)));
    },
    [supabase],
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setError(null);
      setLoading(true);
      try {
        await loadFlags();
        await loadWallet();
        const { conversationId: cid, error: convErr } =
          await getOrCreatePrimaryConversationId(supabase, userId);
        if (convErr) throw convErr;
        if (cancelled || !cid) return;
        setConversationId(cid);
        await loadMessages(cid);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Chargement impossible");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [userId, supabase, loadFlags, loadWallet, loadMessages]);

  async function handleSendText(t: string) {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postAiChat({
        conversationId,
        mode: "text",
        text: t,
      });
      if (typeof r.balance_after === "number") {
        setWallet((w) =>
          w ? { ...w, balance: r.balance_after as number } : w,
        );
      } else {
        await loadWallet();
      }
      await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendImage(file: File, caption: string) {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    try {
      const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: up } = await supabase.storage
        .from("chat-images")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (up) throw up;
      const r = await postAiChat({
        conversationId,
        mode: "image",
        imageStoragePath: path,
        imageMime: file.type || "image/jpeg",
        text: caption.trim() || undefined,
      });
      if (typeof r.balance_after === "number") {
        setWallet((w) =>
          w ? { ...w, balance: r.balance_after as number } : w,
        );
      } else {
        await loadWallet();
      }
      await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image non envoyée");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendAudio(blob: Blob, mime: string, durationMs: number) {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    try {
      const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : "bin";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: up } = await supabase.storage
        .from("chat-audio")
        .upload(path, blob, { contentType: mime, upsert: true });
      if (up) throw up;
      const r = await postAiChat({
        conversationId,
        mode: "audio",
        audioStoragePath: path,
        audioMime: mime,
        audioDurationMs: durationMs,
      });
      if (typeof r.balance_after === "number") {
        setWallet((w) =>
          w ? { ...w, balance: r.balance_after as number } : w,
        );
      } else {
        await loadWallet();
      }
      await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio non envoyé");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-28">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border-2 border-[var(--border)]" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)] border-r-[var(--primary)]" />
        </div>
        <p className="text-sm text-[var(--muted)]">Préparation de la conversation…</p>
      </div>
    );
  }

  if (error && !conversationId) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <div className="moboko-card border-[var(--danger)]/25 p-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--danger)]">
            Impossible de charger
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4.25rem)] flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-3 sm:px-4">
        <div className="border-b border-[var(--border)] py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
                Assistant
              </h1>
              <p className="max-w-md text-xs leading-relaxed text-[var(--muted)]">
                Conversation sécurisée — réponses générées côté serveur (OpenAI).
              </p>
            </div>
            {wallet ? <WalletBanner wallet={wallet} flags={flags} /> : null}
          </div>
        </div>
        {error ? (
          <div
            className="my-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-xs text-[var(--danger)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="custom-scrollbar flex-1 overflow-y-auto pb-2">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)]/80 shadow-inner">
                  <svg
                    className="h-8 w-8 text-[var(--accent)]/80"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.25}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p className="font-display text-lg text-[var(--foreground)]">Votre échange commence ici</p>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
                  {flags.chatVoiceEnabled
                    ? "Envoyez un message texte, une image ou une note vocale pour démarrer."
                    : "Envoyez un message texte ou une image pour démarrer."}
                </p>
              </div>
            ) : (
              <MessageList messages={messages} />
            )}
          </div>
        </div>
      </div>
      <Composer
        textEnabled={flags.chatTextEnabled}
        imageEnabled={flags.chatImageEnabled}
        voiceEnabled={flags.chatVoiceEnabled}
        busy={busy}
        onSendText={handleSendText}
        onSendImage={handleSendImage}
        onSendAudio={handleSendAudio}
      />
    </div>
  );
}
