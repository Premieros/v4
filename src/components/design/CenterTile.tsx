import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import type { LucideIcon } from 'lucide-react';

export type CenterTileItem = {
  id: string;
  labelKey?: string;
  ar?: string;
  en?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  route: string;
  permission?: boolean;
  icon: LucideIcon;
  badge?: string;
};

type CenterTileProps = {
  item: CenterTileItem;
  testIdPrefix: string;
};

export function CenterTile({ item, testIdPrefix }: CenterTileProps) {
  const navigate = useNavigate();
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const Icon = item.icon;

  return (
    <button
      data-testid={`${testIdPrefix}-${item.id}`}
      type="button"
      onClick={() => navigate(item.route)}
      className="group relative rounded-2xl border border-ui-border bg-ui-surface p-5 text-start shadow-ui-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-ui-primary hover:shadow-ui-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
    >
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-ui-primary-soft text-ui-primary transition-all duration-150 group-hover:bg-ui-primary group-hover:text-ui-primary-fg">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-bold text-ui-text">{ar ? (item.ar ?? item.en) : (item.en ?? item.ar)}</h3>
      {(item.descriptionAr || item.descriptionEn) && (
        <p className="mt-2 text-sm leading-6 text-ui-muted">
          {ar ? item.descriptionAr : item.descriptionEn}
        </p>
      )}
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-ui-primary transition group-hover:gap-2">
        {ar ? 'فتح الوحدة' : 'Open module'}
        <span aria-hidden="true" className="transition-all group-hover:ms-1">{ar ? '←' : '→'}</span>
      </span>
      {item.badge && (
        <span className="absolute end-3 top-3 rounded-full bg-ui-success px-2 py-0.5 text-[10px] font-bold text-ui-primary-fg">
          {item.badge}
        </span>
      )}
    </button>
  );
}

type CenterGridProps = {
  items: CenterTileItem[];
  testIdPrefix: string;
  columns?: 2 | 3 | 4;
};

export function CenterGrid({ items, testIdPrefix, columns = 4 }: CenterGridProps) {
  const gridCols = columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4';
  return (
    <div className={`grid gap-4 ${gridCols}`}>
      {items.map((item) => (
        <CenterTile key={item.id} item={item} testIdPrefix={testIdPrefix} />
      ))}
    </div>
  );
}
