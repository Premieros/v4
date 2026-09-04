# ERP-01 — Settings, POS Organization, Payment Flow & Report Center

## Status

- Status: **✅ COMPLETE — MERGED** — PHASE A–E implemented and committed; PHASE F **fully green in CI** (verify ✅ 236/236 unit, db ✅ 154/154 integration, browser-smoke ✅ 50/50 E2E, Netlify deploy preview ✅ — run 31813850004); PHASE G documentation closed. **PR #5 merged into `main` on 2026-08-14 (merge commit `0c2d812`).** ERP-01 is complete.
- Branch: `erp-01-settings-organization`
- Base: production `main` after P7 merge
- Scope: ERP-01 only
- Do not modify `main` directly.
- Do not modify or interfere with other OpenCode workflows/branches.
- Do not start ERP-02 or any unrelated phase until ERP-01 is completed and verified.

## PHASE COMPLETION RECORD

| Phase | Scope | Status | Evidence |
|-------|-------|--------|----------|
| A | Settings Control Center audit + organization + real wiring | ✅ Implemented | `5e8444d`, `b8a7459`, `docs/ERP-01_SETTINGS_AUDIT.md` |
| B | POS organization / default flow | ✅ Implemented | `b70ffed`, `6d8cae6` |
| C | Resume / Kitchen incremental sending | ✅ Implemented | `363b608` + migration `069` |
| D | Payment & full receipt review | ✅ Implemented | `a2bc51e` |
| E | Report Center filters + export | ✅ Implemented | `1f38fcd` |
| F | Tests & verification | ✅ CI GREEN | verify ✅ (unit 236/236), db ✅ (integration 154/154), browser-smoke ✅ (E2E 50/50), deploy preview ✅ — PR #5 run 31813850004; awaits your review + merge |
| G | Documentation & audit | ⏳ In progress | this update |

Full completion record: see `# CURRENT STATUS` at the end of this file.

## Objective

Organize the application into a coherent ERP control structure and make Settings the real control center of the system. At the same time, improve the POS workflow, resume-order kitchen behavior, payment/receipt review, and report generation while preserving all existing business logic, RBAC/RLS, Supabase contracts, routes, and working functionality.

## NON-NEGOTIABLE SAFETY CONTRACT

1. Preserve existing POS business logic unless a listed ERP-01 bug requires a targeted fix.
2. Preserve authentication, RBAC, branch isolation, RLS, database constraints, Supabase RPC contracts, and route contracts.
3. Do not create UI-only settings. Every setting must have a real consumer or be explicitly marked planned/not implemented.
4. Reuse existing SettingsContext/API/database fields before creating new schema.
5. Any new database field/table/RPC requires a migration, RLS review, types update, audit consideration, and regression tests.
6. Do not duplicate business logic in React if the authoritative behavior belongs in the database/API.
7. Never delete existing functionality merely to simplify the UI.
8. Do not change production data manually as part of frontend work.
9. Every behavioral change requires a regression test.
10. Keep ERP-01 commits small and descriptive; update this plan and the master log after each completed sub-phase.
11. If an existing contract is unclear, stop and inspect consumers/tests/database before changing it.
12. A phase is not complete because the UI renders; it is complete only when the setting/feature actually affects its consumer and passes its tests.

# PHASE A — Settings Control Center Audit ✅

## A1 — Inventory the existing Settings system

Audit before coding:

- `SettingsPage`
- `SettingsContext`
- branch settings
- company settings
- existing database settings tables/columns
- existing settings hooks/API/RPCs
- existing consumers
- existing permissions
- existing tests

Produce a mapping:

`Setting → storage → API/context → consumer → permission → test`

Do not create duplicates.

## A2 — Reorganize Settings UI

Create a clear Settings Control Center with grouped navigation/sections:

1. Company & Identity
2. Branches & Locations
3. POS & Sales
4. Orders & Tables
5. Products & Catalog
6. Inventory & Warehouses
7. Purchasing & Suppliers
8. Production & Recipes
9. Kitchen / KDS
10. Delivery
11. Customers & Loyalty
12. Discounts & Promotions
13. Invoices / Tax
14. Receipts & Printing
15. Accounting & Finance
16. Employees / Roles / Security
17. Notifications
18. System / Integrations

Only expose sections/settings that have a real implementation or are clearly labelled planned.

## A3 — Company & Identity

Where supported by current architecture:

- company name
- legal name
- logo
- phone/email
- address
- currency
- timezone
- language
- date/time format
- fiscal year configuration
- default branch

Respect existing `effectiveSettings` behavior.

## A4 — Branch & Location Controls

- active/default branch
- branch identity
- branch contact information
- branch operating status
- branch-specific POS settings
- branch-specific receipt settings
- branch-specific inventory settings
- branch-specific order settings

Never weaken branch isolation.

## A5 — POS & Sales Settings

Expose only settings that have real consumers:

- default order type
- default payment behavior
- allow/deny negative stock
- discount behavior
- price/tax behavior
- receipt behavior
- cashier workflow options
- active order behavior
- table/order behavior

Default POS opening state must become:

**Takeaway / External Order**

The cashier should enter the sale immediately without an obligatory order-type selection screen.

Order type remains changeable at any time.

## A6 — Orders & Tables

- table behavior
- table capacity rules where supported
- order start behavior
- active-order behavior
- hold/resume behavior
- order numbering/reference behavior

Do not change existing table-floor-plan functionality unless required by the listed UX behavior.

## A7 — Inventory Settings (ERP-01 Core)

Implement real settings for:

- low-stock alerts
- reorder point
- minimum stock
- maximum stock
- negative stock policy
- stock adjustment permissions/reasons
- stocktake behavior
- batch/lot tracking where supported
- expiry tracking where supported
- valuation method where supported
- branch/warehouse overrides

Every setting must have a real consumer.

## A8 — Purchasing / Production / Kitchen / Delivery Settings

Where existing architecture supports them, organize controls for:

- purchasing defaults
- supplier workflow
- receiving
- recipe/production behavior
- kitchen routing
- preparation-time settings
- delivery zones/fees
- driver assignment behavior

Do not invent unsupported backend functionality simply to fill the UI.

## A9 — Customers / Loyalty / Promotions

Prepare real control points for:

- customer defaults
- loyalty rules
- points behavior
- promotion/discount behavior
- customer/order restrictions

Only implement backend behavior when required and testable in ERP-01.

## A10 — Tax / Receipts / Accounting

Organize existing controls for:

- tax mode/rates where supported
- invoice numbering
- receipt numbering
- receipt layout/options
- print behavior
- accounting defaults
- payment/tender configuration

Do not alter accounting posting logic unless explicitly required by a tested ERP-01 issue.

## A11 — Security / Roles / Notifications / Integrations

Settings must respect roles and permissions.

- Super Admin remains unrestricted.
- Branch users remain branch-isolated.
- Managers see only settings permitted to their role.
- Cashier settings must not expose administrative controls.
- Audit setting changes.
- Organize notification and integration controls that already exist.

# PHASE B — POS Screen Organization ✅

## B1 — Remove forced order-type selection

When `/pos` opens:

- start directly on Takeaway/External Order.
- show the product browser and current order immediately.
- keep order type change available.
- preserve all existing `pos-*` test IDs and interaction contracts.

## B2 — Bottom POS navigation

Create a persistent bottom action/navigation area containing:

- Active Orders
- Delivery
- Tables
- Takeaway / Quick Order if appropriate

These should open as drawers, popovers, panels, or same-screen sections.

Rules:

- do not navigate away from POS unnecessarily.
- preserve current order state.
- opening a panel must not clear the basket.
- closing a panel returns to the same order.
- preserve accessibility labels and keyboard behavior.

## B3 — Active Orders

Active orders should be accessible without leaving POS.

Support:

- view
- search/filter where already supported
- resume
- inspect status

# PHASE C — Resume Order / Kitchen Incremental Sending ✅

This is a behavioral fix and must be treated as high priority.

## C1 — Item lifecycle

Audit current order-item state and kitchen-send logic.

Target conceptual states:

- new
- sent
- preparing
- ready
- served
- cancelled

Use existing schema/status concepts when available; do not duplicate them.

## C2 — Resume behavior

When an existing order is resumed:

- previously sent items must remain sent.
- newly added items must be identifiable as new.
- saving/resuming must not resend old items.
- only unsent/new kitchen items should be sent to KDS/kitchen.
- the kitchen must retain the full order context.

Prevent:

- duplicate kitchen tickets
- duplicate item sending
- old item re-send
- lost item status
- POS/KDS state divergence

## C3 — Regression tests

Add tests for:

1. create order → send item → resume → add item → send only new item.
2. resume without changes → send nothing new.
3. resume → modify quantity according to existing business rules.
4. repeated resume does not duplicate kitchen output.
5. old items remain in original kitchen state.

# PHASE D — Payment & Full Receipt Review ✅

## D1 — Payment layout

Payment must not hide the entire sale screen.

Use a same-screen payment experience:

- POS/order remains visible.
- payment methods remain visible.
- receipt preview remains visible.
- customer can review the full order with the cashier.

## D2 — Full Receipt Preview

Show:

- products
- quantities
- unit prices
- discounts
- subtotal
- tax
- service charge where applicable
- delivery charge where applicable
- total
- customer
- order type
- table/vehicle/delivery details where applicable
- amount paid
- remaining/change
- payment method(s)

Do not hide payment methods because of receipt display.

## D3 — Payment methods

Preserve existing payment methods and contracts.

Support existing:

- cash
- card
- mixed payment
- other configured methods

Do not add a method without backend/accounting support.

## D4 — New order after payment

After successful payment:

- finalize current order using existing authoritative process.
- show completion/receipt state.
- make POS immediately ready for a new order.
- default the new order to Takeaway/External Order.

# PHASE E — Report Center / Report Builder ✅

## E1 — Unified report selector

All supported reports should be selectable from one Report Center filter.

Categories:

### Sales

- Sales Summary
- Sales by Product
- Sales by Category
- Sales by Branch
- Sales by Employee
- Sales by Order Type
- Sales by Payment Method
- Discounts
- Refunds
- Voids

### Inventory

- Stock
- Stock Movement
- Stock Valuation
- Stock Variance
- Low Stock
- Expiry
- Transfers
- Waste

### Purchasing

- Purchases
- Purchases by Supplier
- Purchase Items
- Supplier Price History
- Receiving

### Production

- Production
- Consumption
- Production Variance
- Recipe Cost
- Waste

### Financial

- General Ledger
- Trial Balance
- Profit & Loss
- Balance Sheet
- Cash Flow
- Accounts Receivable
- Accounts Payable
- Treasury
- Payments
- Bank Reconciliation

### Operations

- Shifts
- Cashier
- Tables
- Delivery
- Drivers
- Kitchen
- Preparation Time

Only list reports that actually exist or are implemented in the current ERP-01 scope. Do not create fake report entries.

## E2 — Dynamic filters

After selecting a report, expose relevant filters:

- date from/to
- branch
- warehouse
- employee
- cashier
- customer
- supplier
- product
- category
- order type
- payment method
- table
- driver
- status
- shift
- recipe
- production order

Filters must actually affect the query/data source.

## E3 — Multiple analysis modes

Where supported, allow:

- summary
- detailed rows
- grouped by branch
- grouped by product
- grouped by category
- grouped by employee
- grouped by payment method
- grouped by order type
- trend/time series

Do not fabricate calculations; use authoritative database/API data.

## E4 — Export

Support existing infrastructure for:

- Print
- PDF
- Excel
- CSV

Exports must match the selected filters and displayed report.

# PHASE F — Tests & Verification ✅ CI GREEN (PR #5, run 31813850004)

- `verify` ✅ — `npm ci` (lockfile fixed at `2382280`, see PHASE F notes below), lint, typecheck:all, test:unit **236/236**, build.
- `db` ✅ — Postgres + migrations + `verify-schema.js` + `stub_auth.sql` + security/RLS regression: **integration 154/154**.
- `browser-smoke` ✅ — `npx playwright test --project=chromium`: **50/50** (public-smoke 38 + dashboard-navigation 3 + pos-actions 9).
- Netlify deploy preview ✅.
- PHASE F note — defects found ONLY by live CI (CI is authoritative):
  1. lockfile: locally regenerated with npm 11 dropped `esbuild@0.28.x` → CI npm 10 rejected (`npm ci` EUSAGE). Fixed by regenerating with npm 10.9.9 (`2382280`).
  2. migration 069: new order_item lines were not registered in `_upd_matched`, so the deletion sweep removed the added line (kitchen_sends `items_sent_count` 0). Fixed with `RETURNING id INTO v_matched_id` + insert (`d4c5e84`).
  3. E2E pos-actions: spec expected the order-type picker on entry to `/pos`, but ERP-01 change B opens POS on Takeaway (picker now via New Order). Added `data-testid="pos-action-new-order"` and updated `beforeEach` (`fde107f`).

If CI differs from local results, CI is authoritative.

# PHASE G — Documentation & Audit ✅ CLOSED (2026-08-14)

Update:

- `docs/ERP-01_EXECUTION_PLAN.md`
- `docs/ERP_DEVELOPMENT_ROADMAP.md`
- `docs/REBUILD_MASTER_LOG.md` only with a concise ERP-01 status entry if appropriate

Record:

- files changed
- migrations
- RPCs/API changes
- settings added
- real consumers
- tests
- CI runs
- known limitations
- technical debt
- rollback notes

# DEFINITION OF DONE

ERP-01 is complete only when:

- Settings is organized as a coherent control center.
- Every implemented setting has real storage and a real consumer.
- POS opens directly on Takeaway/External Order.
- Bottom POS navigation exposes Active Orders, Delivery, and Tables without unnecessary page navigation.
- Resume Order no longer duplicates kitchen sends and sends only genuinely new kitchen items.
- Payment shows the complete receipt while keeping payment methods and POS context visible.
- After payment, POS is immediately ready for a new order.
- Report Center has a unified report selector and dynamic real filters.
- Report output respects all selected filters.
- Existing routes, business logic, RBAC/RLS, Supabase contracts, and critical interaction identities remain intact.
- No fake settings or fake reports were introduced.
- All regression/unit/contract/DB/RLS/browser tests pass.
- Full CI is green on the final ERP-01 HEAD.
- Documentation is updated.

# IMPLEMENTATION ORDER

1. A1 — Settings audit
2. A2 — Settings organization
3. A3–A11 — Real settings wiring
4. B1–B3 — POS organization/default order flow
5. C1–C3 — Resume/Kitchen fix + regression tests
6. D1–D4 — Payment/receipt review
7. E1–E4 — Report Center/filtering/export
8. F — Full verification
9. G — Documentation
10. Final review and PR

# STOP CONDITIONS

Stop and report before proceeding if:

- a requested setting has no authoritative storage/consumer;
- implementing it requires changing RBAC/RLS unexpectedly;
- an existing RPC contract must be broken;
- POS transaction behavior is unclear;
- resume/kitchen state cannot be proven safe;
- report filters cannot be applied authoritatively;
- a test exposes a regression in existing functionality.

Never bypass a stop condition just to make the UI appear complete.

# CURRENT STATUS

- Status: **✅ COMPLETE — MERGED** — PHASE A–E complete and committed; PHASE F verification **fully green in CI** (verify ✅ 236/236 unit, db ✅ 154/154 integration, browser-smoke ✅ 50/50 E2E, deploy preview ✅ — PR #5 run 31813850004); PHASE G closed. **PR #5 merged into `main` on 2026-08-14 (merge commit `0c2d812`).**
- Branch: `erp-01-settings-organization`
- Production/main: **ERP-01 merged into `main` via PR #5 (2026-08-14).**

## Implementation record (commits, A→E)

| Commit | Phase | Change |
|--------|-------|--------|
| `469256b` | Spec | `docs/ERP-01_SETTINGS_POS_REPORTS_SPEC.md` — settings/POS/reports scope definition |
| `5e8444d` | A1 | `docs/ERP-01_SETTINGS_AUDIT.md` — settings surfaces + consumer matrix |
| `b8a7459` | A2–A11 | Unified Settings Control Center + wiring of real settings consumers (POS, receipt, inventory, tax, currency, security) |
| `b70ffed` | B1 | POS opens on Takeaway/External Order by default; order type changeable at any time |
| `6d8cae6` | B2–B3 | Persistent bottom POS navigation (Active Orders, Delivery, Tables) keeps cashier in-workspace; panels never clear the basket |
| `363b608` | C1–C3 | Resume/Kitchen incremental sending fix + regression tests |
| `a2bc51e` | D1–D4 | Full receipt review in POS payment; payment logic/methods preserved; POS ready for new order after payment (takeaway default) |
| `1f38fcd` | E1–E4 | Unified report center: contextual per-report dynamic filters + Excel/CSV/print output |

## Database / RPC changes

- **Migration `supabase/migrations/069_resume_order_kitchen_incremental.sql`** — rewrites `update_order` (same signature, additive) so a re-persisted order line keeps its `order_item_id` when product/unit/price/discount/bonus match; previously-sent kitchen items are never re-sent, newly added lines are sent exactly once, a same-cart re-persist is a no-op (`items_sent_count` 0). No RLS/grants/schema-object changes; no production data touched.
- No other migrations, tables, columns, or RPC signatures changed. Supabase/RBAC/RLS contracts preserved (to be re-confirmed by the live integration suite in PHASE F).

## Settings changes (real consumers only)

- The audit (`docs/ERP-01_SETTINGS_AUDIT.md`) mapped every settings surface to storage → API/context → consumer → permission → test and flagged UI-only settings.
- The Settings Control Center groups sections into Company/Identity, Branches, POS & Sales, Orders & Tables, Products & Catalog, Inventory & Warehouses, Purchasing, Production/Recipes, Kitchen/KDS, Delivery, Customers & Loyalty, Discounts/Promotions, Invoices/Tax, Receipts & Printing, Accounting & Finance, Employees/Roles/Security, Notifications, System/Integrations.
- Only settings with authoritative storage + real consumer are exposed; unsupported future settings remain explicitly marked planned (safety contract items 3–4).
- No new settings storage was created; existing SettingsContext/API/DB fields were reused.

## POS changes

- Default opening state: Takeaway/External Order (`takeaway`); product browser + current order visible immediately; order type switchable anytime (`usePosOrder.ts`, `PosWorkspacePage`).
- Bottom POS navigation exposes Active Orders, Delivery, Tables without leaving POS; opening a panel does not clear the basket; all `pos-*` test IDs and interaction contracts preserved.

## Resume / Kitchen (C)

- Root cause: `update_order` (046) deleted + re-inserted every line, and `order_kitchen_sends` references `order_item_id` ON DELETE CASCADE — resume/Hold→Send duplicated kitchen tickets.
- Fix: migration `069` preserves line identity for matched lines; send boundary remains `order_kitchen_sends` + `send_to_kitchen`.
- Regression coverage: `tests/integration/kitchen_sends.test.ts` (resume adds only new items; no-change resume sends nothing; repeated resume does not duplicate; old items keep kitchen state).

## Payment / Receipt (D)

- `PaymentPanel` rewrite: same-screen payment, full receipt preview (products/qty/prices/discounts/subtotal/tax/total/customer/order type/table/vehicle/delivery/paid/change/methods), methods remain visible.
- Payment methods preserved (cash/card/transfer/credit) — **mixed payment not added** because backend/accounting does not support it (no invented method).
- After payment: order finalized via existing authoritative flow, completion shown, POS reset and ready for a new order defaulting to Takeaway.

## Reports (E)

- Unified selector preserved (14 operational + 9 financial gated by `reports.financial`).
- Contextual per-report dynamic filters (report-specific dimensions incl. branch, warehouse, cashier, customer, supplier, product, category, table, order type, payment method, status; date range; real-time/fixed reports hide date fields) — all filters drive authoritative queries.
- Export: Excel (`.xlsx` via existing `xlsx` dependency), CSV (RFC-4180 + BOM), Print/PDF via print window.
- E3 analysis modes: not implemented as an explicit mode switcher — reports aggregate per type; flagged as known limitation (plan permitted "where supported").

## Tests added (ERP-01)

- `tests/unit/reportFilters.test.ts` — per-report filter dimension contract + `apply*Filters` (9 tests).
- `tests/unit/reportExport.test.ts` — CSV/print export contract (6 tests).
- `tests/unit/reportsCenterContract.test.ts` — extended: unified selector contract preserved (4 new blocks; old contract unbroken).
- `tests/components/pos-payment-panel.test.tsx` — payment receipt review contract.
- `tests/integration/kitchen_sends.test.ts` — Resume/KDS incremental-send regression (live DB).

## Local gate results (PHASE F) — re-verified 2026-08-14 on fresh install

- `npm ci` ✅ (fresh install; added 480 packages, audited 481) — the devDependency gap fix is in place: `@playwright/test@^1.62.1` is declared (commit `32d2faa`), so `npm ci` and `typecheck:all` are deterministic. Non-blocking `allow-scripts` warning for the `esbuild` postinstall was observed; every later gate still passed. (Note: earlier report recorded 477 packages; actual fresh-install count is 480 — npm resolution version detail, no dependency change.)
- `npm run lint` ✅ (0 errors; 16 pre-existing warnings)
- `npm run typecheck` ✅
- `npm run typecheck:all` ✅ (includes type-checking `tests/e2e`)
- `npm run test:unit` ✅ 236/236 across 19 files
- `npm run build` ✅ (~25s)

## Verification still pending (PHASE F) — blocked on environment; classified precisely

No environment values exist in this checkout (no `.env`; git-ignored) and none were invented. The remaining gates are **environment-blocked**, not passed:

1. **`npm run test:integration`** — locally `NOT EXECUTED — ENVIRONMENT BLOCKED` (no DB URL; 154/154 skipped). **First live run in CI (PR #5, `db` job) executed the full suite: 154 tests → 153 passed, 1 failed.** The failure was real and in ERP-01's own path: `kitchen_sends.test.ts` "resume + add item + send + payment: only the new line reaches KDS (ERP-01)" — in 069's rewrite, newly inserted `order_items` lines were never recorded in `_upd_matched`, so the deletion sweep (`DELETE ... NOT EXISTS (_upd_matched)`) immediately removed the added line → `items_sent_count` 0 instead of 1. **Fixed:** the insert now uses `RETURNING id INTO v_matched_id` and registers the new line in `_upd_matched`. Also fixed the CI `npm ci` EUSAGE on npm 10 (lockfile regenerated with npm 10.9.9 to restore the `esbuild@0.28.x` platform packages that local npm 11 had dropped). Re-run in progress. Covers migration `069` + the RLS/security suites (`rls_branch_isolation`, `p0_security_hardening`, `rbac_hardening`, `phase4_security_contract`, `process_sale_*`, `update_order`, `floorplan_orders`, `order_lifecycle_guards`). The repo's sanctioned way to run it locally is the CI `db` job recipe (`.github/workflows/verify-main.yml`): local Postgres + `stub_auth.sql` + migrations + `verify-schema.js` + `disable_subscription_guard.sql` + `seed_raw_material_branch.sql`, then `npm run test:integration`. No Postgres/Docker is installed on this machine, so it cannot be executed here.
2. **Browser E2E** (`pos-actions` 9, `public-smoke` 38 — 2 + 36 protected routes, `dashboard-navigation` 3 = 50 tests) — locally **BLOCKED BY ENVIRONMENT**, but **the first CI `browser-smoke` run executed it: 41/50 passed** (public-smoke + dashboard-navigation), **9 failed** — all in `pos-actions.spec.ts` at the same `beforeEach` step, which expected `pos-order-type-picker` immediately on entering `/pos`. ERP-01 change B (POS opens directly on Takeaway; the order-type picker now opens via the **New Order** button, `setStartStep('type')`) made that precondition stale. **Fixed:** added `data-testid="pos-action-new-order"` to the New Order button (`PosTopBar`) and updated `beforeEach` to open the picker through it; every testid the spec relies on exists in the current code. Re-run pending. Requirements to run it locally: a git-ignored `.env` with `VITE_SUPABASE_URL` set **exactly** to the specs' mock origin `https://lwnsdsncmlsroiswgoga.supabase.co` (`SUPABASE_ORIGIN` in `pos-actions.spec.ts` / `dashboard-navigation.spec.ts`, so `page.route()` interceptors match) and a non-empty `VITE_SUPABASE_ANON_KEY`.
   - Why required locally: `src/lib/supabase.ts` calls `createClient(...)` at module scope and `@supabase/supabase-js` throws synchronously (`supabaseUrl is required.` / `supabaseKey is required.`) when either is missing; this module is imported eagerly by `AuthContext`/`SettingsContext`/`RolesContext`/`api/client.ts`, so the whole app (including the `public-smoke` login page) fails to boot without the values at build time.
   - Then `npm run build` (with the values) → `npx playwright test` (`playwright.config.ts` auto-starts `npm run preview -- --host 127.0.0.1 --port 4173` serving `dist/`). `@playwright/test@^1.62.1` and chromium revision 1234 (matching the installed version) are already present.
3. **RLS/security review of migration `069`** — static review passed (function-only replacement; no RLS/grants/schema-object changes; branch guard byte-identical to 046; send boundary `order_kitchen_sends` + `send_to_kitchen` untouched). **However, the live `db` gate found a logic bug the static review missed** (new lines swept by the deletion pass — see item 1), now fixed at `d4c5e84`; **live confirmation: `db` gate ✅ 154/154 (run 31813850004).**

## Known limitations & technical debt

- No delivery service/fees exist in the system; delivery-receipt lines are display-only where present.
- Mixed payment unsupported by backend/accounting — a single payment method is preserved per sale.
- E3 explicit grouped/trend analysis modes not implemented (reports aggregate per type).
- `test:integration` self-skips locally without `SUPABASE_DB_URL`/`DATABASE_URL`.
- Pre-existing technical debt (from P7, not introduced by ERP-01): `src/features/pos/hooks/usePosSummary.ts` is unused and flagged for a future cleanup decision.

## Rollback notes

- Feature branch rollback: revert the ERP-01 commits (`1f38fcd`..`469256b`) on this branch before any merge.
- Database rollback for migration `069`: recreate the previous `update_order` definition (from migration `046`) via a new migration; no data migration involved.
- No production data was changed by ERP-01 (safety contract item 8).
