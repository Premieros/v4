// Shared application types, organized by domain.
// Keep `@/lib/types` as the single import surface; add/evolve domain types in
// ./domains/types and re-export them here.
export * from './domains/types/users';
export * from './domains/types/organization';
export * from './domains/types/catalog';
export * from './domains/types/parties';
export * from './domains/types/trade';
export * from './domains/types/floorPlan';
export * from './domains/types/manufacturing';
export * from './domains/types/inventory';
export * from './domains/types/costing';
export * from './domains/types/accounting';
export * from './domains/types/subscription';
export * from './domains/types/procurement';
