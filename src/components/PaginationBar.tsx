import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Loader2, Check } from 'lucide-react';

interface PaginationBarProps {
  loaded: number;
  total: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  className?: string;
}

// Reusable "load more" control for the paginated lists produced by
// usePaginatedRows (audit M7). Shows how many rows are loaded and lets the
// user fetch the next page explicitly instead of silently capping or dumping
// the whole table.
export function PaginationBar({ loaded, total, hasMore, loadingMore, onLoadMore, className }: PaginationBarProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';

  if (loaded === 0) return null;

  return (
    <div data-testid="pagination-bar" className={`flex items-center justify-between gap-2 px-1 pt-3 ${className || ''}`}>
      <span className="text-xs text-ui-muted">
        {isAr ? 'تم عرض' : 'Showing'} {loaded}
        {total !== null && <span> / {total}</span>}
      </span>
      {hasMore ? (
        <Button size="sm" variant="outline" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {isAr ? 'جارٍ التحميل…' : 'Loading…'}
            </>
          ) : (
            isAr ? 'تحميل المزيد' : 'Load more'
          )}
        </Button>
      ) : (
        <span className="flex items-center gap-1 text-xs text-ui-success">
          <Check className="w-3.5 h-3.5" /> {isAr ? 'تم عرض الكل' : 'Showing all'}
        </span>
      )}
    </div>
  );
}
