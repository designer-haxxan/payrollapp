// Dashboard: this month's payroll at a glance, a 6-month trend, recently added employees and quick actions.
import { listEmployees, getAllRecords } from '../services/data.js';
import { buildRows, totalsOf, averageAttendance } from '../services/payroll.js';
import { getSettings, companyName } from '../core/settings.js';
import { t, fmtMonth, fmtMonthShort, fmtInt, fmtPercent, greeting } from '../core/i18n.js';
import * as UI from '../core/ui.js';
import { esc, currentMonth, addMonths } from '../core/utils.js';
import * as Auth from '../services/auth.js';

async function render(container, { setTitle }) {
  setTitle(t('dash.title'));
  const settings = getSettings();
  const [emps, recs] = await Promise.all([listEmployees(), getAllRecords()]);
  const cur = currentMonth();
  const rows = buildRows(emps, recs, cur, settings);
  const tot = totalsOf(rows);
  const att = averageAttendance(rows);
  const active = emps.filter((e) => e.status === 'active').length;

  // Six months of net pay (oldest → newest)
  const months = [-5, -4, -3, -2, -1, 0].map((d) => addMonths(cur, d));
  const series = months.map((m) => {
    const r = buildRows(emps, recs, m, settings);
    return { m, net: totalsOf(r).net, n: r.length };
  });
  const maxNet = Math.max(1, ...series.map((s) => s.net));

  const chart = series.some((s) => s.net > 0)
    ? `<div class="chart" role="img" aria-label="${esc(t('dash.chart.title'))}">${series.map((s, i) => `
        <div class="col">
          <div class="val">${s.net ? fmtInt(s.net) : '0'}</div>
          <div class="bar-wrap"><div class="bar ${s.m === cur ? 'last' : ''}" style="--h:${Math.max(4, (s.net / maxNet) * 100)}%;--i:${i}" title="${esc(fmtMonth(s.m))}: ${fmtInt(s.net)}"></div></div>
          <div class="lbl">${esc(fmtMonthShort(s.m))}</div>
        </div>`).join('')}</div>`
    : `<div class="empty-state py-4"><div class="es-icon"><i class="bi bi-bar-chart"></i></div><div class="text-body-secondary">${esc(t('dash.chart.empty'))}</div></div>`;

  const recent = [...emps].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
  const recentHtml = recent.length
    ? recent.map((e) => `<a class="recent-item" href="#/employees/${esc(e.id)}">
        ${UI.avatar(e.name, e.photo)}
        <div class="min-w-0 flex-grow-1"><div class="fw-semibold text-truncate">${esc(e.name)}</div>
        <div class="small text-body-secondary text-truncate">${esc(e.code)}${e.designation ? ' · ' + esc(e.designation) : ''}</div></div>
        <i class="bi bi-chevron-right text-body-secondary"></i></a>`).join('')
    : `<div class="text-body-secondary small py-2">${esc(t('dash.recent.empty'))}</div>`;

  const u = Auth.user();
  const kpi = (i, ico, cls, label, valueHtml, sub, meter = '') => `
    <div class="panel kpi rise" style="--i:${i}">
      <div class="kpi-ico ${cls}"><i class="bi bi-${ico}"></i></div>
      <div class="label">${esc(label)}</div>
      <div class="value">${valueHtml}</div>
      <div class="sub">${sub}</div>${meter}
    </div>`;

  container.innerHTML = `
    <section class="hero rise" style="--i:0">
      <span class="badge-soft"><i class="bi bi-calendar3"></i>${esc(fmtMonth(cur))}</span>
      <h1>${esc(t('dash.welcome', { greet: greeting(), name: u?.name || '' }))}</h1>
      <p>${esc(t('dash.subtitle', { month: fmtMonth(cur) }))}</p>
      <a class="btn-hero" href="#/payroll"><i class="bi bi-table me-1"></i>${esc(t('dash.hero.cta'))}</a>
    </section>

    <div class="kpi-grid">
      ${kpi(1, 'people-fill', 'g1', t('dash.kpi.employees'),
        `<span data-count="${emps.length}">0</span>`,
        esc(t('dash.kpi.employeesSub', { active, inactive: emps.length - active })))}
      ${kpi(2, 'cash-coin', 'g2', t('dash.kpi.payroll'),
        `<span class="fs-6 fw-semibold me-1">${esc(t('currency'))}</span><span data-count="${Math.max(0, tot.net)}">0</span>`,
        esc(fmtMonth(cur)))}
      ${kpi(3, 'check2-circle', 'g3', t('dash.kpi.paid'),
        `<span data-count="${tot.paid}">0</span>`,
        esc(t('dash.kpi.paidSub', { paid: tot.paid, total: rows.length })),
        `<div class="meter"><span style="--w:${rows.length ? (tot.paid / rows.length) * 100 : 0}%"></span></div>`)}
      ${kpi(4, 'graph-up-arrow', 'g4', t('dash.kpi.attendance'),
        `<span>${esc(fmtPercent(att))}</span>`,
        att === null ? esc(t('dash.kpi.attendanceNone')) : '&nbsp;',
        att === null ? '' : `<div class="meter"><span style="--w:${Math.round(att * 100)}%"></span></div>`)}
    </div>

    <div class="row g-3">
      <div class="col-12 col-lg-7">
        <section class="panel rise h-100" style="--i:4">
          <div class="panel-head"><h2>${esc(t('dash.chart.title'))}</h2></div>
          <div class="panel-body">${chart}</div>
        </section>
      </div>
      <div class="col-12 col-lg-5">
        <section class="panel rise mb-3" style="--i:5">
          <div class="panel-head"><h2>${esc(t('dash.actions.title'))}</h2></div>
          <div class="panel-body quick">
            <a href="#/employees/new"><span class="qi" style="background:linear-gradient(135deg,#6366f1,#4f46e5)"><i class="bi bi-person-plus"></i></span>
              <span><span class="qt d-block">${esc(t('dash.actions.addEmp'))}</span><span class="qs">${esc(t('dash.actions.addEmpSub'))}</span></span>
              <i class="bi bi-chevron-right chev"></i></a>
            <a href="#/payroll"><span class="qi" style="background:linear-gradient(135deg,#34d399,#059669)"><i class="bi bi-table"></i></span>
              <span><span class="qt d-block">${esc(t('dash.actions.sheet'))}</span><span class="qs">${esc(t('dash.actions.sheetSub'))}</span></span>
              <i class="bi bi-chevron-right chev"></i></a>
            <a href="#/settings"><span class="qi" style="background:linear-gradient(135deg,#f472b6,#db2777)"><i class="bi bi-sliders"></i></span>
              <span><span class="qt d-block">${esc(t('dash.actions.settings'))}</span><span class="qs">${esc(t('dash.actions.settingsSub'))}</span></span>
              <i class="bi bi-chevron-right chev"></i></a>
          </div>
        </section>
        <section class="panel rise" style="--i:6">
          <div class="panel-head"><h2>${esc(t('dash.recent.title'))}</h2></div>
          <div class="panel-body pt-2">${recentHtml}</div>
        </section>
      </div>
    </div>`;

  UI.countUp(container);
  document.title = `${companyName()} · ${t('dash.title')}`;
}

export default { render, destroy() {} };
