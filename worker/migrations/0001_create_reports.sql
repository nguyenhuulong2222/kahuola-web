-- P08 — citizen fire reports.
--
-- ZERO-PII BY CONSTRUCTION. There is deliberately NO column that can hold an
-- identity: no ip, no device id, no session, no account, no contact, no user
-- agent. The coordinates stored are the FIRE's location, picked by the
-- reporter on a map — never the reporter's own position. Anonymity here is a
-- property of the schema, not of a policy someone has to remember.
--
-- Rate limiting deliberately lives OUTSIDE this table, in KV, keyed on a
-- salted digest with a 10-minute TTL. Nothing identifying reaches D1.
--
-- Retention: rows are filtered from reads at created_at + 24h (see
-- REPORT_TTL_SECONDS) and physically deleted at 48h by the daily cron. The
-- delete threshold is deliberately looser than the read filter so the cron
-- can never remove a row that is still visible.

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT    PRIMARY KEY,   -- crypto.randomUUID()
  created_at  INTEGER NOT NULL,      -- epoch seconds, UTC
  lat         REAL    NOT NULL,      -- fire location, not reporter location
  lon         REAL    NOT NULL,
  category    TEXT    NOT NULL,      -- smoke | flames | burned_area | other
  description TEXT,                  -- <= 280 chars, plain text, never HTML
  lang        TEXT    NOT NULL DEFAULT 'en',
  region      TEXT    NOT NULL       -- hawaii | conus, derived at write time
);

-- Read path: always filtered by region + created_at window.
CREATE INDEX IF NOT EXISTS idx_reports_region_created ON reports(region, created_at);

-- Cron delete path: created_at only.
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
