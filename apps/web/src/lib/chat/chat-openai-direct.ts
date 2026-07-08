/**
 * Appel direct POST /v1/responses (workflow OpenAI), sans tools ni boucle.
 * La clé est passée explicitement (Authorization: Bearer).
 */

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

/** Agrège output_text ou blocs output_text dans output[]. */
export function extractOpenAiResponsesOutputText(data: unknown): string {
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

export type OpenAiWorkflowFetchResult = {
  httpStatus: number;
  data: unknown;
  outputText: string;
  /** false si exception réseau avant réponse HTTP. */
  rawResponseReceived: boolean;
};

/**
 * Un seul aller-retour OpenAI : modèle + input utilisateur + workflow id.
 */
export async function fetchOpenAiResponsesWithWorkflow(opts: {
  apiKey: string;
  model: string;
  workflowId: string;
  userMessage: string;
}): Promise<OpenAiWorkflowFetchResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        input: opts.userMessage,
        workflow: opts.workflowId,
      }),
    });
    const data: unknown = await res.json().catch(() => ({}));
    const outputText = res.ok ? extractOpenAiResponsesOutputText(data) : "";
    return {
      httpStatus: res.status,
      data,
      outputText,
      rawResponseReceived: true,
    };
  } catch (e) {
    console.error("[chat-openai] fetch_exception", e instanceof Error ? e.message : String(e));
    return {
      httpStatus: 0,
      data: null,
      outputText: "",
      rawResponseReceived: false,
    };
  }
}
