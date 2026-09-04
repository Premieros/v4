import { TrendingUp, ShoppingCart, Receipt, Package, BarChart3, CreditCard, Users, FileText, Layers, TrendingDown, AlertTriangle, BookOpen, Award, Factory, Clock, Wallet, Landmark, Star } from 'lucide-react';
import type { ReportDefinition } from './reportRegistry';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  TrendingUp, ShoppingCart, Receipt, Package, BarChart3, CreditCard, Users, FileText,
  Layers, TrendingDown, AlertTriangle, BookOpen, Award, Factory, Clock, Wallet, Landmark,
};

interface ReportCardProps {
  report: ReportDefinition;
  isActive: boolean;
  isFavorite: boolean;
  lang: string;
  onSelect: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}

export function ReportCard({ report, isActive, isFavorite, lang, onSelect, onToggleFavorite }: ReportCardProps) {
  const Icon = ICON_MAP[report.icon] || BarChart3;
  const title = lang === 'ar' ? report.title : report.titleEn;
  const desc = lang === 'ar' ? report.description : report.descriptionEn;

  return (
    <div
      role="button"
      tabIndex={0}
      data-report-type={report.key}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex flex-col items-start gap-2 p-4 rounded-xl border text-start cursor-pointer transition-all duration-150 ${
        isActive
          ? 'bg-ui-primary/10 border-ui-primary shadow-ui-sm ring-1 ring-ui-primary/30'
          : 'bg-ui-surface border-ui-border hover:border-ui-primary/40 hover:shadow-ui-sm'
      }`}
    >
      <div className="flex items-center gap-3 w-full">
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
          isActive ? 'bg-ui-primary text-white' : 'bg-ui-page-alt text-ui-muted group-hover:text-ui-primary'
        }`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-semibold truncate ${isActive ? 'text-ui-primary' : 'text-ui-text'}`}>{title}</h3>
          <p className="text-xs text-ui-subtle mt-0.5 line-clamp-2">{desc}</p>
        </div>
        <button
          onClick={onToggleFavorite}
          className="flex-shrink-0 p-1 rounded hover:bg-ui-page-alt opacity-0 group-hover:opacity-100 transition-opacity"
          title={isFavorite ? (lang === 'ar' ? 'إزالة من المفضلة' : 'Remove from favorites') : (lang === 'ar' ? 'إضافة للمفضلة' : 'Add to favorites')}
        >
          <Star className={`w-4 h-4 ${isFavorite ? 'fill-amber-400 text-ui-warning' : 'text-ui-subtle'}`} />
        </button>
      </div>
      {isActive && (
        <div className="absolute top-2 start-2 w-1.5 h-1.5 rounded-full bg-ui-primary" />
      )}
    </div>
  );
}
