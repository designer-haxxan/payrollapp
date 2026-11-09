// Deployment configuration.
export const CONFIG = {
  APP_NAME: 'Payroll',
  // Namespace for everything this app stores in the browser (database, LocalStorage keys, caches).
  APP_ID: 'payroll',
  APP_VERSION: '1.0.0',
  BACKUP_FORMAT: 'payroll-backup',
  BACKUP_VERSION: 1,
  // The ONLY network call the app makes: the login API (POST {AUTH_API_BASE}/login).
  // All employee, attendance and salary data stays on this device.
  AUTH_API_BASE: 'https://eposwala.com/api',
  SUPPORT_PHONE: '0302-8863131',
};

// Bootstrap is loaded LTR by default and swapped to the RTL build when Urdu is selected.
export const CDN = {
  bootstrapLtr: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  bootstrapRtl: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.rtl.min.css',
};

// LocalStorage key inside this app's namespace, e.g. storageKey('settings') -> 'payroll.settings'.
export const storageKey = (name) => `${CONFIG.APP_ID}.${name}`;
