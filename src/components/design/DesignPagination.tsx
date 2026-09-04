import { PaginationBar } from '@/components/PaginationBar';

interface DesignPaginationProps {
  loaded: number;
  total: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  className?: string;
}

/**
 * Standard pagination footer (6E contract). Thin wrapper over the shared
 * PaginationBar that gives every list surface a stable container identity.
 */
export function DesignPagination(props: DesignPaginationProps) {
  return (
    <div data-testid="design-pagination" className="pt-1">
      <PaginationBar {...props} />
    </div>
  );
}
