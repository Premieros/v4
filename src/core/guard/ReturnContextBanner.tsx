import { Sparkles, ArrowRight, ArrowLeft, X, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useGuidedWorkflow } from './useGuidedWorkflow';
import { Button } from '@/components/Button';

export function ReturnContextBanner() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { guidedContext, completePrerequisiteAndReturn, cancelGuidance } = useGuidedWorkflow();

  if (!guidedContext) return null;

  const sourceName = isAr ? guidedContext.sourceLabelAr : guidedContext.sourceLabelEn;
  const stepName = isAr ? guidedContext.missingStep.titleAr : guidedContext.missingStep.titleEn;

  return (
    <div
      className="sticky top-0 z-40 w-full border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 backdrop-blur-md transition-all shadow-sm"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <Sparkles className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-amber-700 dark:text-amber-300">
                {isAr ? 'مسار التوجيه الذكي النشط' : 'Active Guided Workflow'}
              </span>
              <span className="text-[11px] font-semibold text-ui-subtle">
                ({isAr ? 'الهدف:' : 'Goal:'} {stepName} ➔ {sourceName})
              </span>
            </div>
            <p className="text-xs text-ui-text font-medium">
              {isAr
                ? `أنت في هذه الصفحة لاستكمال ${stepName} المطلوبة لعملية (${sourceName}). بمجرد الإضافة، يمكنك العودة مباشرة لمتابعة عمليتك مع استعادة بياناتك.`
                : `You are here to complete ${stepName} required for (${sourceName}). Once added, return to continue with your saved data.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => completePrerequisiteAndReturn()}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>{isAr ? `العودة إلى ${sourceName}` : `Return to ${sourceName}`}</span>
            {isAr ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
          </Button>

          <button
            onClick={cancelGuidance}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-ui-border bg-ui-surface text-ui-subtle hover:text-ui-text transition-colors"
            title={isAr ? 'إلغاء مسار التوجيه' : 'Cancel Guidance'}
            aria-label={isAr ? 'إلغاء مسار التوجيه' : 'Cancel Guidance'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
