export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: unknown): string => {
    const s = value == null ? '' : String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }
  return lines.join('\n');
}

export function downloadCSV(rows: Record<string, unknown>[], filename: string): void {
  const blob = new Blob(['\uFEFF' + toCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PrintReportOptions {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  lang?: 'ar' | 'en';
}

export function openPrintWindow(options: PrintReportOptions): void {
  const dir = options.lang === 'ar' ? 'rtl' : 'ltr';
  const title = escapeHtml(options.title);
  const subtitle = options.subtitle ? `<p class="subtitle">${escapeHtml(options.subtitle)}</p>` : '';
  const head = options.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = options.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  const win = window.open('', '_blank', 'width=960,height=680');
  if (!win) return;
  win.document.write(
    `<!doctype html>
<html lang="${options.lang || 'en'}" dir="${dir}">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin: 24px; color: #0f172a; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { margin: 0 0 16px; color: #64748b; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f1f5f9; text-align: start; padding: 8px 10px; border: 1px solid #e2e8f0; }
  td { padding: 6px 10px; border: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #fafbfc; }
  @media print { body { margin: 12px; } }
</style></head>
<body><h1>${title}</h1>${subtitle}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.onload = function(){ window.focus(); window.print(); };</script>
</body></html>`,
  );
  win.document.close();
}
