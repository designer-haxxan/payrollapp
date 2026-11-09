// Settings: company details, pay rules, language and theme, local backup/restore and sign-out.
import { getSettings, saveSettings, companyName } from '../core/settings.js';
import { t, lang } from '../core/i18n.js';
import * as UI from '../core/ui.js';
import { esc, downloadFile, currentMonth } from '../core/utils.js';
import { exportBackup, validateBackup, restoreBackup } from '../services/data.js';
import * as Auth from '../services/auth.js';
import { CONFIG } from '../config.js';

async function render(container, { setTitle }) {
  setTitle(t('set.title'));
  const s = getSettings();
  const c = s.company;
  const u = Auth.user();

  const row = (title, desc, control) => `<div class="setting-row"><div class="txt"><div class="t">${esc(title)}</div>${desc ? `<div class="d">${esc(desc)}</div>` : ''}</div>${control}</div>`;

  container.innerHTML = `
    ${UI.pageHeader(t('set.title'))}
    <div class="row g-3">
      <div class="col-12 col-xl-7">
        <section class="panel mb-3 rise" style="--i:0">
          <div class="sec-title"><i class="bi bi-building"></i>${esc(t('set.company'))}</div>
          <form id="co-form" class="panel-body">
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label" for="co-name">${esc(t('set.companyName'))}</label>
                <input class="form-control" id="co-name" name="name" value="${esc(c.name)}" maxlength="120"></div>
              <div class="col-md-6"><label class="form-label" for="co-nameUr">${esc(t('set.companyNameUr'))}</label>
                <input class="form-control" id="co-nameUr" name="nameUr" value="${esc(c.nameUr || '')}" maxlength="120" dir="auto"></div>
              <div class="col-md-8"><label class="form-label" for="co-address">${esc(t('set.address'))}</label>
                <input class="form-control" id="co-address" name="address" value="${esc(c.address || '')}" maxlength="200"></div>
              <div class="col-md-4"><label class="form-label" for="co-phone">${esc(t('set.phone'))}</label>
                <input class="form-control" id="co-phone" name="phone" value="${esc(c.phone || '')}" maxlength="30" type="tel"></div>
              <div class="col-12 text-end"><button class="btn btn-grad" type="submit"><i class="bi bi-check2 me-1"></i>${esc(t('set.saveCompany'))}</button></div>
            </div>
          </form>
        </section>

        <section class="panel mb-3 rise" style="--i:1">
          <div class="sec-title"><i class="bi bi-calculator"></i>${esc(t('set.rules'))}</div>
          <form id="rules-form" class="panel-body">
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label" for="rule-div">${esc(t('set.divisor'))}</label>
                <select class="form-select" id="rule-div" name="payDivisor">
                  <option value="30" ${String(s.payDivisor) === '30' ? 'selected' : ''}>${esc(t('set.div30'))}</option>
                  <option value="26" ${String(s.payDivisor) === '26' ? 'selected' : ''}>${esc(t('set.div26'))}</option>
                  <option value="actual" ${s.payDivisor === 'actual' ? 'selected' : ''}>${esc(t('set.divActual'))}</option>
                </select>
                <div class="form-text">${esc(t('set.divisorHint'))}</div></div>
              <div class="col-md-6"><label class="form-label" for="rule-ot">${esc(t('set.ot'))}</label>
                <input class="form-control" id="rule-ot" name="otMultiplier" type="number" min="1" max="5" step="0.25" value="${esc(s.otMultiplier)}">
                <div class="form-text">${esc(t('set.otHint'))}</div></div>
              <div class="col-12 text-end"><button class="btn btn-grad" type="submit"><i class="bi bi-check2 me-1"></i>${esc(t('btn.save'))}</button></div>
            </div>
          </form>
        </section>

        <section class="panel mb-3 rise" style="--i:2">
          <div class="sec-title"><i class="bi bi-shield-check"></i>${esc(t('set.data'))}</div>
          <div class="panel-body">
            <p class="text-body-secondary small mb-3">${esc(t('set.dataHint'))}</p>
            <div class="d-flex flex-wrap gap-2">
              <button class="btn btn-outline-primary" id="btn-export"><i class="bi bi-cloud-arrow-down me-1"></i>${esc(t('set.export'))}</button>
              <button class="btn btn-outline-primary" id="btn-import"><i class="bi bi-cloud-arrow-up me-1"></i>${esc(t('set.import'))}</button>
              <input type="file" accept="application/json,.json" id="import-file" class="d-none">
            </div>
          </div>
        </section>
      </div>

      <div class="col-12 col-xl-5">
        <section class="panel mb-3 rise" style="--i:1">
          <div class="sec-title"><i class="bi bi-translate"></i>${esc(t('set.appearance'))}</div>
          <div class="panel-body">
            ${row(t('set.language'), '', `<div class="seg-lang" role="group" aria-label="${esc(t('set.language'))}">
              <button type="button" data-lang="en" class="${lang() === 'en' ? 'on' : ''}">English</button>
              <button type="button" data-lang="ur" class="${lang() === 'ur' ? 'on' : ''}">اردو</button></div>`)}
            ${row(t('set.theme'), '', `<select class="form-select" id="theme-sel" style="width:auto;min-width:150px">
              ${['auto', 'light', 'dark'].map((k) => `<option value="${k}" ${s.theme === k ? 'selected' : ''}>${esc(t('set.theme.' + k))}</option>`).join('')}
            </select>`)}
          </div>
        </section>

        <section class="panel mb-3 rise" style="--i:3">
          <div class="sec-title"><i class="bi bi-person-circle"></i>${esc(t('set.account'))}</div>
          <div class="panel-body">
            <p class="mb-3">${esc(t('set.signedIn', { name: u?.name || '' }))}</p>
            <button class="btn btn-outline-danger w-100" id="btn-logout"><i class="bi bi-box-arrow-right me-1"></i>${esc(t('btn.logout'))}</button>
            <div class="text-center text-body-secondary small mt-3">${esc(t('set.version', { v: CONFIG.APP_VERSION }))} · ${esc(companyName())}</div>
          </div>
        </section>
      </div>
    </div>`;

  // Company
  container.querySelector('#co-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    saveSettings({ company: { name: f.name.trim(), nameUr: f.nameUr.trim(), address: f.address.trim(), phone: f.phone.trim() } });
    UI.toast(t('set.saved'));
  });

  // Rules
  container.querySelector('#rules-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const ot = Math.min(5, Math.max(1, Number(f.otMultiplier) || 1.5));
    saveSettings({ payDivisor: f.payDivisor === 'actual' ? 'actual' : Number(f.payDivisor), otMultiplier: ot });
    UI.toast(t('set.saved'));
  });

  // Language (applies immediately through the settings:changed handler in app.js)
  container.querySelectorAll('.seg-lang [data-lang]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.lang !== lang()) saveSettings({ language: b.dataset.lang });
  }));
  container.querySelector('#theme-sel').addEventListener('change', (e) => saveSettings({ theme: e.target.value }));

  // Backup
  container.querySelector('#btn-export').addEventListener('click', async () => {
    try {
      const obj = await exportBackup(getSettings());
      const stamp = currentMonth();
      downloadFile(`payroll-backup-${stamp}.json`, JSON.stringify(obj, null, 2), 'application/json');
      UI.toast(t('set.saved'));
    } catch (err) { UI.toastError(err); }
  });
  const file = container.querySelector('#import-file');
  container.querySelector('#btn-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = validateBackup(JSON.parse(await f.text()));
      if (!await UI.confirmDialog(t('set.importConfirm'), { okLabel: t('set.import'), danger: true })) return;
      const res = await restoreBackup(data);
      UI.toast(t('set.importDone', { e: res.employees, p: res.payroll }));
      location.hash = '#/employees';
    } catch (err) {
      if (err instanceof SyntaxError) UI.toast(t('err.backup_damaged'), 'danger');
      else UI.toastError(err);
    }
  });

  // Account
  container.querySelector('#btn-logout').addEventListener('click', () => document.dispatchEvent(new CustomEvent('app:logout')));
}

export default { render, destroy() {} };
