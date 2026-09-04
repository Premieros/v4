# Premier ERP Development Roadmap

> Separate roadmap for future ERP development. This file is intentionally independent from the active production/main work so ERP additions do not interfere with the completed visual rebuild.

## Safety Contract

- Never modify `main` directly.
- Never modify `ui-visual-rebuild-6h` while this roadmap is being implemented.
- ERP work must use dedicated feature branches created from the approved ERP branch/base.
- Preserve existing routes, authentication, RBAC, branch isolation, Supabase contracts, POS transaction logic, and existing workflows unless a separately approved change is required.
- Reuse existing modules, hooks, RPCs, tables, permissions, and patterns wherever possible.
- Every database change requires a migration and appropriate RLS/security review.
- Every important workflow requires regression/contract tests.
- Do not duplicate business logic between UI and RPC/database functions.
- Do not delete or replace existing functionality without a verified replacement and migration plan.
- Record implementation, decisions, tests, CI results, and rollback notes in this roadmap.

## P0 — Essential ERP Capabilities

### ERP-01 Inventory Control + Settings Control Center

> **Status: ✅ COMPLETE — MERGED** — ERP-01 implemented on branch `erp-01-settings-organization` (commits `469256b`..`e644630`) and **merged into `main` via PR #5 on 2026-08-14 (merge commit `0c2d812`)**. PHASE F **fully green in CI** (verify ✅ 236/236 unit, db ✅ 154/154 integration, browser-smoke ✅ 50/50 E2E, deploy preview ✅ — run 31813850004); PHASE G documentation closed. See `docs/ERP-01_EXECUTION_PLAN.md` → `# CURRENT STATUS` for the full completion record (commits, migration `069`, tests, limitations, rollback).

ERP-01 now includes the organization of the Settings page because inventory behavior, branch defaults, tax/currency, purchasing, receipts, POS rules, and operational policies must have one clear administrative control surface.

#### Settings information architecture

1. Company & Identity
   - Store name Arabic/English
   - Address
   - Phone
   - Logo
   - Default currency
   - Default language
   - Default theme/UI theme
   - Brand appearance

2. POS & Sales
   - Default payment method
   - Barcode autofocus
   - Line-item discount
   - Default order type
   - Customer requirement by order type
   - Held-order behavior
   - POS branch behavior
   - Price/quantity display preferences

3. Orders & Tables
   - Dine-in / takeaway / delivery / drive-through / quick order enablement
   - Guest-count behavior
   - Table reservation policy
   - Table status policy
   - Floor-plan defaults
   - Areas/tables management shortcuts

4. Invoices & Tax
   - Tax enabled
   - Tax rate
   - Invoice prefix
   - Next invoice number
   - Decimal places
   - Tax display behavior
   - Invoice numbering safeguards

5. Receipts & Printing
   - 58/80mm receipt width
   - Copies
   - Auto print
   - Tax display
   - QR display
   - Header/footer
   - Logo
   - Branch-specific overrides

6. Inventory — ERP-01 core
   - Low-stock threshold
   - Reorder point
   - Minimum stock
   - Maximum stock
   - Stocktake frequency/default mode
   - Stock adjustment policy
   - Adjustment approval requirement
   - Negative-stock policy
   - Expiry tracking
   - Batch/lot tracking
   - Inventory valuation method
   - Inventory variance tolerance
   - Branch-specific inventory defaults
   - Warehouse-specific defaults

7. Purchasing
   - Purchase approval threshold
   - Receiving tolerance
   - Partial receiving policy
   - Supplier price tracking
   - Purchase numbering
   - Default payment terms

8. Production / Recipes
   - Recipe costing mode
   - Production variance tolerance
   - Waste approval requirement
   - Yield tracking
   - Component consumption behavior

9. Delivery
   - Delivery enablement
   - Zones and fees
   - Driver assignment
   - Driver settlement behavior
   - Driver cash/debt controls

10. Kitchen
   - Kitchen enablement
   - Stations/routing
   - Preparation timers
   - Priority rules
   - Ready-state behavior
   - Kitchen ticket printing

11. Customers & Loyalty
   - Customer requirement rules
   - Duplicate matching
   - Loyalty enablement
   - Points rules
   - Rewards
   - Membership tiers

12. Discounts & Promotions
   - Maximum cashier discount
   - Approval threshold
   - Promotion defaults
   - Branch-specific promotions
   - Time/date restrictions

13. Accounting & Finance
   - Default accounts
   - Payment-method/account mapping
   - Posting behavior
   - Fiscal period controls
   - Budget defaults
   - Branch/cost-center mapping
   - Tax account mapping

14. Branch Management
   - Branch identity
   - Currency override
   - Tax override
   - Receipt override
   - Logo override
   - Low-stock override
   - Operational defaults

15. Users, Roles & Security
   - Role management
   - Permission groups
   - Branch-scoped roles
   - Approval permissions
   - Session/security policy
   - Audit logging

16. Notifications & System
   - Low-stock notifications
   - Shift alerts
   - Kitchen delay alerts
   - Failed-operation alerts
   - System health shortcuts
   - Demo-data controls

#### ERP-01 inventory capabilities

- Stocktake / physical inventory counts.
- Partial and periodic counts.
- Variance calculation and approval.
- Stock adjustments with reasons and audit trail.
- Minimum/maximum stock.
- Reorder points and low-stock alerts.
- Lot/batch and expiry tracking where applicable.
- Stock valuation.

#### ERP-01 safety rules

- Reorganize existing Settings controls before creating duplicates.
- Do not show a control as configurable unless its value has a real consumer.
- New persistent settings require migration, RLS, typed model, SettingsContext/API integration, audit event, and regression test.
- Global settings and branch overrides must be visually distinct.
- Inventory settings must be consumed by inventory/stocktake logic, not merely stored.
- Unsupported future settings remain explicitly marked as planned until their schema and consumers exist.
- Preserve all existing POS, sales, accounting, RBAC/RLS, and branch-isolation behavior.

### ERP-02 Product & Recipe Costing
- Current recipe cost.
- Component/raw-material unit cost.
- Product cost and gross margin.
- Food Cost %.
- Theoretical vs actual cost.
- Cost history.
- Supplier-price impact on product cost.
- Branch/product profitability.

### ERP-03 Purchasing Workflow
- Purchase Request.
- RFQ / supplier quotation.
- Purchase Order.
- Partial/full receiving.
- Backorder handling.
- Supplier price history.
- Last/average purchase price.
- Supplier evaluation.

### ERP-04 Unified Accounting Posting
- Standard accounting posting for sales, purchases, returns, inventory, taxes, treasury, and adjustments.
- Single source of truth for journal creation.
- Reversal/correction workflow.
- Preserve existing accounting reports and permissions.

## P1 — Restaurant Operations

### ERP-05 Waste Center
- Raw material waste.
- Expired/damaged items.
- Kitchen waste.
- Production waste.
- Reason, quantity, cost, employee, branch, approval.
- Waste analytics and Food Cost impact.

### ERP-06 Production Variance
- Recipe/BOM versioning.
- Yield.
- Planned vs actual consumption.
- Production cost variance.
- Waste/by-products.

### ERP-07 Kitchen Display System
- New/accepted/preparing/ready/served states.
- Station routing.
- Priority and delayed orders.
- Preparation-time metrics.
- Kitchen performance.

### ERP-08 Delivery & Driver Management
- Delivery zones and fees.
- Driver assignment.
- Delivery lifecycle.
- Driver cash collection.
- Driver debt/settlement.
- Driver performance.

## P1 — Customer & Sales Growth

### ERP-09 Customer 360
- Customer profile and purchase history.
- Favorite products.
- Average order value.
- Branch activity.
- Outstanding balance.
- Tags/notes.

### ERP-10 Loyalty
- Points earning/redeeming.
- Membership tiers.
- Rewards.
- Customer wallet.
- Expiry and transaction history.
- POS integration.

### ERP-11 Promotions Engine
- Percentage/fixed discounts.
- Product/category promotions.
- Buy X Get Y.
- Combos.
- Happy hour.
- Branch/customer/date restrictions.
- Usage limits.
- Central promotion rules used by POS.

### ERP-12 Menu Engineering
- Sales volume.
- Food cost.
- Gross profit and margin.
- Popularity/contribution analysis.
- Star/Plow Horse/Puzzle/Dog classification.

## P2 — Finance & Workforce

### ERP-13 Budgeting
- Branch/monthly budgets.
- Actual vs budget.
- Variance.
- Approval workflow.

### ERP-14 Fixed Assets
- Asset register.
- Acquisition.
- Depreciation.
- Disposal.
- Branch transfer.
- Asset history.

### ERP-15 Configurable Tax Center
- Tax rates/configuration.
- Inclusive/exclusive tax.
- Sales and purchase tax reporting.
- Tax liability and periods.
- Configurable for jurisdiction requirements.

### ERP-16 Employee Master
- Employee profile/code.
- Department/job title.
- Branch assignment.
- Employment status.
- Compensation metadata.
- Documents.

### ERP-17 Attendance & Leave
- Clock in/out.
- Late/early leave.
- Absence.
- Overtime.
- Attendance reports.
- Leave balances and approvals.

### ERP-18 Payroll — Later Phase
- Salary structures.
- Allowances/deductions.
- Overtime.
- Commissions/bonuses.
- Advances.
- Payroll periods and approvals.
- Payslips and accounting posting.

## P3 — Enterprise Controls

### ERP-19 Approval Engine
- Purchase approvals.
- Large discounts.
- Stock adjustments.
- Large expenses.
- Refund approvals.
- Configurable thresholds by role/branch.

### ERP-20 Advanced Audit Center
- Who/what/when/branch.
- Before/after values.
- Document history.
- Approval chain.
- Device/IP metadata where appropriate and legally permitted.

### ERP-21 Head Office Intelligence
- Branch comparison.
- Sales ranking.
- Food Cost ranking.
- Waste ranking.
- Labor cost.
- Gross margin.
- Inventory variance.
- Branch profitability.
- Product benchmarking.

## Recommended Priority

1. ERP-01 Inventory Control + Settings Control Center
2. ERP-02 Product & Recipe Costing
3. ERP-03 Purchasing Workflow
4. ERP-04 Unified Accounting Posting
5. ERP-05 Waste Center
6. ERP-06 Production Variance
7. ERP-07 Kitchen Display System
8. ERP-08 Delivery & Driver Management
9. ERP-09 Customer 360
10. ERP-10 Loyalty
11. ERP-11 Promotions Engine
12. ERP-12 Menu Engineering
13. ERP-13 Budgeting
14. ERP-14 Fixed Assets
15. ERP-15 Tax Center
16. ERP-16 Employee Master
17. ERP-17 Attendance & Leave
18. ERP-18 Payroll
19. ERP-19 Approval Engine
20. ERP-20 Advanced Audit Center
21. ERP-21 Head Office Intelligence

## Implementation Status

- ERP roadmap created: 2026-08-13.
- ERP-01 Settings organization scope expanded: 2026-08-14.
- ERP-01 implementation status: **✅ COMPLETE — MERGED** — PHASE A–E implemented on branch `erp-01-settings-organization`; PHASE F **fully green in CI on PR #5** (verify ✅ 236/236 unit, db ✅ 154/154 integration, browser-smoke ✅ 50/50 E2E, deploy preview ✅ — run 31813850004); PHASE G docs closed.
- Production/main code changes: **ERP-01 merged into `main` via PR #5 on 2026-08-14 (merge commit `0c2d812`).**
- ERP-01 implementation record (2026-08-14):
  - Commits `469256b` (spec), `5e8444d` (settings audit), `b8a7459` (Settings Control Center + real consumer wiring), `b70ffed` (POS takeaway default), `6d8cae6` (bottom POS navigation), `363b608` (Resume/KDS incremental fix + migration `069_resume_order_kitchen_incremental.sql`), `a2bc51e` (full receipt review in payment), `1f38fcd` (report center contextual filters + Excel/CSV/print).
  - CI-found fixes during PHASE F: `2382280` (lockfile npm 10/esbuild), `d4c5e84` (069 deletion sweep), `fde107f` (E2E pos-actions picker via New Order).
  - Local gates (fresh `npm ci`): typecheck ✅, typecheck:all ✅, lint ✅ (0 errors), test:unit 236/236 ✅, build ✅. Fix recorded: `@playwright/test@^1.62.1` declared as devDependency (commit `32d2faa`).
  - Live gates (CI): `test:integration` 154/154 ✅; browser E2E 50/50 ✅.
  - Known limitations: no delivery fees/service, mixed payment unsupported, E3 explicit analysis modes not implemented, `usePosSummary.ts` unused (pre-existing debt).
- Next step: **ERP-02 Product & Recipe Costing — started 2026-08-14 from `main` @ `0c2d812`.**
