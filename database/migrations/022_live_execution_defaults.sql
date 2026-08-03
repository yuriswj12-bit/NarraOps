BEGIN;

-- NarraOps is a live product. These defaults describe the real execution
-- pipeline; confirmation is still required immediately before an irreversible
-- launch or trade.
-- Older migrations installed restrictive checks for mock/disabled execution.
-- Remove only those checks before moving durable records to the live contract;
-- historical rows remain auditable in place.
DO $$
DECLARE
  constraint_name text;
BEGIN
  IF to_regclass('public.agent_tasks') IS NOT NULL THEN
    FOR constraint_name IN
      SELECT con.conname
      FROM pg_constraint con
      WHERE con.conrelid = 'public.agent_tasks'::regclass
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%execution_mode%'
    LOOP
      EXECUTE format('ALTER TABLE public.agent_tasks DROP CONSTRAINT %I', constraint_name);
    END LOOP;
  END IF;
END $$;

DO $$
DECLARE
  table_name text;
  constraint_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['launch_drafts', 'transfer_previews', 'transfers'] LOOP
    IF to_regclass(format('public.%s', table_name)) IS NOT NULL THEN
      FOR constraint_name IN
        SELECT con.conname
        FROM pg_constraint con
        WHERE con.conrelid = format('public.%s', table_name)::regclass
          AND con.contype = 'c'
          AND (
            pg_get_constraintdef(con.oid) ILIKE '%execution_mode%'
            OR pg_get_constraintdef(con.oid) ILIKE '%signing_status%'
            OR pg_get_constraintdef(con.oid) ILIKE '%broadcasting_status%'
          )
      LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', table_name, constraint_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.agent_tasks
  ALTER COLUMN execution_mode SET DEFAULT 'live';

ALTER TABLE public.go_launch_drafts
  ALTER COLUMN execution_mode SET DEFAULT 'live',
  ALTER COLUMN signing_status SET DEFAULT 'awaiting_confirmation',
  ALTER COLUMN broadcasting_status SET DEFAULT 'awaiting_confirmation';

UPDATE public.agent_tasks
SET execution_mode = 'live', updated_at = now()
WHERE execution_mode IN ('mock', 'disabled');

UPDATE public.go_launch_drafts
SET execution_mode = 'live',
    signing_status = CASE WHEN confirmation_status = 'confirmed' THEN signing_status ELSE 'awaiting_confirmation' END,
    broadcasting_status = CASE WHEN confirmation_status = 'confirmed' THEN broadcasting_status ELSE 'awaiting_confirmation' END,
    updated_at = now()
WHERE confirmation_status <> 'confirmed'
  AND execution_mode IN ('mock', 'disabled');

UPDATE public.launch_drafts
SET execution_mode = 'live'
WHERE execution_mode IN ('mock', 'disabled');

UPDATE public.transfer_previews
SET execution_mode = 'live'
WHERE execution_mode = 'disabled';

UPDATE public.transfers
SET execution_mode = 'live',
    signing_status = CASE WHEN status IN ('submitted', 'confirmed') THEN 'submitted' ELSE 'awaiting_confirmation' END,
    broadcasting_status = CASE WHEN status IN ('submitted', 'confirmed') THEN 'submitted' ELSE 'awaiting_confirmation' END
WHERE execution_mode = 'disabled';

COMMIT;
