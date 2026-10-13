-- Genertech Payroll — PostgreSQL schema.
-- Applied automatically when the backend starts (every statement is idempotent),
-- and can also be run by hand from pgAdmin's Query Tool.

CREATE TABLE IF NOT EXISTS employees (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('monthly', 'daily')),
  rate     NUMERIC(12, 2) NOT NULL CHECK (rate > 0),
  bank     TEXT,
  account  TEXT,
  active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CONSTRAINT users_role_check CHECK (role IN ('accountant', 'manager', 'employee', 'executive')),
  password_hash TEXT NOT NULL,
  employee_id   INTEGER REFERENCES employees(id)
);

-- Databases created before the executive role existed: widen the role check in place.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('accountant', 'manager', 'employee', 'executive'));

-- Login sessions (token is stored as a SHA-256 hash, never in plain text).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS periods (
  id            SERIAL PRIMARY KEY,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  round         INTEGER NOT NULL CHECK (round IN (1, 2)),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'returned', 'pending', 'approved', 'paid')),
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  return_reason TEXT,
  submitted_by  TEXT, submitted_at TIMESTAMPTZ,
  approved_by   TEXT, approved_at  TIMESTAMPTZ,
  paid_by       TEXT, paid_at      TIMESTAMPTZ,
  UNIQUE (year, month, round)
);

CREATE TABLE IF NOT EXISTS attendance (
  period_id    INTEGER NOT NULL REFERENCES periods(id),
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  days_worked  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  absent_days  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  ot_hours     NUMERIC(6, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (period_id, employee_id)
);

-- Calculated pay per employee per round (snapshot of type/rate at processing time).
CREATE TABLE IF NOT EXISTS payroll_lines (
  period_id    INTEGER NOT NULL REFERENCES periods(id),
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  type         TEXT NOT NULL,
  rate         NUMERIC(12, 2) NOT NULL,
  base         NUMERIC(12, 2) NOT NULL,
  ot_pay       NUMERIC(12, 2) NOT NULL,
  deduction    NUMERIC(12, 2) NOT NULL,
  tax          NUMERIC(12, 2) NOT NULL,
  net          NUMERIC(12, 2) NOT NULL,
  PRIMARY KEY (period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  period_id    INTEGER NOT NULL REFERENCES periods(id),
  employee_id  INTEGER REFERENCES employees(id),
  user_name    TEXT NOT NULL,
  action       TEXT NOT NULL,
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  reason       TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_period_idx ON audit_log (period_id);
CREATE INDEX IF NOT EXISTS payroll_lines_employee_idx ON payroll_lines (employee_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
