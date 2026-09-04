# ERP-01 — Settings Audit (Step 1)

Scope: `erp-01-settings-organization`. This audit maps every exposed settings surface to its real consumers before any restructuring.

## 1. Current surfaces

| Surface | Route | Persistence | Consumer reality |
|---|---|---|---|
| `SettingsPage` (`src/features/admin/pages/SettingsPage.tsx`) | `/settings/basic` | `settings` + `branch_settings` tables (typed columns) | Most fields consumed; ~10 dead fields (see matrix) |
| `SystemControlCenterPage` (`src/features/admin/pages/SystemControlCenterPage.tsx`) | `/settings` | `system_settings` single JSONB row (id=1) | **Zero consumers** — visual-only switches (~90 fields / 19 sections) |
| `SettingsContext` (`src/context/SettingsContext.tsx`) | global | loads `settings` + `branch_settings`, applies theme/language/brand color | Real; exposes `effectiveSettings(branchId)` |

Routes: `APP_ROUTES.settings` → `SystemControlCenterPage`, `APP_ROUTES.basicSettings` → `SettingsPage` (`src/app/routes.tsx:98,100`).

## 2. `settings` table — consumer matrix (24 fields)

| Field | Consumer | Status |
|---|---|---|
| `store_name` | `printing.ts` header, `ShiftsPage` | functional |
| `store_name_en` | none | **dead** |
| `store_address` | `printing.ts` header | functional |
| `store_phone` | `printing.ts` header | functional |
| `currency` | `printing.ts`, POS pricing (`posMath`), SettingsContext branch merge | functional |
| `tax_rate` | `printing.ts`, POS pricing, SettingsContext branch merge | functional |
| `tax_enabled` | POS pricing, SettingsContext branch merge | functional |
| `receipt_header` | `printing.ts` | functional |
| `receipt_footer` | `printing.ts` | functional |
| `receipt_width_mm` | `printing.ts` | functional |
| `receipt_copies` | `printing.ts` | functional |
| `receipt_show_tax` | `printing.ts` | functional |
| `receipt_show_qr` | `printing.ts` | functional |
| `receipt_auto_print` | `usePosOrder.ts` `completeSale` auto-print | functional |
| `logo_url` | `printing.ts` receipt logo (newly wired) | functional |
| `language` | SettingsContext → `LanguageContext` | functional |
| `theme` | SettingsContext → `ThemeContext` | functional |
| `brand_color` | SettingsContext → brandColor/themes | functional |
| `low_stock_threshold` | `VisualDashboardPage` low-stock | functional |
| `pos_default_payment_method` | `usePosOrder.ts` payment default (newly wired) | functional |
| `pos_barcode_autofocus` | `PosWorkspacePage` barcode focus (newly wired) | functional |
| `pos_line_discount` | none | **dead** |
| `invoice_prefix` | none (serials server-side `010_document_serials.sql`) | **dead** |
| `invoice_next_number` | none (serials server-side) | **dead** |
| `invoice_decimal_places` | none | **dead** |

Dead fields remaining (no real consumer, not exposed): **5/24** — `store_name_en`, `pos_line_discount`, `invoice_prefix`, `invoice_next_number`, `invoice_decimal_places`. The `invoice_*` fields are removed from the UI only; the server-side serial contract (`010_document_serials.sql`) is untouched.

## 3. `branch_settings` — 7 override fields

`receipt_header`, `receipt_footer`, `logo_url`, `tax_rate`, `tax_enabled`, `currency`, `low_stock_threshold` — all merged via `mergeEffectiveSettings` and consumed through the effective settings path. `logo_url` override is likewise dead at the consumer level (same as global).

## 4. `system_settings` JSONB — control center (id=1)

19 sections, ~90 fields. Persisted as opaque JSON. **No code reads any of them** (`system_settings` referenced only in `SystemControlCenterPage` + migrations `050`/`051`). Every toggle/number/select in this page is visual-only and violates the spec rule.

Duplicates of real settings (must not exist per spec):
- `sales.tax_rate` / `sales.tax_enabled` ↔ `settings.tax_rate` / `settings.tax_enabled`
- `sales.invoice_prefix` ↔ `settings.invoice_prefix`
- `inventory.low_stock_threshold` ↔ `settings.low_stock_threshold`
- `payments.default_method` ↔ `settings.pos_default_payment_method`
- `printing.copies` / `printing.paper` / `printing.show_tax` ↔ `settings.receipt_copies` / `receipt_width_mm` / `receipt_show_tax`
- `general.default_currency` ↔ `settings.currency`
- `accounting.decimal_places` ↔ `settings.invoice_decimal_places`

## 5. Findings

1. Two competing settings surfaces; the richer one (`/settings`) is entirely visual-only.
2. 10 persisted `settings` fields are dead; 3 of them (`invoice_*`) duplicate a server-side serial contract.
3. ~90 JSONB fields are dead; many duplicate typed settings.
4. No dead field may stay exposed per the spec rule ("No visual-only switches", "Do not create duplicate settings").

## 6. Recommended path for Step 2

1. Build one structured **Settings Control Center** page from the typed `settings`/`branch_settings` tables + real feature state (order types, payment methods, floor plan toggles that map to real consumers).
2. Wire cheap real consumers where a field already affects behavior but is unexposed (e.g., POS default order type from `settings` — see Step 4).
3. Remove (do not expose) dead fields, or wire them to real consumers if the behavior genuinely exists server-side (e.g., invoice serials are server-controlled → remove the UI fields, keep server contract).
4. Retire `SystemControlCenterPage` visual-only surface (or reduce it to read-only status derived from real tables) — never both.
5. Add contract tests per section before/after.
