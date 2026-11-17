-- Kontroll av receptens makron: regler + oberoende AI-bedömning + manuell stämpel.
-- ingredients_hash = hash av ingredienser + portioner när kontrollen gjordes.
-- En ändrad ingredienslista gör kontrollen inaktuell.
CREATE TABLE IF NOT EXISTS recipe_checks (
  recipe_id TEXT PRIMARY KEY,
  ingredients_hash TEXT NOT NULL,
  our_kcal REAL, our_prot REAL, our_carb REAL, our_fat REAL,
  ai_kcal REAL, ai_prot REAL, ai_carb REAL, ai_fat REAL,
  ai_rows TEXT,              -- JSON: [{i, grams, kcal, prot, note}]
  ai_summary TEXT,
  checked_at TEXT,
  verified_hash TEXT,        -- satt när John markerar receptet som kontrollerat
  verified_at TEXT
);
