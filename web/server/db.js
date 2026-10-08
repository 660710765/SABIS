import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { createPeriod, processPeriod, tx } from './service.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('monthly', 'daily')),
  rate REAL NOT NULL CHECK (rate > 0),
  bank TEXT,
  account TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('accountant', 'manager', 'employee')),
  password_hash TEXT NOT NULL,
  employee_id INTEGER REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  round INTEGER NOT NULL CHECK (round IN (1, 2)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'returned', 'pending', 'approved', 'paid')),
  processed INTEGER NOT NULL DEFAULT 0,
  return_reason TEXT,
  submitted_by TEXT, submitted_at TEXT,
  approved_by TEXT, approved_at TEXT,
  paid_by TEXT, paid_at TEXT,
  UNIQUE (year, month, round)
);
CREATE TABLE IF NOT EXISTS attendance (
  period_id INTEGER NOT NULL REFERENCES periods(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  days_worked REAL NOT NULL DEFAULT 0,
  absent_days REAL NOT NULL DEFAULT 0,
  ot_hours REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (period_id, employee_id)
);
CREATE TABLE IF NOT EXISTS lines (
  period_id INTEGER NOT NULL REFERENCES periods(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,
  rate REAL NOT NULL,
  base REAL NOT NULL,
  ot_pay REAL NOT NULL,
  deduction REAL NOT NULL,
  tax REAL NOT NULL,
  net REAL NOT NULL,
  PRIMARY KEY (period_id, employee_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES periods(id),
  employee_id INTEGER REFERENCES employees(id),
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  at TEXT NOT NULL
);
`;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 32);
  const want = Buffer.from(hash, 'hex');
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0) seed(db);
  return db;
}

// Sample data so the system can be demonstrated right after the first start.
function seed(db) {
  const emps = [
    ['EMP-0101', 'วิไล ศรีสุข', 'monthly', 24000, 'กสิกรไทย', '123-4-54521-0'],
    ['EMP-0108', 'ธนพล แก้วมณี', 'monthly', 38000, 'กรุงเทพ', '456-7-00912-3'],
    ['EMP-0115', 'อรุณี พรหมมา', 'monthly', 18000, 'ไทยพาณิชย์', '789-1-27730-5'],
    ['EMP-0142', 'สมชาย ใจดี', 'daily', 450, null, null],
    ['EMP-0157', 'ประยูร ทองมา', 'daily', 450, null, null],
    ['EMP-0163', 'จักรพันธ์ บุญมา', 'daily', 480, null, null]
  ];
  const insEmp = db.prepare('INSERT INTO employees (code, name, type, rate, bank, account) VALUES (?, ?, ?, ?, ?, ?)');
  const insUser = db.prepare('INSERT INTO users (username, name, role, password_hash, employee_id) VALUES (?, ?, ?, ?, ?)');

  tx(db, () => {
    insUser.run('somsri', 'สมศรี รักษ์บัญชี', 'accountant', hashPassword('1234'), null);
    insUser.run('weera', 'วีระ คุมงานดี', 'manager', hashPassword('1234'), null);
    for (const e of emps) {
      const { lastInsertRowid } = insEmp.run(...e);
      insUser.run(e[0], e[1], 'employee', hashPassword('1234'), Number(lastInsertRowid));
    }

    const system = { name: 'ระบบ (ข้อมูลตัวอย่าง)' };

    // October 2026 (ต.ค. 2569) round 1: already paid.
    const p1 = createPeriod(db, 2026, 10, 1, system);
    setAtt(db, p1, 'EMP-0101', { ot_hours: 2 });
    setAtt(db, p1, 'EMP-0142', { days_worked: 12 });
    setAtt(db, p1, 'EMP-0157', { days_worked: 13, ot_hours: 3 });
    processPeriod(db, p1, system);
    db.prepare(`UPDATE periods SET status = 'paid', submitted_by = ?, submitted_at = ?, approved_by = ?, approved_at = ?, paid_by = ?, paid_at = ? WHERE id = ?`)
      .run('สมศรี รักษ์บัญชี', '2026-10-14T15:00:00', 'วีระ คุมงานดี', '2026-10-15T09:30:00', 'สมศรี รักษ์บัญชี', '2026-10-15T14:00:00', p1);

    // October 2026 round 2: attendance imported, waiting to be processed.
    const p2 = createPeriod(db, 2026, 10, 2, system);
    setAtt(db, p2, 'EMP-0101', { ot_hours: 4 });
    setAtt(db, p2, 'EMP-0115', { days_worked: 13, absent_days: 1 });
    setAtt(db, p2, 'EMP-0142', { ot_hours: 6 });
    setAtt(db, p2, 'EMP-0157', { days_worked: 11 });
    setAtt(db, p2, 'EMP-0163', { days_worked: 13, ot_hours: 4 });
  });
}

function setAtt(db, periodId, code, values) {
  const emp = db.prepare('SELECT id FROM employees WHERE code = ?').get(code);
  for (const [k, v] of Object.entries(values)) {
    db.prepare(`UPDATE attendance SET ${k} = ? WHERE period_id = ? AND employee_id = ?`).run(v, periodId, emp.id);
  }
}
