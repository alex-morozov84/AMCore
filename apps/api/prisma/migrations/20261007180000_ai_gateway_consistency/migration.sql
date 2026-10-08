-- Maintenance-only contract upgrade: mixed old/new producers cannot preserve frozen identity.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid()
             AND datname = current_database() AND application_name IN ('amcore-web','amcore-worker','amcore-all')) THEN
    RAISE EXCEPTION 'Stop all AMCore API roles before applying the AI execution contract upgrade';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "ai"."ai_runs" ADD COLUMN     "providerRetryRestriction" JSONB;

-- Bounded conversion of canonical internal timestamps, never a permissive arbitrary JSON cast.
CREATE FUNCTION ai.canonical_retry_timestamp(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER AS $$
DECLARE parsed timestamptz;
BEGIN
  IF length(value) <> 24 OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
     OR left(value,4) = '0000' THEN RETURN NULL; END IF;
  BEGIN parsed := value::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
  END;
  IF to_char(parsed AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> value THEN RETURN NULL; END IF;
  RETURN parsed;
END $$;

CREATE FUNCTION ai.classify_provider_retry_restriction(value jsonb, at_time timestamptz)
RETURNS TABLE(classification text, not_before timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER AS $$
DECLARE observed timestamptz; key_count int;
BEGIN
  classification := 'invalid'; not_before := NULL;
  IF value IS NULL THEN classification := 'unrestricted'; RETURN NEXT; RETURN; END IF;
  IF jsonb_typeof(value) <> 'object' OR pg_column_size(value) > 2048 THEN RETURN NEXT; RETURN; END IF;
  SELECT count(*) INTO key_count FROM jsonb_object_keys(value);
  IF value->'version' <> '1'::jsonb OR NOT value ? 'version'
     OR jsonb_typeof(value->'observedAt') IS DISTINCT FROM 'string' THEN RETURN NEXT; RETURN; END IF;
  observed := ai.canonical_retry_timestamp(value->>'observedAt');
  IF observed IS NULL THEN RETURN NEXT; RETURN; END IF;
  IF value->>'kind' = 'unknown_until' AND key_count = 4
     AND value ?& ARRAY['version','kind','observedAt','reason']
     AND value->>'reason' IN ('overflow','unsupported_header') THEN
    classification := 'unknown'; RETURN NEXT; RETURN;
  END IF;
  IF value->>'kind' IS DISTINCT FROM 'until' OR key_count <> 5
     OR NOT value ?& ARRAY['version','kind','observedAt','notBefore','source']
     OR value->>'source' NOT IN ('relative','http_date')
     OR jsonb_typeof(value->'notBefore') IS DISTINCT FROM 'string'
     OR jsonb_typeof(value->'source') IS DISTINCT FROM 'string' THEN RETURN NEXT; RETURN; END IF;
  not_before := ai.canonical_retry_timestamp(value->>'notBefore');
  IF not_before IS NULL THEN RETURN NEXT; RETURN; END IF;
  classification := CASE WHEN not_before <= at_time THEN 'due' ELSE 'future' END;
  RETURN NEXT;
END $$;
