import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLine, withholdingPerRound, workingDays, periodRange, annualTax } from '../server/payroll.js';
import { openDb } from '../server/db.js';
import * as svc from '../server/service.js';

const accountant = { name: 'บัญชีทดสอบ' };
const manager = { name: 'ผู้จัดการทดสอบ' };

test('BR-01: round ranges', () => {
  assert.deepEqual(periodRange(2026, 10, 1), { start: 1, end: 15, last: 31 });
  assert.deepEqual(periodRange(2026, 2, 2), { start: 16, end: 28, last: 28 });
  assert.deepEqual(periodRange(2028, 2, 2), { start: 16, end: 29, last: 29 });
});

test('working days skip Sundays', () => {
  // 16–31 Oct 2026: Sundays are the 18th and 25th
  assert.equal(workingDays(2026, 10, 2), 14);
});

test('BR-04/BR-10: monthly = half salary, absence deducted at salary/30 per day', () => {
  const r = calcLine({ type: 'monthly', rate: 18000 }, { days_worked: 13, absent_days: 1, ot_hours: 0 });
  assert.equal(r.base, 9000);
  assert.equal(r.deduction, 600);
  assert.equal(r.net, 8400);
});

test('BR-05/BR-08: daily = rate × days, OT at 1.5× hourly', () => {
  const r = calcLine({ type: 'daily', rate: 450 }, { days_worked: 14, absent_days: 0, ot_hours: 6 });
  assert.equal(r.base, 6300);
  assert.equal(r.ot_pay, 506.25); // 450/8 × 1.5 × 6
  assert.equal(r.deduction, 0);
  assert.equal(r.net, 6806.25);
});

test('BR-11: progressive withholding tax', () => {
  assert.equal(annualTax(150000), 0);
  assert.equal(annualTax(300000), 7500);
  assert.equal(annualTax(400000), 17500);
  assert.equal(withholdingPerRound(12000), 0);
  // 19,000 × 24 = 456,000 − 100,000 − 60,000 = 296,000 → (296,000 − 150,000) × 5% = 7,300 / 24
  assert.equal(withholdingPerRound(19000), 304.17);
});

test('workflow: process → edit with audit → submit → return → approve → pay', () => {
  const db = openDb(':memory:');
  const id = svc.createPeriod(db, 2026, 11, 1, accountant);

  assert.throws(() => svc.submitPeriod(db, id, accountant), /ประมวลผล/);
  svc.processPeriod(db, id, accountant);

  const emp = db.prepare("SELECT id FROM employees WHERE code = 'EMP-0142'").get().id;
  assert.throws(() => svc.updateAttendance(db, id, emp, { ot_hours: 2 }, '', accountant), /เหตุผล/);
  svc.updateAttendance(db, id, emp, { ot_hours: 2 }, 'ทำ OT วันที่ 3', accountant);
  const row = svc.periodDetail(db, id).rows.find((r) => r.employee_id === emp);
  assert.equal(row.ot_pay, 168.75); // recalculated right after the edit
  assert.equal(svc.periodDetail(db, id).audit.filter((a) => a.action === 'edit').length, 1);

  assert.throws(() => svc.payPeriod(db, id, accountant), /อนุมัติ/);
  svc.submitPeriod(db, id, accountant);
  assert.throws(() => svc.updateAttendance(db, id, emp, { ot_hours: 3 }, 'x', accountant));

  svc.returnPeriod(db, id, 'OT ไม่ตรง', manager);
  assert.equal(svc.getPeriod(db, id).status, 'returned');
  svc.submitPeriod(db, id, accountant);
  svc.approvePeriod(db, id, manager);
  assert.match(svc.bankFile(db, id), /EMP-0101/);
  assert.doesNotMatch(svc.bankFile(db, id), /EMP-0142/); // daily staff are paid in cash
  svc.payPeriod(db, id, accountant);

  assert.throws(() => svc.updateAttendance(db, id, emp, { ot_hours: 3 }, 'x', accountant), /จ่ายเงินเรียบร้อยแล้ว/);
  assert.equal(svc.payslips(db, emp)[0].period_id, id);
});

test('seed data: October round 2 matches the design figures after processing', () => {
  const db = openDb(':memory:');
  const p = svc.findPeriod(db, 2026, 10, 2);
  svc.processPeriod(db, p.id, accountant);
  const t = svc.periodDetail(db, p.id).totals;
  assert.equal(t.count, 6);
  assert.equal(t.dailyNet, 18356.25);
});
