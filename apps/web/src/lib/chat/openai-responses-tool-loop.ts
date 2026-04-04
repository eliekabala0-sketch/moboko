function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

/** Agrège output_text ou blocs output_text dans output[]. */
export function extractResponsesOutputText(data: unknown): string {
  if (!isRecord(data)) return "";
  const direct = data.output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = data.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!isRecord(c)) continue;
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

export type OpenAiToolDispatcher = (name: string, argsJson: string) => Promise<string>;

/**
 * Boucle POST /v1/responses : tool_calls → function_call_output → requête suivante.
 */
export async function openaiResponsesToolLoop(opts: {
  apiKey: string;
  model: string;
  workflow?: string;
  userMessage: string;
  tools: unknown[];
  dispatch: OpenAiToolDispatcher;
  maxRounds?: number;
}): Promise<{ ok: boolean; outputText: string; lastResponse: unknown; httpStatus?: number }> {
  const maxRounds = opts.maxRounds ?? 14;
  const input: unknown[] = [{ role: "user", content: opts.userMessage }];

  for (let round = 0; round < maxRounds; round++) {
    const body: Record<string, unknown> = {
      model: opts.model,
      input,
      tools: opts.tools,
      tool_choice: "auto",
    };
    if (opts.workflow) body.workflow = opts.workflow;

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[openai-responses-tool-loop] HTTP", res.status, data);
      return { ok: false, outputText: "", lastResponse: data, httpStatus: res.status };
    }

    const output = isRecord(data) && Array.isArray(data.output) ? data.output : [];
    input.push(...output);

    const calls = output.filter(
      (x): x is Record<string, unknown> => isRecord(x) && x.type === "function_call",
    );

    if (calls.length === 0) {
      return {
        ok: true,
        outputText: extractResponsesOutputText(data),
        lastResponse: data,
        httpStatus: res.status,
      };
    }

    for (const call of calls) {
      const name = typeof call.name === "string" ? call.name : "";
      const callId = typeof call.call_id === "string" ? call.call_id : "";
      const rawArgs = call.arguments;
      const argStr =
        typeof rawArgs === "string"
          ? rawArgs
          : rawArgs != null && typeof rawArgs === "object"
            ? JSON.stringify(rawArgs)
            : "{}";
      const outputStr = await opts.dispatch(name, argStr);
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: outputStr,
      });
    }
  }

  return { ok: false, outputText: "", lastResponse: null, httpStatus: 0 };
}

/** Définitions tools (Responses API) — alignées sur /api/tools/*. */
export const SERMON_CHAT_TOOLS: unknown[] = [
  {
    type: "function",
    name: "find_sermon",
    description:
      "Résoudre un sermon publié par titre ou fragment de slug. Retourne sermon_slug et sermon_title si trouvé.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title_or_slug: { type: "string", description: "Titre ou slug partiel du sermon" },
      },
      required: ["title_or_slug"],
    },
  },
  {
    type: "function",
    name: "get_paragraph",
    description: "Récupérer le paragraphe §n exact dans un sermon (slug canonique), avec voisins.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sermon_slug: { type: "string" },
        paragraph_number: { type: "integer" },
        conversation_id: {
          type: "string",
          description: "Optionnel : id conversation Moboko pour métadonnées",
        },
      },
      required: ["sermon_slug", "paragraph_number"],
    },
  },
  {
    type: "function",
    name: "search_in_sermon",
    description: "Rechercher des paragraphes dans un sermon donné (slug canonique).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sermon_slug: { type: "string" },
        query: { type: "string" },
        offset: { type: "integer" },
        page_size: { type: "integer" },
        conversation_id: { type: "string" },
      },
      required: ["sermon_slug", "query"],
    },
  },
  {
    type: "function",
    name: "search_global",
    description: "Rechercher des paragraphes dans toute la bibliothèque de sermons.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        offset: { type: "integer" },
        page_size: { type: "integer" },
        conversation_id: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "continue_scope",
    description:
      "Poursuivre la dernière recherche concordance (même sermon ou bibliothèque) avec pagination (offset).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        conversation_id: { type: "string" },
        offset: { type: "integer" },
        page_size: { type: "integer" },
      },
      required: ["conversation_id"],
    },
  },
];
