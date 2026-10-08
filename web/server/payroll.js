// Payroll calculation rules (pure functions, no I/O).
// Business rules referenced from the requirements document: BR-01 … BR-11.

export const OT_MULTIPLIER = 1.5;      // OT on a normal working day = 1.5x hourly rate
export const HOURS_PER_DAY = 8;
export const DAYS_PER_MONTH = 30;      // monthly salary / 30 = daily rate for deductions
export const ROUNDS_PER_YEAR = 24;     // BR-01: two rounds per month

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// BR-01: round 1 = day 1–15, round 2 = day 16–last day of month.
export function periodRange(year, month, round) {
  const last = new Date(year, month, 0).getDate();
  return round === 1 ? { start: 1, end: 15, last } : { start: 16, end: last, last };
}

// Working days in the round (Sunday is the weekly holiday).
export function workingDays(year, month, round) {
  const { start, end } = periodRange(year, month, round);
  let n = 0;
  for (let d = start; d <= end; d++) {
    if (new Date(year, month - 1, d).getDay() !== 0) n++;
  }
  return n;
}

// Thai personal income tax, progressive rates on annual net income.
const BRACKETS = [
  [150000, 0], [300000, 0.05], [500000, 0.10], [750000, 0.15],
  [1000000, 0.20], [2000000, 0.25], [5000000, 0.30], [Infinity, 0.35]
];

export function annualTax(taxable) {
  let tax = 0, floor = 0;
  for (const [ceiling, rate] of BRACKETS) {
    if (taxable <= floor) break;
    tax += (Math.min(taxable, ceiling) - floor) * rate;
    floor = ceiling;
  }
  return tax;
}

// BR-11: withholding tax per round = annualised income → progressive tax → split over 24 rounds.
// Deductions: employment expense 50% (max 100,000) and personal allowance 60,000.
export function withholdingPerRound(grossThisRound) {
  if (grossThisRound <= 0) return 0;
  const annual = grossThisRound * ROUNDS_PER_YEAR;
  const expense = Math.min(annual * 0.5, 100000);
  const taxable = Math.max(0, annual - expense - 60000);
  return round2(annualTax(taxable) / ROUNDS_PER_YEAR);
}

// One employee's pay for one round.
// emp: { type: 'monthly' | 'daily', rate }  (rate = monthly salary or daily wage)
// att: { days_worked, absent_days, ot_hours }
export function calcLine(emp, att) {
  const days = Number(att.days_worked) || 0;
  const absent = Number(att.absent_days) || 0;
  const otHours = Number(att.ot_hours) || 0;
  let base, deduction, hourly;

  if (emp.type === 'monthly') {
    base = round2(emp.rate / 2);                                   // BR-04: half salary per round
    deduction = round2((emp.rate / DAYS_PER_MONTH) * absent);      // BR-10: absence deducted
    hourly = emp.rate / DAYS_PER_MONTH / HOURS_PER_DAY;
  } else {
    base = round2(emp.rate * days);                                // BR-05: days actually worked
    deduction = 0;                                                 // BR-10: absent days are simply not paid
    hourly = emp.rate / HOURS_PER_DAY;
  }

  const otPay = round2(hourly * OT_MULTIPLIER * otHours);          // BR-08
  const gross = round2(Math.max(0, base + otPay - deduction));
  const tax = withholdingPerRound(gross);                          // BR-11
  const net = round2(gross - tax);
  return { base, ot_pay: otPay, deduction, tax, net };
}
