-- Null preserves the meaning of pre-existing provider-window evidence.
ALTER TABLE core.background_effect_evidence
  ADD COLUMN "recipeVersion" INTEGER,
  ADD COLUMN "cooldownDelayMs" INTEGER,
  ADD COLUMN "cooldownSupported" BOOLEAN,
  ADD COLUMN "cooldownRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE core.background_effect_evidence
  ADD CONSTRAINT background_effect_cooldown_range CHECK (
    ("recipeVersion" IS NULL OR "recipeVersion" = 2) AND
    ("cooldownDelayMs" IS NULL OR "cooldownDelayMs" BETWEEN 0 AND 86400000) AND
    "cooldownRevision" >= 0
  );
