# Premier UI Rebuild — Master Plan & Progress Log

> **Persistent source of truth. READ THIS FILE BEFORE EVERY SESSION AND BEFORE EVERY EDIT, and update it after every meaningful fix, CI result, phase change, or architectural decision.**

## Current Execution

**Branch:** `main` (production baseline after PR #4 merge)
**Former working branch:** `ui-visual-rebuild-6h`
**Base:** `main` after PR #3 merge (`15847d1`)
**Bundle:** 6H + 6I — Full Visual Rebuild (Security + App Shell + Design System + Dashboard + Reports Center + POS)
**Deployment:** GitHub Pages auto-deploys from `main` via `.github/workflows/deploy.yml` (build + DB/RLS + e2e gates). The deployed site reflects green `main` only.
**Status:** **MERGED + DEPLOYED / COMPLETE.** Final PR #4 head `88606d9`; merge commit `d390c47`. Final main verification and GitHub Pages deployment passed on `d390c47`. Rollback tag `rb-6h-base` remains available.

## Final Merge & Production Checkpoint

PR #4 (`https://github.com/Premieros/Premier/pull/4`, head `ui-visual-rebuild-6h`) was completed and merged into `main` after the full P7 gate.

| Check | Result |
|-------|--------|
| PR #4 final HEAD `88606d9` — verify | ✅ success |
| PR #4 final HEAD — db | ✅ success |
| PR #4 final HEAD — browser-smoke | ✅ success |
| Merge commit `d390c47` | ✅ merged to `main` |
| Verify main on `d390c47` | ✅ success |
| Deploy to GitHub Pages on `d390c47` | ✅ success |

PR #4 is now **closed + merged**, not Draft. This is the production baseline for the completed 6H + 6I visual rebuild.

## CI Checkpoint — P0 + P1 (green)

PR #4 after pushing P0 (`690eb71`) + P1 (`82f59a8`):

| Check | Result |
|-------|--------|
| verify (lint / typecheck:all / unit / build) | ✅ success |
| db (Postgres migrations + RLS + integration/security tests incl. P0) | ✅ success |
| browser-smoke | ✅ success |

## CI Checkpoint — P3 (green)

After pushing P3 (`ea801f1`, 6H-C dashboard contract) on top of P0+P1+P2:

| Check | Result |
|-------|--------|
| verify | ✅ success |
| db | ✅ success |
| browser-smoke | ✅ success |
| Redirect rules | ✅ success |
| Header rules / Pages changed | neutral |

## CI Checkpoint — P4 (green)

After pushing P4 (`9fb9d5d`, reports center with two dropdowns):

| Check | Result |
|-------|--------|
| verify | ✅ success |
| db | ✅ success |
| browser-smoke | ✅ success |
| Redirect rules | ✅ success |
| Header rules / Pages changed | neutral |

## CI Checkpoint — P5 (green)

After pushing P5 (`8152eb7`, shared components on ui tokens + interaction-identity registry):

| Check | Result |
|-------|--------|
| verify | ✅ success |
| db | ✅ success |
| browser-smoke | ✅ success |
| Redirect rules | ✅ success |
| Header rules / Pages changed | neutral |

## CI Checkpoint — P6 (green)

After pushing P6 (`POS visual on ui tokens`, on top of P5):

| Check | Result |
|-------|--------|
| verify | ✅ success |
| db | ✅ success |
| browser-smoke | ✅ success |
| Redirect rules | ✅ success |
| Header rules / Pages changed | neutral |

## CI Checkpoint — P7 (green)

After pushing P7 (`legacy removal + final gate`, on top of P6):

| Check | Result |
|-------|--------|
| verify | ✅ success |
| db | ✅ success |
| browser-smoke | ✅ success |
| Redirect rules | ✅ success |
| Header rules / Pages changed | neutral |

## Deployment & Branch Workflow (locked decision — user approved)

1. All visual + security work happens **ONLY** on `ui-visual-rebuild-6h` (the trial branch). **Never** develop directly against the published site (production Supabase data).
2. CI verification on the branch runs through a **PR into `main`** (verify-main.yml triggers on PR). Each push to the branch refreshes PR checks.
3. Merge the PR into `main` only at green checkpoints → `main` push auto-deploys to GitHub Pages.
4. `netlify.toml` is dormant/legacy; GitHub Pages is the active host (do not touch).
5. Local git fetch refspec was fixed to `+refs/heads/*:refs/remotes/origin/*` so all remote branches are visible.

## Non-Negotiable Safety Contract

- Preserve all existing business logic, data fetching, mutations, API contracts, routes, authentication, permissions, RBAC, branch isolation, POS transaction logic, tables/orders/delivery/takeaway/car/quick-order flows, payments, printing, discounts, split/hold/send/close/save actions, kitchen integration, and customer display behavior.
- **Buttons/actions never lose their identity or function wherever they move** — every stable `data-testid` and handler contract must survive the redesign, locked by a contract test.
- UI changes must reuse existing hooks, queries, mutations, and handlers wherever possible.
- **No Supabase schema/RLS change except as a separate, approved, tested migration** (see P0). Never ship a DB change inside a visual commit.
- Do not delete legacy UI until all consumers are identified and the replacement is verified.
- Never weaken or remove existing tests to accommodate the new design.
- Create rollback-safe commits/checkpoints (`rb-*` tags) before risky migrations or deletions.
- Every meaningful implementation, decision, fix, CI result, and phase transition must be recorded here.

## P0 — Security & Branch Isolation (approved — highest priority)

Fixing all audit gaps before/alongside the visual work. Each item is a DB migration + integration/RLS test.

Audited gaps (from the completed branch-isolation audit):

| # | Severity | Gap | Fix |
|---|----------|-----|-----|
| 1 | CRITICAL | `process_sale` executable by `anon`, SECURITY DEFINER, branch guard passes when `auth.uid()` is NULL → cross-branch write | Revoke from `anon`/`public` (keep `authenticated`), harden guard to require `auth.uid()` |
| 2 | Read leak | `raw_materials` RLS `USING (true)` → cross-branch read | Scope to branch |
| 3 | Read leak | `product_components` RLS `USING (true)` → cross-branch read | Scope to branch |
| 4 | LOW | `subscription_status` readable by `anon` for any branch | Restrict to `authenticated` |
| 5 | App leak | `recipe_costs` RPC has no branch filter | Enforce branch scope for non-admins |

## 6D–6G — VERIFIED / CLOSED

6D–6G was completed on the previous rebuild branch and verified by Run #160. The unified `Design*` surface package, list/filter/table migrations, stable test IDs, shell/login/dashboard reconciliation, DB/RLS checks, and browser smoke passed.

## 6H + 6I — Full Visual Rebuild Bundle

### P1 (6H-A) — Design Tokens — DONE
- Established the new visual language via CSS variables + Tailwind config, linked to the brand-color engine.
- `src/index.css`: expanded `--ui-*` token set (primary violet `#5b2bd8` + hover/active/soft/fg, `--ui-accent` = `var(--brand-600)` so accents/charts follow the merchant brand engine, surface/raised, page/page-alt, border/strong, text/muted/subtle, success/warning/danger/info, radius scale `sm/…/2xl`, shadow scale `sm/xl`, focus ring) + `.dark` token overrides for neutrals.
- `tailwind.config.js`: new `ui` color namespace (`bg-ui-page`, `text-ui-text`, `bg-ui-primary`, `text-ui-muted`, …), `shadow-ui-*` scale, `rounded-ui*` scale.
- `body` now uses `bg-ui-page text-ui-text`; `.ui-surface` uses `var(--ui-shadow)`.
- Brand linkage: primary stays violet by default (approved identity); `--ui-accent` follows the brand engine (`--brand-600`), so merchant brand still drives highlights/charts. Decision recorded for future phases.
- Keep semantic identities and interaction behavior unchanged.

### P2 (6H-B) — App Shell — DONE
- Rebuilt Sidebar, Header, navigation hierarchy, content surface and responsive shell on the new `ui-*` tokens (`Layout.tsx`).
- Added a global **active-branch indicator** + **admin branch switcher** in the header: `data-testid="branch-indicator"`, dropdown `branch-menu` with `branch-option-all` and `branch-option-{id}`. Non-admins see a read-only chip pinned to their branch; admins pick "All branches" or any branch.
- New lightweight global store `src/lib/activeBranch.ts` (`getActiveBranchId` / `setActiveBranchId` / `useActiveBranchId`, persisted to `localStorage`) — the shell indicator uses it now; P3 wires the dashboard to it.
- Preserved ALL stable IDs: `app-shell`, `app-sidebar`, `app-navigation`, `nav-group-{group}`, `nav-group-toggle-{group}`, `nav-item-{id}`, `sidebar-close`, `sidebar-open`, `mobile-sidebar-backdrop`, `assistant-card`, `app-header`, `top-navigation`, `top-tab-{key}`, `active-orders-button`, `active-orders-count`, `user-menu-button`, `language-toggle`, `theme-toggle`, `sign-out-button`, `app-main`, `design-content-surface`.
- Route guards, permissions, active-navigation behavior, `navigate('/floor-plan')` active-orders handler, and all existing handlers unchanged.

### P3 (6H-C) — Dashboard — DONE (pushed, CI green)
- Complete the `VisualDashboardPage` contract, restoring everything the old `DashboardFoodicsPage` had:
  - Currency from `effectiveSettings().currency` (not hardcoded `EGP`).
  - Admin branch picker wired to the global active-branch store (`useActiveBranchId`), with the correct guard `isAdmin ? activeBranchId : branchFilter` (old `isAdminRole(...) ? branchFilter : branchFilter` was a no-op).
  - KPI report deep links `to="/reports?reportType=…"` (sales, sales_by_payment, sales_by_product, detailed_invoices).
  - Year range, previous-period comparison, order-type filter, export.
- Preserve all existing Supabase data, filters, metrics and chart data contracts.
- New contract test `tests/unit/dashboardContract.test.ts` (currency source, `isAdmin ? activeBranchId : branchFilter`, KPI deep links, year/comparison/filter/export, no `branchFilter : branchFilter`).
- Removed unused lucide imports (`Activity`, `CalendarDays`, `Package`).
- Local gates green: lint 0 errors (16 pre-existing warnings), typecheck:all, `test:unit` 144/144 (fixed one contract assertion: `data-testid={testId}` is rendered as `<Metric testId="…">`), build pass. Two earlier test timeouts (`brandColor` / `pages.smoke`) were parallel-load artifacts — pass in isolation and in full sequential run.

### P4 (6H-P4) — Reports Center — DONE (pushed, CI green)
- Dropdown 1 = report type: `data-testid="report-type-select"` grouping all 14 operational + 9 financial types (`optgroup` Operational / Financial). Financial options render only with the `reports.financial` permission; selecting one navigates to `/financial-reports?view=<key>&from=<from>&to=<to>`.
- Dropdown 2 = contextual period filter: `data-testid="report-context-filter"` with presets (today / yesterday / last7 / last30 / this month / last month / this year / custom) driving `from`/`to`; manual date edits reset to custom. New i18n key `filterByPeriod`.
- **Preserved the contract:** compact quick-access chip row keeps `button[data-report-type="<key>"]` for all 14 operational + 9 financial keys, and `/reports?reportType=…` deep links still resolve via `ReportDeepLinkPage`.
- `FinancialReportsPage` now reads `?view` / `?from` / `?to` (deep-linkable) and its view buttons carry `data-report-type`.
- Reports center restyled on `ui-*` tokens (surface, page-alt, primary, border, shadows).
- New contract test `tests/unit/reportsCenterContract.test.ts` (dropdowns, financial gating, `button[data-report-type]`, deep links, financial navigation, period presets).
- Local gates green: lint 0 errors (16 pre-existing warnings), typecheck:all, `test:unit` 150/150, build.

### P5 (6H-D) — Shared Components + Full Sweep — DONE (pushed, CI green)
- **Interaction-Identity Registry** `src/lib/interactionIdentity.ts`: central list of every stable `data-testid`/handler contract (shell, dashboard KPIs, reports center, deep links, financial views, data-table, design primitives, POS bottom bar — 60+ contracts) with its owning file + required behavior marker.
- New contract test `tests/unit/interactionIdentity.test.ts`: fails if any registered identity or its documented behavior marker is removed/renamed from the source.
- Swept shared components onto `ui-*` tokens (auto dark-mode via token overrides):
  - `Card` (`PageHeader.tsx`) → `bg-ui-surface border-ui-border rounded-ui-xl shadow-ui`; header title/subtitle/breadcrumbs → `ui-text`/`ui-muted`/`ui-subtle`.
  - `Button` variants → `bg-ui-primary`/`bg-ui-page-alt`/`border-ui-border-strong`, `focus-visible:ring-ui-ring`, `rounded-ui*` scale, `shadow-ui-sm`.
  - `Input`/`Select`/`Textarea` → `bg-ui-surface-raised`, `border-ui-border`, `placeholder-ui-subtle`, error → `text-ui-danger`.
  - `Modal` → `bg-ui-surface rounded-ui-xl shadow-ui-xl ring-ui-border` + `ui-*` header/close.
  - Design package: `DesignSearch`, `DesignStates` (loading/empty/error), `DesignFilterBar`, `DesignPanel` header, `PaginationBar` → `ui-*` tokens.
- No business logic touched; all stable testids unchanged.
- Local gates green: lint 0 errors (16 pre-existing warnings), typecheck:all, `test:unit` 213/213, build.

### P6 (6I-A..D) — POS Visual
- 6I-A POS Workspace layout; 6I-B Product Browser / Order Panel; 6I-C Order Types / Tables (Table, Delivery, Takeaway, Car, Quick); 6I-D Active Orders / Kitchen integration UI.
- Presentation only — preserve every existing handler, data contract, table availability, occupied-table, guest-count and order-selection logic.

### P7 — Safe Legacy Removal + Final CI + PR — DONE
1. Consumer audit: identify every import/route of `DashboardFoodicsPage`, orphan POS components (`TypeChangePicker`, `OrderTypeQuickPicker`, unused `src/ui`), and any legacy surfaces.
2. Remove them only after the replacement is fully verified by tests.
3. Full gate: lint, typecheck:all, unit/smoke, build, DB/RLS integration/security, browser e2e.
4. Merge PR into `main` → auto-deploy. **Completed:** PR #4 merged as `d390c47`; Verify main and GitHub Pages deployment passed.

## 6H–6I Execution Rules

1. Work only on `ui-visual-rebuild-6h`; `main` is protected from direct UI changes.
2. Bundle related stages into CI batches, but keep clear internal checkpoints: Batch 1 = P0 (DB), Batch 2 = P1+P2+P3, Batch 3 = P4, Batch 4 = P5+P6, Batch 5 = P7.
3. Preserve every existing functional contract; run the contract tests before and after each batch.
4. Add focused regression/contract tests for critical interactions when needed (never weaken existing ones).
5. Do not delete legacy UI until replacement consumers are verified.
6. If any regression appears, **stop**, fix the root cause, and rerun the affected + full gates before continuing.
7. The bundle is complete only when the new UI is visibly different, functional behavior is preserved, tests pass, and the legacy surface has a safe removal plan.

## Implementation Progress — 6H + 6I

### Completed
- Created isolated branch `ui-visual-rebuild-6h` from `main`.
- Began the genuinely new Dashboard visual surface on the isolated branch.
- Recorded this bundle and its safety contract in the master log before continuing implementation.
- Fixed 6h-branch baseline: removed unused `APP_ROUTES` import; aligned recharts `Tooltip formatter` typing with repo convention (`Number(value ?? 0)`).
- Baseline gates green locally: lint (0 errors), typecheck:all, test:unit (139 passed), build.
- Rollback tag `rb-6h-base` created.
- Fixed local git fetch refspec so all remote branches are visible.
- **P0 (security) done & pushed** — migration `068_security_harden_audit_gaps.sql` (revoke `process_sale` from anon/public, restrict `subscription_status`, branch-scope `product_components` SELECT via parent product), `ReportsPage.tsx` `recipe_costs` branch filter, integration tests `tests/integration/p0_security_hardening.test.ts`. Local gates green; pushed to PR #4 for CI. Commit `690eb71`.
- **P1 (design tokens) done** — expanded `--ui-*` tokens + `.dark` overrides in `src/index.css`, `ui` color namespace + shadow/radius scales in `tailwind.config.js`. Local gates green (lint 0 errors, typecheck:all, 139 unit tests, build).
- **P2 (app shell) done** — restyled shell on `ui-*` tokens + global active-branch indicator/admin switcher (`src/lib/activeBranch.ts`, header `branch-indicator`). All stable IDs + handlers preserved. Local gates green.
- **P3 (dashboard contract) done locally** — rewrote `VisualDashboardPage.tsx` on `ui-*` tokens with the full contract (currency from `effectiveSettings`, branch picker via `useActiveBranchId`, KPI deep links, year range, previous-period comparison, order-type filter, export menu). New `tests/unit/dashboardContract.test.ts`. Local gates green (lint, typecheck:all, test:unit 144/144, build).
- **P4 (reports center, two dropdowns) done** — report-type dropdown (14 operational + 9 financial gated by `reports.financial`, financial navigate to `/financial-reports?view=…`) + contextual period dropdown; preserved `button[data-report-type]` chips and `/reports?reportType=…` deep links; `FinancialReportsPage` reads `?view/from/to`. New `tests/unit/reportsCenterContract.test.ts`. Local gates green (lint, typecheck:all, test:unit 150/150, build). Pushed `9fb9d5d`; PR #4 CI green (verify, db, browser-smoke).
- **P5 (shared components + identity registry) done** — Interaction-Identity Registry `src/lib/interactionIdentity.ts` (60+ contracts) + `tests/unit/interactionIdentity.test.ts`; swept `Card`, `Button`, `Input`/`Select`/`Textarea`, `Modal`, `DesignSearch`, `DesignStates`, `DesignFilterBar`, `DesignPanel`, `PaginationBar` onto `ui-*` tokens. Local gates green (lint, typecheck:all, test:unit 213/213, build). Pushed `8152eb7`; PR #4 CI green (verify, db, browser-smoke).
- **P6 (POS visual) done** — swept the entire POS feature onto `ui-*` design tokens, presentation-only (no logic/props/handlers/testids changed; all `pos-*` data attributes, bottom-bar `onClick={() => setOrdersOpen(true)}`, and its aria-label preserved): `PosWorkspacePage` (workspace shell, loading/error screens, receipt modal), `PosTopBar`, `ProductBrowser` (search, category chips, cards, stock badges), `CurrentOrderPanel` (chips, cart rows, steppers, totals, pay = `bg-ui-success`, discount editor), `PaymentPanel` (method cards, paid input, change banner, confirm), `OrderTypeBottomBar` (drawer + bottom nav pill), `ActiveOrdersDrawer` (backdrop/aside/filters/cards/actions), `KitchenPanel` (sends, status badges), `TablesPanel` + `TableFloorPlan` (floor canvases, table cards), `OrderStartWizard` + `OrderTypePicker` + `CarOrderStep` + `DeliveryOrderStep` + `TablePickerStep` + `TableActionModal` + `OrderTypeQuickPicker` + `TypeChangePicker`, `ActiveOrdersPage` (StatCard color map via shared `PageHeader.tsx`, branch select, filters, order cards, table form inputs). Utility style maps tokenized: `orderTypes.ts` `STATUS_STYLES`, `orderStage.ts`, `orderState.ts` (+ `OrderStateDot`), `orderLabels.ts` `ORDER_TYPE_META` pill. `shadow-pos`/`hover:shadow-card-hover` → `shadow-ui-*`. No hardcoded slate/navy/gold/brand/emerald/amber/red/sky/blue/orange/green color classes remain under `src/features/pos`. Local gates green (lint 0 errors, typecheck:all, test:unit 213/213, build).
- **P7 (safe legacy removal) done** — full consumer audit completed first, then only proven orphans removed. **Replacement proof:** `VisualDashboardPage` (live via route `/dashboard` → `DashboardEnhancedPage`) contains every marker the legacy contract pinned (`reportType=sales|sales_by_payment|sales_by_product|detailed_invoices`, `to="/inventory"`, `setCompareEnabled`, `setFilterOpen`; no `sales_by_branch`, no `/pos/active`), and the `interactionIdentity` registry pins dashboard testids (`dashboard-surface`, `dashboard-branch-filter`, …) to `VisualDashboardPage`; POS bottom-bar nav + aria contracts remain pinned to `OrderTypeBottomBar`. **Contract tests before deletion: 117/117 green; after deletion: 117/117 green** (7 files: interactionIdentity, navigationRegression, dashboardContract, navigation-contract, navigationRegistry, reportsCenterContract, pages.smoke). **Deleted (11, all zero-consumer after audit):** `DashboardFoodicsPage.tsx`, `DashboardPage.tsx`, `DashboardControlCenterPage.tsx`, `DashboardFinalPage.tsx`, `DashboardModernPage.tsx` (legacy dashboard + compat wrappers), `DashboardChrome.tsx` (legacy shell adapter, only consumer was the deleted legacy page), `TypeChangePicker.tsx`, `OrderTypeQuickPicker.tsx` (orphan POS pickers, no import anywhere), `src/ui/AppCard.tsx`, `src/ui/AppStatCard.tsx`, `src/ui/index.ts` (orphan package, zero consumers in src/tests). **Kept:** `VisualDashboardPage.tsx`, `DashboardEnhancedPage.tsx` (live route), `OrderTypePill.tsx`, `OrderStageBadge.tsx`, `OrderStatusBadge.tsx`, `CurrentOrderPanel.tsx`, all start-wizard/table/orders/kitchen components (live consumers), `orderLabels.ts`/`orderStage.ts`/`orderState.ts`/`orderTypes.ts` (used by live components). **Test/config re-points (no contracts weakened):** `navigationRegression.test.ts` now reads `VisualDashboardPage.tsx` (same 9 assertions) and dropped the obsolete `DashboardChrome` read; `pages.smoke.test.tsx` renders `DashboardEnhancedPage` (the real route component); `eslint.config.js` removed the deleted-wrappers exception block. **Full gate green:** lint 0 errors (16 pre-existing warnings), typecheck:all, test:unit 213/213, build; DB/RLS integration 153 tests self-skip locally (no DB URL — runs in CI `db` job); browser-smoke runs in CI. **Observation (not deleted):** `src/features/pos/hooks/usePosSummary.ts` is unused but is a hook, not a listed legacy surface — flagged for a future cleanup decision. No business logic, RBAC/RLS, schema, routes, or POS behavior changed. Pushed; PR #4 CI green (verify, db, browser-smoke).
- **Final production checkpoint** — P7 report committed as `88606d9`; PR #4 merged into `main` as `d390c47`; Verify main and Deploy to GitHub Pages both passed on `d390c47`. Master log synchronized to `main` in this docs-only update.
- **ERP-01 (implementation A–E) done on branch `erp-01-settings-organization` — VERIFICATION PENDING.** Commits `469256b` (spec) → `5e8444d` (settings audit) → `b8a7459` (Settings Control Center + real consumer wiring) → `b70ffed` (POS takeaway default) → `6d8cae6` (bottom POS nav) → `363b608` (Resume/KDS incremental fix) → `a2bc51e` (full receipt review in payment) → `1f38fcd` (report center filters + Excel/CSV/print). Migration `069_resume_order_kitchen_incremental.sql` preserves `order_item_id` across `update_order` so kitchen sends stay incremental. New tests: `reportFilters`, `reportExport`, extended `reportsCenterContract`, `pos-payment-panel`, `kitchen_sends` (live). Local gates green: typecheck:all, lint 0 errors, test:unit 236/236, build. Production/main untouched; no PR opened.
- **Multi-Tenant Phase 1 (Foundation) — DONE.** PR #8 merged into `main` (merge commit `f27d4b6`). Schema: `organizations`, `organization_members`, `organization_invites` tables; `org_id` columns on `users`, `branches`, `products`, `customers`; `is_superadmin` flag on `users`; org-scoped RLS on all tenant tables. RPCs: `register_tenant()` (atomic org + first user + first branch + first product), `create_branch()`, `invite_member()`, `accept_invite()`, `remove_member()`, `transfer_ownership()`, `delete_organization()`. Integration tests: `multitenant_full.test.ts` (16 cases). CI green: verify ✅, db ✅, browser-smoke ✅.
- **Multi-Tenant Phase 2 (Branch Management) — DONE.** PR #10 OPEN: `https://github.com/Premieros/Premier/pull/10`. Branch `agent/multitenant-phase2` (from `agent/multitenant-foundation`). 12+ commits; latest `bbf4598`. CI ALL GREEN: verify ✅, db ✅, browser-smoke ✅ (workflow badge "build: passing"). Migration `20260821000000_branch_management_phase2.sql`: `create_organization_branch()` RPC (atomic: branch + warehouse + settings + trial subscription), `update_branch()`, `deactivate_branch()`, `assert_branch_active` trigger (blocks transactions on disabled branches), `guard_branch_org_immutable` trigger (prevents `organization_id` change), updated `branches` RLS with org-aware policies + legacy fallback via `is_platform_admin()`. New: `src/api/domains/branches.ts` (branch RPC API domain), `src/api/modules.ts` (updated exports), `src/features/admin/pages/BranchesPage.tsx` (updated to use RPCs), `src/lib/domains/types/organization.ts` (new `Organization` interface, `Branch.organization_id` field). Integration tests: `branch_management_phase2.test.ts` (9 cases — CASE 1–6, 9–11; CASE 7–8 deferred to Phase 3); `tests/integration/rls.ts` (added `runAsPersist` helper). 9 tests pass.
- **Multi-Tenant Phase 3 (Full Tenant Data Isolation) — DONE.** PR #10 OPEN: `https://github.com/Premieros/Premier/pull/10`. Branch `agent/multitenant-phase2`. Migration `20260821010000_tenant_data_isolation.sql`: `user_may_access_branch(uuid)` SECURITY DEFINER helper (org-membership check + NULL branch fallback for platform admin). Updated RLS policies on 40+ branch-scoped tables: SELECT uses `user_may_access_branch(branch_id)`; WRITE uses `is_platform_admin() OR (can_permission(...) AND user_may_access_branch(branch_id))`. DELETE uses `USING(false)` on ~20 tables (shifts, users, branch_settings, audit_log, dining_areas, dining_tables, etc.). Child tables use parent JOIN to branch_id. New integration test `tenant_data_isolation.test.ts` (30+ cases). `rls_branch_isolation.test.ts` updated: `noDel` system, `updSet` for column-varied children, `parentWrite` mode for Phase 3 branch-access INSERTs, cross-tenant tests use cashier (orgA-only). CI GREEN: verify ✅ (1m15s), db ✅ (41s), browser-smoke ✅ (1m34s) — run `32476458568`.

### Pending
- **6H + 6I visual rebuild: COMPLETE.** No further work in this bundle. Next work must be explicitly requested and isolated from the production baseline.
- `src/features/pos/hooks/usePosSummary.ts` remains flagged as future technical debt; do not remove without a separate cleanup decision.
- **ERP-01 PHASE F CI results (PR #5, first live run 2026-08-14):** the Actions gate now runs for the branch. Findings and fixes:
   - `npm ci` EUSAGE in `verify` (npm 10, Node 22): lockfile generated locally with npm 11 had dropped the `esbuild@0.28.x` platform packages required by the rolldown-vite (vitest 4.x) graph → regenerated `package-lock.json` with npm 10.9.9 (commit `2382280`); `npm ci` now green locally and in CI.
   - `db` gate ran the live integration suite: **154 tests → 153 passed, 1 failed** — `kitchen_sends.test.ts` "resume + add item + send + payment (ERP-01)". Root cause: migration `069`'s rewrite inserted new `order_items` lines without registering them in `_upd_matched`, so the deletion sweep removed them → `items_sent_count` 0. Fixed by `RETURNING id INTO v_matched_id` + registering new lines in `_upd_matched`. Re-run pending.
   - `browser-smoke` (E2E, 50 tests) first run: **41/50 passed** (public-smoke 38 + dashboard-navigation 3); **9 failed** — `pos-actions.spec.ts` `beforeEach` still expected `pos-order-type-picker` immediately on entering `/pos`, but ERP-01 change B opens POS directly on Takeaway and the picker now appears via the **New Order** button. Fixed: added `data-testid="pos-action-new-order"` (`PosTopBar`) and updated the spec to open the picker through it.
   - **Final run 31813850004 (PR #5, after both fixes): ALL GREEN — `verify` ✅ (unit 236/236), `db` ✅ (integration 154/154), `browser-smoke` ✅ (E2E 50/50), Netlify deploy preview ✅.**
   - **ERP-01 COMPLETE — MERGED.** PR #5 merged into `main` on 2026-08-14 (merge commit `0c2d812`); follow-up docs run 31814495488 also ALL GREEN. PHASE G closed. ERP-02 Product & Recipe Costing starts next from `main` @ `0c2d812`.
- **Batch 2 DONE** — PR #10 (agent/multitenant-phase2) CI GREEN: verify ✅, db ✅ (328/328), browser-smoke ✅. All 5 commits pushed.
- **Phase 4 — Navigation Audit & Feature Discoverability — DONE.** Full inventory: 32 sidebar items (A), 15 center-accessible items (B), 0 hidden (D). All features discoverable. New `src/components/CommandPalette.tsx`: global Ctrl+K command search with 46 searchable items, permission-filtered, bilingual (AR/EN), fuzzy search. Integrated into `src/components/Layout.tsx` header. Extended `tests/unit/navigation-contract.test.ts` from 4 → 29 tests: route resolution, center discoverability, feature discoverability, command palette, no duplicates, sidebar structure. Lint ✅, typecheck ✅, 310 unit tests ✅, build ✅. Documentation: `docs/NAVIGATION_AUDIT.md`.
- **Batch 2 — Permissions + Super Admin Console — DONE. CI GREEN.** PR #10 (`agent/multitenant-phase2`). 5 commits: `3c94e42` (main batch 2), `cd548f2` (membership_role fix), `238fff2` (trigger guard fix), `05baee5` (FK→public.users + legacy fallback), `38f94b5` (test fixes). Migration `20260821120000_permissions_super_admin.sql`: `user_branch_access` junction table (user_id FK→`public.users(id)`, branch_id), tightened `user_may_access_branch()` — platform admin → all, org owner/admin → all org branches, explicit grant → that branch, legacy fallback (`users.branch_id`), else denied. Backfill seed from `users.branch_id` + org owners. 6 RPCs: `get_user_branch_access`, `assign_user_to_branch`, `remove_user_from_branch`, `set_user_branch_access`, `get_super_admin_tenant_stats`, `get_super_admin_all_users`, `toggle_organization_status`. Triggers: auto-grant branch access on user create, block `organization_id` change. Super Admin Console (`SuperAdminConsolePage.tsx`): 3 tabs (Tenants/Users/System Health), route `/super-admin` with `superAdminOnly` guard, menu item + CommandPalette entry. UsersPage: multi-branch assignment checkboxes for admin users. i18n: Arabic/English `superAdmin` translations. Integration tests: 15 scenarios (`batch2_permissions.test.ts`) + 1 fixed (`phase4_security_contract.test.ts`) covering cross-tenant isolation, role-based access, branch assignment, RPC authorization. CI run `32488402363`: verify ✅, db ✅ (328/328 tests), browser-smoke ✅.
- **Unified Design System (DS-1 through DS-5) — DONE. MERGED. CI GREEN.** PR #11 (`agent/unified-design-system`) merged into `main` (merge commit `ef7c68f`). CI run `32508883452`: verify ✅, db ✅, browser-smoke ✅. Unit tests: 248/248 ✅. Build: ✅. **2,068 hardcoded color classes → 0** across 55+ files, 70 files changed (+1,146 / -915).
  - **DS-1**: Expanded tokens (spacing 4–48px, typography, z-index, motion), semantic soft variants (success/warning/danger/info), dark mode updated. Layout: header 64px, sidebar 260px, backdrop-blur, pill-style tabs, logical CSS. CenterTile/CenterGrid shared component. Modal, Toast, DataTable, ConfirmDialog, ErrorBoundary tokenized.
  - **DS-2**: Badge (6 variants), Switch (accessible), Tabs (compound), Alert (4 variants), Skeleton (3 variants), Tooltip (4 positions).
  - **DS-3**: Dashboard greeting + Quick Actions (New Sale, Purchase, Production), Quick Stats tokenized, waste/low-stock alerts tokenized.
  - **DS-4**: POS + KDS — already tokenized from P6, no changes needed.
  - **DS-5**: Full tokenization of all 55+ feature pages. Button hover/active tokens added. Dark mode via CSS custom properties only. Zero `dark:text-slate-*` / `dark:bg-slate-*` remaining.

## Relationship Audit Note

The production Supabase schema had a duplicate FK on `users.branch_id`. The duplicate `users_branch_id_fkey` was removed manually after verification, leaving only `users_branch_fk_strict`. A migration was added on the previous rebuild branch to preserve the fix for schema recreation. This relationship fix is separate from the visual rebuild and must remain behavior-preserving.

## Definition of Done — 6H + 6I

**COMPLETE.** The bundle reached the required state: new App Shell + Dashboard + Reports Center + POS visual surfaces are clearly distinguishable from the old design, existing functionality contracts remained intact, legacy consumers were audited and safe orphans removed, P0 security gaps were closed with passing RLS tests, focused tests and full CI passed, DB/RLS/security/browser checks passed, PR #4 was merged into `main`, and GitHub Pages deployment succeeded on merge commit `d390c47`.
