import type { Product, Warehouse } from './catalog';
import type { AppUser } from './users';
import type { Unit } from './catalog';
import type { Branch } from './organization';

export interface RawMaterial {
  id: string;
  code: string;
  name: string;
  unit_id: string | null;
  category: string | null;
  min_stock: number;
  default_cost: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  unit?: Unit;
}

export interface RawMaterialInventory {
  id: string;
  raw_material_id: string;
  branch_id: string;
  quantity: number;
  avg_cost: number;
  min_stock: number;
  updated_at: string;
  raw_material?: RawMaterial;
  branch?: Branch;
}

export interface RawMaterialBatch {
  id: string;
  raw_material_id: string;
  branch_id: string;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  production_date: string | null;
  expiry_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
  raw_material?: RawMaterial;
  branch?: Branch;
}

export interface Recipe {
  id: string;
  product_id: string;
  branch_id: string;
  name: string | null;
  yield_quantity: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  product?: Product;
  branch?: Branch;
  items?: RecipeItem[];
}

export interface RecipeItem {
  id: string;
  recipe_id: string;
  raw_material_id: string;
  quantity: number;
  wastage_percent: number;
  note: string | null;
  raw_material?: RawMaterial;
}

export interface RecipeItemInput {
  raw_material_id: string;
  quantity: number;
  wastage_percent: number;
  note?: string | null;
}

export type ProductionStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface ProductionOrder {
  id: string;
  order_number: string;
  product_id: string;
  branch_id: string;
  warehouse_id: string | null;
  quantity: number;
  batch_number: string | null;
  status: ProductionStatus;
  total_cost: number;
  planned_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  product?: Product;
  warehouse?: Warehouse;
  branch?: Branch;
  creator?: AppUser;
}

export interface ProductionWaste {
  id: string;
  order_id: string;
  branch_id: string;
  raw_material_id: string | null;
  product_id: string | null;
  quantity: number;
  reason: string | null;
  created_at: string;
  raw_material?: RawMaterial;
  product?: Product;
}

export interface WasteInput {
  raw_material_id: string;
  quantity: number;
  reason?: string;
}
