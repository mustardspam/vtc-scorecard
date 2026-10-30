# vtc-automation

Nightly imports into the VTC Scorecard, plus read-only MCP servers, built on **ResPlan**, the local service that drives the ERP (Dynamic Builder) and HB NEXT. Everything runs on the PC that runs ResPlan; nothing is hosted.

```
core/      resplan_client, erp_client, hbnext_client   pulls through ResPlan (127.0.0.1:4870)
           transforms, validate                         the scorecard's mapping + checks before import
           importer                                     imports with the scorecard's own code (src/lib/importers/erp-import.js)
           runner, state, archive, retry, log, notify   orchestration, catch-up, archives, Outlook email
jobs/      nightly_import.js                            what Task Scheduler runs (no Claude / MCP needed)
           set_credentials.js                           secrets -> Windows Credential Manager
mcp/       erp_mcp_server.js, hbnext_mcp_server.js      read-only tools for Claude (stdio)
scripts/   install.ps1, register-task.ps1, send-mail.ps1
tests/     node --test
```

The Uploads page and this job share `src/lib/importers/erp-import.js`, so a manual "Pull from ERP" and the nightly job import identically.

## Where things live

| What | Where |
|---|---|
| Source | here (OneDrive) |
| Runtime copy + `node_modules` | `%LOCALAPPDATA%\vtc-automation\app` (created by `install.ps1`) |
| Logs (JSON lines, one file a day) | `%LOCALAPPDATA%\vtc-automation\logs` |
| Raw + transformed pulls, by date | `%LOCALAPPDATA%\vtc-automation\archive` |
| Catch-up state, run lock | `%LOCALAPPDATA%\vtc-automation\state` |
| Local config overrides (optional) | `%LOCALAPPDATA%\vtc-automation\config.json` (same keys as `config/default.json`) |
| Secrets | Windows Credential Manager, service `vtc-automation` |

Logs and archives are kept 90 days (`retentionDays`).

## Setup (on the ResPlan PC)

1. **Scorecard account:** create a dedicated user (e.g. `vtc-automation@...`) in the scorecard with the **admin** role. Replacing a month's pull needs admin, as it does in the web app.
2. **Install:** `powershell -ExecutionPolicy Bypass -File vtc-automation\scripts\install.ps1` copies the code to `%LOCALAPPDATA%`, runs `npm install` and runs the tests.
3. **Credentials:** `cd %LOCALAPPDATA%\vtc-automation\app` then `npm run credentials`. It asks for the account email and password, the Supabase anon key (the one the web app is built with) and the ResPlan key (ResPlan > Settings > VTC Scorecard). `npm run credentials -- --status` shows which are set.
4. **Dry run:** `node vtc-automation\jobs\nightly_import.js --dry-run` pulls, validates and archives without importing. Check the archived `.raw.json` files against `core/validate.js` the first time.
5. **Schedule:** `powershell -ExecutionPolicy Bypass -File vtc-automation\scripts\register-task.ps1`. To skip scheduled pulls and use only the Refresh now button, add `-RequestsOnly`: it registers just the 5-minute request task and removes the nightly task if it was registered before.
6. **Retire the old browser autopull:** once the task has run cleanly for a few nights, turn off ResPlan's own midnight browser autopull (`/uploads?autopull=nightly`) so the data isn't pulled twice. Pulling twice is harmless, since each pull replaces the month, but it is wasted work.

## Running it

```
node vtc-automation/jobs/nightly_import.js                     scheduled run, with catch-up
  --dry-run                                                    pull + validate + archive, no import, no email
  --category schedule|rework|safety|jc_vendor_report[,...]     (aliases: jc, backcharges)
  --brand Starlight|"Ashton Woods"
  --date 2026-10-15                                            the month containing that date
  --backfill 2026-07-01 2026-09-30                             every month in the range
```

Exit codes: 0 means OK; 1 means something failed (an email goes out); 2 means bad arguments; 3 means another run is in progress.

**How a run works**

- **Unit of work:** each category, brand and month is one unit. ResPlan pulls a month to date, and importing a month **replaces** the earlier pull of that month, so re-runs never duplicate rows.
- **Order:** the JC report runs first, then schedule, rework and safety.
- **Failures:** one unit failing never stops the others. Transient errors are retried 3 times with backoff; bad credentials are not retried.
- **Validation:** before importing, each dataset is checked for required columns, types, and a row count that hasn't dropped sharply since the last import of the same month. A failed check skips that import and sends an alert email.
- **Catch-up:** the state file records the last fully successful date per category and brand. The next run pulls every month since then, and on the 1st–3rd it also pulls the previous month again.
- **Fail-fast:** if ResPlan isn't running, the run stops at once. Nothing is marked done, so the next trigger (midnight or logon) catches up.

## "Refresh now" on the Uploads page

Managers and admins see a **Refresh now** button at the top of the Uploads page. A manager's browser can't reach ResPlan, which only listens on the ResPlan PC, so the button queues a row in `erp_refresh_requests` (migration `017`).

Two things can pick a request up:

- **ResPlan itself (current setup).** With `vtc.requests.enabled` in ResPlan's `config.json`, ResPlan opens `/uploads?autopull=request` in its Edge window every 5 minutes, and the page runs the request. This needs no Node network access, so it works on a PC where `node.exe` is blocked from the internet. See ResPlan's README.
- **This job's `--requests` task (described below).** Use it only where Node can reach Supabase. Don't use both on the same PC.

- **Pickup:** the second scheduled task, *VTC Nightly Import - Refresh Requests*, runs `nightly_import.js --requests` every 5 minutes. It claims the request and runs the same pulls as the nightly job (current month; also last month on the 1st–3rd), signed in as the automation account.
- **Progress:** it writes progress and the result back to the request row. The page shows "Queued", then "Running: …", then "Last refreshed …", and reloads its data when the run finishes.
- **One at a time:** only one request can be open. If the nightly run is going, the request waits for it.
- **If the PC is off:** the request stays queued until the ResPlan PC is on and you're logged in. After 15 minutes the page says so.
- **Stuck runs:** a request stuck in "running" for 2 hours is marked failed, so it can't block new ones.

The migration has to be run once in the Supabase SQL Editor before the button works.

## MCP servers (Claude Code)

```
claude mcp add vtc-erp -- node "%LOCALAPPDATA%\vtc-automation\app\vtc-automation\mcp\erp_mcp_server.js"
claude mcp add vtc-hbnext -- node "%LOCALAPPDATA%\vtc-automation\app\vtc-automation\mcp\hbnext_mcp_server.js"
```

| Server | Tools |
|---|---|
| ERP | `get_schedule_data`, `get_rework_backcharges`, `get_jc_vendor_report`, `list_vendors` |
| HB NEXT | `get_safety_inspections`, `get_safety_summary_by_vendor` |

All tools are read-only. They answer from a pull archived in the last 24 hours when there is one; pass `refresh: true` for a live pull, which can take minutes per report.

## Known limits

- The task runs **only while you're logged on** (a locked screen is fine). ResPlan, Outlook and Credential Manager all live in your Windows session.
- On a laptop with Modern Standby, "wake to run" is not reliable. The logon trigger plus catch-up covers missed nights.
- Email uses classic Outlook through COM. If group policy shows a "program is trying to send" prompt, the email waits in the Outbox.
- ResPlan's record fields aren't documented anywhere in this repo. `core/validate.js` follows what the scorecard's import code reads; confirm them against the first dry run's archived `.raw.json` files.
