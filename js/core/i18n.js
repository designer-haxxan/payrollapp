// Translation, language direction and locale-aware formatting. English is the fallback for any missing key.
import en from '../i18n/en.js';
import ur from '../i18n/ur.js';

const DICTS = { en, ur };
let current = 'en';

export const LANGS = { en: 'English', ur: 'اردو' };
export const lang = () => current;
export const isRTL = () => current === 'ur';

export function setLang(code) {
  current = DICTS[code] ? code : 'en';
  return current;
}

// t('dash.welcome', { name: 'Ali' }) → 'Good morning, Ali'
export function t(key, vars) {
  let s = DICTS[current][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// Arrays such as month names.
export function list(key) {
  return DICTS[current][key] ?? en[key] ?? [];
}

// Updates static text in the DOM:  data-i18n="key"  and  data-i18n-attr="placeholder:key,aria-label:key".
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  });
}

// Western digits in every language (the usual format for payroll in Pakistan).
const moneyNf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalNf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const fmtMoney = (n, withCurrency = true) => {
  const s = moneyNf.format(Math.round(Number(n) || 0));
  return withCurrency ? `${t('currency')} ${s}` : s;
};
export const fmtDecimal = (n) => decimalNf.format(Number(n) || 0);
export const fmtInt = (n) => moneyNf.format(Math.round(Number(n) || 0));
export const fmtPercent = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`);

// 'YYYY-MM' → 'November 2026' / 'نومبر 2026'
export function fmtMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${list('months')[m - 1]} ${y}`;
}
export function fmtMonthShort(month) {
  const [y, m] = month.split('-').map(Number);
  return `${list('months')[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
}
// 'YYYY-MM-DD' → '5 November 2026'
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${list('months')[m - 1]} ${y}`;
}
export const weekdayName = (dow) => list('weekdays')[dow] || '';

export function greeting() {
  const h = new Date().getHours();
  return t(h < 12 ? 'greet.morning' : h < 17 ? 'greet.afternoon' : 'greet.evening');
}
