// Pure payroll rules (no DOM, no storage) so they can be checked on their own.
//
// Attendance codes per day:  P = present (1 day)   H = half day (0.5)   L = paid leave (1 day)   A = absent (0)
// Blank = not marked (not paid).
//
//   daily rate        = gross salary / pay divisor           (divisor: 30, 26 or actual days in the month)
//   earned            = daily rate × paid days               (capped at the divisor)
//   overtime          = overtime hours × hourly basic × multiplier     (hourly basic = basic / divisor / 8)
//   net pay           = earned + overtime + bonus − advance − other deduction   (rounded to whole rupees)
import { num, daysInMonth, weekdayOf } from '../core/utils.js';
import { lang } from '../core/i18n.js';

// Name in the current language (Urdu name when Urdu is selected and one was entered).
export const displayName = (emp) => (lang() === 'ur' && emp?.nameUr ? emp.nameUr : emp?.name || '');

export const CODE_VALUE = { P: 1, H: 0.5, L: 1, A: 0 };
export const CODE_CYCLE = ['', 'P', 'H', 'L', 'A'];   // click order in the sheet
export const WORKED = ['P', 'H', 'L'];                  // codes that are paid

export function payDivisor(month, settings) {
  if (settings.payDivisor === 'actual') return daysInMonth(month);
  return Number(settings.payDivisor) || 30;
}

export const grossOf = (emp) => num(emp.basic) + num(emp.houseRent) + num(emp.medical) + num(emp.transport);

// Days before the joining date are not applicable (shown greyed out, cannot be marked).
export function isDayNA(emp, month, day) {
  if (!emp.joinDate) return false;
  return `${month}-${String(day).padStart(2, '0')}` < emp.joinDate;
}

export const isSunday = (month, day) => weekdayOf(month, day) === 0;

export function countCodes(days, month) {
  const c = { P: 0, H: 0, L: 0, A: 0 };
  const n = daysInMonth(month);
  for (let d = 1; d <= n; d++) {
    const v = days?.[d];
    if (v && c[v] !== undefined) c[v]++;
  }
  return c;
}

// Full pay breakdown for one employee in one month.
export function computePay(emp, rec, month, settings) {
  const divisor = payDivisor(month, settings);
  const gross = grossOf(emp);
  const counts = countCodes(rec?.days, month);
  const present = counts.P + counts.L + counts.H * CODE_VALUE.H;
  const marked = counts.P + counts.H + counts.L + counts.A;
  const paidDays = Math.min(present, divisor);
  const earned = (gross / divisor) * paidDays;
  const hourly = num(emp.basic) / divisor / 8;
  const overtime = num(rec?.overtime) * hourly * num(settings.otMultiplier, 1.5);
  const bonus = num(rec?.bonus);
  const advance = num(rec?.advance);
  const deduction = num(rec?.deduction);
  const raw = earned + overtime + bonus - advance - deduction;
  return {
    divisor, gross, counts, present, marked,
    rate: marked ? present / marked : null,        // attendance rate (null when nothing marked yet)
    dailyRate: gross / divisor, hourly,
    earned, overtime, bonus, advance, deduction,
    net: Math.round(raw),
  };
}

// One row per employee shown in a month: active employees, plus anyone with a record that month.
export function buildRows(emps, recs, month, settings) {
  const map = new Map(recs.filter((r) => r.month === month).map((r) => [r.employeeId, r]));
  return emps
    .filter((e) => e.status === 'active' || map.has(e.id))
    .map((emp) => {
      const rec = map.get(emp.id) || null;
      return { emp, rec, pay: computePay(emp, rec, month, settings) };
    });
}

export function totalsOf(rows) {
  const t = { count: rows.length, gross: 0, earned: 0, overtime: 0, bonus: 0, advance: 0, deduction: 0, net: 0, paid: 0, unpaid: 0 };
  for (const r of rows) {
    t.gross += r.pay.gross; t.earned += r.pay.earned; t.overtime += r.pay.overtime;
    t.bonus += r.pay.bonus; t.advance += r.pay.advance; t.deduction += r.pay.deduction; t.net += r.pay.net;
    if (r.rec?.paid) t.paid++; else t.unpaid++;
  }
  return t;
}

// Average attendance across employees who have at least one marked day this month.
export function averageAttendance(rows) {
  const withRate = rows.filter((r) => r.pay.rate !== null);
  if (!withRate.length) return null;
  return withRate.reduce((s, r) => s + r.pay.rate, 0) / withRate.length;
}
