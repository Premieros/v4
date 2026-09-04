# ERP-02 — Product & Recipe Costing

## Status

> **Status: ✅ SUPERSEDED — IMPLEMENTED ON `development/master-log2`**
>
> This design was the original draft for the Product & Recipe Costing feature
> (branch `erp-02-recipe-costing`, based on `main` @ `0c2d812`). The feature is
> now **fully implemented and verified on `development/master-log2`** as a
> strict functional superset, so this plan is kept as a historical design
> record only:
>
> - Migration `074_product_costing.sql` (replaces draft migration `070`) adds
>   the `product_cost_history` table + trigger and five branch-scoped RPCs:
>   `get_costing_overview`, `get_product_costing_detail`,
>   `get_cost_history`, `get_supplier_price_impact`, `get_order_margin`.
> - UI is `src/features/costing/pages/CostingCenterPage.tsx` at route `/costing`
>   (permission `reports.costing`, finance group, `Calculator` icon) with three
>   tabs (Costing Overview / Order Margin / Supplier Price Impact) plus a
>   per-product deep-detail modal (BOM + recipe + cost history) and Excel export.
> - All eight roadmap bullets below are covered. Implementation commit:
>   `82c7b1c` on `development/master-log2`.
> - The draft integration/contract tests from `erp-02-recipe-costing` targeted
>   the removed `070` RPC set and were **not** ported; equivalent DB coverage
>   for the `074` RPCs should be written against the live schema when a
>   `SUPABASE_DB_URL` environment is available.

- Original branch: `erp-02-recipe-costing`
- Original base: production `main` (post ERP-01)
- Scope: ERP-02 only — Product & Recipe Costing

## Goal

Give operators a single, branch-scoped **Costing Center** that answers the eight roadmap bullets:

1. Current recipe cost.
2. Component / raw-material unit cost.
3. Product cost and gross margin.
4. Food Cost %.
5. Theoretical vs actual cost.
6. Cost history.
7. Supplier-price impact on product cost.
8. Branch/product profitability.

## What already exists (foundation, no rework needed)

- `raw_materials` (master: `code/name/unit_id/category/min_stock/default_cost/is_active`) — 011.
- `raw_material_inventory` (per-branch aggregate `quantity` + weighted `avg_cost`) — 011, updated by `_raw_add` on purchases (013).
- `raw_material_batches` (FIFO lots with `unit_cost`, `source_type`='purchase', `source_id`) — 011, 013.
- `recipes` (`product_id`, `branch_id`, `yield_quantity`, `is_active`) + `recipe_items` (`raw_material_id`, `quantity`, `wastage_percent`) — 011; managed by `RecipesPage`.
- `products` (`sale_price`, `cost_price`) — 001; `cost_price` recomputed on purchases (013).
- `production_orders.total_cost` (actual completed production cost) — 011/013.
- `inventory_ledger` — full cost movements: raw-material and finished-goods FIFO consumption with `total_cost`, including `entry_type='sale'` rows that carry the **actual COGS** per sale item (013/031). This is the source of truth for actual cost.
- Existing `recipe_costs` report in `ReportsPage` uses the **legacy `product_components`** (product-to-product BOM). ERP-02 supersedes it with the manufacturing model (`recipes → recipe_items → raw_materials`).

## Design (original draft)

### Data layer — draft migration `070_recipe_costing.sql` (additive RPCs only; no DDL/DML changes)

All functions are `SECURITY DEFINER SET search_path TO 'public'` and mirror branch-isolation RLS: allow when `is_pos_admin()` OR target `branch_id = get_branch_id()`.

1. **`compute_recipe_cost(p_recipe_id uuid)` → jsonb**
   - Core unit-cost calculation. For each `recipe_items` row:
     - unit cost = `raw_material_inventory.avg_cost` for `(raw_material_id, branch_id)`; fallback `raw_materials.default_cost`.
     - consumed qty = `quantity × (1 + wastage_percent/100)`.
     - line cost = consumed qty × unit cost.
   - `total_cost` = Σ lines; `unit_cost` = `total_cost / yield_quantity`.
   - Returns `{ success, recipe_id, product_id, branch_id, yield_quantity, total_cost, unit_cost, items: [{ raw_material_id, name, quantity, wastage_percent, unit_cost, line_cost }] }`.
   - Errors: `RECIPE_NOT_FOUND`, `BRANCH_MISMATCH`.

2. **`recipe_costing_report(p_branch_id uuid DEFAULT NULL)` → TABLE(...)**
   - One row per active recipe: `product_id, product_name, branch_id, recipe_id, yield_quantity, sale_price, recipe_cost, gross_margin, gross_margin_pct, food_cost_pct`.
   - `recipe_cost` = `compute_recipe_cost(...).unit_cost`; `gross_margin = sale_price − recipe_cost`; `gross_margin_pct = margin/sale_price`; `food_cost_pct = recipe_cost/sale_price` (guard divide-by-zero).
   - Optional branch filter; isolation enforced.

3. **`raw_material_cost_history(p_raw_material_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL)` → TABLE(...)**
   - From `raw_material_batches` joined to `raw_materials` and, for `source_type='purchase'`, `purchases` (supplier name).
   - Columns: `raw_material_id, raw_material_name, branch_id, unit_cost, quantity, batch_number, source_type, supplier_id, supplier_name, occurred_at`.
   - Sorted `occurred_at DESC`. Covers roadmap bullets 2, 6, 7 (unit cost history, cost history, supplier-price trace).

4. **`costing_profitability_report(p_branch_id uuid, p_from timestamptz, p_to timestamptz)` → TABLE(...)**
   - Per product sold in the period: `product_id, product_name, units_sold, revenue, theoretical_cost, actual_cogs, gross_profit, gross_margin_pct, variance`.
   - `units_sold`/`revenue` from `sale_items` joined to `sales` (`status='completed'`, in period, branch).
   - `theoretical_cost` = active recipe `unit_cost × units_sold` (or 0 when no recipe).
   - `actual_cogs` = `-SUM(inventory_ledger.total_cost)` where `entry_type='sale'`, same product/branch/period.
   - `gross_profit = revenue − actual_cogs`; `gross_margin_pct = gross_profit/revenue`.
   - `variance = actual_cogs − theoretical_cost` (roadmap bullets 5 and 8).

### UI — draft `src/features/costing/pages/CostingPage.tsx`

Three tabs under one `DesignSurface` (`data-testid="costing-page"`):

1. **Recipe Costs** (`recipe-costs`) — `recipe_costing_report` table: product, branch, yield, sale price, recipe cost, gross margin, margin %, food cost %. Row expansion calls `compute_recipe_cost` to show the component breakdown.
2. **Raw Material Costs** (`raw-material-costs`) — `raw_material_cost_history` table + current per-branch `raw_material_inventory` summary (default cost vs avg cost vs last purchase cost).
3. **Profitability** (`profitability`) — `costing_profitability_report` with branch + from/to period controls: product, units sold, revenue, theoretical cost, actual COGS, variance, gross profit, margin %.

- Branch filter via `useBranchFilter()` (admin can select any branch; branch users locked).
- Reuses `Design*` primitives, `DataTable`, `formatNumber`, i18n `t()`.
- Route `/costing` gated by `reports.view`; menu entry under **finance** group with new `costing` icon (`Calculator`).
- All report labels and titles added to `src/lib/i18n.ts` (ar + en).

### Tests (original draft)

- **Integration** `tests/integration/recipe_costing.test.ts`:
  - `compute_recipe_cost` accuracy (avg_cost + wastage + yield) and `default_cost` fallback.
  - `recipe_costing_report` margin/food-cost math and branch isolation.
  - `raw_material_cost_history` after `process_purchase` (supplier + batch traced).
  - `costing_profitability_report` after `process_sale` (revenue, actual COGS from ledger, theoretical from recipe, variance).
  - RLS/branch guard on all four RPCs.
- **Unit/smoke** — add `CostingPage` to `tests/components/pages.smoke.test.tsx` and `design-surfaces.test.tsx`; add a small `costingContract` test (page + route + menu wiring), mirroring the reports-center contract pattern.

## Known limitations (recorded, not blocking)

- Actual COGS for profitability relies on `inventory_ledger` sale rows; legacy pre-ledger historical sales have no per-product actual cost (shown as 0).
- `yield_quantity` is assumed to scale linearly (no fixed/variable cost split).
- Supplier-price "impact" is traceable via history (avg cost is weighted by purchases); a full what-if simulator is out of scope.
