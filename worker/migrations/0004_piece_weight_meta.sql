-- Piece-weight provenance for gram ladder (punkt 3).
-- AI-estimated weights are cached here with needs_review=1.

ALTER TABLE ingredients ADD COLUMN piece_weight_source TEXT;
-- 'manual' | 'slv' | 'ai_estimated' | 'category_fallback' | NULL (legacy / unknown)

ALTER TABLE ingredient_aliases ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE ingredient_aliases ADD COLUMN needs_review INTEGER DEFAULT 0;
