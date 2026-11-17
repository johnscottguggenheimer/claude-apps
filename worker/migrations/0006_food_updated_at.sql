-- Fas 4: egna livsmedel med etikettvärden.
-- updated_at sätts när ett eget/AI-livsmedel redigeras, så katalogcachen
-- (catalog.ts) märker ändrade värden utan att antal/id ändras.
ALTER TABLE ingredients ADD COLUMN updated_at TEXT;
