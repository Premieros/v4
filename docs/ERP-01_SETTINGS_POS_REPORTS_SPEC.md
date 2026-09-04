# ERP-01 — Settings, POS Flow & Report Center Specification

## Scope

This phase is isolated on `erp-01-settings-organization` and must not modify `main` directly or interfere with the completed 6H/6I visual rebuild.

## 1. Settings Control Center

Transform the existing Settings page into a structured control center while preserving all existing working settings and integrations.

### Sections

1. General / Company
2. Appearance / Theme
3. Language / Localization
4. POS & Sales
5. Order Types & Workflow
6. Tables / Floor Plan
7. Invoices & Tax
8. Receipts & Printing
9. Inventory & Warehouses
10. Purchasing
11. Production / Recipes
12. Delivery & Drivers
13. Kitchen / KDS
14. Customers & Loyalty
15. Discounts & Promotions
16. Accounting / Treasury
17. Branch Overrides
18. Users / Roles / Security
19. Notifications
20. System / Maintenance

### Rule

Every setting that is exposed must be connected to a real consumer. No visual-only switches.

For a new persisted setting, verify:

- database column/table or existing settings field;
- RLS/security impact;
- SettingsContext/API integration;
- consumer in the relevant feature;
- audit entry where appropriate;
- regression/contract test.

Do not create duplicate settings when an existing field already represents the same behavior.

## 2. POS Default Order Flow

Change the POS opening state so the sale screen opens directly into an external/takeaway order flow by default.

Requirements:

- No mandatory order-type selection before the cashier can start adding products.
- Takeaway/external order is the initial state.
- Cashier can change order type at any time.
- Existing Table, Delivery, Car and Quick Order workflows remain available.
- Existing POS routes, handlers, test IDs, aria contracts, pricing, tax and stock logic remain unchanged.

## 3. POS Bottom Navigation

Keep the cashier inside the POS workspace.

Primary bottom controls:

- Active Orders
- Delivery
- Tables
- Takeaway / Quick Order where applicable

Use drawers, popovers or in-workspace sections rather than navigating away from POS.

The active order must remain visible and editable while these surfaces are opened.

## 4. Resume Order / Kitchen Incremental Sending

Fix the resume-order behavior so previously sent items are not resent, while newly added items are correctly sent to the kitchen.

Each order item must have a reliable send/state identity sufficient to distinguish:

- new;
- sent;
- preparing;
- ready;
- served;
- cancelled.

Requirements:

- Resume must preserve the complete order context.
- Previously sent items must not be duplicated to KDS.
- Newly added items must be sent to KDS.
- The same new item must never be sent twice because of rerender/resume/retry.
- POS and KDS state must remain consistent.
- Add regression tests for resume + add item + send + payment.

Do not solve this with UI-only state if the authoritative transaction boundary is in database/RPC logic.

## 5. Payment / Full Receipt Review

Payment must not hide the sale context.

Before final confirmation, show a complete receipt preview containing:

- order type;
- table/car/delivery context;
- customer when present;
- products and quantities;
- item prices;
- discounts;
- subtotal;
- tax;
- service/delivery charges where applicable;
- total;
- amount paid;
- remaining/change;
- selected payment method(s).

Payment methods must remain visible and selectable without replacing the whole POS workspace with an unrelated screen.

Support existing payment methods and mixed payment behavior where already supported.

After successful payment, POS should be immediately ready for a new order.

## 6. Report Center / Report Builder

Reports must be selectable from a unified filter-driven center rather than requiring separate hardcoded report pages for every variation.

### Report groups

#### Sales
- Sales Summary
- Sales by Product
- Sales by Category
- Sales by Branch
- Sales by Employee/Cashier
- Sales by Order Type
- Sales by Payment Method
- Discounts
- Refunds
- Voids

#### Inventory
- Stock
- Stock Movement
- Stock Valuation
- Stock Variance
- Low Stock
- Expiry
- Transfers
- Waste

#### Purchasing
- Purchases
- Purchases by Supplier
- Purchase Items
- Supplier Price History
- Receiving

#### Production
- Production
- Consumption
- Production Variance
- Recipe Cost
- Waste

#### Financial
- General Ledger
- Trial Balance
- Profit & Loss
- Balance Sheet
- Cash Flow
- Accounts Receivable
- Accounts Payable
- Treasury
- Payments
- Reconciliation

#### Operations
- Shifts
- Cashier
- Tables
- Delivery
- Drivers
- Kitchen
- Preparation Time

### Dynamic filters

Only filters relevant to the selected report should be displayed. Supported dimensions include:

- date range;
- branch;
- warehouse;
- employee/cashier;
- customer;
- supplier;
- product;
- category;
- order type;
- payment method;
- table;
- driver;
- status;
- shift;
- recipe;
- production order.

### Output

- on-screen preview;
- print;
- PDF;
- Excel;
- CSV.

Filters must affect the real query/RPC/data source. No fake client-side report generation where the existing architecture expects server/database filtering.

## 7. Safety / Regression Contract

Do not change:

- authentication;
- RBAC/RLS;
- branch isolation;
- existing POS transaction semantics;
- accounting posting contracts;
- inventory deduction logic;
- Supabase RPC contracts;
- existing routes unless explicitly required and tested.

Every behavioral change requires regression coverage.

## 8. Implementation Order

1. Audit existing SettingsPage and SettingsContext/Settings persistence.
2. Build Settings Control Center structure without changing behavior.
3. Add real missing settings only after consumer/schema verification.
4. Implement POS default Takeaway flow.
5. Implement bottom in-workspace navigation.
6. Fix Resume Order/KDS incremental sending with regression tests.
7. Redesign payment/receipt review while preserving payment logic.
8. Build unified Report Center and dynamic filters.
9. Run full gates.
10. Update ERP roadmap and create an implementation report.

## Definition of Done

ERP-01 is complete only when the Settings Control Center is organized, every exposed setting is functional, POS opens directly to the intended default flow, bottom navigation works without leaving POS, resume-order kitchen sending is correct and regression-tested, payment shows the full receipt context, reports support real dynamic filtering and output, and full CI remains green.