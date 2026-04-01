import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getOpenAIClient, runStructuredJsonCompletion } from "@/lib/ai/moboko-chat";
import {
  parseSemanticIntentFromModelJson,
  type SemanticIntent,
} from "@/lib/sermons/semantic-intent";

const MOBOKO_SOURCE_ONLY_LOCK = `Règles Moboko (impératif) :
- Moboko ne doit jamais utiliser des connaissances générales.
- Moboko ne répond que par des passages présents dans la base.
- Si aucun passage n’est trouvé dans les extraits fournis, Moboko ne répond pas à l’utilisateur : produis uniquement le JSON demandé sans autre texte, par ex. {"picks":[]}.`;

/**
 * Retrieval agent : compréhension sémantique uniquement, sortie JSON structurée.
 * Aucun texte pour l’utilisateur final.
 */
type OpenAIClient = NonNullable<ReturnType<typeof getOpenAIClient>>;

export async function runRetrievalAgent(
  openai: OpenAIClient,
  query: string,
  turnContextBlock: string | null,
): Promise<SemanticIntent | null> {
  const ctx =
    turnContextBlock && turnContextBlock.trim()
      ? `\n\n## Contexte poursuite (ne pas ignorer si la question s’y réfère)\n${turnContextBlock.trim()}`
      : "";
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${MOBOKO_SOURCE_ONLY_LOCK}

Tu es l’agent de retrieval Moboko : tu ne parles jamais à l’utilisateur, tu produis UNIQUEMENT un JSON de pilotage de recherche documentaire.

Retourne UNIQUEMENT un JSON :
{"search_mode":"...","user_need":"...","intent":"...","topic":"...","concepts":["..."],"expansions":["..."],"content_types":["..."],"quoted_phrase":"...|null","sermon_hint":"...|null","year_from":1963|null,"year_to":1965|null,"maybe_meant":"...|null","retrieval_phrases":["..."],"avoid_lexical_bait":["..."],"passage_brief":"...","restrict_sermon_slug":"...|null","follow_up_continuity":false,"paragraph_exact":null,"confidence":0.85}

search_mode parmi: exact_quote_search, exact_paragraph_lookup, theme_search, situation_search, story_search, prayer_search, doctrinal_search, time_bounded_search, preaching_prep_search, comfort_or_exhortation_search, sermon_title_then_topic_search.
user_need parmi: simple_answer, orientation, exhortation, comfort, preaching_prep, citation_list, prayer_list, story_list.

Règles :
- Comprends le SENS et le TYPE DE PASSAGE (récit, prière réelle, consolation, exégèse ciblée, thème + périmètre sermon…).
- retrieval_phrases : 3–8 expressions substantives pour la base (pas de mots pièges seuls).
- avoid_lexical_bait : termes à ne pas utiliser seuls en requête.
- passage_brief : critères internes pour le classement (inclusion / exclusion sémantique).
- follow_up_continuity : true si la phrase suppose le tour précédent (« toujours dans ce sermon », « montre encore », « plus précisément », etc.).
- restrict_sermon_slug : slug exact si le contexte ou la question fixe un sermon.
- paragraph_exact : numéro seulement si l’utilisateur demande explicitement un § connu ET que le slug est certain via contexte ; sinon null (le routeur déterministe gère le cas évident).
- confidence : entre 0 et 1, ta confiance dans ce plan de retrieval.
- Aucune prose hors JSON.${ctx}`,
    },
    { role: "user", content: query },
  ];
  const raw = await runStructuredJsonCompletion(openai, messages, {
    maxTokens: 560,
    temperature: 0.08,
    timeoutMs: 26_000,
  });
  if (!raw) return null;
  return parseSemanticIntentFromModelJson(raw);
}
