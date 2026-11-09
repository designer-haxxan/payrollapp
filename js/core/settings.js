// Settings and preferences stored in LocalStorage (never employee data or secrets).
import { storageKey } from '../config.js';
import { lang, t } from './i18n.js';

const KEY = storageKey('settings');

export const DEFAULT_SETTINGS = {
  company: { name: '', nameUr: '', address: '', phone: '' },   // empty name → the app name is shown
  // Days used to turn a monthly salary into a daily rate: 'actual' (days in the month), 26 or 30.
  payDivisor: 30,
  // Multiplier on the hourly basic rate for overtime hours.
  otMultiplier: 1.5,
  language: 'en',   // 'en' | 'ur'
  theme: 'auto',    // 'auto' | 'light' | 'dark'
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

let cache = null;
export function getSettings() {
  if (!cache) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }
    cache = merge(DEFAULT_SETTINGS, stored);
  }
  return cache;
}

export function saveSettings(patch) {
  cache = merge(getSettings(), patch);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage full or blocked: keep in memory */ }
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

// Company name in the current language (Urdu name when it exists and Urdu is selected).
export function companyName() {
  const c = getSettings().company;
  if (lang() === 'ur' && c.nameUr) return c.nameUr;
  return c.name || t('app.name');
}

export function applyTheme() {
  const t = getSettings().theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#4f46e5');
}
