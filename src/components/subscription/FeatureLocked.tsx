import React from 'react';
import { Lock, Sparkles, ArrowLeft, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useAuth } from '@/context/AuthContext';
import { isAdminRole } from '@/lib/permissions';
import { FEATURE_REGISTRY, type RejectionReason } from '../../services/subscription';

interface FeatureLockedProps {
  featureKey: string;
  reason?: RejectionReason | string;
  message?: { ar: string; en: string };
  title?: string;
  description?: string;
}

export const FeatureLocked: React.FC<FeatureLockedProps> = ({
  featureKey,
  reason,
  message,
  title,
  description,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = isAdminRole(user?.role);
  const feat = FEATURE_REGISTRY[featureKey];

  const displayTitle = title || feat?.name_ar || 'ميزة مقفولة';
  const displayDesc =
    description ||
    message?.ar ||
    (reason === 'BRANCH_OVERRIDE_DISABLED'
      ? 'تم تعطيل هذه الميزة خصيصاً لهذا الفرع من قِبل إدارة النظام.'
      : reason === 'SUBSCRIPTION_EXPIRED'
      ? 'انتهت صلاحية اشتراك منشأتك. يرجى التجديد لاستئناف استخدام هذه الميزة.'
      : reason === 'SUBSCRIPTION_SUSPENDED'
      ? 'تم تعليق حساب المنشأة مؤقتاً.'
      : 'هذه الميزة غير مشمولة في خطة اشتراكك الحالية. يمكنك الترقية الآن لفتحها والاستفادة من إمكانياتها.');

  const isSuspendedOrBranch =
    reason === 'BRANCH_OVERRIDE_DISABLED' || reason === 'SUBSCRIPTION_SUSPENDED';

  return (
    <div
      id={`feature-locked-${featureKey}`}
      className="max-w-xl mx-auto my-12 p-8 bg-ui-card border border-ui-border rounded-2xl shadow-sm text-center"
    >
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
        {isSuspendedOrBranch ? (
          <ShieldAlert className="w-8 h-8" />
        ) : (
          <Lock className="w-8 h-8" />
        )}
      </div>

      <div className="inline-flex items-center gap-1.5 px-3 py-1 mb-3 rounded-full text-xs font-semibold bg-ui-muted text-ui-text-muted">
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <span>ميزة حصرية للمشتركين</span>
      </div>

      <h2 className="text-xl font-bold text-ui-text mb-2">{displayTitle}</h2>
      <p className="text-sm text-ui-text-muted leading-relaxed mb-6 max-w-md mx-auto">
        {displayDesc}
      </p>

      <div className="flex items-center justify-center gap-3">
        {!isSuspendedOrBranch && isOwner && (
          <button
            id={`btn-upgrade-feature-${featureKey}`}
            onClick={() => navigate(APP_ROUTES.subscription)}
            className="px-5 py-2.5 bg-ui-primary text-ui-primary-contrast font-medium rounded-xl text-sm shadow-sm hover:opacity-90 transition-all flex items-center gap-2"
          >
            <span>ترقية الخطة الآن</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <button
          id={`btn-back-feature-${featureKey}`}
          onClick={() => navigate(APP_ROUTES.dashboard)}
          className="px-5 py-2.5 bg-ui-muted hover:bg-ui-border text-ui-text font-medium rounded-xl text-sm transition-all"
        >
          العودة للرئيسية
        </button>
      </div>
    </div>
  );
};
