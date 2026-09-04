import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { PrerequisiteModal } from './PrerequisiteModal';
import {
  validateActionPrerequisites,
  interpretDbError,
} from './prerequisitesRegistry';
import { GuidedWorkflowContext } from './guidedWorkflowContextDef';
import type { GuidedWorkflowContextValue } from './guidedWorkflowContextDef';
import type {
  OperationalActionKey,
  PrerequisiteStep,
  GuidedContextState,
  OperationalValidationContext,
} from './types';

const STORAGE_KEY = 'premier_pos_guided_workflow';

export function GuidedWorkflowProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  const [guidedContext, setGuidedContext] = useState<GuidedContextState | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GuidedContextState;
        // Expire older than 2 hours
        if (Date.now() - parsed.timestamp < 2 * 60 * 60 * 1000) {
          return parsed;
        }
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    step: PrerequisiteStep | null;
    actionKey?: OperationalActionKey;
    sourceRoute?: string;
    sourceLabelAr?: string;
    sourceLabelEn?: string;
    draftData?: Record<string, unknown>;
    customReason?: string;
  }>({ isOpen: false, step: null });

  // Sync to session storage
  useEffect(() => {
    try {
      if (guidedContext) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(guidedContext));
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [guidedContext]);

  const startGuidance = useCallback(
    (
      step: PrerequisiteStep,
      sourceAction: OperationalActionKey,
      sourceRoute: string,
      draftData?: Record<string, unknown>,
      sourceLabelAr?: string,
      sourceLabelEn?: string
    ) => {
      const state: GuidedContextState = {
        sourceRoute,
        sourceAction,
        sourceLabelAr: sourceLabelAr || (isAr ? 'العملية الأصلية' : 'Original Operation'),
        sourceLabelEn: sourceLabelEn || 'Original Operation',
        missingStep: step,
        draftData,
        timestamp: Date.now(),
      };
      setGuidedContext(state);
      setModalState({ isOpen: false, step: null });
      navigate(step.targetRoute);
      show(
        isAr
          ? `تم توجيهك إلى (${step.titleAr}). بمجرد الإضافة سيتم إعادتك تلقائياً لـ (${state.sourceLabelAr}).`
          : `Guided to (${step.titleEn}). You will be returned to (${state.sourceLabelEn}) after completion.`,
        'info'
      );
    },
    [navigate, isAr, show]
  );

  const completePrerequisiteAndReturn = useCallback(
    (options?: { customMessageAr?: string; customMessageEn?: string }) => {
      if (!guidedContext) return;
      const target = guidedContext.sourceRoute;
      const srcName = isAr ? guidedContext.sourceLabelAr : guidedContext.sourceLabelEn;
      const defaultMsg = isAr
        ? `تم استكمال المتطلب بنجاح! جاري العودة إلى (${srcName}) مع استعادة بياناتك.`
        : `Prerequisite fulfilled! Returning to (${srcName}) with your data.`;
      const msg = (isAr ? options?.customMessageAr : options?.customMessageEn) || defaultMsg;

      // Keep draft data for one step, clear guided target state
      const draft = guidedContext.draftData;
      setGuidedContext(null);
      sessionStorage.removeItem(STORAGE_KEY);

      show(msg, 'success');
      navigate(target, { state: { restoredDraft: draft, fromGuidance: true } });
    },
    [guidedContext, isAr, navigate, show]
  );

  const cancelGuidance = useCallback(() => {
    setGuidedContext(null);
    sessionStorage.removeItem(STORAGE_KEY);
    show(isAr ? 'تم إلغاء مسار التوجيه الذكي.' : 'Guided workflow cancelled.', 'info');
  }, [isAr, show]);

  const openGuardModal = useCallback(
    (
      step: PrerequisiteStep,
      actionKey: OperationalActionKey,
      sourceRoute: string,
      sourceLabelAr: string,
      sourceLabelEn: string,
      draftData?: Record<string, unknown>,
      customReason?: string
    ) => {
      setModalState({
        isOpen: true,
        step,
        actionKey,
        sourceRoute,
        sourceLabelAr,
        sourceLabelEn,
        draftData,
        customReason,
      });
    },
    []
  );

  const validateAndProceed = useCallback(
    (
      action: OperationalActionKey,
      ctx: OperationalValidationContext,
      sourceRoute: string,
      sourceLabelAr: string,
      sourceLabelEn: string,
      draftData?: Record<string, unknown>
    ): boolean => {
      const validation = validateActionPrerequisites(action, ctx);
      if (!validation.allowed && validation.missingStep) {
        openGuardModal(
          validation.missingStep,
          action,
          sourceRoute || location.pathname,
          sourceLabelAr,
          sourceLabelEn,
          draftData || ctx.formData,
          isAr ? validation.reasonAr : validation.reasonEn
        );
        return false;
      }
      return true;
    },
    [openGuardModal, location.pathname, isAr]
  );

  const handleDbError = useCallback(
    (
      error: unknown,
      fallbackAction: OperationalActionKey,
      sourceRoute: string,
      sourceLabelAr: string,
      sourceLabelEn: string,
      draftData?: Record<string, unknown>,
      ctx?: OperationalValidationContext
    ): boolean => {
      const interpreted = interpretDbError(error, ctx);
      if (interpreted) {
        openGuardModal(
          interpreted.step,
          fallbackAction,
          sourceRoute || location.pathname,
          sourceLabelAr,
          sourceLabelEn,
          draftData,
          isAr ? interpreted.friendlyMessageAr : interpreted.friendlyMessageEn
        );
        return true;
      }
      return false;
    },
    [openGuardModal, location.pathname, isAr]
  );

  const getDraftData = useCallback(<T = Record<string, unknown>,>(): T | null => {
    return (guidedContext?.draftData as T) || null;
  }, [guidedContext]);

  const clearDraftData = useCallback(() => {
    if (guidedContext) {
      setGuidedContext({ ...guidedContext, draftData: undefined });
    }
  }, [guidedContext]);

  const value = useMemo<GuidedWorkflowContextValue>(
    () => ({
      guidedContext,
      startGuidance,
      completePrerequisiteAndReturn,
      cancelGuidance,
      validateAndProceed,
      handleDbError,
      getDraftData,
      clearDraftData,
      openGuardModal,
    }),
    [
      guidedContext,
      startGuidance,
      completePrerequisiteAndReturn,
      cancelGuidance,
      validateAndProceed,
      handleDbError,
      getDraftData,
      clearDraftData,
      openGuardModal,
    ]
  );

  return (
    <GuidedWorkflowContext.Provider value={value}>
      {children}
      <PrerequisiteModal
        isOpen={modalState.isOpen}
        step={modalState.step}
        actionKey={modalState.actionKey}
        customReason={modalState.customReason}
        sourceLabelAr={modalState.sourceLabelAr}
        sourceLabelEn={modalState.sourceLabelEn}
        onClose={() => setModalState({ isOpen: false, step: null })}
        onProceed={() => {
          if (modalState.step && modalState.sourceRoute && modalState.actionKey) {
            startGuidance(
              modalState.step,
              modalState.actionKey,
              modalState.sourceRoute,
              modalState.draftData,
              modalState.sourceLabelAr,
              modalState.sourceLabelEn
            );
          }
        }}
      />
    </GuidedWorkflowContext.Provider>
  );
}
