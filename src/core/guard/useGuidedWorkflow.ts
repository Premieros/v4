import { useContext } from 'react';
import { GuidedWorkflowContext, defaultFallbackGuidedWorkflow } from './guidedWorkflowContextDef';
import type { GuidedWorkflowContextValue } from './guidedWorkflowContextDef';

export function useGuidedWorkflow(): GuidedWorkflowContextValue {
  const ctx = useContext(GuidedWorkflowContext);
  return ctx || defaultFallbackGuidedWorkflow;
}
