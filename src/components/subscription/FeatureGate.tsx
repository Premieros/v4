import React, { type ReactNode } from 'react';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import { FeatureLocked } from './FeatureLocked';

interface FeatureGateProps {
  feature: string;
  branchId?: string | null;
  children: ReactNode;
  fallback?: ReactNode;
  showLockedCard?: boolean;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  branchId,
  children,
  fallback,
  showLockedCard = true,
}) => {
  const access = useFeatureAccess(feature, branchId);

  if (access.allowed) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  if (showLockedCard) {
    return (
      <FeatureLocked
        featureKey={feature}
        reason={access.reason}
        message={access.message}
      />
    );
  }

  return null;
};
