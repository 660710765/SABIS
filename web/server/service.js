// Payroll workflow: create round → process (UC-04) → edit with audit (UC-07)
// → submit → approve / return (UC-08) → pay (UC-09).
import { calcLine, periodRange, workingDays, round2 } from './payroll.js';

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toISOString();
const EDITABLE = ['draft', 'returned'];

// Runs fn in a transaction, or inside the caller's transaction when already in one.
const depth = new WeakMap();
export function tx(db, fn) {
  const d = depth.get(db) || 0;
  if (d > 0) return fn();
  depth.set(db, 1);
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth.set(db, 0);
  }
}

function log(db, periodId, user, action, extra = {}) {
  db.prepare(`INSERT INTO audit (period_id, employee_id, user_name, action, field, old_value, new_value, reason, at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(periodId, extra.employeeId ?? null, user.name, action, extra.field ?? null,
      extra.from ?? null, extra.to ?? null, extra.reason ?? null, now());
}

export function getPeriod(db, id) {
  const p = db.prepare('SELECT * FROM periods WHERE id = ?').get(id);
  if (!p) throw new AppError(404, 'ไม่พบรอบการจ่ายนี้');
  return p;
}

export function findPeriod(db, year, month, round) {
  return db.prepare('SELECT * FROM periods WHERE year = ? AND month = ? AND round = ?').get(year, month, round) || null;
}

export function listPeriods(db, statuses) {
  const marks = statuses.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM periods WHERE status IN (${marks}) ORDER BY year DESC, month DESC, round DESC`).all(...statuses);
}

export function createPeriod(db, year, month, round, user) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError(400, 'ปีไม่ถูกต้อง');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new AppError(400, 'เดือนไม่ถูกต้อง');
  if (round !== 1 && round !== 2) throw new AppError(400, 'รอบการจ่ายต้องเป็น 1 หรือ 2');
  if (findPeriod(db, year, month, round)) throw new AppError(409, 'มีรอบการจ่ายนี้อยู่แล้ว');

  return tx(db, () => {
    const { lastInsertRowid } = db.prepare('INSERT INTO periods (year, month, round) VALUES (?, ?, ?)').run(year, month, round);
    const id = Number(lastInsertRowid);
    const days = workingDays(year, month, round);
    db.prepare(`INSERT INTO attendance (period_id, employee_id, days_worked)
                SELECT ?, id, ? FROM employees WHERE active = 1`).run(id, days);
    log(db, id, user, 'create');
    return id;
  });
}

function computeLine(db, periodId, employeeId) {
  const row = db.prepare(`SELECT e.type, e.rate, a.days_worked, a.absent_days, a.ot_hours
                          FROM attendance a JOIN employees e ON e.id = a.employee_id
                          WHERE a.period_id = ? AND a.employee_id = ?`).get(periodId, employeeId);
  const r = calcLine(row, row);
  db.prepare(`INSERT OR REPLACE INTO lines (period_id, employee_id, type, rate, base, ot_pay, deduction, tax, net)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(periodId, employeeId, row.type, row.rate, r.base, r.ot_pay, r.deduction, r.tax, r.net);
}

export function processPeriod(db, id, user) {
  const p = getPeriod(db, id);
  if (!EDITABLE.includes(p.status)) throw new AppError(409, 'ประมวลผลได้เฉพาะรอบที่อยู่ในสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"');
  const emps = db.prepare('SELECT employee_id FROM attendance WHERE period_id = ?').all(id);
  if (emps.length === 0) throw new AppError(409, 'ยังไม่มีข้อมูลเวลาทำงานในรอบนี้');
  tx(db, () => {
    for (const { employee_id } of emps) computeLine(db, id, employee_id);
    db.prepare('UPDATE periods SET processed = 1 WHERE id = ?').run(id);
    log(db, id, user, 'process');
  });
}

const FIELDS = {
  days_worked: 'วันทำงาน',
  absent_days: 'ขาดงาน (วัน)',
  ot_hours: 'OT (ชม.)'
};

// UC-07: every change needs a reason and is written to the audit log.
export function updateAttendance(db, id, employeeId, values, reason, user) {
  const p = getPeriod(db, id);
  if (p.status === 'paid') throw new AppError(409, 'ไม่อนุญาตให้แก้ไขเนื่องจากมีการจ่ายเงินเรียบร้อยแล้ว');
  if (!EDITABLE.includes(p.status)) throw new AppError(409, 'แก้ไขได้เฉพาะรอบที่อยู่ในสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"');
  const why = String(reason || '').trim();
  if (!why) throw new AppError(400, 'กรุณาระบุเหตุผลในการแก้ไข');

  const att = db.prepare('SELECT * FROM attendance WHERE period_id = ? AND employee_id = ?').get(id, employeeId);
  if (!att) throw new AppError(404, 'ไม่พบพนักงานในรอบนี้');

  const { start, end } = periodRange(p.year, p.month, p.round);
  const maxDays = end - start + 1;
  const changes = [];
  for (const key of Object.keys(FIELDS)) {
    if (values[key] === undefined || values[key] === null || values[key] === '') continue;
    const v = Number(values[key]);
    if (!Number.isFinite(v) || v < 0) throw new AppError(400, `${FIELDS[key]} ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`);
    if (key !== 'ot_hours' && v > maxDays) throw new AppError(400, `${FIELDS[key]} ต้องไม่เกิน ${maxDays} วันในรอบนี้`);
    if (key === 'ot_hours' && v > maxDays * 12) throw new AppError(400, 'ชั่วโมง OT มากเกินกว่าที่เป็นไปได้ในรอบนี้');
    if (v !== att[key]) changes.push([key, att[key], v]);
  }
  const days = changes.find((c) => c[0] === 'days_worked')?.[2] ?? att.days_worked;
  const absent = changes.find((c) => c[0] === 'absent_days')?.[2] ?? att.absent_days;
  if (days + absent > maxDays) throw new AppError(400, `วันทำงานรวมวันขาดงานต้องไม่เกิน ${maxDays} วัน`);
  if (changes.length === 0) throw new AppError(400, 'ไม่มีข้อมูลที่เปลี่ยนแปลง');

  tx(db, () => {
    for (const [key, from, to] of changes) {
      db.prepare(`UPDATE attendance SET ${key} = ? WHERE period_id = ? AND employee_id = ?`).run(to, id, employeeId);
      log(db, id, user, 'edit', { employeeId, field: FIELDS[key], from: String(from), to: String(to), reason: why });
    }
    if (p.processed) computeLine(db, id, employeeId);
  });
}

export function submitPeriod(db, id, user) {
  const p = getPeriod(db, id);
  if (!EDITABLE.includes(p.status)) throw new AppError(409, 'ส่งอนุมัติได้เฉพาะรอบที่อยู่ในสถานะ "ร่าง" หรือ "ส่งกลับแก้ไข"');
  if (!p.processed) throw new AppError(409, 'ต้องประมวลผลเงินเดือนก่อนส่งอนุมัติ');
  tx(db, () => {
    db.prepare(`UPDATE periods SET status = 'pending', submitted_by = ?, submitted_at = ? WHERE id = ?`).run(user.name, now(), id);
    log(db, id, user, 'submit');
  });
}

// BR-12: only a processed round checked by accounting reaches the manager.
export function approvePeriod(db, id, user) {
  const p = getPeriod(db, id);
  if (p.status !== 'pending') throw new AppError(409, 'อนุมัติได้เฉพาะรอบที่อยู่ในสถานะ "รออนุมัติ"');
  tx(db, () => {
    db.prepare(`UPDATE periods SET status = 'approved', approved_by = ?, approved_at = ?, return_reason = NULL WHERE id = ?`).run(user.name, now(), id);
    log(db, id, user, 'approve');
  });
}

// BR-13: the manager can send a round back until it is paid; it must be approved again.
export function returnPeriod(db, id, reason, user) {
  const p = getPeriod(db, id);
  if (!['pending', 'approved'].includes(p.status)) throw new AppError(409, 'ส่งกลับแก้ไขได้เฉพาะรอบที่รออนุมัติหรืออนุมัติแล้วแต่ยังไม่จ่าย');
  const why = String(reason || '').trim();
  if (!why) throw new AppError(400, 'กรุณาระบุเหตุผลที่ส่งกลับแก้ไข');
  tx(db, () => {
    db.prepare(`UPDATE periods SET status = 'returned', return_reason = ?, approved_by = NULL, approved_at = NULL WHERE id = ?`).run(why, id);
    log(db, id, user, 'return', { reason: why });
  });
}

export function payPeriod(db, id, user) {
  const p = getPeriod(db, id);
  if (p.status !== 'approved') throw new AppError(409, 'ต้องรอการอนุมัติจากผู้จัดการก่อนจึงจะสามารถจ่ายเงินได้');
  tx(db, () => {
    db.prepare(`UPDATE periods SET status = 'paid', paid_by = ?, paid_at = ? WHERE id = ?`).run(user.name, now(), id);
    log(db, id, user, 'pay');
  });
}

export function periodDetail(db, id) {
  const period = getPeriod(db, id);
  const rows = db.prepare(`
    SELECT e.id AS employee_id, e.code, e.name, e.bank, e.account,
           COALESCE(l.type, e.type) AS type, COALESCE(l.rate, e.rate) AS rate,
           a.days_worked, a.absent_days, a.ot_hours,
           l.base, l.ot_pay, l.deduction, l.tax, l.net
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN lines l ON l.period_id = a.period_id AND l.employee_id = a.employee_id
    WHERE a.period_id = ?
    ORDER BY e.type DESC, e.code`).all(id);
  const audit = db.prepare(`
    SELECT a.*, e.code AS employee_code, e.name AS employee_name
    FROM audit a LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.period_id = ? ORDER BY a.id DESC`).all(id);
  return { period, rows, totals: totals(rows), audit };
}

export function totals(rows) {
  const t = { count: rows.length, monthly: 0, daily: 0, monthlyNet: 0, dailyNet: 0, ot_hours: 0, ot_pay: 0, deduction: 0, tax: 0, net: 0 };
  for (const r of rows) {
    t[r.type] += 1;
    t.ot_hours += r.ot_hours || 0;
    t.ot_pay += r.ot_pay || 0;
    t.deduction += r.deduction || 0;
    t.tax += r.tax || 0;
    t.net += r.net || 0;
    if (r.type === 'monthly') t.monthlyNet += r.net || 0; else t.dailyNet += r.net || 0;
  }
  for (const k of ['ot_pay', 'deduction', 'tax', 'net', 'monthlyNet', 'dailyNet']) t[k] = round2(t[k]);
  return t;
}

// UC-09 / BR-03: transfer file for monthly staff only (daily staff are paid in cash).
export function bankFile(db, id) {
  const p = getPeriod(db, id);
  if (!['approved', 'paid'].includes(p.status)) throw new AppError(409, 'ต้องรอการอนุมัติจากผู้จัดการก่อนจึงจะสามารถจ่ายเงินได้');
  const rows = periodDetail(db, id).rows.filter((r) => r.type === 'monthly');
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['employee_code,name,bank,account,amount'];
  for (const r of rows) lines.push([q(r.code), q(r.name), q(r.bank), q(r.account), r.net.toFixed(2)].join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function payslips(db, employeeId) {
  return db.prepare(`
    SELECT p.id AS period_id, p.year, p.month, p.round, p.status, p.paid_at,
           l.type, l.rate, l.base, l.ot_pay, l.deduction, l.tax, l.net,
           a.days_worked, a.absent_days, a.ot_hours
    FROM lines l
    JOIN periods p ON p.id = l.period_id
    JOIN attendance a ON a.period_id = l.period_id AND a.employee_id = l.employee_id
    WHERE l.employee_id = ? AND p.status IN ('approved', 'paid')
    ORDER BY p.year DESC, p.month DESC, p.round DESC`).all(employeeId);
}
