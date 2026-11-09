// Payroll sheet: an Excel-style grid. Employees are rows, days of the month are columns.
// Each day holds an attendance code (P / H / L / A). Overtime, bonus, advance and other deduction are typed in
// their own columns. Net pay and totals update live, and every change is saved to this device straight away.
import { listEmployees, getMonthRecords, updateRecord, fillPresent } from '../services/data.js';
import {
  CODE_CYCLE, CODE_VALUE, buildRows, computePay, totalsOf, averageAttendance, isDayNA, displayName, countCodes,
} from '../services/payroll.js';
import { getSettings, companyName } from '../core/settings.js';
import { t, lang, fmtMoney, fmtInt, fmtDecimal, fmtPercent, fmtMonth, fmtDate, list } from '../core/i18n.js';
import * as UI from '../core/ui.js';
import { esc, currentMonth, addMonths, daysInMonth, weekdayOf, today, toCSV, downloadFile } from '../core/utils.js';

const MONTH_RE = /^\d{4}-\d{2}$/;
const CODE_CLASS = { P: 'code-P', H: 'code-H', L: 'code-L', A: 'code-A' };

// The open sheet. Replaced every time the page renders; `saves` holds pending autosaves.
let view = null;

async function render(container, { params, setTitle }) {
  const month = MONTH_RE.test(params[0] || '') ? params[0] : currentMonth();
  setTitle(t('pay.title'));
  const settings = getSettings();
  const emps = await listEmployees();
  const recs = await getMonthRecords(month);
  const rows = buildRows(emps, recs, month, settings).map((row) => ({ ...row, rec: row.rec ? clone(row.rec) : null }));

  view = {
    container, month, settings, rows, dept: '',
    days: daysInMonth(month), saves: new Map(), inflight: 0,
  };
  // Monthly totals and day-by-day counts are recalculated after every change.
  paintPage(container);
  document.title = `${companyName()} · ${fmtMonth(month)}`;
}

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function destroy() {
  if (!view) return;
  // Save anything still waiting in the debounce queue before leaving the page.
  for (const [empId, timer] of view.saves) { clearTimeout(timer); persist(empId); }
  view.saves.clear();
  view = null;
}

// ---------- Page ----------
function paintPage(container) {
  const { month, rows, days } = view;
  const depts = [...new Set(rows.map((r) => r.emp.department).filter(Boolean))].sort();
  const monthLabel = fmtMonth(month);

  container.innerHTML = `
    ${UI.pageHeader(t('pay.title'), { sub: monthLabel })}
    <div class="sheet-tools">
      <div class="left">
        <div class="month-nav">
          <button type="button" class="btn-icon" data-act="prev" aria-label="${esc(t('pay.prev'))}"><i class="bi bi-chevron-left"></i></button>
          <label class="mname" title="${esc(t('pay.title'))}">
            <span class="swap">${esc(monthLabel)}</span>
            <input type="month" value="${esc(month)}" aria-label="${esc(t('pay.title'))}" id="pay-month">
          </label>
          <button type="button" class="btn-icon" data-act="next" aria-label="${esc(t('pay.next'))}"><i class="bi bi-chevron-right"></i></button>
        </div>
        ${depts.length ? `<select class="form-select" id="pay-dept" aria-label="${esc(t('pay.dept'))}" style="width:auto;min-width:190px;border-radius:14px">
          <option value="">${esc(t('pay.allDepts'))}</option>
          ${depts.map((d) => `<option value="${esc(d)}" ${view.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select>` : ''}
      </div>
      <div class="left">
        <span class="save-state" id="save-state" aria-live="polite"><span class="dot"></span><span>${esc(t('ui.saved'))}</span></span>
        <button type="button" class="btn btn-light btn-sm" data-act="fill"><i class="bi bi-check2-all me-1"></i>${esc(t('pay.fill'))}</button>
        <button type="button" class="btn btn-light btn-sm" data-act="summary"><i class="bi bi-printer me-1"></i>${esc(t('pay.summary'))}</button>
        <button type="button" class="btn btn-light btn-sm" data-act="csv"><i class="bi bi-filetype-csv me-1"></i>${esc(t('btn.csv'))}</button>
      </div>
    </div>
    <div class="kpi-strip" id="kpi-strip">${kpiTiles()}</div>
    <div class="legend mb-2" aria-label="${esc(t('pay.legend'))}">
      ${['P', 'H', 'L', 'A'].map((c) => `<span class="lg ${CODE_CLASS[c]}"><b>${c}</b>${esc(t('code.' + c))}</span>`).join('')}
    </div>
    <p class="hint">${esc(t('pay.hint'))}</p>
    <div class="sheet-wrap" id="sheet-wrap" dir="ltr"></div>`;

  const wrap = container.querySelector('#sheet-wrap');
  if (!rows.length) {
    wrap.innerHTML = UI.emptyState('calendar2-x', t('pay.empty'), '',
      `<a class="btn btn-grad" href="#/employees/new"><i class="bi bi-person-plus me-1"></i>${esc(t('btn.addEmployee'))}</a>`);
    container.querySelector('#kpi-strip').innerHTML = '';
    return;
  }
  wrap.innerHTML = `<table class="sheet" id="sheet">${sheetHead(days, month)}<tbody id="sheet-body"></tbody><tfoot id="sheet-foot"></tfoot></table>`;
  paintBody(container);
  refreshTotals(container);

  // ---- events (delegated; they are removed together with this page) ----
  wrap.addEventListener('click', onClick);
  wrap.addEventListener('keydown', onKeydown);
  wrap.addEventListener('input', onInput);
  wrap.addEventListener('focusin', (e) => { const td = e.target.closest('td.day'); if (td) markActive(td); });

  container.querySelector('[data-act=prev]').addEventListener('click', () => go(addMonths(view.month, -1)));
  container.querySelector('[data-act=next]').addEventListener('click', () => go(addMonths(view.month, 1)));
  container.querySelector('#pay-month').addEventListener('change', (e) => { if (MONTH_RE.test(e.target.value)) go(e.target.value); });
  container.querySelector('#pay-dept')?.addEventListener('change', (e) => { view.dept = e.target.value; paintBody(container); refreshTotals(container); });
  container.querySelector('[data-act=fill]').addEventListener('click', () => fillBlanks(container));
  container.querySelector('[data-act=summary]').addEventListener('click', () => openSummary());
  container.querySelector('[data-act=csv]').addEventListener('click', exportCsv);

}

const go = (m) => { location.hash = `#/payroll/${m}`; };

// KPI tiles are created once per page; refreshTotals only updates their values (no re-animation on each keystroke).
function kpiTiles() {
  return [
    ['count', 'people-fill', 'g1', t('pay.kpi.employees')],
    ['net', 'cash-coin', 'g2', t('pay.kpi.net')],
    ['paid', 'check2-circle', 'g3', t('pay.kpi.paid')],
    ['att', 'graph-up-arrow', 'g4', t('pay.kpi.attendance')],
  ].map(([k, ico, cls, label], i) => `<div class="panel kpi rise" style="--i:${i}">
      <div class="kpi-ico ${cls}" style="width:34px;height:34px;font-size:1rem"><i class="bi bi-${ico}"></i></div>
      <div class="label">${esc(label)}</div><div class="value" data-k="${k}"></div></div>`).join('');
}

function sheetHead(days, month) {
  const dayHeads = [];
  for (let d = 1; d <= days; d++) {
    const sun = weekdayOf(month, d) === 0;
    dayHeads.push(`<th class="day-h${sun ? ' sunday' : ''}" title="${esc(fmtDate(`${month}-${String(d).padStart(2, '0')}`))} · ${esc(list('weekdays')[weekdayOf(month, d)])}" style="min-width:40px">${d}</th>`);
  }
  return `<thead><tr>
    <th class="sticky-col grp" style="text-align:start;min-width:236px">${esc(t('pay.col.employee'))}</th>
    ${dayHeads.join('')}
    <th class="grp" style="min-width:90px">${esc(t('pay.col.paidDays'))}</th>
    <th class="grp" style="min-width:110px">${esc(t('pay.col.earned'))}</th>
    <th class="grp" style="min-width:110px">${esc(t('pay.col.ot'))}</th>
    <th class="grp" style="min-width:110px">${esc(t('pay.col.bonus'))}</th>
    <th class="grp" style="min-width:110px">${esc(t('pay.col.advance'))}</th>
    <th class="grp" style="min-width:120px">${esc(t('pay.col.deduction'))}</th>
    <th class="grp" style="min-width:120px">${esc(t('pay.col.net'))}</th>
    <th class="grp" style="min-width:110px">${esc(t('pay.col.status'))}</th>
    <th class="grp" style="min-width:60px">${esc(t('pay.col.slip'))}</th>
  </tr></thead>`;
}

function visibleRows() {
  return view.rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => !view.dept || row.emp.department === view.dept);
}

function paintBody(container) {
  const body = container.querySelector('#sheet-body');
  const { month, days } = view;
  body.innerHTML = visibleRows().map(({ row, idx }, i) => {
    const e = row.emp;
    const name = displayName(e) || e.name;
    const cells = [];
    for (let d = 1; d <= days; d++) cells.push(dayCell(row, d, month));
    const rec = row.rec || {};
    const p = row.pay;
    return `<tr data-idx="${idx}" class="rise-row" style="animation-delay:${Math.min(i, 20) * 22}ms">
      <td class="sticky-col emp-cell">
        <div class="who">${UI.avatar(e.name, e.photo)}
          <div class="min-w-0"><div class="nm" dir="auto">${esc(name)}</div>
          <div class="ds">${esc(e.code)}${e.designation ? ' · ' + esc(e.designation) : ''}</div></div></div>
      </td>
      ${cells.join('')}
      <td class="num days-count" data-calc="paid">${esc(fmtDecimal(p.present))}</td>
      <td class="num" data-calc="earned">${esc(fmtInt(p.earned))}</td>
      <td><input class="cell-input" type="number" min="0" step="0.5" inputmode="decimal" aria-label="${esc(t('pay.col.ot'))}" data-f="overtime" value="${rec.overtime ? esc(rec.overtime) : ''}" placeholder="0"></td>
      <td><input class="cell-input" type="number" min="0" step="1" inputmode="decimal" aria-label="${esc(t('pay.col.bonus'))}" data-f="bonus" value="${rec.bonus ? esc(rec.bonus) : ''}" placeholder="0"></td>
      <td><input class="cell-input" type="number" min="0" step="1" inputmode="decimal" aria-label="${esc(t('pay.col.advance'))}" data-f="advance" value="${rec.advance ? esc(rec.advance) : ''}" placeholder="0"></td>
      <td><input class="cell-input" type="number" min="0" step="1" inputmode="decimal" aria-label="${esc(t('pay.col.deduction'))}" data-f="deduction" value="${rec.deduction ? esc(rec.deduction) : ''}" placeholder="0"></td>
      <td class="num net" data-calc="net">${esc(fmtInt(p.net))}</td>
      <td class="text-center"><button type="button" class="paybtn ${row.rec?.paid ? 'is-paid' : ''}" data-act="paid" aria-pressed="${!!row.rec?.paid}">${esc(row.rec?.paid ? '✓ ' + t('pay.paid') : t('pay.markPaid'))}</button></td>
      <td class="text-center"><button type="button" class="slipbtn" data-act="slip" aria-label="${esc(t('pay.slip'))}"><i class="bi bi-receipt"></i></button></td>
    </tr>`;
  }).join('');
}

function dayCell(row, d, month) {
  const na = isDayNA(row.emp, month, d);
  const code = row.rec?.days?.[d] || '';
  const sun = weekdayOf(month, d) === 0;
  const label = na ? t('code.na') : code ? t('code.' + code) : t('code.blank');
  const title = `${list('weekdays')[weekdayOf(month, d)]} ${d}: ${label}`;
  return `<td class="day${sun ? ' sunday' : ''}${na ? ' na' : ''}${code ? ' ' + CODE_CLASS[code] : ' blank'}" data-day="${d}" tabindex="${na ? -1 : 0}"
    role="gridcell" aria-label="${esc(title)}" title="${esc(title)}">${na ? '' : esc(code || '·')}</td>`;
}

// ---------- Interactions ----------
function onClick(e) {
  const td = e.target.closest('td.day');
  if (td) {
    if (td.classList.contains('na')) { td.focus(); return; }
    const tr = td.parentElement;
    const row = view.rows[+tr.dataset.idx];
    const cur = row.rec?.days?.[+td.dataset.day] || '';
    const next = CODE_CYCLE[(CODE_CYCLE.indexOf(cur) + 1) % CODE_CYCLE.length];
    setCode(row, +td.dataset.day, next);
    td.focus();
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr[data-idx]');
  if (!tr) return;
  const row = view.rows[+tr.dataset.idx];
  if (btn.dataset.act === 'paid') togglePaid(row, btn);
  if (btn.dataset.act === 'slip') openPayslip(row);
}

function onKeydown(e) {
  const td = e.target.closest('td.day');
  if (!td) return;
  const tr = td.parentElement;
  const row = view.rows[+tr.dataset.idx];
  const d = +td.dataset.day;
  const k = e.key;
  const codeKey = { p: 'P', h: 'H', l: 'L', a: 'A' }[k.toLowerCase()];
  let target = null;

  if (codeKey) {
    e.preventDefault();
    setCode(row, d, codeKey);
    target = td.nextElementSibling?.dataset?.day ? td.nextElementSibling : null;
  } else if (k === 'Backspace' || k === 'Delete') {
    e.preventDefault();
    setCode(row, d, '');
  } else if (k === 'ArrowRight') {
    e.preventDefault(); target = td.nextElementSibling;
  } else if (k === 'ArrowLeft') {
    e.preventDefault(); target = td.previousElementSibling;
  } else if (k === 'ArrowDown' || k === 'Enter') {
    e.preventDefault(); target = tr.nextElementSibling?.querySelector(`td[data-day="${d}"]`);
  } else if (k === 'ArrowUp') {
    e.preventDefault(); target = tr.previousElementSibling?.querySelector(`td[data-day="${d}"]`);
  }
  if (target && target.dataset?.day) target.focus();
}

// Typing in the money columns: update totals immediately, save shortly after.
function onInput(e) {
  const input = e.target.closest('input[data-f]');
  if (!input) return;
  const tr = input.closest('tr[data-idx]');
  const row = view.rows[+tr.dataset.idx];
  const field = input.dataset.f;
  const value = input.value === '' ? 0 : Math.max(0, Number(input.value) || 0);
  if (!row.rec) row.rec = newRecord(row.emp.id);
  row.rec[field] = field === 'overtime' ? Math.round(value * 2) / 2 : Math.round(value);
  recalcRow(row, tr);
  refreshTotals(view.container);
  queueSave(row);
}

function newRecord(employeeId) {
  return { id: `${employeeId}|${view.month}`, employeeId, month: view.month, days: {}, overtime: 0, bonus: 0, advance: 0, deduction: 0, paid: false, paidOn: '', note: '' };
}

function setCode(row, d, code) {
  if (isDayNA(row.emp, view.month, d)) return;
  if (!row.rec) row.rec = newRecord(row.emp.id);
  if (code) row.rec.days[d] = code; else delete row.rec.days[d];
  const tr = view.container.querySelector(`#sheet-body tr[data-idx="${view.rows.indexOf(row)}"]`);
  if (tr) {
    const td = tr.querySelector(`td[data-day="${d}"]`);
    if (td) paintDay(td, row, d, code, true);
    recalcRow(row, tr);
  }
  refreshTotals(view.container);
  queueSave(row);
}

function paintDay(td, row, d, code, pop = false) {
  const sun = weekdayOf(view.month, d) === 0;
  td.className = `day${sun ? ' sunday' : ''}${code ? ' ' + CODE_CLASS[code] : ' blank'}`;
  td.textContent = code || '·';
  const label = code ? t('code.' + code) : t('code.blank');
  const title = `${list('weekdays')[weekdayOf(view.month, d)]} ${d}: ${label}`;
  td.setAttribute('aria-label', title); td.title = title;
  if (pop) { td.classList.remove('pop'); void td.offsetWidth; td.classList.add('pop'); }
}

function markActive(td) {
  view.container.querySelectorAll('td.day.is-active').forEach((x) => x.classList.remove('is-active'));
  td.classList.add('is-active');
}

function recalcRow(row, tr) {
  row.pay = computePay(row.emp, row.rec, view.month, view.settings);
  const set = (k, text) => { const el = tr.querySelector(`[data-calc="${k}"]`); if (el) el.textContent = text; };
  set('paid', fmtDecimal(row.pay.present));
  set('earned', fmtInt(row.pay.earned));
  const net = tr.querySelector('[data-calc="net"]');
  if (net) {
    net.textContent = fmtInt(row.pay.net);
    net.classList.remove('flash'); void net.offsetWidth; net.classList.add('flash');
  }
}

function togglePaid(row, btn) {
  if (!row.rec) row.rec = newRecord(row.emp.id);
  row.rec.paid = !row.rec.paid;
  row.rec.paidOn = row.rec.paid ? today() : '';
  btn.classList.toggle('is-paid', row.rec.paid);
  btn.setAttribute('aria-pressed', row.rec.paid);
  btn.textContent = row.rec.paid ? `✓ ${t('pay.paid')}` : t('pay.markPaid');
  refreshTotals(view.container);
  queueSave(row, 0);
}

// ---------- Totals & KPIs ----------
function refreshTotals(container) {
  const shown = visibleRows().map(({ row }) => row);
  const tot = totalsOf(shown);
  const foot = container.querySelector('#sheet-foot');
  if (foot) {
    const { days } = view;
    const dayCells = [];
    for (let d = 1; d <= days; d++) {
      let sum = 0;
      for (const row of shown) {
        const c = row.rec?.days?.[d];
        if (c && CODE_VALUE[c] !== undefined) sum += CODE_VALUE[c];
      }
      dayCells.push(`<td class="foot-day${sum ? '' : ' zero'}" data-fday="${d}">${sum ? esc(fmtDecimal(sum)) : '–'}</td>`);
    }
    foot.innerHTML = `<tr>
      <td class="sticky-col" style="text-align:start">${esc(t('pay.total'))} (${shown.length})</td>
      ${dayCells.join('')}
      <td class="num days-count">${esc(fmtDecimal(shown.reduce((s, r) => s + r.pay.present, 0)))}</td>
      <td class="num">${esc(fmtInt(tot.earned))}</td>
      <td class="num">${esc(fmtDecimal(shown.reduce((s, r) => s + (num(r.rec?.overtime)), 0)))}</td>
      <td class="num">${esc(fmtInt(tot.bonus))}</td>
      <td class="num">${esc(fmtInt(tot.advance))}</td>
      <td class="num">${esc(fmtInt(tot.deduction))}</td>
      <td class="num net">${esc(fmtInt(tot.net))}</td>
      <td class="text-center">${esc(`${tot.paid}/${tot.count}`)}</td>
      <td></td>
    </tr>`;
  }
  // KPI values
  const att = averageAttendance(shown);
  const set = (k, html) => { const el = container.querySelector(`[data-k="${k}"]`); if (el) el.innerHTML = html; };
  set('count', esc(fmtInt(tot.count)));
  set('net', `<span class="fs-6 me-1">${esc(t('currency'))}</span>${esc(fmtInt(tot.net))}`);
  set('paid', `<bdi dir="ltr">${tot.paid}<span class="fs-6 text-body-secondary"> / ${tot.count}</span></bdi>`);
  set('att', esc(fmtPercent(att)));
}

const num = (v) => Number(v) || 0;

// ---------- Saving ----------
function setSaveState(state) {
  const el = view?.container.querySelector('#save-state');
  if (!el) return;
  el.className = `save-state ${state === 'busy' ? 'busy' : state === 'err' ? 'err' : ''}`;
  el.querySelector('span:last-child').textContent = t(state === 'busy' ? 'ui.saving' : state === 'err' ? 'ui.saveFailed' : 'ui.saved');
}

function queueSave(row, delay = 350) {
  const id = row.emp.id;
  clearTimeout(view.saves.get(id));
  setSaveState('busy');
  const current = view;
  const timer = setTimeout(() => {
    if (current.saves.get(id) === undefined) return;
    current.saves.delete(id);
    persist(id, current);
  }, delay);
  view.saves.set(id, timer);
}

async function persist(id, v = view) {
  if (!v) return;
  const row = v.rows.find((r) => r.emp.id === id);
  if (!row?.rec) return;
  const snapshot = clone(row.rec);
  v.inflight++;
  try {
    await updateRecord(id, v.month, (rec) => { Object.assign(rec, snapshot); });
  } catch (err) {
    console.error(err);
    if (view === v) { setSaveState('err'); UI.toast(t('err.save'), 'danger'); }
    return;
  } finally { v.inflight--; }
  if (view === v && v.inflight === 0 && v.saves.size === 0) setSaveState('ok');
}

// ---------- Bulk fill ----------
async function fillBlanks(container) {
  const { month, days } = view;
  const cur = currentMonth();
  const upTo = month < cur ? days : month === cur ? new Date().getDate() : 0;
  if (!upTo) { UI.toast(t('pay.fillDone', { n: 0 }), 'info'); return; }
  const day = upTo;
  const ok = await UI.confirmDialog(t('pay.fillConfirm', { day, month: fmtMonth(month) }), { okLabel: t('pay.fill') });
  if (!ok) return;
  try {
    const active = view.rows.filter((r) => r.emp.status === 'active').map((r) => r.emp);
    const changed = await fillPresent(month, active, upTo, (emp, d) => isDayNA(emp, month, d));
    // Reload the saved records so the grid shows exactly what was stored.
    const recs = await getMonthRecords(month);
    const map = new Map(recs.map((r) => [r.employeeId, r]));
    for (const row of view.rows) row.rec = map.get(row.emp.id) ? clone(map.get(row.emp.id)) : row.rec;
    for (const row of view.rows) row.pay = computePay(row.emp, row.rec, month, view.settings);
    paintBody(container);
    refreshTotals(container);
    UI.toast(t('pay.fillDone', { n: changed }));
  } catch (err) { UI.toastError(err); }
}

// ---------- Payslip ----------
function payslipHtml(row, month) {
  const e = row.emp; const p = row.pay;
  const counts = countCodes(row.rec?.days, month);
  const d = p.divisor;
  const cur = t('currency');
  const amt = (n) => fmtMoney(n);
  const less = (n) => (n ? `− ${amt(n)}` : amt(0));
  return `
    <div class="payslip" dir="${lang() === 'ur' ? 'rtl' : 'ltr'}">
      <div class="payslip-head">
        <img src="icons/icon-192.png" alt="" width="46" height="46" style="border-radius:14px;background:#fff">
        <div class="min-w-0 flex-grow-1">
          <div class="co">${esc(companyName())}</div>
          <div class="per">${esc(t('pay.slipPeriod', { month: fmtMonth(month) }))}</div>
        </div>
        <div class="text-end"><div class="fw-bold">${esc(e.code)}</div><div class="small opacity-75">${esc(cur)}</div></div>
      </div>
      <div class="payslip-body">
        <div class="payslip-grid">
          <div><div class="k">${esc(t('emp.name'))}</div><div class="v" dir="auto">${esc(displayName(e) || e.name)}</div></div>
          <div><div class="k">${esc(t('emp.designation'))}</div><div class="v">${esc(e.designation || '—')}</div></div>
          <div><div class="k">${esc(t('emp.department'))}</div><div class="v">${esc(e.department || '—')}</div></div>
          <div><div class="k">${esc(t('emp.cnic'))}</div><div class="v">${esc(e.cnic || '—')}</div></div>
          ${e.bankName || e.accountNo ? `<div style="grid-column:1/-1"><div class="k">${esc(t('emp.bankName'))}</div><div class="v">${esc(t('pay.slipBank', { bank: e.bankName || '—', acct: e.accountNo || '—' }))}</div></div>` : ''}
        </div>
        <table class="payslip-table">
          <tr><td>${esc(t('pay.slipSalary'))}</td><td class="amt">${esc(amt(p.gross))}</td></tr>
          <tr><td>${esc(t('pay.slipDays'))} <span class="text-secondary small">(${esc(fmtDecimal(p.present))} / ${d}) · ${esc(t('pay.slipCounts', { p: counts.P, h: counts.H, l: counts.L, a: counts.A }))}</span></td><td class="amt">${esc(fmtDecimal(p.present))}</td></tr>
          <tr><td>${esc(t('pay.slipEarned'))}</td><td class="amt">${esc(amt(p.earned))}</td></tr>
          <tr><td>${esc(t('pay.slipOt'))} <span class="text-secondary small">(${esc(fmtDecimal(num(row.rec?.overtime)))} h)</span></td><td class="amt">${esc(amt(p.overtime))}</td></tr>
          <tr><td>${esc(t('pay.slipBonus'))}</td><td class="amt">${esc(amt(p.bonus))}</td></tr>
          <tr><td>${esc(t('pay.slipAdvance'))}</td><td class="amt">${esc(less(p.advance))}</td></tr>
          <tr><td>${esc(t('pay.slipDeduction'))}</td><td class="amt">${esc(less(p.deduction))}</td></tr>
          <tr class="total"><td>${esc(t('pay.slipNet'))}</td><td class="amt">${esc(amt(p.net))}</td></tr>
        </table>
        <div class="payslip-sign"><div>${esc(t('pay.slipEmployer'))}</div><div>${esc(t('pay.slipEmployee'))}</div></div>
      </div>
    </div>`;
}

function openPayslip(row) {
  const m = UI.modal({
    title: t('pay.slip'),
    size: 'md',
    className: 'print-target',
    body: payslipHtml(row, view.month),
    footer: `<button class="btn btn-light no-print" data-bs-dismiss="modal">${esc(t('ui.close'))}</button>
      <button class="btn btn-grad no-print" data-print><i class="bi bi-printer me-1"></i>${esc(t('pay.slipPrint'))}</button>`,
  });
  m.el.querySelector('[data-print]').addEventListener('click', () => window.print());
}

// ---------- Summary & export ----------
function openSummary() {
  const rows = visibleRows().map(({ row }) => row);
  const tot = totalsOf(rows);
  const m = UI.modal({
    title: t('pay.summaryTitle', { month: fmtMonth(view.month) }),
    size: 'xl',
    className: 'print-target',
    body: `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
      <thead><tr>
        <th>${esc(t('pay.col.employee'))}</th>
        <th class="text-end">${esc(t('pay.col.paidDays'))}</th>
        <th class="text-end">${esc(t('emp.gross'))}</th>
        <th class="text-end">${esc(t('pay.col.earned'))}</th>
        <th class="text-end">${esc(t('pay.col.ot'))}</th>
        <th class="text-end">${esc(t('pay.col.bonus'))}</th>
        <th class="text-end">${esc(t('pay.col.advance'))}</th>
        <th class="text-end">${esc(t('pay.col.deduction'))}</th>
        <th class="text-end">${esc(t('pay.col.net'))}</th>
        <th>${esc(t('pay.col.status'))}</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><div class="fw-semibold" dir="auto">${esc(displayName(r.emp) || r.emp.name)}</div><div class="small text-body-secondary">${esc(r.emp.code)}${r.emp.designation ? ' · ' + esc(r.emp.designation) : ''}</div></td>
        <td class="text-end">${esc(fmtDecimal(r.pay.present))}</td>
        <td class="text-end">${esc(fmtInt(r.pay.gross))}</td>
        <td class="text-end">${esc(fmtInt(r.pay.earned))}</td>
        <td class="text-end">${esc(fmtInt(r.pay.overtime))}</td>
        <td class="text-end">${esc(fmtInt(r.pay.bonus))}</td>
        <td class="text-end">${esc(fmtInt(r.pay.advance))}</td>
        <td class="text-end">${esc(fmtInt(r.pay.deduction))}</td>
        <td class="text-end fw-bold">${esc(fmtInt(r.pay.net))}</td>
        <td><span class="pill ${r.rec?.paid ? 'pill-paid' : 'pill-unpaid'}">${esc(r.rec?.paid ? t('pay.paid') : t('pay.unpaid'))}</span></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr class="fw-bold">
        <td>${esc(t('pay.total'))} (${tot.count})</td><td></td><td class="text-end">${esc(fmtInt(tot.gross))}</td>
        <td class="text-end">${esc(fmtInt(tot.earned))}</td><td class="text-end">${esc(fmtInt(tot.overtime))}</td>
        <td class="text-end">${esc(fmtInt(tot.bonus))}</td><td class="text-end">${esc(fmtInt(tot.advance))}</td>
        <td class="text-end">${esc(fmtInt(tot.deduction))}</td><td class="text-end">${esc(fmtInt(tot.net))}</td><td></td>
      </tr></tfoot>
    </table></div>`,
    footer: `<button class="btn btn-light no-print" data-bs-dismiss="modal">${esc(t('ui.close'))}</button>
      <button class="btn btn-grad no-print" data-print><i class="bi bi-printer me-1"></i>${esc(t('btn.print'))}</button>`,
  });
  m.el.querySelector('[data-print]').addEventListener('click', () => window.print());
}

function exportCsv() {
  const { month } = view;
  const rows = visibleRows().map(({ row }) => row);
  const data = rows.map((r) => {
    const c = countCodes(r.rec?.days, month);
    return [r.emp.code, displayName(r.emp) || r.emp.name, r.emp.designation, r.emp.department, c.P, c.H, c.L, c.A,
      r.pay.present, r.pay.gross, r.pay.earned, num(r.rec?.overtime), r.pay.overtime, r.pay.bonus, r.pay.advance,
      r.pay.deduction, r.pay.net, r.rec?.paid ? 'Yes' : 'No'];
  });
  const csv = toCSV([list('pay.csvHeaders'), ...data]);
  downloadFile(t('pay.csvFile', { month }), `﻿${csv}`, 'text/csv;charset=utf-8');
}

export default { render, destroy };
