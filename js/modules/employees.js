// Employees: searchable card list, and the employee form (personal, job, salary, bank) with a live salary summary.
import { listEmployees, getEmployee, saveEmployee, deleteEmployee } from '../services/data.js';
import { grossOf, displayName } from '../services/payroll.js';
import { getSettings } from '../core/settings.js';
import { t, fmtMoney } from '../core/i18n.js';
import * as UI from '../core/ui.js';
import { esc, compressImage, debounce } from '../core/utils.js';

const CNIC_RE = /^\d{5}-\d{7}-\d$/;
const STATUS_PILL = { active: 'pill-active', inactive: 'pill-inactive' };

// List state survives leaving and returning to the page within this session.
const listState = { q: '', filter: 'all' };

async function render(container, { params, setTitle }) {
  if (params[0] === 'new') return renderForm(container, setTitle, null);
  if (params[0]) return renderForm(container, setTitle, decodeURIComponent(params[0]));
  return renderList(container, setTitle);
}

// ---------- List ----------
async function renderList(container, setTitle) {
  setTitle(t('emp.title'));
  const emps = await listEmployees();
  container.innerHTML = `
    ${UI.pageHeader(t('emp.title'), {
      sub: t('emp.count', { n: emps.length }),
      actions: `<a class="btn btn-grad" href="#/employees/new"><i class="bi bi-person-plus me-1"></i>${esc(t('btn.addEmployee'))}</a>`,
    })}
    <div class="toolbar">
      <div class="search"><i class="bi bi-search"></i>
        <input type="search" class="form-control" id="emp-q" autocomplete="off" placeholder="${esc(t('emp.search'))}" value="${esc(listState.q)}"></div>
      <div class="seg" id="emp-seg" role="group">
        <span class="thumb" aria-hidden="true"></span>
        ${['all', 'active', 'inactive'].map((k) => `<button type="button" data-f="${k}" class="${listState.filter === k ? 'on' : ''}" aria-pressed="${listState.filter === k}">${esc(t('emp.filter.' + k))}</button>`).join('')}
      </div>
    </div>
    <div id="emp-list"></div>`;

  const list = container.querySelector('#emp-list');

  const paint = () => {
    const q = listState.q.trim().toLowerCase();
    const items = emps.filter((e) => {
      if (listState.filter !== 'all' && e.status !== listState.filter) return false;
      if (!q) return true;
      return [e.name, e.nameUr, e.code, e.designation, e.department].some((v) => String(v || '').toLowerCase().includes(q));
    });
    if (!emps.length) {
      list.innerHTML = UI.emptyState('people', t('emp.empty'), t('emp.emptyCta'),
        `<a class="btn btn-grad" href="#/employees/new"><i class="bi bi-person-plus me-1"></i>${esc(t('btn.addEmployee'))}</a>`);
      return;
    }
    if (!items.length) { list.innerHTML = UI.emptyState('search', t('emp.empty')); return; }
    list.innerHTML = `<div class="emp-grid">${items.map((e, i) => `
      <a class="panel emp-card rise" href="#/employees/${esc(e.id)}" style="--i:${Math.min(i, 14)}">
        <div class="emp-top">
          ${UI.avatar(e.name, e.photo)}
          <div class="min-w-0 flex-grow-1">
            <div class="emp-name text-truncate">${esc(displayName(e))}</div>
            <div class="emp-meta text-truncate">${esc(e.code)}${e.designation ? ' · ' + esc(e.designation) : ''}</div>
          </div>
        </div>
        <div class="emp-foot">
          <div class="emp-gross tabular">${esc(fmtMoney(grossOf(e), true))}<small>${esc(t('emp.gross'))}</small></div>
          <span class="pill ${STATUS_PILL[e.status] || 'pill-inactive'}">${esc(t('emp.filter.' + e.status))}</span>
        </div>
      </a>`).join('')}</div>`;
  };

  const seg = container.querySelector('#emp-seg');
  const moveThumb = () => {
    const on = seg.querySelector('button.on');
    const thumb = seg.querySelector('.thumb');
    if (!on) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.left = `${on.offsetLeft}px`;
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    listState.filter = b.dataset.f;
    seg.querySelectorAll('button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    moveThumb();
    paint();
  });
  const q = container.querySelector('#emp-q');
  q.addEventListener('input', debounce(() => { listState.q = q.value; paint(); }, 120));

  paint();
  requestAnimationFrame(moveThumb);
}

// ---------- Form ----------
const field = (name, label, value, { type = 'text', attrs = '', col = 'col-md-6', hint = '' } = {}) => `
  <div class="${col}">
    <label class="form-label" for="f-${name}">${esc(label)}</label>
    <input class="form-control" id="f-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" ${attrs}>
    ${hint ? `<div class="form-text small">${esc(hint)}</div>` : ''}
    <div class="err-msg small text-danger mt-1 d-none"></div>
  </div>`;

const moneyField = (name, label, value, { required = false, col = 'col-md-6' } = {}) => `
  <div class="${col}">
    <label class="form-label" for="f-${name}">${esc(label)}${required ? ' *' : ''}</label>
    <div class="input-group">
      <span class="input-group-text">${esc(t('currency'))}</span>
      <input class="form-control money-input" id="f-${name}" name="${name}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"
        value="${value ? esc(value) : ''}" data-money="${name}" ${required ? 'required' : ''}>
    </div>
    <div class="err-msg small text-danger mt-1 d-none"></div>
  </div>`;

async function renderForm(container, setTitle, id) {
  let emp = null;
  if (id) {
    emp = await getEmployee(id);
    if (!emp) {
      setTitle(t('nav.employees'));
      container.innerHTML = `${UI.pageHeader(t('nav.employees'), { back: '#/employees' })}${UI.emptyState('person-x', t('err.employee_missing'))}`;
      return;
    }
  }
  const isNew = !emp;
  const v = emp || { status: 'active', basic: 0, houseRent: 0, medical: 0, transport: 0 };
  let photo = emp?.photo || '';
  const settings = getSettings();
  setTitle(isNew ? t('emp.new') : displayName(emp));

  container.innerHTML = `
    ${UI.pageHeader(isNew ? t('emp.new') : t('emp.edit'), { sub: isNew ? '' : emp.code, back: '#/employees' })}
    <form id="emp-form" class="form-layout" novalidate autocomplete="off">
      <div class="min-w-0">
        <section class="panel sec-card rise" style="--i:0">
          <div class="sec-title"><i class="bi bi-person-vcard"></i>${esc(t('emp.sec.personal'))}</div>
          <div class="panel-body">
            <div class="photo-pick mb-3">
              <label class="photo-frame" for="emp-photo" id="photo-frame" role="button" tabindex="0" aria-label="${esc(t('emp.photoUpload'))}">
                ${photo ? `<img src="${esc(photo)}" alt="">` : '<i class="bi bi-camera fs-3"></i>'}
              </label>
              <div class="min-w-0">
                <div class="fw-semibold mb-1">${esc(t('emp.photo'))}</div>
                <div class="d-flex flex-wrap gap-2">
                  <button type="button" class="btn btn-sm btn-outline-primary" id="photo-btn"><i class="bi bi-upload me-1"></i>${esc(t('emp.photoUpload'))}</button>
                  <button type="button" class="btn btn-sm btn-light${photo ? '' : ' d-none'}" id="photo-rm">${esc(t('emp.photoRemove'))}</button>
                </div>
                <input type="file" accept="image/*" id="emp-photo" class="d-none">
              </div>
            </div>
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label" for="f-name">${esc(t('emp.name'))} *</label>
                <input class="form-control" id="f-name" name="name" type="text" value="${esc(v.name)}" required autocomplete="off">
                <div class="err-msg small text-danger mt-1 d-none"></div>
              </div>
              ${field('nameUr', t('emp.nameUr'), v.nameUr, { attrs: 'dir="auto"' })}
              ${field('fatherName', t('emp.father'), v.fatherName)}
              ${field('cnic', t('emp.cnic'), v.cnic, { attrs: 'inputmode="numeric" maxlength="15" placeholder="00000-0000000-0"', hint: t('emp.cnicHint') })}
              ${field('phone', t('emp.phone'), v.phone, { type: 'tel', attrs: 'inputmode="tel"' })}
              <div class="col-12">
                <label class="form-label" for="f-address">${esc(t('emp.address'))}</label>
                <textarea class="form-control" id="f-address" name="address" rows="2">${esc(v.address || '')}</textarea>
              </div>
            </div>
          </div>
        </section>

        <section class="panel sec-card rise" style="--i:1">
          <div class="sec-title"><i class="bi bi-briefcase"></i>${esc(t('emp.sec.job'))}</div>
          <div class="panel-body">
            <div class="row g-3">
              <div class="col-md-6">
                <label class="form-label" for="f-code">${esc(t('emp.code'))}</label>
                <input class="form-control" id="f-code" type="text" value="${esc(isNew ? t('emp.codeAuto') : emp.code)}" readonly>
              </div>
              ${field('designation', t('emp.designation'), v.designation)}
              ${field('department', t('emp.department'), v.department)}
              ${field('joinDate', t('emp.joinDate'), v.joinDate, { type: 'date' })}
              <div class="col-md-6">
                <label class="form-label" for="f-status">${esc(t('emp.status'))}</label>
                <select class="form-select" id="f-status" name="status">
                  <option value="active" ${v.status !== 'inactive' ? 'selected' : ''}>${esc(t('emp.filter.active'))}</option>
                  <option value="inactive" ${v.status === 'inactive' ? 'selected' : ''}>${esc(t('emp.filter.inactive'))}</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section class="panel sec-card rise" style="--i:2">
          <div class="sec-title"><i class="bi bi-cash-stack"></i>${esc(t('emp.sec.salary'))}</div>
          <div class="panel-body">
            <div class="row g-3">
              ${moneyField('basic', t('emp.basic'), v.basic, { required: true, col: 'col-12' })}
              ${moneyField('houseRent', t('emp.houseRent'), v.houseRent)}
              ${moneyField('medical', t('emp.medical'), v.medical)}
              ${moneyField('transport', t('emp.transport'), v.transport)}
            </div>
          </div>
        </section>

        <section class="panel sec-card rise" style="--i:3">
          <div class="sec-title"><i class="bi bi-bank"></i>${esc(t('emp.sec.bank'))}</div>
          <div class="panel-body">
            <div class="row g-3">
              ${field('bankName', t('emp.bankName'), v.bankName)}
              ${field('accountNo', t('emp.accountNo'), v.accountNo)}
            </div>
          </div>
        </section>
      </div>

      <aside>
        <section class="panel summary-card rise" style="--i:1">
          <div class="summary-hero">
            <div id="sum-avatar">${UI.avatar(v.name || '?', photo)}</div>
            <div class="nm" id="sum-name">${esc(displayName(v) || t('emp.name'))}</div>
            <div class="ds" id="sum-desig">${esc(v.designation || '')}</div>
            <div class="summary-gross" id="sum-gross">${esc(fmtMoney(grossOf(v)))}</div>
            <div class="ds">${esc(t('emp.sumGross'))}</div>
          </div>
          <div class="panel-body">
            <div id="sum-breakdown"></div>
            <div class="small text-body-secondary mt-3" id="sum-divisor"></div>
          </div>
          <div class="panel-body pt-0 d-grid gap-2">
            <button type="submit" class="btn btn-grad" id="emp-save"><i class="bi bi-check2-circle me-1"></i>${esc(t('btn.save'))}</button>
            <a href="#/employees" class="btn btn-light">${esc(t('btn.cancel'))}</a>
            ${isNew ? '' : `<button type="button" class="btn btn-outline-danger btn-sm mt-2" id="emp-delete"><i class="bi bi-trash me-1"></i>${esc(t('emp.deleteBtn'))}</button>`}
          </div>
        </section>
      </aside>
    </form>`;

  const form = container.querySelector('#emp-form');
  const pulse = (el) => { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); };

  // Live summary: name, designation, gross and the breakdown bars.
  const refreshSummary = () => {
    const d = Object.fromEntries(new FormData(form).entries());
    const basic = Number(d.basic) || 0;
    const parts = [
      ['basic', t('emp.basic'), basic],
      ['houseRent', t('emp.houseRent'), Number(d.houseRent) || 0],
      ['medical', t('emp.medical'), Number(d.medical) || 0],
      ['transport', t('emp.transport'), Number(d.transport) || 0],
    ];
    const gross = parts.reduce((s, p) => s + p[2], 0);
    const div = settings.payDivisor === 'actual' ? null : Number(settings.payDivisor) || 30;
    const daily = div ? gross / div : null;
    const hourly = div ? basic / div / 8 : null;
    container.querySelector('#sum-name').textContent = displayName({ name: d.name, nameUr: d.nameUr }) || t('emp.name');
    container.querySelector('#sum-desig').textContent = d.designation || '';
    const grossEl = container.querySelector('#sum-gross');
    grossEl.textContent = fmtMoney(gross);
    pulse(grossEl);
    container.querySelector('#sum-breakdown').innerHTML = `
      ${parts.map(([k, label, val], i) => `
        <div class="bd-row"><span class="k">${esc(label)}</span><span class="v">${esc(fmtMoney(val))}</span>
          <div class="bd-bar"><span class="c${i + 1}" style="--w:${gross ? (val / gross) * 100 : 0}%"></span></div></div>`).join('')}
      <div class="bd-row"><span class="k">${esc(t('emp.sumDaily'))}</span><span class="v">${daily === null ? '—' : esc(fmtMoney(daily))}</span></div>
      <div class="bd-row"><span class="k">${esc(t('emp.sumHourly'))}</span><span class="v">${hourly === null ? '—' : esc(fmtMoney(hourly))}</span></div>`;
    container.querySelector('#sum-divisor').textContent = div
      ? t('emp.sumDivisor', { n: div }) : t('emp.sumDivisorActual');
    if (!basic && !gross) container.querySelector('#sum-breakdown').insertAdjacentHTML('afterbegin', `<div class="small text-body-secondary mb-2">${esc(t('emp.sumHint'))}</div>`);
  };
  refreshSummary();
  form.addEventListener('input', refreshSummary);

  // CNIC: digits only, formatted 00000-0000000-0
  const cnic = form.querySelector('#f-cnic');
  cnic.addEventListener('input', () => {
    const d = cnic.value.replace(/\D/g, '').slice(0, 13);
    cnic.value = d.length > 12 ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  });

  // Photo
  const pickPhoto = () => form.querySelector('#emp-photo').click();
  container.querySelector('#photo-btn').addEventListener('click', pickPhoto);
  container.querySelector('#photo-frame').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickPhoto(); } });
  container.querySelector('#photo-rm').addEventListener('click', () => {
    photo = '';
    container.querySelector('#photo-frame').innerHTML = '<i class="bi bi-camera fs-3"></i>';
    container.querySelector('#photo-rm').classList.add('d-none');
    container.querySelector('#sum-avatar').innerHTML = UI.avatar(form.elements.namedItem('name').value || '?', '');
  });
  form.querySelector('#emp-photo').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      photo = await compressImage(file);
      container.querySelector('#photo-frame').innerHTML = `<img src="${esc(photo)}" alt="">`;
      container.querySelector('#photo-rm').classList.remove('d-none');
      container.querySelector('#sum-avatar').innerHTML = UI.avatar(form.elements.namedItem('name').value || '?', photo);
    } catch (err) {
      UI.toast(t(file.type.startsWith('image/') ? 'err.photo_read' : 'err.photo_type'), 'danger');
    }
  });

  // Save
  const setErr = (input, msg) => {
    input.classList.toggle('is-invalid', !!msg);
    const box = input.closest('[class*="col"]')?.querySelector('.err-msg');
    if (box) { box.textContent = msg || ''; box.classList.toggle('d-none', !msg); }
    return !!msg;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let bad = false;
    const nameInput = form.elements.namedItem('name');
    bad = setErr(nameInput, nameInput.value.trim() ? '' : t('err.name_required')) || bad;
    const cv = cnic.value.trim();
    bad = setErr(cnic, cv && !CNIC_RE.test(cv) ? t('emp.cnicInvalid') : '') || bad;
    const basic = form.elements.namedItem('basic');
    bad = setErr(basic, basic.value === '' || Number(basic.value) < 0 ? t('emp.required') : '') || bad;
    for (const m of form.querySelectorAll('[data-money]')) {
      if (m === basic) continue;
      bad = setErr(m, Number(m.value) < 0 ? t('emp.required') : '') || bad;
    }
    if (bad) {
      UI.toast(t('emp.invalid'), 'warning');
      form.querySelector('.is-invalid')?.focus();
      return;
    }
    const btn = form.querySelector('#emp-save');
    btn.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      data.photo = photo;
      await saveEmployee(id, data);
      UI.toast(t('emp.saved'));
      location.hash = '#/employees';
    } catch (err) {
      UI.toastError(err);
      btn.disabled = false;
    }
  });

  container.querySelector('#emp-delete')?.addEventListener('click', async () => {
    const name = displayName(emp);
    if (!await UI.confirmDialog(t('emp.deleteConfirm', { name }), { okLabel: t('btn.delete'), danger: true })) return;
    try {
      await deleteEmployee(id);
      UI.toast(t('emp.deleted'));
      location.hash = '#/employees';
    } catch (err) { UI.toastError(err); }
  });

}

export default { render, destroy() {} };
