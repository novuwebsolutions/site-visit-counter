-- The tables site-visit-counter uses. The Worker creates them by itself on the first visit;
-- this file is for looking at them, or for creating them by hand:
--   npx wrangler d1 execute site-visits --remote --file schema.sql
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, time INTEGER NOT NULL, visitor TEXT NOT NULL,
  path TEXT NOT NULL, source TEXT, tag TEXT NOT NULL DEFAULT '', device TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '', seconds INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS views_day ON views (day);
CREATE TABLE IF NOT EXISTS events (
  view TEXT NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (view, type, name));
CREATE INDEX IF NOT EXISTS events_day ON events (day);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, count INTEGER NOT NULL,
  total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, value));
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, value TEXT NOT NULL);
