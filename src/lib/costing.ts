export function safeDiv(n: number, d: number): number {
  if (!Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

export function weightedAvgCost(quantities: number[], costs: number[]): number {
  const totalQty = quantities.reduce((s, q) => s + Number(q || 0), 0);
  if (totalQty <= 0) return 0;
  const totalCost = quantities.reduce((s, q, i) => s + Number(q || 0) * Number(costs[i] || 0), 0);
  return Math.round((totalCost / totalQty) * 100) / 100;
}

export function foodCostPct(cost: number, price: number): number {
  const p = Number(price || 0);
  if (p <= 0) return 0;
  return Math.max(0, (Number(cost || 0) / p) * 100);
}

export function grossMargin(cost: number, price: number): number {
  return Number(price || 0) - Number(cost || 0);
}

export function marginPct(cost: number, price: number): number {
  const p = Number(price || 0);
  if (p <= 0) return 0;
  return ((p - Number(cost || 0)) / p) * 100;
}

export function variancePct(actual: number, theoretical: number): number {
  const t = Number(theoretical || 0);
  if (t === 0) return 0;
  return ((Number(actual || 0) - t) / t) * 100;
}
