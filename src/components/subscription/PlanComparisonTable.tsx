import React, { useState } from 'react';
import { Check, Minus, Sparkles } from 'lucide-react';
import type { Plan, FeatureCategory } from '../../services/subscription';
import { CATEGORY_LABELS } from '../../services/subscription';

interface PlanComparisonTableProps {
  plans: Plan[];
  currentPlanSlug?: string;
  onSelectPlan?: (plan: Plan) => void;
}

export const PlanComparisonTable: React.FC<PlanComparisonTableProps> = ({
  plans,
  currentPlanSlug,
  onSelectPlan,
}) => {
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  // Collect distinct categories from the first plan's features
  const sampleFeatures = plans[0]?.features || [];
  const categories = Array.from(
    new Set(sampleFeatures.map((f) => f.category))
  ) as FeatureCategory[];

  return (
    <div id="plan-comparison-matrix" className="w-full space-y-6">
      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center gap-3">
        <div className="bg-ui-muted p-1 rounded-xl flex items-center gap-1 border border-ui-border">
          <button
            type="button"
            id="toggle-cycle-monthly"
            onClick={() => setSelectedBillingCycle('monthly')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedBillingCycle === 'monthly'
                ? 'bg-ui-card text-ui-text shadow-sm'
                : 'text-ui-text-muted hover:text-ui-text'
            }`}
          >
            شهري
          </button>
          <button
            type="button"
            id="toggle-cycle-yearly"
            onClick={() => setSelectedBillingCycle('yearly')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
              selectedBillingCycle === 'yearly'
                ? 'bg-ui-card text-ui-text shadow-sm'
                : 'text-ui-text-muted hover:text-ui-text'
            }`}
          >
            <span>سنوي</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              وفر شهرين
            </span>
          </button>
        </div>
      </div>

      {/* Comparison Grid */}
      <div className="overflow-x-auto border border-ui-border rounded-2xl bg-ui-card">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="border-b border-ui-border bg-ui-muted/40">
              <th className="p-4 text-sm font-semibold text-ui-text min-w-[220px]">
                الخصائص والمميزات
              </th>
              {plans.map((plan) => {
                const priceObj = plan.prices?.find(
                  (p) => p.billing_cycle === selectedBillingCycle
                ) || plan.prices?.[0];
                const isCurrent = currentPlanSlug === plan.slug;

                return (
                  <th
                    key={plan.id}
                    className={`p-4 text-center min-w-[160px] ${
                      isCurrent ? 'bg-ui-primary/5 border-x border-ui-primary/20' : ''
                    }`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-ui-primary text-ui-primary-contrast mb-1">
                          خطتك الحالية
                        </span>
                      )}
                      <span className="font-bold text-ui-text text-base">{plan.name}</span>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-xl font-black text-ui-text">
                          {priceObj ? priceObj.price : 0}
                        </span>
                        <span className="text-xs text-ui-text-muted">
                          {priceObj?.currency || 'EGP'} /{' '}
                          {selectedBillingCycle === 'monthly' ? 'شهر' : 'سنة'}
                        </span>
                      </div>
                      {onSelectPlan && !isCurrent && (
                        <button
                          type="button"
                          id={`btn-select-plan-${plan.slug}`}
                          onClick={() => onSelectPlan(plan)}
                          className="mt-3 px-4 py-1.5 text-xs font-semibold rounded-lg bg-ui-primary text-ui-primary-contrast hover:opacity-90 transition-all shadow-sm w-full"
                        >
                          اختيار الخطة
                        </button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-ui-border text-sm">
            {categories.map((cat) => {
              const catLabel = CATEGORY_LABELS[cat]?.ar || cat;
              const catFeatures = sampleFeatures.filter((f) => f.category === cat);

              return (
                <React.Fragment key={cat}>
                  <tr className="bg-ui-muted/60 font-bold text-xs text-ui-text uppercase tracking-wider">
                    <td
                      colSpan={plans.length + 1}
                      className="px-4 py-2 text-ui-text-muted flex items-center gap-2"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-ui-primary" />
                      <span>{catLabel}</span>
                    </td>
                  </tr>
                  {catFeatures.map((feat) => (
                    <tr
                      key={feat.key}
                      className="hover:bg-ui-muted/30 transition-colors"
                    >
                      <td className="p-4 text-ui-text">
                        <div className="font-medium">{feat.name}</div>
                        {feat.description && (
                          <div className="text-xs text-ui-text-muted mt-0.5">
                            {feat.description}
                          </div>
                        )}
                      </td>
                      {plans.map((plan) => {
                        const pf = plan.features?.find((f) => f.key === feat.key);
                        const isCurrent = currentPlanSlug === plan.slug;

                        return (
                          <td
                            key={plan.id}
                            className={`p-4 text-center ${
                              isCurrent ? 'bg-ui-primary/5 border-x border-ui-primary/20' : ''
                            }`}
                          >
                            {pf?.enabled ? (
                              pf.limit_value !== null && pf.limit_value !== undefined ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300">
                                  {pf.limit_value === -1 ? 'غير محدود' : `حتى ${pf.limit_value}`}
                                </span>
                              ) : (
                                <div className="w-6 h-6 mx-auto rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                  <Check className="w-4 h-4" />
                                </div>
                              )
                            ) : (
                              <Minus className="w-4 h-4 mx-auto text-ui-text-muted/40" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
