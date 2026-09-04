import { VisualDashboardPage } from './VisualDashboardPage';
import { DashboardExecutiveInsightsV2 } from './DashboardExecutiveInsightsV2';

/**
 * 6H visual rebuild entry point.
 * Business/data concerns remain isolated in the existing hooks/API layer;
 * this component owns the dashboard surface and executive management panel.
 */
export function DashboardEnhancedPage() {
  return (
    <div className="space-y-8">
      <VisualDashboardPage />
      <DashboardExecutiveInsightsV2 />
    </div>
  );
}
