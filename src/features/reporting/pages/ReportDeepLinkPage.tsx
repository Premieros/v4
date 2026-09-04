import { useEffect, useRef, useState } from 'react';
import { BarChart3, CreditCard, Factory, FileText, Package, Settings2, ShoppingCart } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';

const REPORT_LABELS = {
  sales: ['المبيعات', 'Sales'], sales_by_payment: ['المبيعات حسب طريقة الدفع', 'Sales by Payment'], sales_by_employee: ['المبيعات حسب الموظف', 'Sales by Employee'], sales_by_product: ['المبيعات حسب المنتج', 'Sales by Product'], detailed_invoices: ['الفواتير التفصيلية', 'Detailed Invoices'],
  purchases: ['المشتريات', 'Purchases'], expenses: ['المصروفات', 'Expenses'], profit: ['الربحية', 'Profitability'], inventory: ['المخزون', 'Inventory'], component_consumption: ['استهلاك المكونات', 'Component Consumption'], recipe_costs: ['تكلفة الوصفات', 'Recipe Costs'], top_consumed_components: ['أكثر المكونات استهلاكًا', 'Top Components'], top_consumed_products: ['أكثر المنتجات استهلاكًا', 'Top Consumed Products'], low_stock: ['المخزون المنخفض', 'Low Stock'],
} as const;

type ReportType = keyof typeof REPORT_LABELS;
type Lang = 'ar' | 'en';
const GROUPS: { key: string; icon: typeof BarChart3; reports: ReportType[]; ar: string; en: string }[] = [
  { key: 'sales', icon: BarChart3, reports: ['sales', 'sales_by_payment', 'sales_by_employee', 'sales_by_product', 'detailed_invoices'], ar: 'المبيعات', en: 'Sales' },
  { key: 'trade', icon: ShoppingCart, reports: ['purchases', 'expenses'], ar: 'المشتريات والمصروفات', en: 'Purchases & Expenses' },
  { key: 'performance', icon: CreditCard, reports: ['profit'], ar: 'الأداء والربحية', en: 'Performance & Profit' },
  { key: 'inventory', icon: Package, reports: ['inventory', 'low_stock'], ar: 'المخزون', en: 'Inventory' },
  { key: 'manufacturing', icon: Factory, reports: ['component_consumption', 'recipe_costs', 'top_consumed_components', 'top_consumed_products'], ar: 'التصنيع والتكلفة', en: 'Manufacturing & Costing' },
];
function isReportType(value: string | null): value is ReportType { return value !== null && Object.prototype.hasOwnProperty.call(REPORT_LABELS, value); }
function selectReport(report: string) { document.querySelector<HTMLButtonElement>(`button[data-report-type="${report}"]`)?.click(); }

export function ReportDeepLinkPage() {
  const [searchParams] = useSearchParams();
  const requestedParam = searchParams.get('reportType');
  const [activeGroup, setActiveGroup] = useState('sales');
  const [lang, setLang] = useState<Lang>('ar');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [visible, setVisible] = useState<boolean[]>([]);
  const lastSignature = useRef('');

  const refreshColumns = () => {
    const headers = Array.from(document.querySelectorAll<HTMLTableCellElement>('table thead th')).map((th) => th.textContent?.trim() || '');
    if (!headers.length) return;
    const signature = headers.join('\u001f');
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    const report = document.querySelector<HTMLSelectElement>('[data-testid="report-type-select"]')?.value || 'report';
    let savedValues: boolean[] = [];
    try { savedValues = JSON.parse(localStorage.getItem(`premier.report.columns.${report}`) || '[]') as boolean[]; } catch { savedValues = []; }
    setColumns(headers);
    setVisible(headers.map((_, i) => savedValues[i] !== false));
  };

  useEffect(() => {
    if (!isReportType(requestedParam)) return;
    const group = GROUPS.find((g) => g.reports.includes(requestedParam));
    if (group) setActiveGroup(group.key);
    let attempts = 0;
    const resolve = () => {
      const reportButton = document.querySelector<HTMLButtonElement>(`button[data-report-type="${requestedParam}"]`);
      if (reportButton && !reportButton.disabled) { reportButton.click(); return; }
      attempts += 1;
      if (attempts < 40) window.setTimeout(resolve, 50);
    };
    const timer = window.setTimeout(resolve, 0);
    return () => window.clearTimeout(timer);
  }, [requestedParam]);

  useEffect(() => {
    const observer = new MutationObserver(refreshColumns);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(refreshColumns, 250);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const table = document.querySelector('table');
    if (!table || !visible.length) return;
    table.querySelectorAll('tr').forEach((row) => row.querySelectorAll<HTMLElement>(':scope > *').forEach((cell, i) => { cell.style.display = visible[i] === false ? 'none' : ''; }));
    const report = document.querySelector<HTMLSelectElement>('[data-testid="report-type-select"]')?.value || 'report';
    localStorage.setItem(`premier.report.columns.${report}`, JSON.stringify(visible));
  }, [visible, columns]);

  const group = GROUPS.find((g) => g.key === activeGroup) || GROUPS[0];
  return (
    <div className="relative">
      <style>{`button[data-report-type] { display: none !important; }`}</style>
      <div className="mb-4 rounded-ui-xl border border-ui-border bg-ui-surface shadow-ui overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border px-4 py-3">
          <div><div className="flex items-center gap-2 text-sm font-bold text-ui-text"><FileText className="h-4 w-4 text-ui-primary" />{lang === 'ar' ? 'مركز التقارير' : 'Reports Center'}</div><p className="mt-0.5 text-xs text-ui-muted">{lang === 'ar' ? 'كل التقارير في مكان واحد بدون ازدحام' : 'All reports, organized without clutter'}</p></div>
          <div className="flex items-center gap-2"><button onClick={() => setCustomizeOpen((v) => !v)} className="flex items-center gap-2 rounded-ui-lg border border-ui-border bg-ui-page-alt px-3 py-2 text-xs font-semibold text-ui-text hover:bg-ui-primary-soft hover:text-ui-primary"><Settings2 className="h-4 w-4" />{lang === 'ar' ? 'تخصيص الأعمدة' : 'Customize columns'}</button><div className="flex items-center gap-1 rounded-ui-lg border border-ui-border bg-ui-page-alt p-1"><button onClick={() => setLang('ar')} className={`rounded-ui px-2.5 py-1 text-xs font-semibold ${lang === 'ar' ? 'bg-ui-surface text-ui-text shadow-ui-sm' : 'text-ui-muted'}`}>العربية</button><button onClick={() => setLang('en')} className={`rounded-ui px-2.5 py-1 text-xs font-semibold ${lang === 'en' ? 'bg-ui-surface text-ui-text shadow-ui-sm' : 'text-ui-muted'}`}>EN</button></div></div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-ui-border px-3 py-2">{GROUPS.map((item) => { const Icon = item.icon; const active = item.key === activeGroup; return <button key={item.key} onClick={() => setActiveGroup(item.key)} className={`flex shrink-0 items-center gap-2 rounded-ui-lg px-3 py-2 text-xs font-semibold transition ${active ? 'bg-ui-primary text-ui-primary-fg' : 'text-ui-muted hover:bg-ui-page-alt hover:text-ui-text'}`}><Icon className="h-4 w-4" />{lang === 'ar' ? item.ar : item.en}</button>; })}</div>
        <div className="flex flex-wrap gap-2 px-4 py-3">{group.reports.map((key) => <button key={key} data-report-nav={key} onClick={() => selectReport(key)} className="rounded-ui-lg border border-ui-border bg-ui-page-alt px-3 py-2 text-xs font-medium text-ui-text transition hover:border-ui-primary hover:bg-ui-primary-soft hover:text-ui-primary">{lang === 'ar' ? REPORT_LABELS[key][0] : REPORT_LABELS[key][1]}</button>)}</div>
        {customizeOpen && <div className="border-t border-ui-border bg-ui-page-alt px-4 py-3"><div className="mb-2 text-xs font-bold text-ui-text">{lang === 'ar' ? 'الأعمدة الظاهرة في التقرير الحالي' : 'Visible columns in the current report'}</div><div className="flex flex-wrap gap-2">{columns.map((column, i) => <label key={`${column}-${i}`} className="flex items-center gap-2 rounded-ui-lg border border-ui-border bg-ui-surface px-3 py-2 text-xs text-ui-text"><input type="checkbox" checked={visible[i] !== false} onChange={() => setVisible((prev) => prev.map((v, index) => index === i ? !v : v))} />{column}</label>)}</div>{columns.length === 0 && <div className="text-xs text-ui-muted">{lang === 'ar' ? 'اختر تقريرًا لعرض أعمدته.' : 'Select a report to see its columns.'}</div>}</div>}
      </div>
      <ReportsPage />
    </div>
  );
}
