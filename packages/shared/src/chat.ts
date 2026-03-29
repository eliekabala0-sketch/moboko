import type { JsonScalar } from "./app-settings";

/** Types de pièces jointes persistées (Storage + métadonnées). */
export type ChatAttachmentRecord = {
  bucket: string;
  path: string;
  mime: string;
  public_url?: string | null;
  duration_ms?: number | null;
  size_bytes?: number | null;
};

/** Ligne `messages` alignée avec le schéma SQL (champs média optionnels). */
export type ChatMessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "audio" | "image";
  content: string | null;
  attachments: ChatAttachmentRecord[];
  metadata: Record<string, JsonScalar | unknown>;
  media_bucket: string | null;
  media_storage_path: string | null;
  media_mime: string | null;
  media_duration_ms: number | null;
  media_public_url: string | null;
  created_at: string;
};

/** Payload côté UI avant persistance / avant appel API IA. */
export type ChatComposerPayload = {
  text: string;
  kind: "text" | "audio" | "image";
  attachments: ChatAttachmentRecord[];
  media_bucket?: string | null;
  media_storage_path?: string | null;
  media_mime?: string | null;
  media_duration_ms?: number | null;
  media_public_url?: string | null;
};
