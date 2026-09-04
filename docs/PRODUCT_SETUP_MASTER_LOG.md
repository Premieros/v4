# Product Setup — Master Execution Log

> **Persistent source of truth for the unified Product → Units → Recipes → Production work on `agent/product-setup-flow`. Read this file before every edit, update it after every meaningful change, CI result, bug, architectural decision, or phase transition. Do not advance to the next phase until the current phase is recorded and its validation state is explicit.**

## Scope

Goal: enforce the hierarchy:

`Raw Materials → Manufacturing → Inventory Units → Products → Sale`

Rules:

- Do not touch `main` directly.
- Do not create duplicate raw materials or inventory units when an existing entity can be reused.
- Preserve branch isolation and RLS.
- Raw materials are consumed by manufacturing only; sales do not deduct raw materials directly.
- Products use inventory units as their sellable components.
- Manufactured units own their recipes.
- Every database change must be a new migration; do not rewrite historical migrations.
- Every CI failure must be recorded with root cause and resolution.

## Current Branch

- Branch: `agent/product-setup-flow`
- Base: `main`
- PR: `#8` — Implement unified product setup flow
- Current HEAD: `d515adcdeee130613362810ac979c066667ab89a`
- PR state: Open, not merged

## Current Status

**Phase: Unit-centered inventory model**

Status: **IN PROGRESS — validation pending**

The product Add flow is wired to the wizard. Sales now deduct units only. Manufactured units own their Recipes. The `/production` route now opens the new unit-centered production workflow, which consumes the unit Recipe and creates inventory-unit batches.

## Work Completed

### 1. Unified product setup wizard

Status: ✅ implemented

Primary route:

`/products/setup`

Canonical tables:

- `inventory_units`
- `product_unit_links`
- `inventory_unit_recipes`

### 2. Full CI stabilization baseline

Status: ✅ baseline confirmed on `Verify main #250`

- lint ✅
- typecheck ✅
- test suite typecheck ✅
- unit tests ✅
- build ✅
- schema verification ✅
- integration/security/RLS ✅
- browser smoke ✅

### 3. Products-page Add action

Status: ✅ code implemented

Main Add action opens `/products/setup`.

Existing Edit flow and import/export remain unchanged.

### 4. Sales deduction model changed to unit-only

Commit: `717c3587e87dd90768743a3283b2abf01448b608`

File: `src/lib/sales-deduction.ts`

Rules:

- Sale → product → linked inventory units → deduct unit batches only.
- No recipe lookup during sale.
- No raw-material inventory mutation during sale.

This prevents double consumption of raw materials.

### 5. Unit-owned Recipe management

Commit: `b9de36587e86509b110a4228bf50c83a8e69206f`

File: `src/features/catalog/pages/InventoryUnitsPage.tsx`

Manufactured units now expose a Recipe editor using `inventory_unit_recipes`. Ready units do not have a Recipe editor.

### 6. Unit-centered production workflow

Commits:

- `b2c881599f46fc6584a5804a05e1d91cb91e0840` — UnitProductionPage
- `03c101bec230f15b8acadef52a84a9cf59643b30` — production route constant
- `c7fa06107e3bb3ec3b6bf96027e68ff6e766a1ef` — `/production` → UnitProductionPage

New page:

`src/features/manufacturing/pages/UnitProductionPage.tsx`

The workflow:

`Manufactured Unit → Unit Recipe → Production → Raw Material Deduction → Unit Batch`

The page uses the existing `produce_inventory_unit` RPC and filters manufactured units and warehouses by the active branch when available.

### 7. End-to-end hierarchy tests added

Status: 🔄 awaiting CI

#### Database integration test

Commit: `c2083f23f19a0647e4b4660129bd4efc361bc5b5`

File:

`tests/integration/unit_inventory_hierarchy.test.ts`

Scenario:

- 100 units of Mayonnaise raw-material stock
- Recipe: 2 units of Mayonnaise per Burger Sauce unit
- Produce 20 Burger Sauce units
- Assert raw-material stock becomes 60
- Assert finished-unit batch becomes 20
- Assert production record is completed with total cost 400 and unit cost 20

#### Sales deduction unit test

Commit: `d515adcdeee130613362810ac979c066667ab89a`

File:

`tests/unit/sales_deduction_units_only.test.ts`

Assertions:

- Sale of 2 manufactured units deducts 2 unit-stock items
- Creates one unit sale ledger entry for `-2`
- Returns zero raw-material deductions
- Never touches `raw_material_inventory`

## Current Architecture Decision

The source of truth is:

`Raw Material`
→ `Unit Recipe`
→ `Manufacturing`
→ `Inventory Unit Batch`
→ `Product Unit Link`
→ `Sale`

Examples:

- Ready unit: purchased/received/added → unit stock increases directly.
- Manufactured unit: production order → recipe consumes raw materials → unit batch increases.
- Product sale: unit stock decreases only.

## Immediate Next Actions

### Phase A — Validate current commits

Status: 🔄 awaiting CI

1. Confirm lint/typecheck/unit/build remain green.
2. Confirm DB integration/security/RLS remain green.
3. Confirm browser smoke remains green.
4. Confirm unit Recipe editor compiles and renders.
5. Confirm `/production` opens the new unit production workflow.
6. Confirm `unit_inventory_hierarchy.test.ts` passes.
7. Confirm `sales_deduction_units_only.test.ts` passes.

### Phase B — Product composition validation

After CI is green, validate:

`Product`
→ `Product Unit Links`
→ `Ready Unit / Manufactured Unit`
→ `Unit stock`

No new product-level raw-material Recipe should be required for the unit-centered flow.

### Phase C — End-to-end business validation

Validate exactly:

`Mayonnaise 100`

→ manufacture `Burger Sauce 20`

→ raw material stock decreases according to the unit Recipe

→ `Burger Sauce` unit stock increases by 20

→ product `Chicken Burger` links to `Burger Sauce × 1`

→ sell 2 Chicken Burgers

→ `Burger Sauce` stock decreases by 2

→ mayonnaise stock does **not** decrease again.

Also verify:

- branch isolation
- RLS
- FIFO/batch behavior
- unit cost
- production history
- audit log

### Phase D — Final PR gate

Only when all validations are green:

- review PR diff against `main`
- verify no unintended files changed
- update this log
- mark Product Setup phase complete
- merge only after explicit final review

## Change Ledger

| Date | Commit/Action | Area | Result |
|---|---|---|---|
| 2026-08-19 | Product setup wizard work | Frontend/product flow | ✅ |
| 2026-08-19 | `109e98d3...` | Products-page Add → unified wizard | ✅ code |
| 2026-08-19 | Verify main #250 | Full CI baseline | ✅ all jobs green |
| 2026-08-19 | Verify main #252 | Products Add lint regression | ❌ fixed |
| 2026-08-19 | `717c3587...` | Sales deduction → units only | ✅ |
| 2026-08-19 | `b9de3658...` | Unit-owned Recipe editor | ✅ |
| 2026-08-19 | `b2c8815...` | Unit-centered production page | ✅ |
| 2026-08-19 | `03c101b...` | Production route constant | ✅ |
| 2026-08-19 | `c7fa061...` | `/production` → UnitProductionPage | ✅ |
| 2026-08-19 | `c2083f23...` | DB hierarchy integration test | 🔄 CI pending |
| 2026-08-19 | `d515adc...` | Unit-only sales deduction test | 🔄 CI pending |
| 2026-08-19 | `PRODUCT_SETUP_MASTER_LOG.md` | Project governance | ✅ |

## Do Not Forget

- Update this file after every meaningful step.
- Record exact commit SHA and CI run for each stabilization step.
- Never claim a green result before GitHub Actions confirms it.
- Do not merge while any required verification job is red.
- Legacy product recipes may remain for compatibility, but they must not supersede the unit-centered source of truth.
