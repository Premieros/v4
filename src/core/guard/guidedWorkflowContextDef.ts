import { createContext } from 'react';
import type {
  OperationalActionKey,
  PrerequisiteStep,
  GuidedContextState,
  OperationalValidationContext,
} from './types';

export interface GuidedWorkflowContextValue {
  guidedContext: GuidedContextState | null;
  startGuidance: (
    step: PrerequisiteStep,
    sourceAction: OperationalActionKey,
    sourceRoute: string,
    draftData?: Record<string, unknown>,
    sourceLabelAr?: string,
    sourceLabelEn?: string
  ) => void;
  completePrerequisiteAndReturn: (options?: { customMessageAr?: string; customMessageEn?: string }) => void;
  cancelGuidance: () => void;
  validateAndProceed: (
    action: OperationalActionKey,
    ctx: OperationalValidationContext,
    sourceRoute: string,
    sourceLabelAr: string,
    sourceLabelEn: string,
    draftData?: Record<string, unknown>
  ) => boolean;
  handleDbError: (
    error: unknown,
    fallbackAction: OperationalActionKey,
    sourceRoute: string,
    sourceLabelAr: string,
    sourceLabelEn: string,
    draftData?: Record<string, unknown>,
    ctx?: OperationalValidationContext
  ) => boolean;
  getDraftData: <T = Record<string, unknown>>() => T | null;
  clearDraftData: () => void;
  openGuardModal: (
    step: PrerequisiteStep,
    actionKey: OperationalActionKey,
    sourceRoute: string,
    sourceLabelAr: string,
    sourceLabelEn: string,
    draftData?: Record<string, unknown>,
    customReason?: string
  ) => void;
}

export const defaultFallbackGuidedWorkflow: GuidedWorkflowContextValue = {
  guidedContext: null,
  startGuidance: () => {},
  completePrerequisiteAndReturn: () => {},
  cancelGuidance: () => {},
  validateAndProceed: () => true,
  handleDbError: () => false,
  getDraftData: () => null,
  clearDraftData: () => {},
  openGuardModal: () => {},
};

export const GuidedWorkflowContext = createContext<GuidedWorkflowContextValue | undefined>(undefined);
