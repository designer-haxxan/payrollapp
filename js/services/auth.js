// Authentication against the login API (POST {AUTH_API_BASE}/login). This is the only server call in the app.
// One account is bound server-side to one device (deviceId). After a successful online login the session
// { token, expiresAt, username } is kept in LocalStorage and the app works offline until expiresAt.
// Passwords are never stored.
import { CONFIG, storageKey } from '../config.js';
import { AppError } from '../core/utils.js';

const SESSION_KEY = storageKey('session');
// Device id identifies the PHONE (the server binds the account to it), so it is shared by all apps on this origin.
// Changing it would make the server reply device_mismatch.
const DEVICE_KEY = 'minipos.deviceId';

let current = null;

// Stable per-browser device id (sent with every login; the server binds the account to it).
export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

const toUser = (s) => ({ id: s.username, name: s.username, username: s.username });

const isValid = (s) => !!(s && typeof s.token === 'string' && s.token && typeof s.username === 'string' && Number(s.expiresAt) > Date.now());

// Returns { user } or { user:null, reason }
export function restoreSession() {
  const s = readSession();
  if (!s) return { user: null };
  if (!isValid(s)) {
    localStorage.removeItem(SESSION_KEY);
    current = null;
    return { user: null, reason: 'session_expired' };
  }
  current = toUser(s);
  return { user: current };
}

export const user = () => current;
export const expiresAt = () => Number(readSession()?.expiresAt) || 0;
export const sessionExpired = () => !!current && !isValid(readSession());

// Throws AppError with a stable `code`: missing_fields | offline | network | invalid_credentials |
// device_mismatch | account_disabled | generic. The UI translates the code.
export async function login(username, password) {
  username = String(username ?? '').trim();
  password = String(password ?? '');
  if (!username || !password) throw new AppError('Enter your username and password.', 'missing_fields');
  if (!navigator.onLine) throw new AppError('Internet connection is required to sign in.', 'offline');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res;
  try {
    res = await fetch(`${CONFIG.AUTH_API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceId: deviceId() }),
      credentials: 'omit', cache: 'no-store', signal: ctrl.signal,
    });
  } catch {
    throw new AppError('Could not reach the login server.', 'network');
  } finally { clearTimeout(timer); }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) {
    const known = ['missing_fields', 'invalid_credentials', 'device_mismatch', 'account_disabled'];
    const code = known.includes(data?.error) ? data.error : 'generic';
    throw new AppError('Login failed.', code);
  }

  const session = { token: data?.token, expiresAt: Number(data?.expiresAt), username: data?.username };
  if (!isValid(session)) throw new AppError('Login failed.', 'generic');
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  current = toUser(session);
  return current;
}

// Logout only clears the local session (the API has no logout endpoint). The device binding stays on the server.
export function logout() {
  localStorage.removeItem(SESSION_KEY);
  current = null;
}
