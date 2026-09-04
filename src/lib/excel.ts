export interface ExcelExportOptions {
  data: Record<string, unknown>[];
  filename: string;
  sheetName?: string;
  title?: string;
  subtitle?: string;
  currencyColumns?: string[];
  totalRow?: Record<string, unknown>;
  lang?: 'ar' | 'en';
}

function autoWidth(columns: string[], rows: Record<string, unknown>[]): number[] {
  return columns.map((col) => {
    let max = col.length;
    for (const row of rows) {
      const v = row[col];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return Math.min(max + 2, 40);
  });
}

export async function exportToExcelAdvanced(options: ExcelExportOptions): Promise<void> {
  const XLSX = await import('xlsx');
  const {
    data,
    filename,
    sheetName = 'Sheet1',
    title,
    subtitle,
    currencyColumns = [],
    totalRow,
    lang,
  } = options;

  const wb = XLSX.utils.book_new();

  if (title) {
    const summaryRows: [string, string][] = [[title, '']];
    if (subtitle) summaryRows.push([subtitle, '']);
    if (totalRow) {
      const entries = Object.entries(totalRow);
      for (const [k, v] of entries) summaryRows.push([k, v == null ? '' : String(v)]);
    }
    summaryRows.push([`${lang === 'ar' ? 'تاريخ الإنشاء' : 'Generated at'}: ${new Date().toLocaleString()}`, '']);
    const summaryData: (string | number)[][] = [
      [lang === 'ar' ? 'البيان' : 'Item', lang === 'ar' ? 'القيمة' : 'Value'],
      ...summaryRows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws, lang === 'ar' ? 'ملخص' : 'Summary');
  }

  const columns = data.length > 0 ? Object.keys(data[0]) : [];
  const allRows = totalRow ? [...data, totalRow] : data;

  const ws = XLSX.utils.json_to_sheet(allRows, { header: columns });

  const widths = autoWidth(columns, allRows);
  ws['!cols'] = widths.map((w) => ({ wch: w }));

  (wb as unknown as Record<string, unknown>)['Workbook'] = { Views: [{ state: 'frozen', ysplit: 1, xsplit: 0 }] };

  const range = XLSX.utils.decode_range(ws['!ref']!);

  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (!cell) continue;
    cell.s = {
      font: { bold: true },
      fill: { fgColor: { rgb: 'F1F5F9' } },
      border: {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      },
    };
  }

  if (currencyColumns.length > 0 && allRows.length > 0) {
    const colIdxMap = new Map(columns.map((col, i) => [col, i]));
    for (const col of currencyColumns) {
      const ci = colIdxMap.get(col);
      if (ci == null) continue;
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: ci });
        const cell = ws[addr];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = '#,##0.00';
        }
      }
    }
  }

  if (totalRow && allRows.length > 0) {
    const lastR = range.e.r;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: lastR, c });
      const cell = ws[addr];
      if (cell) {
        cell.s = { ...(cell.s || {}), font: { bold: true } };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function exportToExcel(data: Record<string, unknown>[], filename: string, sheetName = 'Sheet1'): Promise<void> {
  return exportToExcelAdvanced({ data, filename, sheetName });
}

export async function importFromExcel(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const data = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(data), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
}

export async function downloadTemplate(columns: string[], filename: string): Promise<void> {
  const data = [columns.reduce((acc, col) => ({ ...acc, [col]: '' }), {})];
  await exportToExcel(data, filename, 'Template');
}
