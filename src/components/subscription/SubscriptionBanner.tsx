import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Clock, ArrowLeft, ShieldAlert } from 'lucide-react';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useAuth } from '@/context/AuthContext';
import { isAdminRole } from '@/lib/permissions';
import { useSubscription } from '../../hooks/useSubscription';

export const SubscriptionBanner: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = isAdminRole(user?.role);
  const { isTrial, isExpired, isSuspended, trialDaysRemaining, periodDaysRemaining, status } =
    useSubscription();

  // If active with plenty of days, or no subscription needed to display
  if (status === 'none') return null;

  if (isSuspended) {
    return (
      <div
        id="subscription-banner-suspended"
        className="bg-red-500/10 border-b border-red-500/20 text-red-700 dark:text-red-300 px-4 py-2.5 text-sm flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="font-medium">
            حساب المنشأة معلق حالياً. يرجى التواصل مع إدارة النظام لتسوية الاشتراك.
          </span>
        </div>
      </div>
    );
  }

  if (isExpired) {
    return (
      <div
        id="subscription-banner-expired"
        className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-sm flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="font-medium">
            انتهت فترة اشتراك المنشأة. الميزات الحصرية مقفولة حالياً حتى يتم التجديد.
          </span>
        </div>
        {isOwner && (
          <button
            id="btn-banner-renew"
            onClick={() => navigate(APP_ROUTES.subscription)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors shadow-sm"
          >
            <span>تجديد الاشتراك</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (isTrial && trialDaysRemaining !== null && trialDaysRemaining <= 5) {
    return (
      <div
        id="subscription-banner-trial"
        className="bg-blue-500/10 border-b border-blue-500/20 text-blue-800 dark:text-blue-200 px-4 py-2 text-xs md:text-sm flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span>
            أنت في الفترة التجريبية المجانية (متبقي {trialDaysRemaining} يوم).
          </span>
        </div>
        {isOwner && (
          <button
            id="btn-banner-choose-plan"
            onClick={() => navigate(APP_ROUTES.subscription)}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            <span>اختيار خطة</span>
            <ArrowLeft className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  if (status === 'active' && periodDaysRemaining !== null && periodDaysRemaining <= 5) {
    return (
      <div
        id="subscription-banner-expiring"
        className="bg-amber-500/10 border-b border-amber-500/20 text-amber-800 dark:text-amber-200 px-4 py-2 text-xs md:text-sm flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>
            سينتهي اشتراكك الحالي خلال {periodDaysRemaining} أيام. يرجى التجديد لتجنب انقطاع الخدمة.
          </span>
        </div>
        {isOwner && (
          <button
            id="btn-banner-renew-expiring"
            onClick={() => navigate(APP_ROUTES.subscription)}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 text-white text-xs font-medium rounded-md hover:bg-amber-700 transition-colors"
          >
            <span>تجديد الآن</span>
            <ArrowLeft className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return null;
};
