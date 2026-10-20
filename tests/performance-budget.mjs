export const DEFAULT_P95_BUDGET_MS = 8;

export function parseP95Budget(value, defaultValue = DEFAULT_P95_BUDGET_MS) {
  const source = value ?? String(defaultValue);
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('PERFORMANCE_P95_BUDGET_MS must be a finite positive number');
  }
  const budget = Number(source);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error('PERFORMANCE_P95_BUDGET_MS must be a finite positive number');
  }
  return budget;
}

export function percentile(samples, fraction = 0.95) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('performance samples must be a non-empty array');
  }
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error('percentile fraction must be greater than 0 and at most 1');
  }
  if (samples.some(sample => typeof sample !== 'number' || !Number.isFinite(sample))) {
    throw new Error('performance samples must contain only finite numbers');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function evaluatePerformanceBudget(p95Ms, budgetMs) {
  if (typeof p95Ms !== 'number' || !Number.isFinite(p95Ms) || p95Ms < 0) {
    throw new Error('P95 must be a finite non-negative number');
  }
  const budget = parseP95Budget(String(budgetMs));
  return {
    budgetMs: budget,
    p95WithinBudget: p95Ms <= budget,
  };
}
