// IndexedDB schema definition and migrations.
import { CONFIG } from '../config.js';

export const DB_NAME = `${CONFIG.APP_ID}_db`;
export const DB_VERSION = 1;

// Stores included in backups.
export const DATA_STORES = ['employees', 'payroll'];

const STORES = {
  meta: { keyPath: 'key', indexes: {} },
  // One record per employee. `code` (EMP-0001…) is unique and never changes.
  employees: { indexes: { code: ['code', true], status: 'status' } },
  // One record per employee per month. Primary key: `${employeeId}|${YYYY-MM}`.
  payroll: { indexes: { month: 'month', employeeId: 'employeeId' } },
};

export function upgrade(db, oldVersion, t) {
  if (oldVersion < 1) {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.createObjectStore(name, { keyPath: def.keyPath || 'id' });
      for (const [idx, spec] of Object.entries(def.indexes)) {
        const [keyPath, unique] = Array.isArray(spec) ? spec : [spec, false];
        os.createIndex(idx, keyPath, { unique: !!unique });
      }
    }
    t.objectStore('meta').put({ key: 'schemaVersion', value: DB_VERSION });
    t.objectStore('meta').put({ key: 'createdAt', value: new Date().toISOString() });
  }
  // Future migrations: if (oldVersion < 2) { ... }
}
