// UI helpers: toasts, modals, confirm dialogs, empty states, avatars, count-up numbers. Plain DOM + Bootstrap.
import { esc } from './utils.js';
import { t, fmtInt } from './i18n.js';
import { CONFIG } from '../config.js';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Message for an error: a translated text for known codes, otherwise the error's own message.
export function errorText(err) {
  const key = `err.${err?.code}`;
  const s = t(key, { phone: CONFIG.SUPPORT_PHONE });
  if (s !== key) return s;
  return err?.message || t('app.error');
}

export function toast(message, type = 'success', ms = 3200) {
  const icons = { success: 'check-circle-fill', danger: 'x-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0 toast-anim`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi bi-${icons[type] || icons.info} me-2"></i>${esc(message)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="${esc(t('ui.close'))}"></button></div>`;
  document.getElementById('toast-container').append(el);
  el.addEventListener('hidden.bs.toast', () => el.remove());
  new window.bootstrap.Toast(el, { delay: ms }).show();
}

export function toastError(err) {
  console.error(err);
  toast(errorText(err), 'danger', 5000);
}

// Bootstrap modal. Returns { el, close, closed (promise), bs }.
export function modal({ title, body = '', footer = '', size = '', fullscreenMobile = true, className = '' }) {
  const el = document.createElement('div');
  el.className = `modal fade ${className}`;
  el.tabIndex = -1;
  el.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? 'modal-' + size : ''} ${fullscreenMobile ? 'modal-fullscreen-sm-down' : ''}">
    <div class="modal-content">
      <div class="modal-header py-3"><h2 class="modal-title h5">${esc(title)}</h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${esc(t('ui.close'))}"></button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer py-2">${footer}</div>` : ''}
    </div></div>`;
  document.body.append(el);
  const bs = new window.bootstrap.Modal(el);
  const closed = new Promise((resolve) => el.addEventListener('hidden.bs.modal', () => { bs.dispose(); el.remove(); resolve(); }, { once: true }));
  bs.show();
  return { el, close: () => bs.hide(), closed, bs };
}

export function confirmDialog(message, { title = t('ui.confirm'), okLabel = t('btn.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      title, size: 'sm', fullscreenMobile: false,
      body: `<p class="mb-0">${esc(message)}</p>`,
      footer: `<button class="btn btn-light" data-bs-dismiss="modal">${esc(t('btn.cancel'))}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-ok">${esc(okLabel)}</button>`,
    });
    m.el.querySelector('.btn-ok').addEventListener('click', () => { ok = true; m.close(); });
    m.closed.then(() => resolve(ok));
  });
}

export function emptyState(icon, title, sub = '', action = '') {
  return `<div class="empty-state text-center">
    <div class="es-icon"><i class="bi bi-${icon}"></i></div>
    <div class="fw-semibold fs-5">${esc(title)}</div>
    ${sub ? `<div class="text-body-secondary mt-1">${esc(sub)}</div>` : ''}
    ${action ? `<div class="mt-3">${action}</div>` : ''}</div>`;
}

export function errorState(err) {
  return `<div class="alert alert-danger m-3"><i class="bi bi-exclamation-octagon me-2"></i>${esc(errorText(err))}</div>`;
}

export function skeleton() {
  return `<div class="skeleton" role="status" aria-label="${esc(t('app.loading'))}">
    <div class="skel" style="height:34px;width:38%"></div>
    <div class="d-flex gap-3 mt-3"><div class="skel flex-fill" style="height:104px"></div><div class="skel flex-fill" style="height:104px"></div><div class="skel flex-fill d-none d-md-block" style="height:104px"></div></div>
    <div class="skel mt-3" style="height:240px"></div></div>`;
}

// Coloured initials; the colour is derived from the name so it stays the same everywhere.
const TINTS = ['indigo', 'violet', 'green', 'amber', 'cyan', 'pink', 'red', 'slate'];
export function tintFor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}
export function initials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}
export function avatar(name, photo = '', cls = '') {
  if (photo) return `<img class="avatar ${cls}" src="${esc(photo)}" alt="">`;
  return `<div class="avatar tint-${tintFor(name)} ${cls}" aria-hidden="true">${esc(initials(name))}</div>`;
}

// Animates [data-count] numbers from 0 to their value. Formatting uses fmtInt; skipped for reduced motion.
export function countUp(root = document) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count) || 0;
    const suffix = el.dataset.suffix || '';
    if (reduceMotion() || !end) { el.textContent = fmtInt(end) + suffix; return; }
    const t0 = performance.now(); const dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtInt(end * e) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

let loadingCount = 0;
export function loading(on, text = t('ui.wait')) {
  loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.toggle('d-none', loadingCount === 0);
  overlay.querySelector('.loading-text').textContent = text;
}

export function pageHeader(title, { sub = '', actions = '', back = null } = {}) {
  return `<header class="page-head">
    ${back ? `<a href="${esc(back)}" class="btn btn-icon" aria-label="${esc(t('ui.back'))}"><i class="bi bi-arrow-left-short"></i></a>` : ''}
    <div class="flex-grow-1 min-w-0">
      <h1 class="page-title text-truncate">${esc(title)}</h1>
      ${sub ? `<div class="page-sub text-truncate">${esc(sub)}</div>` : ''}
    </div>
    <div class="d-flex gap-2 flex-wrap justify-content-end">${actions}</div></header>`;
}
