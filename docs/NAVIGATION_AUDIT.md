# Phase 4 — Navigation Audit & Feature Discoverability

## 1. Complete Feature Inventory

| Feature | Route | Menu Item | Center | Permission | Discoverability | Status |
|---------|-------|-----------|--------|------------|----------------|--------|
| Dashboard | /dashboard | dashboard (main) | — | dashboard.view | A — Sidebar | ✅ |
| My Subscription | /subscription | subscription (main) | — | — (public) | A — Sidebar | ✅ |
| POS | /pos | pos (main) | Operations Center | pos.sell | A — Sidebar | ✅ |
| Operations Center | /operations | operations-center (centers) | — | dashboard.view | A — Sidebar | ✅ |
| Inventory Center | /inventory-center | inventory-center (centers) | — | inventory.view | A — Sidebar | ✅ |
| Procurement Center | /procurement-center | procurement-center (centers) | — | purchases.view | A — Sidebar | ✅ |
| Manufacturing Center | /manufacturing-center | manufacturing-center (centers) | — | production.view | A — Sidebar | ✅ |
| Waste Center | /waste-center | waste-center (centers) | — | production.waste | A — Sidebar | ✅ |
| Kitchen Display | /kitchen-display | kitchen-display (centers) | — | pos.sell | A — Sidebar | ✅ |
| Kitchen Stations | /kitchen-stations | kitchen-stations (admin) | — | settings.manage | A — Sidebar | ✅ |
| Products | /products | products (catalog) | — | products.view | A — Sidebar | ✅ |
| Categories | /categories | categories (catalog) | — | categories.view | A — Sidebar | ✅ |
| Components | /components | components (catalog) | Manufacturing Center | components.view | A — Sidebar | ✅ |
| Inventory Units | /inventory-units | inventory-units (catalog) | — | raw_materials.view | A — Sidebar | ✅ |
| Branches | /branches | branches (operations) | — | branches.manage | A — Sidebar | ✅ |
| Customers | /customers | customers (people) | Procurement Center | customers.view | A — Sidebar | ✅ |
| Suppliers | /suppliers | suppliers (people) | Procurement Center | suppliers.view | A — Sidebar | ✅ |
| Expenses | /expenses | expenses (finance) | — | expenses.view | A — Sidebar | ✅ |
| Costing Center | /costing | costing-center (finance) | Manufacturing Center | reports.costing | A — Sidebar | ✅ |
| Chart of Accounts | /accounts | accounts (finance) | — | accounts.view | A — Sidebar | ✅ |
| Payments | /payments | payments (finance) | Procurement Center | accounts.view | A — Sidebar | ✅ |
| Journal Entries | /journal | journal (finance) | — | accounts.view | A — Sidebar | ✅ |
| Treasury | /treasury | treasury (finance) | — | accounts.view | A — Sidebar | ✅ |
| Bank Reconciliation | /reconciliation | reconciliation (finance) | — | accounts.view | A — Sidebar | ✅ |
| Financial Reports | /financial-reports | financial-reports (finance) | — | reports.financial | A — Sidebar | ✅ |
| Sales Invoices | /sales | sales (finance) | — | sales.view | A — Sidebar | ✅ |
| Shifts | /shifts | shifts (finance) | — | shifts.view | A — Sidebar | ✅ |
| Reports | /reports | reports (finance) | — | reports.view | A — Sidebar | ✅ |
| Users | /users | users (admin) | Settings System | users.view | A — Sidebar | ✅ |
| Subscriptions Admin | /subscriptions | subscriptions-admin (admin) | Settings System | super_admin only | A — Sidebar | ✅ |
| Audit Log | /audit-log | audit-log (admin) | Settings System | audit.view | A — Sidebar | ✅ |
| Settings | /settings | settings (admin) | — | settings.manage | A — Sidebar | ✅ |
| **Raw Materials** | /raw-materials | — | Manufacturing Center | raw_materials.view | **B — Center** | ✅ |
| **Recipes** | /recipes | — | Manufacturing Center | recipes.view | **B — Center** | ✅ |
| **Production Orders** | /production | — | Manufacturing Center | production.view | **B — Center** | ✅ |
| **Warehouses** | /warehouses | — | Inventory Center + Operations Center | warehouses.view | **B — Center** | ✅ |
| **Transfers** | /transfers | — | Inventory Center + Operations Center | inventory.transfers | **B — Center** | ✅ |
| **Inventory Ledger** | /inventory-ledger | — | Inventory Center | inventory.ledger.view | **B — Center** | ✅ |
| **Stock Counts** | /stock-counts | — | Inventory Center + Operations Center | inventory.manage | **B — Center** | ✅ |
| **Inventory Batches** | /inventory-batches | — | Inventory Center | inventory.view | **B — Center** | ✅ |
| **Stock Valuation** | /stock-valuation | — | Inventory Center | inventory.ledger.view | **B — Center** | ✅ |
| **Low Stock Alerts** | /low-stock-alerts | — | Inventory Center + Operations Center | inventory.view | **B — Center** | ✅ |
| **Inventory (Stock)** | /inventory | — | Inventory Center + Operations Center | inventory.view | **B — Center** | ✅ |
| **Purchase Requests** | /purchases/requests | — | Procurement Center | purchases.requests | **B — Center** | ✅ |
| **RFQs** | /purchases/rfqs | — | Procurement Center | purchases.rfq | **B — Center** | ✅ |
| **Receiving** | /purchases/receiving | — | Procurement Center | purchases.receiving | **B — Center** | ✅ |
| **Floor Plan / Tables** | /floor-plan | — | Operations Center | floor_plan.view | **B — Center** | ✅ |
| **System Health** | /system-health | — | Settings System section | settings.manage | **B — Center** | ✅ |

### Discoverability Summary
- **A (Sidebar):** 32 features
- **B (Center):** 15 features
- **C (Deep-link only):** 0 features
- **D (Not discoverable):** 0 features
- **E (Incomplete):** 0 features
- **F (Permission mismatch):** 0 features
- **All features have at least one discoverability path.** ✅

## 2. Route Map

All routes defined in `src/core/navigation/routes.ts` → `APP_ROUTES` object.

**Redirect aliases:**
- `/kitchen` → `/pos`
- `/tables` → `/floor-plan`
- `/accounting` → `/financial-reports`
- `/employees` → `/users`
- `/settings/basic` → `/settings`
- `/*` → `/dashboard`

## 3. Menu Map

**Sidebar Groups (7):**
| Group | Arabic | Items |
|-------|--------|-------|
| main | الرئيسية | dashboard, subscription, pos |
| catalog | الكتالوج | products, categories, components, inventory-units |
| operations | العمليات | branches |
| centers | مراكز الإدارة | operations-center, inventory-center, procurement-center, manufacturing-center, waste-center, kitchen-display |
| people | الأطراف | customers, suppliers |
| finance | المالية | expenses, costing-center, accounts, payments, journal, treasury, reconciliation, financial-reports, sales, shifts, reports |
| admin | الإدارة | users, subscriptions-admin, audit-log, settings, kitchen-stations |

**Top Header Tabs (4):**
- عام / General → /dashboard
- الفروع / Branches → /branches (permission: branches.manage)
- المخزون / Inventory → /inventory (permission: inventory.view)
- المطبخ / Kitchen → /pos (always visible, shows "جديد/New" badge)

## 4. Center Map

### Operations Center (9 cards)
| Card | Route | Permission |
|------|-------|------------|
| POS & Orders | /pos | pos.sell |
| Inventory Center | /inventory-center | inventory.view |
| Inventory | /inventory | inventory.view |
| Warehouses | /warehouses | warehouses.view |
| Stock Transfers | /transfers | inventory.transfers |
| Counts & Adjustments | /stock-counts | inventory.manage |
| Low Stock Alerts | /low-stock-alerts | inventory.view |
| Purchasing | /purchases | purchases.view |
| Kitchen & Orders | /floor-plan | floor_plan.view |

### Inventory Center (8 cards)
| Card | Route | Permission |
|------|-------|------------|
| Current Stock | /inventory | inventory.view |
| Warehouses | /warehouses | warehouses.view |
| Inventory Ledger | /inventory-ledger | inventory.ledger.view |
| Transfers | /transfers | inventory.transfers |
| Counts & Adjustments | /stock-counts | inventory.manage |
| Batches & Expiry | /inventory-batches | inventory.view |
| Low Stock Alerts | /low-stock-alerts | inventory.view |
| Stock Valuation | /stock-valuation | inventory.ledger.view |

### Manufacturing & Costing Center (8 cards)
| Card | Route | Permission |
|------|-------|------------|
| Raw Materials | /raw-materials | raw_materials.view |
| Recipes & Components | /recipes | recipes.view |
| Production Orders | /production | production.view |
| Costing Center | /costing | reports.costing |
| Product Components | /components | components.view |
| Material Stock | /inventory-center | inventory.view |
| Waste Center | /waste-center | production.waste |
| Kitchen Display | /kitchen-display | pos.sell |

### Procurement Center (6 cards)
| Card | Route | Permission |
|------|-------|------------|
| Purchases | /purchases | purchases.view |
| Purchase Requests | /purchases/requests | purchases.requests |
| RFQs | /purchases/rfqs | purchases.rfq |
| Receiving | /purchases/receiving | purchases.receiving |
| Suppliers | /suppliers | suppliers.view |
| Payables | /payments | accounts.view |

## 5. Permission Map

Every menu item and center card has an explicit permission gate. Non-admin roles resolve permissions from the DB-backed `roles` table, falling back to `DEFAULT_ROLE_PERMISSIONS` in `src/lib/permissionDefs.ts`.

## 6. Command Search (Phase 4 New)

**Component:** `src/components/CommandPalette.tsx`
**Trigger:** Ctrl+K / Cmd+K anywhere in the app, or click the search button in the header.
**Integration:** `src/components/Layout.tsx` renders both `CommandPaletteTrigger` and `CommandPalette`.

**Features:**
- Searches across all 32 sidebar items + 14 additional deep-link features
- Permission-filtered: only shows features the current user can access
- Fuzzy matching on Arabic name, English name, section, description, and route
- Keyboard navigation: Arrow Up/Down, Enter to select, Escape to close
- Bilingual labels (Arabic first when lang=ar, English when lang=en)
- Includes: Raw Materials, Recipes, Production Orders, Transfers, Stock Counts, Inventory Ledger, Warehouses, Purchase Requests, RFQs, Receiving, Floor Plan, System Health

## 7. Mobile Navigation

- Sidebar opens via hamburger menu button (always accessible)
- Command Palette trigger visible in header on all screen sizes
- Top header tabs: General, Branches, Inventory, Kitchen
- Active orders button always visible in header
- All sidebar items accessible on mobile through the drawer

## 8. Tests

**File:** `tests/unit/navigation-contract.test.ts` — 29 tests

| Section | Tests |
|---------|-------|
| navigation contract (original) | 4 |
| Phase 4 — route resolution | 3 |
| Phase 4 — center discoverability | 4 |
| Phase 4 — feature discoverability | 8 |
| Phase 4 — command palette | 5 |
| Phase 4 — no duplicate destinations | 3 |
| Phase 4 — sidebar structure | 2 |

**All 29 tests pass.** ✅

**Other test files preserved:**
- `tests/unit/navigationRegistry.test.ts` — 3 tests ✅
- `tests/unit/navigationRegression.test.ts` — 5 tests ✅
- `tests/e2e/dashboard-navigation.spec.ts` — E2E tests ✅

## 9. Files Modified

| File | Change |
|------|--------|
| `src/components/CommandPalette.tsx` | **NEW** — Global command palette (Ctrl+K) |
| `src/components/Layout.tsx` | Added `CommandPaletteTrigger` in header + `<CommandPalette />` at root |
| `tests/unit/navigation-contract.test.ts` | Extended from 4 → 29 tests covering all Phase 4 requirements |

## 10. CI

- Lint: 0 errors ✅
- Typecheck: 0 errors ✅
- Unit tests: 310 passed ✅
- Build: Success ✅
