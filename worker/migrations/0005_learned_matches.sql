-- Fas 1: AI-väljare + inlärda matchningar.
-- Tabellerna saknar FK mot ingredients med flit: nutrition-migrate.mts
-- tömmer och återskapar SLV-raderna, och inlärningen ska överleva det.

-- Ingrediensnamn (normaliserat + enhetsklass) → livsmedel.
-- match_key = '<normaliserat namn>|<spoon|bulk>'
CREATE TABLE IF NOT EXISTS learned_matches (
  match_key TEXT PRIMARY KEY,
  ingredient_id INTEGER NOT NULL,
  source TEXT NOT NULL,              -- 'ai' | 'user'
  confidence TEXT,                   -- 'high' | 'medium' | 'low'
  needs_review INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learned_matches_review
  ON learned_matches(needs_review);

-- Gram per enhet för ett livsmedel (1 st broccoli, 1 strimla bacon, 1 msk paprikapulver).
CREATE TABLE IF NOT EXISTS learned_unit_weights (
  ingredient_id INTEGER NOT NULL,
  unit TEXT NOT NULL,
  grams_per_unit REAL NOT NULL,
  source TEXT NOT NULL,              -- 'ai' | 'user'
  needs_review INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ingredient_id, unit)
);

-- Ursprung per livsmedel. Egna/AI-skapade livsmedel har id >= 950000
-- och lämnas orörda av nutrition-migrate.mts.
ALTER TABLE ingredients ADD COLUMN source TEXT;
