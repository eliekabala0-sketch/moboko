-- Une seule conversation « principale » par utilisateur : évite plusieurs fils créés en parallèle
-- (ex. première ouverture chat sur web + mobile) et garantit le même historique partout.

WITH ranked AS (
  SELECT
    c.id,
    row_number() OVER (
      PARTITION BY c.user_id
      ORDER BY
        (SELECT COUNT(*)::bigint FROM public.messages m WHERE m.conversation_id = c.id) DESC,
        c.updated_at DESC,
        c.created_at DESC
    ) AS rn
  FROM public.conversations c
)
DELETE FROM public.conversations c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_id_unique
  ON public.conversations (user_id);
