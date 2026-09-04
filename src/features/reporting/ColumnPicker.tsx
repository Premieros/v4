import { useState, useRef, useEffect } from 'react';
import { Columns } from 'lucide-react';
import { Button } from '@/components/Button';

interface ColumnPickerProps {
  columns: string[];
  visibleColumns: string[] | null;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  lang: string;
  hiddenCount: number;
}

export function ColumnPicker({ columns, visibleColumns, onToggle, onShowAll, lang, hiddenCount }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const isVisible = (col: string) => visibleColumns === null || visibleColumns.includes(col);

  return (
    <div ref={ref} className="relative inline-flex">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        <Columns className="w-4 h-4" />
        {lang === 'ar' ? 'الأعمدة' : 'Columns'}
        {hiddenCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-ui-primary text-ui-primary-fg">
            {hiddenCount}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute end-0 top-full mt-1 z-50 w-56 bg-ui-surface border border-ui-border rounded-ui shadow-lg p-2">
          <button
            onClick={() => { onShowAll(); setOpen(false); }}
            className="w-full text-start px-2 py-1.5 text-sm rounded-ui hover:bg-ui-page-alt text-ui-primary font-medium"
          >
            {lang === 'ar' ? 'إظهار الكل' : 'Show All'}
          </button>
          <div className="border-t border-ui-border my-1" />
          {columns.map((col) => (
            <label key={col} className="flex items-center gap-2 px-2 py-1.5 text-sm text-ui-text rounded-ui hover:bg-ui-page-alt cursor-pointer">
              <input
                type="checkbox"
                checked={isVisible(col)}
                onChange={() => onToggle(col)}
                className="rounded"
              />
              {col}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
