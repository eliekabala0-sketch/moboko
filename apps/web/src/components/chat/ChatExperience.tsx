"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  defaultPublicHomePageSettings,
  getOrCreatePrimaryConversationId,
  PUBLIC_APP_SETTING_KEYS,
  parseAppSettingScalar,
  type PublicHomePageSettings,
} from "@moboko/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./Composer";
import { mapRowToUiMessage, MessageList, type UiMessage } from "./MessageList";
import Link from "next/link";

type Props = {
  userId: string;
  initialConversationId?: string | null;
  paymentStatus?: string | null;
};

type ConversationListItem = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

const CREDIT_EXHAUSTED_MESSAGE =
  "Vous n’avez plus de crédits pour utiliser l’Assistant. Rechargez votre solde pour continuer.";
const CHAT_RETURN_CONVERSATION_KEY = "moboko.chat.returnConversationId";

function creditsHref() {
  return "/billing?tab=credits&from=chat#credits";
}

function formatCreditLabel(wallet: { balance: number; isPremium: boolean; isFreeAccess: boolean }) {
  if (wallet.isFreeAccess || wallet.isPremium) return "Accès offert";
  if (wallet.balance <= 0) return "0 crédit";
  if (wallet.balance <= 2) return `Plus que ${wallet.balance} crédit${wallet.balance > 1 ? "s" : ""}`;
  return `Crédits : ${wallet.balance}`;
}

function updateChatUrl(conversationId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set("conversationId", conversationId);
  else url.searchParams.delete("conversationId");
  url.searchParams.delete("payment");
  url.searchParams.delete("status");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function rememberChatReturn(conversationId: string | null) {
  if (typeof window === "undefined" || !conversationId) return;
  window.localStorage.setItem(CHAT_RETURN_CONVERSATION_KEY, conversationId);
}

function readRememberedChatReturn() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CHAT_RETURN_CONVERSATION_KEY);
}

class CreditError extends Error {
  code: string;
  balance: number | null;
  required: number | null;

  constructor(code: string, balance: number | null, required: number | null) {
    super(CREDIT_EXHAUSTED_MESSAGE);
    this.name = "CreditError";
    this.code = code;
    this.balance = balance;
    this.required = required;
  }
}

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
    if (
      res.status === 402 ||
      data.error === "credits_insuffisants" ||
      data.error === "credits_epuises"
    ) {
      throw new CreditError(
        typeof data.error === "string" ? data.error : "credits_epuises",
        typeof data.balance === "number" ? data.balance : null,
        typeof data.required === "number" ? data.required : null,
      );
    }
    if (data.error === "assistant_indisponible") {
      throw new Error("L’Assistant est temporairement indisponible. Réessayez dans un instant.");
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

export function ChatExperience({ userId, initialConversationId, paymentStatus }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [flags, setFlags] = useState<PublicHomePageSettings>(defaultPublicHomePageSettings);
  const [wallet, setWallet] = useState<{
    balance: number;
    isPremium: boolean;
    isFreeAccess: boolean;
  } | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) ?? null,
    [conversations, conversationId],
  );
  const activeTitle = activeConversation?.title?.trim() || "Nouvelle discussion";
  const conversationHistory = useMemo(() => {
    const now = Date.now();
    const groups = [
      { label: "Aujourd'hui", items: [] as Array<{ id: string; preview: string; at: string; active: boolean }> },
      { label: "7 derniers jours", items: [] as Array<{ id: string; preview: string; at: string; active: boolean }> },
      { label: "30 derniers jours", items: [] as Array<{ id: string; preview: string; at: string; active: boolean }> },
      { label: "Plus anciennes", items: [] as Array<{ id: string; preview: string; at: string; active: boolean }> },
    ];
    for (const c of conversations) {
      const date = new Date(c.updated_at);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const ageMs = now - date.getTime();
      const item = {
        id: c.id,
        preview: c.title?.trim() || "Nouvelle discussion",
        at: date.toLocaleString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
        active: c.id === conversationId,
      };
      if (date >= startOfToday) groups[0].items.push(item);
      else if (ageMs <= 7 * 24 * 60 * 60 * 1000) groups[1].items.push(item);
      else if (ageMs <= 30 * 24 * 60 * 60 * 1000) groups[2].items.push(item);
      else groups[3].items.push(item);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [conversations, conversationId]);

  const creditBlocked =
    Boolean(wallet) &&
    !wallet?.isPremium &&
    !wallet?.isFreeAccess &&
    (wallet?.balance ?? 0) <= 0;
  const lowCredits =
    Boolean(wallet) &&
    !wallet?.isPremium &&
    !wallet?.isFreeAccess &&
    (wallet?.balance ?? 0) > 0 &&
    (wallet?.balance ?? 0) <= Math.max(1, flags.textCreditCost * 2);

  useEffect(() => {
    if (!wallet || typeof document === "undefined") return;
    const label = formatCreditLabel(wallet);
    document.querySelectorAll("[data-moboko-credit-label]").forEach((node) => {
      node.textContent = label;
    });
  }, [wallet]);

  useEffect(() => {
    rememberChatReturn(conversationId);
  }, [conversationId]);

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

  useEffect(() => {
    if (paymentStatus) void loadWallet();
  }, [paymentStatus, loadWallet]);

  const loadConversations = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (e) throw e;
    const rows = (data ?? []).map((r) => ({
      id: String(r.id),
      title: typeof r.title === "string" ? r.title : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
    setConversations(rows);
    return rows;
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
        const rows = await loadConversations();
        const requestedId = initialConversationId?.trim() || readRememberedChatReturn();
        let cid =
          requestedId && rows.some((row) => row.id === requestedId)
            ? requestedId
            : rows[0]?.id ?? null;
        if (!cid) {
          const { conversationId: createdId, error: convErr } =
            await getOrCreatePrimaryConversationId(supabase, userId);
          if (convErr) throw convErr;
          if (!createdId) throw new Error("conversation_create_failed");
          cid = createdId;
          await loadConversations();
        }
        if (cancelled || !cid) return;
        setConversationId(cid);
        updateChatUrl(cid);
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
  }, [userId, supabase, initialConversationId, loadFlags, loadWallet, loadConversations, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

  async function handleSendText(t: string) {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    setCreditError(null);
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
      void loadConversations();
    } catch (err) {
      if (err instanceof CreditError) {
        setCreditError(CREDIT_EXHAUSTED_MESSAGE);
        if (typeof err.balance === "number") {
          setWallet((w) => (w ? { ...w, balance: err.balance as number } : w));
        }
      } else {
        setError(err instanceof Error ? err.message : "Envoi impossible");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendImage(file: File, caption: string) {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    setCreditError(null);
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
      void loadConversations();
    } catch (err) {
      if (err instanceof CreditError) {
        setCreditError(CREDIT_EXHAUSTED_MESSAGE);
        if (typeof err.balance === "number") {
          setWallet((w) => (w ? { ...w, balance: err.balance as number } : w));
        }
      } else {
        setError(err instanceof Error ? err.message : "Image non envoyée");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendAudio(blob: Blob, mime: string, durationMs: number) {
    if (!conversationId) return;
    setBusy(true);
    setError(null);
    setCreditError(null);
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
      void loadConversations();
    } catch (err) {
      if (err instanceof CreditError) {
        setCreditError(CREDIT_EXHAUSTED_MESSAGE);
        if (typeof err.balance === "number") {
          setWallet((w) => (w ? { ...w, balance: err.balance as number } : w));
        }
      } else {
        setError(err instanceof Error ? err.message : "Audio non envoyé");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleNewChat() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCreditError(null);
    try {
      const { data, error: insErr } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          title: "Nouvelle discussion",
          assistant_state: {},
          archived_at: null,
        })
        .select("id")
        .single();
      if (insErr || !data?.id) throw insErr ?? new Error("conversation_create_failed");
      const id = String(data.id);
      setConversationId(id);
      setMessages([]);
      updateChatUrl(id);
      await loadConversations();
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer une nouvelle discussion");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectConversation(id: string) {
    if (busy || id === conversationId) {
      setHistoryOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    setCreditError(null);
    try {
      setConversationId(id);
      updateChatUrl(id);
      await loadMessages(id);
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversation indisponible");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConversation(id: string) {
    if (busy) return;
    if (!window.confirm("Supprimer cette conversation de l'historique ?")) return;
    setBusy(true);
    setError(null);
    setCreditError(null);
    try {
      const { error: delErr } = await supabase
        .from("conversations")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId);
      if (delErr) throw delErr;
      const rows = await loadConversations();
      if (conversationId === id) {
        const nextId = rows[0]?.id ?? null;
        if (nextId) {
          setConversationId(nextId);
          updateChatUrl(nextId);
          await loadMessages(nextId);
        } else {
          const { data: created, error: insErr } = await supabase
            .from("conversations")
            .insert({ user_id: userId, title: "Nouvelle discussion", assistant_state: {}, archived_at: null })
            .select("id")
            .single();
          if (insErr || !created?.id) throw insErr ?? new Error("conversation_create_failed");
          const createdId = String(created.id);
          setConversationId(createdId);
          setMessages([]);
          updateChatUrl(createdId);
          await loadConversations();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameConversation(id: string, title: string) {
    const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!clean || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: upErr } = await supabase.from("conversations").update({ title: clean }).eq("id", id);
      if (upErr) throw upErr;
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renommage impossible");
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
      <aside
        className={`border-b border-[var(--border)] bg-[var(--surface)]/40 p-4 lg:block lg:border-b-0 lg:border-r ${
          historyOpen ? "block" : "hidden"
        }`}
      >
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
            <ul className="max-h-[40vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-14rem)]">
              {conversationHistory.map((group) => (
                <li key={group.label} className="space-y-1">
                  <p className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {group.label}
                  </p>
                  <ul className="space-y-1">
                    {group.items.map((h) => (
                <li
                  key={h.id}
                  className={`rounded-xl border px-3 py-2 ${
                    h.active
                      ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]/25"
                      : "border-[var(--border)] bg-[var(--surface)]/60"
                  }`}
                >
                  <button type="button" onClick={() => void handleSelectConversation(h.id)} className="w-full text-left">
                    <p className="line-clamp-2 text-xs leading-relaxed text-[var(--foreground)]">{h.preview}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">{h.at}</p>
                  </button>
                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt("Renommer le chat", h.preview);
                        if (next != null) void handleRenameConversation(h.id, next);
                      }}
                      className="text-[10px] font-semibold text-[var(--accent)]"
                    >
                      Renommer
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteConversation(h.id)}
                      className="text-[10px] font-semibold text-[var(--danger)]"
                    >
                      Supprimer
                    </button>
                  </div>
                </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {wallet ? <WalletBanner wallet={wallet} flags={flags} /> : null}
          <Link href={creditsHref()} className="block px-1 text-xs text-[var(--accent)] hover:underline">
            Acheter des crédits
          </Link>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="border-b border-[var(--border)] px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] lg:hidden"
            >
              Chats
            </button>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
                Assistant Moboko
              </h1>
              <p className="mt-0.5 text-xs font-medium text-[var(--accent)]">{activeTitle}</p>
            </div>
          </div>
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
        {creditError ? (
          <div
            className="mx-4 mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-xs text-[var(--danger)] sm:mx-6"
            role="alert"
          >
            <span>{creditError}</span>{" "}
            <Link href={creditsHref()} className="font-semibold underline">
              Acheter des crédits
            </Link>
          </div>
        ) : null}
        <div className="custom-scrollbar flex-1 overflow-y-auto px-3 pb-36 pt-3 sm:px-6">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <p className="font-display text-lg text-[var(--foreground)]">Nouvelle discussion</p>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
                  Posez votre question. Moboko répondra en priorité avec des sources sermons réelles.
                </p>
              </div>
            ) : (
              <MessageList messages={messages} conversationId={conversationId} />
            )}
            {busy ? (
              <p className="px-2 pb-3 text-xs text-[var(--muted)]">Recherche des sources...</p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 z-40 lg:left-[17rem]">
          <Composer
            textEnabled={flags.chatTextEnabled}
            imageEnabled={flags.chatImageEnabled}
            voiceEnabled={flags.chatVoiceEnabled}
            busy={busy}
            actionsDisabled={creditBlocked}
            disabledReason={
              creditBlocked ? (
                <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--danger)]">
                  <span className="font-semibold">Rechargez vos crédits pour continuer.</span>{" "}
                  <span>{CREDIT_EXHAUSTED_MESSAGE}</span>{" "}
                  <Link href={creditsHref()} className="font-semibold underline">
                    Acheter des crédits
                  </Link>
                </div>
              ) : lowCredits ? (
                <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--warning)]">
                  Plus que {wallet?.balance ?? 0} crédit{(wallet?.balance ?? 0) > 1 ? "s" : ""}.{" "}
                  <Link href={creditsHref()} className="font-semibold underline">
                    Acheter des crédits
                  </Link>
                </div>
              ) : null
            }
            onSendText={handleSendText}
            onSendImage={handleSendImage}
            onSendAudio={handleSendAudio}
          />
        </div>
      </section>
    </div>
  );
}
