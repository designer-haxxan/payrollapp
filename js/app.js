// Application bootstrap: service worker, database, auth gate, navigation, language and theme.
import { CONFIG, CDN } from './config.js';
import { applyTheme, getSettings, saveSettings, companyName } from './core/settings.js';
import { t, applyI18n, setLang, lang, LANGS } from './core/i18n.js';
import * as UI from './core/ui.js';
import { esc } from './core/utils.js';
import { openDB } from './db/idb.js';
import * as Auth from './services/auth.js';

const $ = (sel, root = document) => root.querySelector(sel);

// Route table. Modules receive params (e.g. ['new'] or [employeeId] or [YYYY-MM]).
const ROUTES = {
  dashboard: { load: () => import('./modules/dashboard.js'), title: 'nav.dashboard', icon: 'speedometer2', section: 'nav.main', tab: true },
  employees: { load: () => import('./modules/employees.js'), title: 'nav.employees', icon: 'people', section: 'nav.main', tab: true },
  payroll: { load: () => import('./modules/payroll.js'), title: 'nav.payroll', icon: 'calendar2-week', section: 'nav.main', tab: true },
  settings: { load: () => import('./modules/settings.js'), title: 'nav.settings', icon: 'gear', section: 'nav.system' },
};

let currentModule = null;
let routeToken = 0;
let deferredInstall = null;
let expiryTimer = null;

function showView(name) {
  $('#splash').classList.add('d-none');
  $('#view-login').classList.toggle('d-none', name !== 'login');
  $('#view-app').classList.toggle('d-none', name !== 'app');
}

function fatal(msg) {
  $('#splash-error').textContent = msg;
  $('#splash .splash-bar')?.classList.add('d-none');
}

// ---------- Language & direction ----------
// Sets document direction, swaps Bootstrap to its RTL build and translates the static text.
function applyLanguage(code) {
  setLang(code);
  document.documentElement.lang = code;
  document.documentElement.dir = code === 'ur' ? 'rtl' : 'ltr';
  const bs = document.getElementById('bs-css');
  const want = code === 'ur' ? CDN.bootstrapRtl : CDN.bootstrapLtr;
  if (bs && bs.getAttribute('href') !== want) bs.setAttribute('href', want);
  applyI18n(document);
  const other = code === 'ur' ? 'en' : 'ur';
  document.querySelectorAll('.lang-toggle').forEach((b) => {
    b.textContent = LANGS[other];
    b.setAttribute('aria-label', other === 'ur' ? 'اردو' : 'English');
    b.dataset.lang = other;
  });
  document.title = `${companyName()} · ${t('app.name')}`;
}

// ---------- Service worker & install ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('service-worker.js').then((reg) => {
    const check = () => {
      if (!navigator.onLine) return;
      reg.update().catch(() => {});
      (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'ENSURE_CACHE' });
    };
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch((e) => console.warn('Service worker registration failed:', e));
  // Reload when an update replaces an existing worker so the page never mixes files from two versions.
  let controlled = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled && !reloading) { reloading = true; location.reload(); }
    controlled = true;
  });
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#install-btn').classList.remove('d-none'); });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('#install-btn').classList.add('d-none'); UI.toast(t('app.installed')); });
async function promptInstall() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null; $('#install-btn').classList.add('d-none');
}

// ---------- Connection badge ----------
function renderConn(status) {
  const online = status === 'online';
  const badge = $('#conn-badge');
  badge.className = `badge rounded-pill conn-${status}`;
  badge.innerHTML = `<i class="bi bi-${online ? 'wifi' : 'wifi-off'}"></i> <span>${esc(t(online ? 'ui.online' : 'ui.offline'))}</span>`;
  $('#login-conn').innerHTML = online
    ? `<i class="bi bi-wifi text-success"></i> ${esc(t('login.online'))}`
    : `<i class="bi bi-wifi-off text-danger"></i> ${esc(t('login.offlineSignin'))}`;
}
window.addEventListener('online', () => renderConn('online'));
window.addEventListener('offline', () => renderConn('offline'));

// ---------- Navigation ----------
function navHtml(activeName = '') {
  let html = ''; let section = '';
  for (const [name, r] of Object.entries(ROUTES)) {
    if (r.section !== section) { section = r.section; html += `<div class="nav-section">${esc(t(section))}</div>`; }
    html += `<a class="nav-link${name === activeName ? ' active' : ''}" href="#/${name}" data-route="${name}"><i class="bi bi-${r.icon}"></i><span>${esc(t(r.title))}</span></a>`;
  }
  return html;
}

function buildMenu(activeName = currentRouteName()) {
  const html = navHtml(activeName);
  document.querySelectorAll('.nav-menu').forEach((n) => { n.innerHTML = html; });
  const u = Auth.user();
  if (u) {
    $('#user-name').textContent = u.name;
    $('#user-role').textContent = t('set.account');
    $('#user-avatar').textContent = UI.initials(u.name);
  }
  $('#brand-name').textContent = companyName();
  $('#brand-sub').textContent = t('app.tagline');
}

function currentRouteName() {
  const first = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
  return ROUTES[first] ? first : 'dashboard';
}

function markActive(name) {
  document.querySelectorAll('.nav-link, #bottom-nav a[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
}

async function route() {
  if (!Auth.user()) return;
  if (checkExpiry()) return;
  const token = ++routeToken;
  const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const name = ROUTES[parts[0]] ? parts[0] : 'dashboard';
  const r = ROUTES[name];
  try { currentModule?.destroy?.(); } catch (e) { console.warn(e); }
  currentModule = null;
  bootstrap.Offcanvas.getInstance('#menu-offcanvas')?.hide();
  markActive(name);
  const content = $('#content');
  const setTitle = (s) => { $('#topbar-title').textContent = s; };
  setTitle(t(r.title));
  content.innerHTML = UI.skeleton();
  content.classList.remove('page-enter');
  try {
    const mod = (await r.load()).default;
    if (token !== routeToken) return;
    currentModule = mod;
    window.scrollTo(0, 0);
    await mod.render(content, { params: parts.slice(1), setTitle });
    if (token === routeToken) { void content.offsetWidth; content.classList.add('page-enter'); }
  } catch (e) {
    console.error(e);
    if (token === routeToken) content.innerHTML = UI.errorState(e);
  }
}

// ---------- Auth gate ----------
async function startApp() {
  buildMenu();
  showView('app');
  renderConn(navigator.onLine ? 'online' : 'offline');
  clearInterval(expiryTimer);
  expiryTimer = setInterval(checkExpiry, 60000);
  if (navigator.storage?.persist) navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist().catch(() => {}); });
  route();
}

async function doLogout(forced = false, reason = '') {
  if (!forced && !await UI.confirmDialog(t('set.logoutConfirm'), { okLabel: t('btn.logout'), danger: true })) return;
  clearInterval(expiryTimer);
  try { currentModule?.destroy?.(); } catch { /* ignore */ }
  currentModule = null;
  Auth.logout();
  $('#content').innerHTML = '';
  showLogin(reason);
}

// Sessions are valid until expiresAt (set by the server); after that an online sign-in is required.
function checkExpiry() {
  if (!Auth.sessionExpired()) return false;
  UI.toast(t('app.sessionExpiredToast'), 'warning', 6000);
  doLogout(true, t('app.sessionExpired'));
  return true;
}

function showLogin(reason = '') {
  showView('login');
  renderConn(navigator.onLine ? 'online' : 'offline');
  const notice = $('#login-notice');
  notice.textContent = reason;
  notice.classList.toggle('d-none', !reason);
  setTimeout(() => $('#login-username').focus(), 50);
}

// ---------- Event wiring ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span><span>${esc(t('login.signingIn'))}</span>`;
  $('#login-error').classList.add('d-none');
  try {
    await Auth.login($('#login-username').value, $('#login-password').value);
    $('#login-password').value = '';
    await startApp();
  } catch (err) {
    const box = $('#login-error');
    box.textContent = UI.errorText(err);
    box.classList.remove('d-none');
    const card = $('.auth-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>${esc(t('login.submit'))}</span><i class="bi bi-arrow-right"></i>`;
  }
});

$('#toggle-pw').addEventListener('click', () => {
  const input = $('#login-password');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const b = $('#toggle-pw');
  b.querySelector('i').className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
  b.setAttribute('aria-label', t(show ? 'login.hidePw' : 'login.showPw'));
});

// Language buttons (login screen, top bar): saving the setting triggers the settings:changed handler below.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.lang-toggle');
  if (b) saveSettings({ language: b.dataset.lang });
});

$('#logout-btn').addEventListener('click', () => doLogout(false));
document.addEventListener('app:logout', () => doLogout(false));
$('#install-btn').addEventListener('click', promptInstall);
window.addEventListener('hashchange', route);

document.addEventListener('settings:changed', () => {
  applyTheme();
  const code = getSettings().language;
  const changed = code !== lang();
  if (changed) applyLanguage(code);
  if (Auth.user()) {
    buildMenu(currentRouteName());
    if (changed) route();   // re-render the open page in the new language
  } else {
    renderConn(navigator.onLine ? 'online' : 'offline');   // login screen: translate dynamic text too
    if (changed) $('#login-notice').textContent = '';
  }
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- Boot ----------
(async function boot() {
  applyLanguage(getSettings().language);
  applyTheme();
  registerSW();
  if (!window.bootstrap) return fatal(t('app.libsError'));
  try { await openDB(); } catch (e) { return fatal(t('app.dbError', { msg: e.message || String(e) })); }
  const { user, reason } = Auth.restoreSession();
  if (user) {
    try { await startApp(); } catch (e) { console.error(e); fatal(UI.errorText(e)); }
  } else {
    showLogin(reason ? t('app.sessionExpired') : '');
  }
})();
