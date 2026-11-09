# Payroll · تنخواہ

Offline-first payroll as a static PWA (no build step), in **English** and **اردو** (right-to-left).
HTML5 · ES modules · Bootstrap 5.3 (LTR and RTL builds) · Bootstrap Icons · IndexedDB · Service Worker.

## What it does

- **Employees** — a full form for personal details (Urdu name, father's/husband's name, CNIC with automatic
  `00000-0000000-0` formatting, phone, address, photo), job details (auto code `EMP-0001`, designation, department,
  joining date, active/inactive), salary and allowances (basic, house rent, medical, transport), and bank details.
  A live salary summary shows the gross, the breakdown, the daily rate and the overtime rate while you type.
- **Payroll sheet** — an Excel-style grid for one month at a time:
  - employees are rows, days 1…31 are columns, Sundays are highlighted, and days before a joining date are hatched and locked;
  - each day holds **P** (present), **H** (half day), **L** (paid leave) or **A** (absent);
  - extra columns: paid days, earned pay, overtime hours, bonus, advance, other deduction, net pay, paid/unpaid, payslip;
  - totals row (per day and per money column), KPI tiles, and month/department navigation;
  - keyboard entry: click a day to cycle its code, or select a cell and press `P` `H` `L` `A`; `Delete` clears; arrow keys and `Enter` move;
  - "Mark blanks present" fills every blank, applicable working day up to today (with confirmation);
  - every change is saved to this device automatically.
- **Payslips** — a printable slip per employee (in the current language), with a signature line.
- **Summary and export** — a printable month summary, and a CSV export (with a UTF-8 BOM so Urdu opens correctly in Excel).
- **Dashboard** — this month's net payroll, paid count, average attendance, a six-month trend chart, recent employees and quick actions.
- **Settings** — company name in English and Urdu, pay divisor, overtime multiplier, language, theme (automatic / light / dark), JSON backup export and restore, and log out.

## Pay rules

| Item | Formula |
|---|---|
| Gross salary | basic + house rent + medical + transport |
| Daily rate | gross ÷ pay divisor (30, 26, or the actual days in the month; set in Settings) |
| Paid days | P × 1 + L × 1 + H × 0.5 |
| Earned | daily rate × paid days (capped at the divisor) |
| Overtime | OT hours × (basic ÷ divisor ÷ 8) × overtime multiplier (default 1.5) |
| Net pay | earned + overtime + bonus − advance − other deduction, rounded to whole rupees |

The rules live in `js/services/payroll.js` and are pure functions, so they can be checked without the UI.

## Login API

Sign-in uses the existing **eposwala login API** (`POST {AUTH_API_BASE}/login`, set in `js/config.js`). It is the only
network call the app makes. Employee, attendance and salary data stay on the device.

- Sign-in needs internet. After a successful sign-in the session is kept locally until it expires, and the app works offline.
- **CORS:** the API must allow the origin the app is served from (see the note under *Run locally*).

## Run locally

The app needs HTTP (ES modules and the service worker). `localhost` counts as a secure context.

```bash
python -m http.server 8765
```

Then open http://localhost:8765. Sign-in from `localhost` only works once the login API allows that origin.

## Deploy

Host the folder over HTTPS (for example at `pos.eposwala.com`, as set in `CNAME`). Paths are relative.

**When you change any file, bump `VERSION` in `service-worker.js`** (and `APP_VERSION` in `js/config.js`), so installed
copies update on the next online visit. The worker serves cached files first, so a version bump is required for changes to reach users.

## Data and backup

- Data lives in IndexedDB `payroll_db` (`employees`, `payroll`). Settings live in LocalStorage under `payroll.*`.
- **Settings → Export backup** downloads one JSON file. **Restore** replaces all employees and payroll records after a
  confirmation, and validates the file first (format, version, required fields, record counts).
- The database name is `payroll_db`, so it does not collide with data from the earlier POS app on the same origin.

## Project structure

```
index.html              App shell (bilingual login, sidebar, bottom nav, offcanvas menu)
css/app.css             Design tokens (light/dark), animations, payroll sheet, print styles
js/config.js            Login API URL, support phone, app/backup versions
js/app.js               Boot, auth gate and session expiry, router, language and theme switching
js/core/                i18n (t(), RTL, number/date formatting), settings, UI helpers, utils, early.js (pre-paint RTL)
js/i18n/                en.js and ur.js dictionaries (same keys)
js/db/                  IndexedDB wrapper (atomic transactions) and schema
js/services/            auth (login API), data (employees, payroll records, backup), payroll (pay rules)
js/modules/             dashboard, employees (list + form), payroll (sheet + payslip), settings
service-worker.js       Precache of the app shell; cache-first; never caches the login API
```

## Known limitations

- **No tax, EOBI, provident fund or loan schedules.** Income tax and other statutory deductions are entered manually as "other deduction".
- **One company per device.** Data is not synced between phones or computers. Use backups to move data.
- **No roles.** The signed-in account has full access, as in the login API's single-account model.
- **Anyone with access to the unlocked device can read local data.** Use the device lock screen.
