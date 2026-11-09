// Local data access for employees and monthly payroll records (IndexedDB). Nothing here touches the network.
import { read, write, getAll, getAllByIndex } from '../db/idb.js';
import { CONFIG } from '../config.js';
import { clean, num, nowISO, uuid, AppError } from '../core/utils.js';

export const recordId = (employeeId, month) => `${employeeId}|${month}`;

export const blankRecord = (employeeId, month) => ({
  id: recordId(employeeId, month), employeeId, month,
  days: {}, overtime: 0, bonus: 0, advance: 0, deduction: 0,
  paid: false, paidOn: '', note: '',
});

const byCode = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true });

function cleanEmployee(input) {
  const amount = (v) => Math.max(0, Math.round(num(v) * 100) / 100);
  const joinDate = /^\d{4}-\d{2}-\d{2}$/.test(input.joinDate || '') ? input.joinDate : '';
  return {
    name: clean(input.name, 120),
    nameUr: clean(input.nameUr, 120),
    fatherName: clean(input.fatherName, 120),
    cnic: clean(input.cnic, 15),
    phone: clean(input.phone, 30),
    address: clean(input.address, 300),
    designation: clean(input.designation, 80),
    department: clean(input.department, 80),
    joinDate,
    status: input.status === 'inactive' ? 'inactive' : 'active',
    basic: amount(input.basic),
    houseRent: amount(input.houseRent),
    medical: amount(input.medical),
    transport: amount(input.transport),
    bankName: clean(input.bankName, 80),
    accountNo: clean(input.accountNo, 40),
    photo: typeof input.photo === 'string' && input.photo.startsWith('data:image/') ? input.photo : '',
  };
}

export async function listEmployees() {
  const all = await getAll('employees');
  return all.sort(byCode);
}

export async function getEmployee(id) {
  const rows = await read(['employees'], (t) => t.get('employees', id));
  return rows || null;
}

export async function saveEmployee(id, input) {
  const data = cleanEmployee(input);
  if (!data.name) throw new AppError('Enter the employee name.', 'name_required');
  return write(['employees', 'meta'], async (t) => {
    const now = nowISO();
    if (id) {
      const prev = await t.get('employees', id);
      if (!prev) throw new AppError('This employee no longer exists.', 'employee_missing');
      const rec = { ...prev, ...data, updatedAt: now };
      await t.put('employees', rec);
      return rec;
    }
    const counter = (await t.get('meta', 'employeeCounter'))?.value || 0;
    const next = Number(counter) + 1;
    await t.put('meta', { key: 'employeeCounter', value: next });
    const rec = { id: uuid(), code: `EMP-${String(next).padStart(4, '0')}`, ...data, createdAt: now, updatedAt: now };
    await t.add('employees', rec);
    return rec;
  });
}

export async function deleteEmployee(id) {
  return write(['employees', 'payroll'], async (t) => {
    await t.delete('employees', id);
    await t.deleteByIndex('payroll', 'employeeId', id);
  });
}

export async function getMonthRecords(month) {
  return getAllByIndex('payroll', 'month', month);
}

export async function getAllRecords() {
  return getAll('payroll');
}

// Applies `mutate(record)` to the employee's record for the month (creating it if needed), in one transaction.
export async function updateRecord(employeeId, month, mutate) {
  const id = recordId(employeeId, month);
  return write(['payroll'], async (t) => {
    const rec = (await t.get('payroll', id)) || blankRecord(employeeId, month);
    mutate(rec);
    rec.updatedAt = nowISO();
    await t.put('payroll', rec);
    return rec;
  });
}

// Marks every blank, applicable day as present for the given employees up to `upToDay`.
export async function fillPresent(month, employees, upToDay, isNA) {
  return write(['payroll'], async (t) => {
    let changed = 0;
    for (const emp of employees) {
      const id = recordId(emp.id, month);
      const rec = (await t.get('payroll', id)) || blankRecord(emp.id, month);
      let touched = false;
      for (let d = 1; d <= upToDay; d++) {
        if (rec.days[d] || isNA(emp, d)) continue;
        rec.days[d] = 'P'; touched = true; changed++;
      }
      if (touched) { rec.updatedAt = nowISO(); await t.put('payroll', rec); }
    }
    return changed;
  });
}

// ---------- Backup (local JSON file; no network) ----------
export async function exportBackup(settings) {
  const [employees, payroll] = await Promise.all([getAll('employees'), getAll('payroll')]);
  return {
    format: CONFIG.BACKUP_FORMAT,
    backupVersion: CONFIG.BACKUP_VERSION,
    appVersion: CONFIG.APP_VERSION,
    createdAt: nowISO(),
    counts: { employees: employees.length, payroll: payroll.length },
    settings,
    data: { employees, payroll },
  };
}

export function validateBackup(obj) {
  if (!obj || obj.format !== CONFIG.BACKUP_FORMAT) throw new AppError('This file is not a payroll backup.', 'backup_not_payroll');
  if (obj.backupVersion !== CONFIG.BACKUP_VERSION) throw new AppError('This backup was made by a different version of the app.', 'backup_version');
  const { employees, payroll } = obj.data || {};
  if (!Array.isArray(employees) || !Array.isArray(payroll)) throw new AppError('The backup file is damaged.', 'backup_damaged');
  if (employees.some((e) => !e?.id || !e?.code) || payroll.some((r) => !r?.id || !r?.employeeId || !r?.month)) {
    throw new AppError('The backup file is damaged.', 'backup_damaged');
  }
  if (obj.counts && (obj.counts.employees !== employees.length || obj.counts.payroll !== payroll.length)) {
    throw new AppError('The backup file is incomplete (record counts do not match).', 'backup_incomplete');
  }
  return { employees, payroll };
}

// Replaces all employee and payroll data with the backup. Runs in one transaction.
export async function restoreBackup({ employees, payroll }) {
  return write(['employees', 'payroll', 'meta'], async (t) => {
    await t.clear('employees');
    await t.clear('payroll');
    let max = 0;
    for (const e of employees) { await t.put('employees', e); max = Math.max(max, Number(String(e.code).replace(/\D/g, '')) || 0); }
    for (const r of payroll) await t.put('payroll', r);
    await t.put('meta', { key: 'employeeCounter', value: max });
    return { employees: employees.length, payroll: payroll.length };
  });
}
