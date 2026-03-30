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
import Link from "next/link";

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

  const conversationHistory = useMemo(() => {
    return messages
      .filter((m) => m.role === "user" && m.content)
      .slice(-24)
      .reverse()
      .map((m) => ({
        id: m.id,
        preview: (m.content ?? "").replace(/\s+/g, " ").trim().slice(0, 72) || "(message)",
        at: new Date(m.created_at).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));
  }, [messages]);

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

  async function handleNewChat() {
    if (!conversationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: delErr } = await supabase.from("messages").delete().eq("conversation_id", conversationId);
      if (delErr) throw delErr;
      await loadMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer une nouvelle discussion");
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
    <div className="grid min-h-[calc(100vh-4.25rem)] grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b border-[var(--border)] bg-[var(--surface)]/40 p-4 lg:border-b-0 lg:border-r">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleNewChat()}
          className="moboko-btn-primary w-full px-4 py-2.5 text-sm disabled:opacity-40"
        >
          Nouveau chat
        </button>
        <div className="mt-4 space-y-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Historique
          </p>
          {conversationHistory.length === 0 ? (
            <p className="px-1 text-xs text-[var(--muted)]">Aucun message pour l’instant.</p>
          ) : (
            <ul className="max-h-[40vh] space-y-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-14rem)]">
              {conversationHistory.map((h) => (
                <li key={h.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/60 px-3 py-2">
                  <p className="line-clamp-2 text-xs leading-relaxed text-[var(--foreground)]">{h.preview}</p>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">{h.at}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {wallet ? <WalletBanner wallet={wallet} flags={flags} /> : null}
          <Link href="/billing" className="block px-1 text-xs text-[var(--accent)] hover:underline">
            Gérer crédits / abonnement
          </Link>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="border-b border-[var(--border)] px-4 py-4 sm:px-6">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
            Assistant Moboko
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Réponses orientées sources. Le texte généré reste bref; les références sermons sont prioritaires.
          </p>
        </div>
        {error ? (
          <div
            className="mx-4 mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-xs text-[var(--danger)] sm:mx-6"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        <div className="custom-scrollbar flex-1 overflow-y-auto px-3 pb-36 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <p className="font-display text-lg text-[var(--foreground)]">Nouvelle discussion</p>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
                  Posez votre question. Moboko répondra en priorité avec des sources sermons réelles.
                </p>
              </div>
            ) : (
              <MessageList messages={messages} />
            )}
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:left-[17rem]">
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
      </section>
    </div>
  );
}
