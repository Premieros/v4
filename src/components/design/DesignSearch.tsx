import { useId } from 'react';
import { Search } from 'lucide-react';

export interface DesignSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  testId?: string;
  className?: string;
}

/**
 * Standardized search input (6E contract). Stable `design-search` test id,
 * labelled for accessibility, responsive width, identical visual identity on
 * every list surface. Pure presentational — callers keep their filtering logic.
 */
export function DesignSearch({ value, onChange, placeholder, label, testId = 'design-search', className = '' }: DesignSearchProps) {
  const id = useId();
  return (
    <div className={`relative min-w-0 ${className}`}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" aria-hidden="true" />
      <input
        id={label ? id : undefined}
        type="search"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        data-testid={testId}
        className="w-full rounded-ui border border-ui-border bg-ui-surface-raised ps-10 pe-4 py-2.5 text-sm text-ui-text placeholder-ui-subtle shadow-ui-sm focus:outline-none focus:border-ui-border-strong focus:ring-2 focus:ring-ui-ring"
      />
    </div>
  );
}
