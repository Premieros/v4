import { AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import type { PrerequisiteStep } from './types';

interface PrerequisiteAlertBannerProps {
  step: PrerequisiteStep;
  onAction: () => void;
  customMessageAr?: string;
  customMessageEn?: string;
  className?: string;
}

export function PrerequisiteAlertBanner({
  step,
  onAction,
  customMessageAr,
  customMessageEn,
  className = '',
}: PrerequisiteAlertBannerProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const message = (isAr ? customMessageAr : customMessageEn) || (isAr ? step.descriptionAr : step.descriptionEn);
  const actionLabel = isAr ? step.actionLabelAr : step.actionLabelEn;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 transition-all ${className}`}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-black text-ui-text">{isAr ? step.titleAr : step.titleEn}</h4>
          <p className="text-xs font-medium text-ui-subtle mt-0.5 leading-relaxed">{message}</p>
        </div>
      </div>

      <Button size="sm" variant="primary" onClick={onAction} className="shrink-0 gap-1.5 font-bold">
        <span>{actionLabel}</span>
        {isAr ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
