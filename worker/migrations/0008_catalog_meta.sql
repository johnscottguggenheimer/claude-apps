-- Billig katalogversion. Tidigare räknade catalogVersion() hela ingredients och
-- ingredient_aliases (~12 700 rader per anrop) och åt upp D1:s dagliga
-- gratiskvot (5 M rows_read). Nu bumpar triggers en räknare, och versionsfrågan
-- läser 1 rad.
CREATE TABLE IF NOT EXISTS catalog_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT OR IGNORE INTO catalog_meta (id, version) VALUES (1, 1);

CREATE TRIGGER IF NOT EXISTS trg_ingredients_ins AFTER INSERT ON ingredients
BEGIN UPDATE catalog_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS trg_ingredients_upd AFTER UPDATE ON ingredients
BEGIN UPDATE catalog_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS trg_ingredients_del AFTER DELETE ON ingredients
BEGIN UPDATE catalog_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS trg_aliases_ins AFTER INSERT ON ingredient_aliases
BEGIN UPDATE catalog_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS trg_aliases_upd AFTER UPDATE ON ingredient_aliases
BEGIN UPDATE catalog_meta SET version = version + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS trg_aliases_del AFTER DELETE ON ingredient_aliases
BEGIN UPDATE catalog_meta SET version = version + 1 WHERE id = 1; END;
