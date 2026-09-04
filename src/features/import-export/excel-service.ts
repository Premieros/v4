import { ImportExportEntity, ValidationError, ExportFormat } from './types';
import { ENTITY_CONFIGS } from './entity-configs';

export interface ParsedSpreadsheet {
  fileName: string;
  headers: string[];
  rawRows: Record<string, unknown>[];
  totalRows: number;
}

export class ExcelService {
  /**
   * Parse uploaded Excel or CSV file
   */
  public static async readSpreadsheet(file: File): Promise<ParsedSpreadsheet> {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), {
      type: 'array',
      cellDates: true,
      cellText: false,
    });

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Read headers and data
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd',
    }) as unknown[][];

    if (!rawData || rawData.length === 0) {
      return {
        fileName: file.name,
        headers: [],
        rawRows: [],
        totalRows: 0,
      };
    }

    const headers = (rawData[0] || []).map((h) => String(h || '').trim()).filter((h) => h !== '');
    const dataRows = rawData.slice(1);

    const jsonRows: Record<string, unknown>[] = [];

    dataRows.forEach((row) => {
      // Check if entire row is empty
      const hasAnyValue = row.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== '');
      if (!hasAnyValue) return;

      const rowObj: Record<string, unknown> = {};
      headers.forEach((header, colIndex) => {
        rowObj[header] = row[colIndex] ?? '';
      });
      jsonRows.push(rowObj);
    });

    return {
      fileName: file.name,
      headers,
      rawRows: jsonRows,
      totalRows: jsonRows.length,
    };
  }

  /**
   * Helper to normalize Arabic and English header strings for resilient matching
   */
  private static normalizeHeader(str: string): string {
    if (!str) return '';
    return str
      .toLowerCase()
      .trim()
      // Remove diacritics / tashkeel
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Normalize Arabic letters
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      // Remove asterisk, parentheses, brackets, special symbols
      .replace(/[-*()[\]{}:/#%$^&|_+\s]/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, '')
      .trim();
  }

  /**
   * Auto-detect and match spreadsheet headers with target entity columns
   */
  public static detectAndMapColumns(
    fileHeaders: string[],
    entity: ImportExportEntity
  ): Record<string, string> {
    const config = ENTITY_CONFIGS[entity];
    if (!config) return {};

    const mapping: Record<string, string> = {}; // canonicalKey -> fileHeader
    const usedHeaders = new Set<string>();

    config.columns.forEach((col) => {
      const normalizedKey = this.normalizeHeader(col.key);
      const normalizedLabelAr = this.normalizeHeader(col.labelAr);
      const normalizedLabelEn = this.normalizeHeader(col.labelEn);
      const normalizedAliases = (col.aliases || []).map((a) => this.normalizeHeader(a));

      // 1. Direct exact or normalized match with key
      let match = fileHeaders.find(
        (h) => !usedHeaders.has(h) && (h.toLowerCase().trim() === col.key.toLowerCase() || this.normalizeHeader(h) === normalizedKey)
      );

      // 2. Direct or normalized match with labelAr or labelEn
      if (!match) {
        match = fileHeaders.find((h) => {
          if (usedHeaders.has(h)) return false;
          const normH = this.normalizeHeader(h);
          return normH === normalizedLabelAr || normH === normalizedLabelEn;
        });
      }

      // 3. Match with aliases
      if (!match && normalizedAliases.length > 0) {
        match = fileHeaders.find((h) => {
          if (usedHeaders.has(h)) return false;
          const normH = this.normalizeHeader(h);
          return normalizedAliases.some((alias) => normH === alias);
        });
      }

      // 4. Substring / partial match with aliases or labels
      if (!match) {
        match = fileHeaders.find((h) => {
          if (usedHeaders.has(h)) return false;
          const normH = this.normalizeHeader(h);
          if (!normH) return false;
          if (normH.includes(normalizedKey) || (normalizedKey.length > 3 && normalizedKey.includes(normH))) return true;
          if (normalizedLabelAr && (normH.includes(normalizedLabelAr) || normalizedLabelAr.includes(normH))) return true;
          return normalizedAliases.some(
            (alias) => alias.length > 2 && (normH.includes(alias) || alias.includes(normH))
          );
        });
      }

      if (match) {
        mapping[col.key] = match;
        usedHeaders.add(match);
      }
    });

    return mapping;
  }

  /**
   * Transform raw spreadsheet rows using column mapping into canonical objects
   */
  public static transformMappedRows(
    rawRows: Record<string, unknown>[],
    columnMapping: Record<string, string>
  ): Record<string, unknown>[] {
    return rawRows.map((raw) => {
      const canonicalObj: Record<string, unknown> = {};
      Object.entries(columnMapping).forEach(([canonicalKey, fileHeader]) => {
        if (fileHeader && raw[fileHeader] !== undefined) {
          let val = raw[fileHeader];
          if (typeof val === 'string') {
            val = val.trim();
            // Boolean normalization for Arabic/English common values
            if (val === 'نعم' || val === 'صح' || val === 'مفعل' || val === 'نشط' || val === 'true' || val === 'TRUE') {
              val = true;
            } else if (val === 'لا' || val === 'خطأ' || val === 'معطل' || val === 'غير نشط' || val === 'false' || val === 'FALSE') {
              val = false;
            }
          }
          canonicalObj[canonicalKey] = val;
        }
      });
      return canonicalObj;
    });
  }

  /**
   * Download official Excel template with styling, header guidelines & sample rows
   */
  public static async downloadTemplate(entity: ImportExportEntity, lang: 'ar' | 'en' = 'ar'): Promise<void> {
    const XLSX = await import('xlsx');
    const config = ENTITY_CONFIGS[entity];
    if (!config) return;

    const wb = XLSX.utils.book_new();

    // 1. Prepare sample rows with localized headers
    const headers = config.columns.map((c) => (lang === 'ar' ? c.labelAr : c.labelEn));

    const rowsData = config.sampleRows.map((sample) => {
      const row: Record<string, unknown> = {};
      config.columns.forEach((col) => {
        const headerLabel = lang === 'ar' ? col.labelAr : col.labelEn;
        let val = sample[col.key];
        if (typeof val === 'boolean') {
          val = val ? (lang === 'ar' ? 'نعم' : 'Yes') : (lang === 'ar' ? 'لا' : 'No');
        }
        row[headerLabel] = val ?? '';
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rowsData, { header: headers });

    // Set column widths based on label and content
    const colWidths = config.columns.map((col) => ({
      wch: Math.max(lang === 'ar' ? col.labelAr.length * 2 : col.labelEn.length + 5, 18),
    }));
    ws['!cols'] = colWidths;

    // 2. Instructions Sheet
    const instructions = lang === 'ar' ? config.instructionsAr : config.instructionsEn;
    const instructionsData = [
      [lang === 'ar' ? 'إرشادات وقواعد استيراد: ' + config.titleAr : 'Import Guidelines: ' + config.titleEn],
      [''],
      ...instructions.map((inst, i) => [`${i + 1}. ${inst}`]),
      [''],
      [lang === 'ar' ? 'توضيح الأعمدة:' : 'Columns Guide:'],
      [
        lang === 'ar' ? 'العمود' : 'Column',
        lang === 'ar' ? 'إلزامي؟' : 'Required?',
        lang === 'ar' ? 'النوع' : 'Type',
        lang === 'ar' ? 'مثال' : 'Example',
        lang === 'ar' ? 'الشرح' : 'Description',
      ],
      ...config.columns.map((col) => [
        lang === 'ar' ? col.labelAr : col.labelEn,
        col.required ? (lang === 'ar' ? 'نعم' : 'Yes') : (lang === 'ar' ? 'اختياري' : 'Optional'),
        col.type,
        String(col.example),
        lang === 'ar' ? col.descriptionAr : col.descriptionEn,
      ]),
    ];

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
    wsInstructions['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 50 }];

    // Append sheets
    const dataSheetTitle = lang === 'ar' ? 'البيانات' : 'Data';
    const instructionsSheetTitle = lang === 'ar' ? 'الإرشادات' : 'Instructions';

    XLSX.utils.book_append_sheet(wb, ws, dataSheetTitle);
    XLSX.utils.book_append_sheet(wb, wsInstructions, instructionsSheetTitle);

    const filename = `${config.id}_template_${lang}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  /**
   * Download comprehensive Error Report with exact line number, column, cause and remedy
   */
  public static async downloadErrorReport(
    errors: ValidationError[],
    entity: ImportExportEntity,
    lang: 'ar' | 'en' = 'ar'
  ): Promise<void> {
    const XLSX = await import('xlsx');

    const errorRows = errors.map((err) => ({
      [lang === 'ar' ? 'رقم الصف في الإكسل' : 'Excel Row #']: err.rowNumber,
      [lang === 'ar' ? 'اسم العمود' : 'Column']: err.column,
      [lang === 'ar' ? 'القيمة المدخلة' : 'Provided Value']: String(err.value ?? ''),
      [lang === 'ar' ? 'درجة الخطأ' : 'Severity']: err.severity === 'error' ? (lang === 'ar' ? 'خطأ يمنع الاستيراد' : 'Error') : (lang === 'ar' ? 'تنبيه' : 'Warning'),
      [lang === 'ar' ? 'سبب المشكلة' : 'Issue Description']: lang === 'ar' ? err.message : err.messageEn,
      [lang === 'ar' ? 'طريقة الإصلاح' : 'Recommended Remedy']: lang === 'ar' ? err.remedy : err.remedyEn,
    }));

    const ws = XLSX.utils.json_to_sheet(errorRows);
    ws['!cols'] = [
      { wch: 18 },
      { wch: 22 },
      { wch: 25 },
      { wch: 18 },
      { wch: 45 },
      { wch: 55 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, lang === 'ar' ? 'تقرير الأخطاء' : 'Error Report');

    const filename = `import_errors_${entity}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  /**
   * Export database entity records to XLSX or CSV
   */
  public static async exportData(
    records: Record<string, unknown>[],
    filename: string,
    format: ExportFormat = 'xlsx',
    sheetName: string = 'Data'
  ): Promise<void> {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(records);

    if (records.length > 0) {
      const keys = Object.keys(records[0]);
      ws['!cols'] = keys.map((k) => ({
        wch: Math.min(Math.max(k.length * 1.5, 14), 40),
      }));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    if (format === 'csv') {
      XLSX.writeFile(wb, `${filename}.csv`, { bookType: 'csv' });
    } else {
      XLSX.writeFile(wb, `${filename}.xlsx`, { bookType: 'xlsx' });
    }
  }
}
