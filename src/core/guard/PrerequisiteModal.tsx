import {
  Store,
  Warehouse,
  Building2,
  Users,
  Scale,
  Tags,
  Package,
  FlaskConical,
  ChefHat,
  Timer,
  ShieldAlert,
  SlidersHorizontal,
  Settings,
  ArrowRight,
  ArrowLeft,
  X,
  AlertCircle,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import type { PrerequisiteStep, OperationalActionKey } from './types';

interface PrerequisiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: () => void;
  step: PrerequisiteStep | null;
  actionKey?: OperationalActionKey;
  customReason?: string;
  sourceLabelAr?: string;
  sourceLabelEn?: string;
}

export function PrerequisiteModal({
  isOpen,
  onClose,
  onProceed,
  step,
  customReason,
  sourceLabelAr,
  sourceLabelEn,
}: PrerequisiteModalProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  if (!isOpen || !step) return null;

  const renderIcon = () => {
    switch (step.iconName) {
      case 'store':
        return <Store className="h-7 w-7 text-amber-500" />;
      case 'warehouse':
        return <Warehouse className="h-7 w-7 text-amber-500" />;
      case 'building':
        return <Building2 className="h-7 w-7 text-amber-500" />;
      case 'users':
        return <Users className="h-7 w-7 text-amber-500" />;
      case 'scale':
        return <Scale className="h-7 w-7 text-amber-500" />;
      case 'tags':
        return <Tags className="h-7 w-7 text-amber-500" />;
      case 'package':
        return <Package className="h-7 w-7 text-amber-500" />;
      case 'flask':
        return <FlaskConical className="h-7 w-7 text-amber-500" />;
      case 'chefHat':
        return <ChefHat className="h-7 w-7 text-amber-500" />;
      case 'timer':
        return <Timer className="h-7 w-7 text-amber-500" />;
      case 'shield':
        return <ShieldAlert className="h-7 w-7 text-rose-500" />;
      case 'settings':
        return <Settings className="h-7 w-7 text-amber-500" />;
      default:
        return <SlidersHorizontal className="h-7 w-7 text-amber-500" />;
    }
  };

  const reason = customReason || (isAr ? step.descriptionAr : step.descriptionEn);
  const title = isAr ? step.titleAr : step.titleEn;
  const actionLabel = isAr ? step.actionLabelAr : step.actionLabelEn;
  const targetSource = isAr ? sourceLabelAr || 'العملية الحالية' : sourceLabelEn || 'Current Operation';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-ui-border bg-ui-surface p-6 shadow-2xl transition-all"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ui-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20">
              {renderIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {isAr ? 'متطلب تشغيلي إلزامي' : 'Mandatory Prerequisite'}
                </span>
              </div>
              <h3 className="mt-1 text-lg font-black text-ui-text">{title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ui-subtle hover:bg-ui-muted hover:text-ui-text transition-colors"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="py-5 space-y-4">
          <div className="rounded-xl border border-ui-border bg-ui-muted/50 p-4">
            <p className="text-sm font-medium leading-relaxed text-ui-text">{reason}</p>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-ui-subtle">
            <span>{isAr ? 'مسار التوجيه الذكي:' : 'Guided Workflow Route:'}</span>
            <span className="font-bold text-ui-text">{targetSource}</span>
            {isAr ? <ArrowLeft className="h-3.5 w-3.5 text-ui-accent" /> : <ArrowRight className="h-3.5 w-3.5 text-ui-accent" />}
            <span className="font-bold text-ui-accent">{title}</span>
            {isAr ? <ArrowLeft className="h-3.5 w-3.5 text-ui-accent" /> : <ArrowRight className="h-3.5 w-3.5 text-ui-accent" />}
            <span className="font-bold text-ui-text">{isAr ? 'العودة التلقائية' : 'Auto Return'}</span>
          </div>

          <p className="text-xs text-ui-subtle">
            {isAr
              ? '💡 سيتم الاحتفاظ بحالة بياناتك المدخلة، وتحويلك لاستكمال الخطوة المطلوبة ثم إعادتك تلقائياً لمتابعة عمليتك.'
              : '💡 Your current input state will be preserved. You will be guided to complete the step and returned automatically.'}
          </p>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-ui-border pt-4">
          <Button variant="outline" onClick={onClose}>
            {isAr ? 'إلغاء / البقاء هنا' : 'Cancel / Stay Here'}
          </Button>
          <Button variant="primary" onClick={onProceed} className="gap-2">
            <span>{actionLabel}</span>
            {isAr ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
