// Domain API surface. Each domain owns its RPC wrappers; the barrel keeps
// `import * as api from '@/api'` stable while letting domains evolve independently.
export { pos } from './domains/pos';
export { floorPlan } from './domains/floorPlan';
export { trade } from './domains/trade';
export { procurement } from './domains/procurement';
export { shifts } from './domains/shifts';
export { inventory } from './domains/inventory';
export { costing } from './domains/costing';
export { manufacturing } from './domains/manufacturing';
export { catalog } from './domains/catalog';
export { accounting } from './domains/accounting';
export { reporting } from './domains/reporting';
export { subscriptions } from './domains/subscriptions';
export { admin } from './domains/admin';
export { branches } from './domains/branches';
