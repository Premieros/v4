import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  FileText,
  Clock,
  Filter,
  Check,
  Layers,
  Package,
  ShoppingCart,
  Boxes,
  Users,
  Truck,
  Receipt,
  Factory,
  ArrowLeftRight,
  BadgePercent,
  FolderTree,
  UserCheck,
  UtensilsCrossed,
  Info,
  X,
  SlidersHorizontal,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { ENTITY_CONFIGS } from '../entity-configs';
import {
  ImportExportEntity,
  CollisionPolicy,
  ExportFormat,
  ExportFilters,
  ValidationSummary,
  ImportProgress,
  ImportResult,
  ImportExportOperationLog,
} from '../types';
import { ExcelService, ParsedSpreadsheet } from '../excel-service';
import { ValidationEngine, ValidationContext } from '../validation-engine';
import { ImportExecutor } from '../import-executor';
import { ExportService } from '../export-service';

export function ImportExportCenterPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const { show } = useToast();

  // Active Main Tab
  const [activeTab, setActiveTab] = useState<'import' | 'export' | 'templates' | 'logs'>('import');

  // Master Data Context for Validation & Branch Isolation
  const [validationContext, setValidationContext] = useState<ValidationContext>({
    existingProducts: [],
    existingCategories: [],
    existingComponents: [],
    existingSuppliers: [],
    existingCustomers: [],
    existingWarehouses: [],
    existingBranches: [],
    existingUsers: [],
    userBranchId: user?.branch_id || null,
    isSuperAdmin: user?.role === 'super_admin',
    allowedBranchIds: user?.branch_id ? [user.branch_id] : [],
    allowedWarehouseIds: [],
  });

  const [loadingContext, setLoadingContext] = useState(true);

  // Load master data for validation
  const loadContextData = useCallback(async () => {
    setLoadingContext(true);
    try {
      const [
        prodsRes,
        catsRes,
        compsRes,
        suppsRes,
        custsRes,
        whsRes,
        brsRes,
        usersRes,
      ] = await Promise.all([
        Promise.resolve(supabase.from('products').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('categories').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('raw_materials').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('suppliers').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('customers').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('warehouses').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('branches').select('*')).catch(() => ({ data: [], error: null })),
        Promise.resolve(supabase.from('users').select('*')).catch(() => ({ data: [], error: null })),
      ]);

      const isSuper = user?.role === 'super_admin';
      const userBranch = user?.branch_id || null;
      const branches = ((brsRes as { data: Array<{ id: string; code?: string; name: string }> })?.data || []) as Array<{ id: string; code?: string; name: string }>;
      const warehouses = ((whsRes as { data: Array<{ id: string; code?: string; name: string; branch_id?: string }> })?.data || []) as Array<{ id: string; code?: string; name: string; branch_id?: string }>;

      const allowedBranches = isSuper
        ? branches.map((b) => b.id)
        : userBranch
        ? [userBranch]
        : [];

      const allowedWarehouses = isSuper
        ? warehouses.map((w) => w.id)
        : warehouses.filter((w) => !w.branch_id || allowedBranches.includes(w.branch_id)).map((w) => w.id);

      const prodsList = ((prodsRes as { data: Record<string, unknown>[] })?.data || []);
      const catsList = ((catsRes as { data: Record<string, unknown>[] })?.data || []);
      const compsList = ((compsRes as { data: Record<string, unknown>[] })?.data || []);
      const suppsList = ((suppsRes as { data: Record<string, unknown>[] })?.data || []);
      const custsList = ((custsRes as { data: Record<string, unknown>[] })?.data || []);
      const usersList = ((usersRes as { data: Record<string, unknown>[] })?.data || []);

      setValidationContext({
        existingProducts: prodsList.map((p) => ({
          id: String(p.id || ''),
          sku: String(p.sku || p.name || ''),
          name: String(p.name || ''),
          barcode: p.barcode ? String(p.barcode) : undefined,
          category_id: p.category_id ? String(p.category_id) : undefined,
        })),
        existingCategories: catsList.map((c) => ({
          id: String(c.id || ''),
          code: String(c.code || c.name || ''),
          name: String(c.name || ''),
          name_en: c.name_en ? String(c.name_en) : undefined,
        })),
        existingComponents: compsList.map((c) => ({
          id: String(c.id || ''),
          sku: String(c.code || c.sku || c.name || ''),
          name: String(c.name || ''),
          unit: String(c.unit || c.description || 'قطعة'),
          cost: Number(c.default_cost ?? c.cost_price ?? 0),
        })),
        existingSuppliers: suppsList.map((s) => ({
          id: String(s.id || ''),
          code: s.code ? String(s.code) : undefined,
          name: String(s.name || ''),
          phone: s.phone ? String(s.phone) : undefined,
        })),
        existingCustomers: custsList.map((c) => ({
          id: String(c.id || ''),
          code: c.code ? String(c.code) : undefined,
          name: String(c.name || ''),
          phone: c.phone ? String(c.phone) : undefined,
        })),
        existingWarehouses: warehouses,
        existingBranches: branches,
        existingUsers: usersList.map((u) => ({
          id: String(u.id || ''),
          username: String(u.username || u.email || 'user'),
          email: u.email ? String(u.email) : undefined,
        })),
        userBranchId: userBranch,
        isSuperAdmin: isSuper,
        allowedBranchIds: allowedBranches,
        allowedWarehouseIds: allowedWarehouses,
      });
    } catch (err) {
      console.error('Failed loading import/export metadata:', err);
    } finally {
      setLoadingContext(false);
    }
  }, [user]);

  useEffect(() => {
    loadContextData();
  }, [loadContextData]);

  // ==========================================
  // WIZARD STATE (10 Steps)
  // ==========================================
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [selectedEntity, setSelectedEntity] = useState<ImportExportEntity>('products');
  const [parsedFile, setParsedFile] = useState<ParsedSpreadsheet | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [mappedRows, setMappedRows] = useState<Record<string, unknown>[]>([]);
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);
  const [collisionPolicy, setCollisionPolicy] = useState<CollisionPolicy>('update_existing');
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [finalResult, setFinalResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==========================================
  // EXPORT STATE
  // ==========================================
  const [exportEntity, setExportEntity] = useState<ImportExportEntity>('products');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx');
  const [exportFilters, setExportFilters] = useState<ExportFilters>({
    status: 'all',
  });
  const [isExporting, setIsExporting] = useState(false);

  // ==========================================
  // AUDIT LOGS STATE
  // ==========================================
  const [operationLogs, setOperationLogs] = useState<ImportExportOperationLog[]>(() => {
    const saved = localStorage.getItem('premier_import_export_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [
      {
        id: 'log-sample-1',
        timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
        operation: 'import',
        entity: 'products',
        fileName: 'Products_August_2026.xlsx',
        totalRecords: 125,
        successCount: 120,
        errorCount: 5,
        status: 'partial',
        performedBy: user?.username || 'admin',
        performedByName: user?.full_name || user?.username || 'مدير النظام',
        branchName: 'الفرع الرئيسي',
        errors: [
          {
            rowNumber: 14,
            column: 'سعر البيع',
            value: 0,
            message: 'سعر البيع يساوي صفر',
            messageEn: 'Price is zero',
            remedy: 'أدخل سعر بيع صحيح',
            remedyEn: 'Enter price',
            severity: 'warning',
          },
        ],
      },
    ];
  });

  const saveLog = (log: ImportExportOperationLog) => {
    const updated = [log, ...operationLogs];
    setOperationLogs(updated);
    localStorage.setItem('premier_import_export_logs', JSON.stringify(updated.slice(0, 100)));
  };

  // Helper icon selector
  const getEntityIcon = (iconName: string) => {
    switch (iconName) {
      case 'Package':
        return <Package className="w-5 h-5" />;
      case 'FolderTree':
        return <FolderTree className="w-5 h-5" />;
      case 'Layers':
        return <Layers className="w-5 h-5" />;
      case 'UtensilsCrossed':
        return <UtensilsCrossed className="w-5 h-5" />;
      case 'BadgePercent':
        return <BadgePercent className="w-5 h-5" />;
      case 'Truck':
        return <Truck className="w-5 h-5" />;
      case 'Users':
        return <Users className="w-5 h-5" />;
      case 'ShoppingCart':
        return <ShoppingCart className="w-5 h-5" />;
      case 'Boxes':
        return <Boxes className="w-5 h-5" />;
      case 'Factory':
        return <Factory className="w-5 h-5" />;
      case 'ArrowLeftRight':
        return <ArrowLeftRight className="w-5 h-5" />;
      case 'Receipt':
        return <Receipt className="w-5 h-5" />;
      case 'UserCheck':
        return <UserCheck className="w-5 h-5" />;
      default:
        return <FileSpreadsheet className="w-5 h-5" />;
    }
  };

  // Handle File Selection & Auto-Parsing
  const handleFileUpload = async (file: File) => {
    try {
      const parsed = await ExcelService.readSpreadsheet(file);
      if (parsed.rawRows.length === 0) {
        show(isAr ? 'الملف فارغ أو لا يحتوي على صفوف بيانات صالحة' : 'File is empty or contains no valid rows', 'error');
        return;
      }
      setParsedFile(parsed);

      // Auto-detect columns
      const detectedMapping = ExcelService.detectAndMapColumns(parsed.headers, selectedEntity);
      setColumnMapping(detectedMapping);

      const transformed = ExcelService.transformMappedRows(parsed.rawRows, detectedMapping);
      setMappedRows(transformed);

      // Run Validation
      const summary = ValidationEngine.validate(selectedEntity, transformed, validationContext);
      setValidationSummary(summary);

      // Advance to validation step
      setWizardStep(4);
      show(
        isAr
          ? `تم قراءة الملف بنجاح (${parsed.rawRows.length} سجل)`
          : `File parsed successfully (${parsed.rawRows.length} records)`,
        'success'
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      show(isAr ? `تعذر قراءة الملف: ${errMsg}` : `Failed to parse file: ${errMsg}`, 'error');
    }
  };

  // Handle loading built-in sample data for testing
  const handleLoadSampleData = () => {
    if (!currentEntityConfig) return;
    const sampleRows = currentEntityConfig.sampleRows;
    if (!sampleRows || sampleRows.length === 0) {
      show(isAr ? 'لا توجد بيانات تجريبية متوفرة لهذا الكيان' : 'No sample data available for this entity', 'error');
      return;
    }

    const headers = Object.keys(sampleRows[0]);
    const mockFile: ParsedSpreadsheet = {
      headers,
      rawRows: sampleRows,
      totalRows: sampleRows.length,
      fileName: `${selectedEntity}_sample_data.xlsx`,
    };
    setParsedFile(mockFile);

    // Auto-detect columns
    const detectedMapping = ExcelService.detectAndMapColumns(headers, selectedEntity);
    setColumnMapping(detectedMapping);

    const transformed = ExcelService.transformMappedRows(sampleRows, detectedMapping);
    setMappedRows(transformed);

    // Run Validation
    const summary = ValidationEngine.validate(selectedEntity, transformed, validationContext);
    setValidationSummary(summary);

    // Advance to validation step
    setWizardStep(4);
    show(
      isAr
        ? `تم تحميل البيانات التجريبية بنجاح (${sampleRows.length} سجل)`
        : `Sample data loaded successfully (${sampleRows.length} records)`,
      'success'
    );
  };

  // Re-run validation on column mapping change
  const handleColumnMappingChange = (canonicalKey: string, fileHeader: string) => {
    if (!parsedFile) return;
    const newMapping = { ...columnMapping, [canonicalKey]: fileHeader };
    setColumnMapping(newMapping);

    const transformed = ExcelService.transformMappedRows(parsedFile.rawRows, newMapping);
    setMappedRows(transformed);

    const summary = ValidationEngine.validate(selectedEntity, transformed, validationContext);
    setValidationSummary(summary);
  };

  // Execute Import
  const handleExecuteImport = async () => {
    if (!validationSummary || mappedRows.length === 0) return;

    setIsExecuting(true);
    setWizardStep(9); // Step 9: Progress

    try {
      const result = await ImportExecutor.execute(
        selectedEntity,
        mappedRows,
        collisionPolicy,
        validationContext,
        (prog) => setProgress(prog),
        validationSummary
      );

      setFinalResult(result);
      setWizardStep(10); // Step 10: Result Summary

      // Save operation log
      const logStatus =
        result.errorCount === 0 ? 'completed' : result.successCount > 0 ? 'partial' : 'failed';

      saveLog({
        id: `import-${Date.now()}`,
        timestamp: new Date().toISOString(),
        operation: 'import',
        entity: selectedEntity,
        fileName: parsedFile?.fileName || 'import.xlsx',
        totalRecords: result.totalRows,
        successCount: result.successCount,
        errorCount: result.errorCount,
        status: logStatus,
        performedBy: user?.username || 'user',
        performedByName: user?.full_name || user?.username || undefined,
        branchName: validationContext.existingBranches.find((b) => b.id === user?.branch_id)?.name || 'الفرع الرئيسي',
        errors: result.errors,
      });

      // Refresh metadata
      loadContextData();

      if (result.errorCount === 0) {
        show(
          isAr
            ? `تم استيراد ${result.successCount} سجل بنجاح كامل!`
            : `Successfully imported ${result.successCount} records!`,
          'success'
        );
      } else {
        show(
          isAr
            ? `اكتمل الاستيراد مع وجود ${result.errorCount} خطأ. يمكنك تحميل تقرير الأخطاء.`
            : `Import completed with ${result.errorCount} errors. Download error report for details.`,
          'warning'
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      show(isAr ? `فشل الاستيراد: ${errMsg}` : `Import failed: ${errMsg}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  // Handle Export Execution
  const handleExportExecution = async () => {
    setIsExporting(true);
    try {
      const res = await ExportService.exportEntity(
        exportEntity,
        exportFilters,
        exportFormat,
        isAr ? 'ar' : 'en'
      );

      saveLog({
        id: `export-${Date.now()}`,
        timestamp: new Date().toISOString(),
        operation: 'export',
        entity: exportEntity,
        fileName: res.fileName,
        totalRecords: res.recordCount,
        successCount: res.recordCount,
        errorCount: 0,
        status: 'completed',
        performedBy: user?.username || 'user',
        performedByName: user?.full_name || user?.username || undefined,
        branchName: exportFilters.branchId
          ? validationContext.existingBranches.find((b) => b.id === exportFilters.branchId)?.name
          : isAr
          ? 'كل الفروع المصرحة'
          : 'All Authorized Branches',
      });

      show(
        isAr
          ? `تم تصدير ${res.recordCount} سجل بنجاح إلى ملف ${res.fileName}`
          : `Successfully exported ${res.recordCount} records to ${res.fileName}`,
        'success'
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      show(isAr ? `فشل التصدير: ${errMsg}` : `Export failed: ${errMsg}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Reset Wizard
  const resetWizard = () => {
    setWizardStep(1);
    setParsedFile(null);
    setColumnMapping({});
    setMappedRows([]);
    setValidationSummary(null);
    setProgress(null);
    setFinalResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const currentEntityConfig = ENTITY_CONFIGS[selectedEntity];

  return (
    <DesignSurface testId="import-export-center">
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        {/* Page Header */}
        <DesignPageHeader
          title={isAr ? 'مركز الاستيراد والتصدير الموحد' : 'Unified Import & Export Center'}
          description={
            isAr
              ? 'المنظومة المركزية الشاملة لجميع عمليات إكسل: استيراد وتصدير الأصناف والمواد الخام والوصفات والمشتريات مع التحقق الصارم من العلاقات والصلاحيات'
              : 'Enterprise Excel engine: Import & export catalog, BOM recipes, purchases, and stock with strict relational integrity'
          }
          actions={
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadContextData}
                disabled={loadingContext}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loadingContext ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'تحديث البيانات' : 'Refresh Metadata'}</span>
              </Button>
            </div>
          }
        />

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2">
          <button
            onClick={() => setActiveTab('import')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'import'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>{isAr ? 'معالج الاستيراد (Import Wizard)' : 'Import Wizard'}</span>
          </button>

          <button
            onClick={() => setActiveTab('export')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'export'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>{isAr ? 'تصدير البيانات (Export)' : 'Export Center'}</span>
          </button>

          <button
            onClick={() => setActiveTab('templates')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'templates'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isAr ? 'قوالب Excel الجاهزة (Templates)' : 'Excel Templates'}</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'logs'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{isAr ? 'سجل العمليات السابقة' : 'Operation History'}</span>
            {operationLogs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-muted text-foreground">
                {operationLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: IMPORT WIZARD */}
        {/* ========================================================================= */}
        {activeTab === 'import' && (
          <div className="space-y-6">
            {/* Wizard Stepper Header */}
            <DesignPanel className="p-4 bg-muted/20">
              <div className="flex items-center justify-between overflow-x-auto pb-2 gap-2 text-xs sm:text-sm">
                {[
                  { step: 1, label: isAr ? '١. نوع البيانات' : '1. Entity' },
                  { step: 2, label: isAr ? '٢. تحميل القالب' : '2. Template' },
                  { step: 3, label: isAr ? '٣. رفع الملف' : '3. Upload' },
                  { step: 4, label: isAr ? '٤. مطابقة الأعمدة' : '4. Columns' },
                  { step: 6, label: isAr ? '٥. الفحص والمعاينة' : '5. Validate' },
                  { step: 8, label: isAr ? '٦. سياسة التطبيق' : '6. Policy' },
                  { step: 10, label: isAr ? '٧. النتيجة والتقرير' : '7. Results' },
                ].map((s) => {
                  const isActive = wizardStep === s.step || (wizardStep >= s.step && wizardStep < s.step + 2);
                  const isDone = wizardStep > s.step + 1;
                  return (
                    <div
                      key={s.step}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                          : isDone
                          ? 'text-primary bg-primary/10'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {isDone ? <Check className="w-3.5 h-3.5" /> : <span>{s.label}</span>}
                    </div>
                  );
                })}
              </div>
            </DesignPanel>

            {/* STEP 1: Select Entity Type */}
            {wizardStep === 1 && (
              <div className="space-y-6">
                <div className="text-center sm:text-right space-y-1">
                  <h3 className="text-lg font-semibold text-foreground">
                    {isAr ? 'الخطوة الأولى: اختر نوع البيانات المراد استيرادها' : 'Step 1: Select Entity to Import'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isAr
                      ? 'اختر الجدول المطلوب. يقوم النظام بالتحقق الصارم من الروابط والعزل المحاسبي للفروع'
                      : 'Choose destination entity. The system handles relation validation and strict branch isolation.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {Object.values(ENTITY_CONFIGS).map((cfg) => {
                    const isSelected = selectedEntity === cfg.id;
                    return (
                      <div
                        key={cfg.id}
                        onClick={() => setSelectedEntity(cfg.id)}
                        className={`cursor-pointer p-4 rounded-xl border transition-all duration-200 flex flex-col justify-between space-y-3 ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
                            : 'border-border/60 hover:border-primary/50 bg-card hover:shadow-xs'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div
                            className={`p-2.5 rounded-lg ${
                              isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                            }`}
                          >
                            {getEntityIcon(cfg.icon)}
                          </div>
                          {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                        </div>

                        <div>
                          <h4 className="font-semibold text-base text-foreground">
                            {isAr ? cfg.titleAr : cfg.titleEn}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {isAr ? cfg.descriptionAr : cfg.descriptionEn}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{cfg.columns.length} أعمدة</span>
                          <span className="text-primary font-medium">{isAr ? 'اختيار' : 'Select'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    size="lg"
                    onClick={() => setWizardStep(2)}
                    className="flex items-center gap-2 px-8"
                  >
                    <span>{isAr ? 'المتابعة لتحميل القالب والرفع' : 'Continue to Template & Upload'}</span>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2 & 3: Template & File Upload */}
            {(wizardStep === 2 || wizardStep === 3) && currentEntityConfig && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={() => setWizardStep(1)} className="gap-2">
                    <ArrowRight className="w-4 h-4" />
                    <span>{isAr ? 'تغيير نوع البيانات' : 'Change Entity'}</span>
                  </Button>
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>{isAr ? 'النوع المختار:' : 'Selected:'}</span>
                    <Badge variant="primary" className="text-xs px-2.5 py-1">
                      {isAr ? currentEntityConfig.titleAr : currentEntityConfig.titleEn}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Guidelines & Template Download */}
                  <DesignPanel className="p-5 space-y-5 lg:col-span-1 border border-border/70">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-primary font-semibold">
                        <Info className="w-5 h-5" />
                        <h4>{isAr ? 'قواعد وإرشادات الاستيراد' : 'Import Rules & Guidelines'}</h4>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-2 pr-4 list-disc">
                        {(isAr ? currentEntityConfig.instructionsAr : currentEntityConfig.instructionsEn).map(
                          (inst, idx) => (
                            <li key={idx}>{inst}</li>
                          )
                        )}
                      </ul>
                    </div>

                    <div className="pt-4 border-t border-border/40 space-y-3">
                      <h5 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        {isAr ? 'تحميل القالب المعتمد' : 'Download Verified Template'}
                      </h5>
                      <p className="text-xs text-muted-foreground">
                        {isAr
                          ? 'يحتوي القالب على أمثلة توضيحية لجميع الأعمدة المطلوبة لتجنب أخطاء التنسيق.'
                          : 'Pre-formatted template with sample rows and column validators.'}
                      </p>

                      <Button
                        variant="outline"
                        className="w-full justify-center gap-2 text-primary border-primary/30 hover:bg-primary/5"
                        onClick={() => ExcelService.downloadTemplate(selectedEntity, isAr ? 'ar' : 'en')}
                      >
                        <Download className="w-4 h-4" />
                        <span>
                          {isAr
                            ? `تحميل قالب ${currentEntityConfig.titleAr}.xlsx`
                            : `Download ${currentEntityConfig.id}_template.xlsx`}
                        </span>
                      </Button>
                    </div>
                  </DesignPanel>

                  {/* Right Column: Drag & Drop Zone */}
                  <DesignPanel className="p-8 lg:col-span-2 flex flex-col items-center justify-center border-2 border-dashed border-border/80 hover:border-primary/60 rounded-2xl bg-card/60 transition-colors">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                      }}
                    />

                    <div className="p-4 rounded-full bg-primary/10 text-primary mb-4">
                      <Upload className="w-8 h-8" />
                    </div>

                    <h3 className="text-lg font-semibold text-foreground text-center">
                      {isAr ? 'اسحب وأفلت ملف Excel أو CSV هنا' : 'Drag & Drop your Excel or CSV file here'}
                    </h3>
                    <p className="text-sm text-muted-foreground text-center mt-1 max-w-md">
                      {isAr
                        ? 'يدعم الملفات بصيغة .xlsx, .xls, .csv. يقوم النظام تلقائياً بالتعرف على الأعمدة ومطابقتها.'
                        : 'Supports .xlsx, .xls, .csv. Headers and columns are mapped automatically.'}
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                      <Button
                        size="lg"
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-2 px-6"
                      >
                        <FileSpreadsheet className="w-5 h-5" />
                        <span>{isAr ? 'استعراض واختيار ملف من جهازك' : 'Browse Files from Computer'}</span>
                      </Button>

                      <Button
                        size="lg"
                        variant="secondary"
                        onClick={handleLoadSampleData}
                        className="gap-2 px-5 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>{isAr ? 'اختبار سريع ببيانات تجريبية جاهزة' : 'Quick Test with Sample Data'}</span>
                      </Button>
                    </div>
                  </DesignPanel>
                </div>
              </div>
            )}

            {/* STEP 4 & 5: Column Mapping & Validation Preview */}
            {wizardStep >= 4 && wizardStep <= 8 && parsedFile && currentEntityConfig && validationSummary && (
              <div className="space-y-6">
                {/* File Header Bar */}
                <DesignPanel className="p-4 flex flex-wrap items-center justify-between gap-4 bg-card border border-border">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">{parsedFile.fileName}</h4>
                      <p className="text-xs text-muted-foreground">
                        {isAr ? `إجمالي الصفوف:` : `Total Rows:`}{' '}
                        <strong className="text-foreground">{parsedFile.totalRows}</strong> |{' '}
                        {isAr ? `الأعمدة المكتشفة:` : `Detected Headers:`}{' '}
                        <strong className="text-foreground">{parsedFile.headers.length}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={resetWizard} className="text-xs text-destructive">
                      <X className="w-4 h-4 mr-1" />
                      {isAr ? 'إلغاء واختيار ملف آخر' : 'Cancel & Reupload'}
                    </Button>
                  </div>
                </DesignPanel>

                {/* Validation Stats Bento */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl border border-border bg-card">
                    <span className="text-xs text-muted-foreground">{isAr ? 'إجمالي السجلات' : 'Total Records'}</span>
                    <p className="text-2xl font-bold text-foreground mt-1">{validationSummary.totalRows}</p>
                  </div>

                  <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      {isAr ? 'سجلات صالحة' : 'Valid Records'}
                    </span>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                      {validationSummary.validRows}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
                    <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                      {isAr ? 'سجلات بها أخطاء' : 'Error Rows'}
                    </span>
                    <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                      {validationSummary.errorRows}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      {isAr ? 'تنبيهات وملاحظات' : 'Warnings'}
                    </span>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                      {validationSummary.warnings.length}
                    </p>
                  </div>
                </div>

                {/* Grouped Summary Preview (e.g. for Recipes BOM & Purchases) */}
                {validationSummary.groupedSummary && validationSummary.groupedSummary.length > 0 && (
                  <DesignPanel className="p-4 border-l-4 border-primary space-y-3 bg-muted/10">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                        <UtensilsCrossed className="w-4 h-4 text-primary" />
                        <span>
                          {selectedEntity === 'recipes'
                            ? isAr
                              ? `معاينة تجميع الوصفات (${validationSummary.groupedSummary.length} منتجات مجمعة بنموذج One Row Per Component)`
                              : `Grouped Recipes Preview (${validationSummary.groupedSummary.length} BOM Recipes)`
                            : isAr
                            ? `معاينة الفواتير المجمعة (${validationSummary.groupedSummary.length} فواتير شراء)`
                            : `Grouped Purchase Orders (${validationSummary.groupedSummary.length} POs)`}
                        </span>
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                      {validationSummary.groupedSummary.map((grp) => (
                        <div
                          key={grp.id}
                          className="p-2.5 rounded-lg border border-border/70 bg-card text-xs flex items-center justify-between"
                        >
                          <div className="truncate mr-2">
                            <strong className="text-foreground">{grp.id}</strong> — {grp.name}
                          </div>
                          <Badge variant="default" className="text-xs shrink-0">
                            {selectedEntity === 'recipes'
                              ? `${grp.count} ${isAr ? 'مكونات' : 'items'}`
                              : `${grp.count} ${isAr ? 'أصناف' : 'lines'}`}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </DesignPanel>
                )}

                {/* Column Mapping Section Accordion */}
                <DesignPanel className="p-4 border border-border/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
                      <SlidersHorizontal className="w-4 h-4 text-primary" />
                      <span>{isAr ? 'مطابقة أعمدة الملف مع حقول النظام' : 'Column Mapping Settings'}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {Object.keys(columnMapping).length} / {currentEntityConfig.columns.length} حقول مطابقة
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                    {currentEntityConfig.columns.map((col) => {
                      const currentMapped = columnMapping[col.key] || '';
                      const isMapped = Boolean(currentMapped);
                      return (
                        <div
                          key={col.key}
                          className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                            isMapped ? 'border-border/80 bg-muted/10' : 'border-amber-500/40 bg-amber-500/5'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground">
                              {isAr ? col.labelAr : col.labelEn}
                              {col.required && <span className="text-destructive ml-1">*</span>}
                            </span>
                            {isMapped ? (
                              <span className="text-emerald-600 font-medium text-[10px]">مطابق</span>
                            ) : (
                              <span className="text-amber-600 font-medium text-[10px]">غير مطابق</span>
                            )}
                          </div>

                          <select
                            value={currentMapped}
                            onChange={(e) => handleColumnMappingChange(col.key, e.target.value)}
                            className="w-full text-xs p-1.5 rounded border border-border bg-background text-foreground"
                          >
                            <option value="">-- {isAr ? 'تجاهل أو غير موجود' : 'Ignore / Not mapped'} --</option>
                            {parsedFile.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </DesignPanel>

                {/* Validation Inspector & Error Table */}
                <DesignPanel className="p-4 border border-border/70 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm text-foreground">
                        {isAr ? 'سجل فحص الأخطاء والتنبيهات' : 'Validation Inspector & Error Report'}
                      </h4>
                      {validationSummary.errors.length > 0 && (
                        <Badge variant="danger" className="text-xs">
                          {validationSummary.errors.length} {isAr ? 'أخطاء حرجة' : 'Critical Errors'}
                        </Badge>
                      )}
                    </div>

                    {validationSummary.errors.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                        onClick={() =>
                          ExcelService.downloadErrorReport(
                            [...validationSummary.errors, ...validationSummary.warnings],
                            selectedEntity,
                            isAr ? 'ar' : 'en'
                          )
                        }
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{isAr ? 'تحميل تقرير الأخطاء Excel' : 'Download Error Report'}</span>
                      </Button>
                    )}
                  </div>

                  {validationSummary.errors.length === 0 && validationSummary.warnings.length === 0 ? (
                    <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                      <h5 className="font-semibold text-emerald-800 dark:text-emerald-300">
                        {isAr ? 'الملف سليم 100% وجاهز للاستيراد!' : 'Spreadsheet is 100% valid and ready!'}
                      </h5>
                      <p className="text-xs text-muted-foreground">
                        {isAr
                          ? 'تم التحقق من كافة أنواع البيانات، عدم التكرار، والروابط وصلاحيات الفروع بنجاح.'
                          : 'All schema types, uniqueness checks, and branch access barriers passed.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-64 border rounded-lg">
                      <table className="w-full text-xs text-right divide-y divide-border">
                        <thead className="bg-muted/40 text-muted-foreground font-semibold sticky top-0">
                          <tr>
                            <th className="p-2.5">{isAr ? 'الصف' : 'Row'}</th>
                            <th className="p-2.5">{isAr ? 'العمود' : 'Column'}</th>
                            <th className="p-2.5">{isAr ? 'القيمة' : 'Value'}</th>
                            <th className="p-2.5">{isAr ? 'سبب المشكلة' : 'Reason'}</th>
                            <th className="p-2.5">{isAr ? 'طريقة الإصلاح' : 'Remedy'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card">
                          {validationSummary.errors.map((err, i) => (
                            <tr key={`err-${i}`} className="bg-rose-500/5 hover:bg-rose-500/10">
                              <td className="p-2.5 font-bold text-rose-600">#{err.rowNumber}</td>
                              <td className="p-2.5 font-medium">{err.column}</td>
                              <td className="p-2.5 font-mono text-muted-foreground">{String(err.value || '')}</td>
                              <td className="p-2.5 text-rose-600 dark:text-rose-400 font-medium">
                                {isAr ? err.message : err.messageEn}
                              </td>
                              <td className="p-2.5 text-foreground">{isAr ? err.remedy : err.remedyEn}</td>
                            </tr>
                          ))}
                          {validationSummary.warnings.map((warn, i) => (
                            <tr key={`warn-${i}`} className="bg-amber-500/5 hover:bg-amber-500/10">
                              <td className="p-2.5 font-bold text-amber-600">#{warn.rowNumber}</td>
                              <td className="p-2.5 font-medium">{warn.column}</td>
                              <td className="p-2.5 font-mono text-muted-foreground">{String(warn.value || '')}</td>
                              <td className="p-2.5 text-amber-600 dark:text-amber-400 font-medium">
                                {isAr ? warn.message : warn.messageEn}
                              </td>
                              <td className="p-2.5 text-foreground">{isAr ? warn.remedy : warn.remedyEn}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </DesignPanel>

                {/* STEP 8: Collision Policy & Final Execution Confirmation */}
                <DesignPanel className="p-5 border border-border bg-muted/20 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm text-foreground">
                      {isAr ? 'تحديد سياسة معالجة السجلات المكررة والموجودة مسبقاً' : 'Existing Records Collision Policy'}
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      {
                        key: 'update_existing',
                        title: isAr ? 'تحديث السجلات الموجودة' : 'Update Existing',
                        desc: isAr ? 'تحديث بيانات الصنف إذا كان الـ SKU موجوداً مسبقاً' : 'Update match by SKU/Code',
                      },
                      {
                        key: 'skip_existing',
                        title: isAr ? 'تخطي الموجود' : 'Skip Existing',
                        desc: isAr ? 'إدراج الجديد فقط وتخطي أي صنف مسجل' : 'Insert new only, skip matches',
                      },
                      {
                        key: 'add_only',
                        title: isAr ? 'إضافة فقط (إلزامية الفرادة)' : 'Insert Only',
                        desc: isAr ? 'منع أي تكرار وتجاهل التكرارات' : 'Strict uniqueness',
                      },
                      {
                        key: 'stop_on_error',
                        title: isAr ? 'إيقاف عند أول خطأ' : 'Stop on First Error',
                        desc: isAr ? 'إلغاء المعالجة والتراجع عند حدوث أي خطأ' : 'Halt batch on any error',
                      },
                    ].map((pol) => {
                      const isSelected = collisionPolicy === pol.key;
                      return (
                        <div
                          key={pol.key}
                          onClick={() => setCollisionPolicy(pol.key as CollisionPolicy)}
                          className={`cursor-pointer p-3.5 rounded-xl border text-xs space-y-1 transition-all ${
                            isSelected
                              ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                              : 'border-border bg-card hover:border-primary/40'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground">{pol.title}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                          </div>
                          <p className="text-muted-foreground text-[11px]">{pol.desc}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Informational banner on matching vs non-matching rows */}
                  {validationSummary.errorRows > 0 && (
                    <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span>
                          {isAr
                            ? `تنبيه: سيتم استيراد ${validationSummary.validRows} سجل مطابق وصالح، وتخطي ${validationSummary.errorRows} سجل غير مطابق لاحتوائه على أخطاء.`
                            : `Notice: ${validationSummary.validRows} matching records will be imported, while ${validationSummary.errorRows} non-matching records will be skipped.`}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          ExcelService.downloadErrorReport(validationSummary.errors, selectedEntity, isAr ? 'ar' : 'en')
                        }
                        className="text-xs shrink-0 border-amber-500/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/20"
                      >
                        <Download className="w-3.5 h-3.5 mr-1" />
                        {isAr ? 'تنزيل تقرير الأخطاء Excel' : 'Download Errors Excel'}
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <Button variant="ghost" onClick={() => setWizardStep(2)}>
                      {isAr ? 'السابق' : 'Back'}
                    </Button>

                    <Button
                      size="lg"
                      onClick={handleExecuteImport}
                      disabled={isExecuting || validationSummary.validRows === 0}
                      className="gap-2 px-8 bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                    >
                      <Upload className="w-4 h-4" />
                      <span>
                        {isAr
                          ? `بدء استيراد السجلات المطابقة (${validationSummary.validRows} من ${validationSummary.totalRows})`
                          : `Import Matching Records (${validationSummary.validRows} of ${validationSummary.totalRows})`}
                      </span>
                    </Button>
                  </div>
                </DesignPanel>
              </div>
            )}

            {/* STEP 9: Live Execution Progress */}
            {wizardStep === 9 && (
              <DesignPanel className="p-10 border text-center space-y-6 max-w-xl mx-auto">
                <div className="p-4 rounded-full bg-primary/10 text-primary w-16 h-16 mx-auto flex items-center justify-center animate-pulse">
                  <Upload className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-foreground">
                    {isAr ? 'جاري تنفيذ الاستيراد ومعالجة الحركات...' : 'Processing Bulk Import...'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {progress?.currentStep || (isAr ? 'يرجى الانتظار حتى اكتمال الدفعة...' : 'Please wait...')}
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300 rounded-full"
                      style={{ width: `${progress?.percentage || 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{progress?.percentage || 0}%</span>
                    <span>
                      {progress?.current || 0} / {progress?.total || 0}
                    </span>
                  </div>
                </div>
              </DesignPanel>
            )}

            {/* STEP 10: Final Outcome Result Screen */}
            {wizardStep === 10 && finalResult && (
              <DesignPanel className="p-8 border space-y-6 max-w-2xl mx-auto text-center">
                <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-600 w-16 h-16 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-2xl font-bold text-foreground">
                    {isAr ? 'اكتملت عملية الاستيراد بنجاح!' : 'Bulk Import Completed!'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isAr
                      ? `تمت معالجة الدفعة في ${Math.round(finalResult.timeTakenMs / 100) / 10} ثانية`
                      : `Batch processed in ${Math.round(finalResult.timeTakenMs / 100) / 10}s`}
                  </p>
                </div>

                {/* Results Bento */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-right">
                  <div className="p-3.5 rounded-xl border bg-card">
                    <span className="text-xs text-muted-foreground">{isAr ? 'إجمالي السجلات' : 'Total Rows'}</span>
                    <p className="text-xl font-bold text-foreground mt-1">{finalResult.totalRows}</p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                    <span className="text-xs text-emerald-600">{isAr ? 'سجلات جديدة مضافة' : 'Inserted'}</span>
                    <p className="text-xl font-bold text-emerald-600 mt-1">{finalResult.insertedCount}</p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5">
                    <span className="text-xs text-blue-600">{isAr ? 'سجلات تم تحديثها' : 'Updated'}</span>
                    <p className="text-xl font-bold text-blue-600 mt-1">{finalResult.updatedCount}</p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5">
                    <span className="text-xs text-rose-600">{isAr ? 'أخطاء تم تجاوزها' : 'Errors'}</span>
                    <p className="text-xl font-bold text-rose-600 mt-1">{finalResult.errorCount}</p>
                  </div>
                </div>

                {/* Error Report Download if Errors */}
                {finalResult.errors.length > 0 && (
                  <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-right space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                        {isAr ? 'يوجد أخطاء في بعض السجلات' : 'Errors encountered on some rows'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1 text-rose-600 border-rose-300"
                        onClick={() =>
                          ExcelService.downloadErrorReport(finalResult.errors, selectedEntity, isAr ? 'ar' : 'en')
                        }
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{isAr ? 'تنزيل تقرير الأخطاء Excel' : 'Download Error Excel'}</span>
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap justify-center gap-3 pt-4 border-t border-border">
                  <Button variant="outline" onClick={resetWizard} className="px-6">
                    {isAr ? 'استيراد ملف جديد' : 'Import Another File'}
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedEntity === 'products') window.location.hash = '/products';
                      else if (selectedEntity === 'recipes') window.location.hash = '/recipes';
                      else if (selectedEntity === 'purchases') window.location.hash = '/purchases';
                      else setActiveTab('logs');
                    }}
                    className="px-6 gap-2"
                  >
                    <span>{isAr ? 'عرض البيانات في شاشتها' : 'Go to Module View'}</span>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                </div>
              </DesignPanel>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: EXPORT CENTER */}
        {/* ========================================================================= */}
        {activeTab === 'export' && (
          <div className="space-y-6">
            <div className="text-center sm:text-right space-y-1">
              <h3 className="text-lg font-semibold text-foreground">
                {isAr ? 'تصدير البيانات والتقارير إلى Excel أو CSV' : 'Export Data & Reports'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isAr
                  ? 'اختر نوع البيانات وطبق الفلاتر المطلوبة حسب الفرع أو المستودع أو التاريخ'
                  : 'Select entity and apply granular branch, warehouse and timeframe filters.'}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Entity Selection */}
              <div className="lg:col-span-2 space-y-4">
                <h4 className="text-sm font-semibold text-foreground">{isAr ? '١. نوع البيانات' : '1. Select Entity'}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.values(ENTITY_CONFIGS).map((cfg) => {
                    const isSelected = exportEntity === cfg.id;
                    return (
                      <div
                        key={cfg.id}
                        onClick={() => setExportEntity(cfg.id)}
                        className={`cursor-pointer p-3.5 rounded-xl border transition-all flex items-center gap-3 ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                            : 'border-border bg-card hover:border-primary/40'
                        }`}
                      >
                        <div
                          className={`p-2 rounded-lg ${
                            isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                          }`}
                        >
                          {getEntityIcon(cfg.icon)}
                        </div>
                        <div className="truncate">
                          <h5 className="font-semibold text-xs text-foreground truncate">
                            {isAr ? cfg.titleAr : cfg.titleEn}
                          </h5>
                          <span className="text-[10px] text-muted-foreground">
                            {cfg.columns.length} {isAr ? 'أعمدة' : 'cols'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Filters & Export Actions */}
              <DesignPanel className="p-5 space-y-5 border border-border">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Filter className="w-4 h-4 text-primary" />
                  <span>{isAr ? '٢. خيارات وفلاتر التصدير' : '2. Export Filters & Format'}</span>
                </h4>

                {/* Format Toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{isAr ? 'صيغة الملف:' : 'File Format:'}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setExportFormat('xlsx')}
                      className={`p-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-2 ${
                        exportFormat === 'xlsx'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground'
                      }`}
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Excel (.xlsx)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExportFormat('csv')}
                      className={`p-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-2 ${
                        exportFormat === 'csv'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                      <span>CSV (.csv)</span>
                    </button>
                  </div>
                </div>

                {/* Branch Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{isAr ? 'الفرع:' : 'Branch:'}</label>
                  <select
                    value={exportFilters.branchId || ''}
                    onChange={(e) => setExportFilters({ ...exportFilters, branchId: e.target.value || undefined })}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-background text-foreground"
                  >
                    <option value="">{isAr ? 'كل الفروع المتاحة' : 'All Authorized Branches'}</option>
                    {validationContext.existingBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{isAr ? 'الحالة:' : 'Status:'}</label>
                  <select
                    value={exportFilters.status || 'all'}
                    onChange={(e) => setExportFilters({ ...exportFilters, status: e.target.value as 'all' | 'active' | 'inactive' })}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-background text-foreground"
                  >
                    <option value="all">{isAr ? 'الكل (نشط وغير نشط)' : 'All Records'}</option>
                    <option value="active">{isAr ? 'النشط فقط' : 'Active Only'}</option>
                    <option value="inactive">{isAr ? 'غير النشط فقط' : 'Inactive Only'}</option>
                  </select>
                </div>

                {/* Date range filters */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">{isAr ? 'من تاريخ:' : 'From:'}</label>
                    <input
                      type="date"
                      value={exportFilters.startDate || ''}
                      onChange={(e) => setExportFilters({ ...exportFilters, startDate: e.target.value || undefined })}
                      className="w-full text-xs p-1.5 rounded-lg border border-border bg-background text-foreground"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">{isAr ? 'إلى تاريخ:' : 'To:'}</label>
                    <input
                      type="date"
                      value={exportFilters.endDate || ''}
                      onChange={(e) => setExportFilters({ ...exportFilters, endDate: e.target.value || undefined })}
                      className="w-full text-xs p-1.5 rounded-lg border border-border bg-background text-foreground"
                    />
                  </div>
                </div>

                <Button
                  size="lg"
                  onClick={handleExportExecution}
                  disabled={isExporting}
                  className="w-full justify-center gap-2 mt-4"
                >
                  <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
                  <span>{isExporting ? (isAr ? 'جاري التصدير...' : 'Exporting...') : isAr ? 'بدء التصدير وتحميل الملف' : 'Export & Download'}</span>
                </Button>
              </DesignPanel>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: TEMPLATES HUB */}
        {/* ========================================================================= */}
        {activeTab === 'templates' && (
          <div className="space-y-6">
            <div className="text-center sm:text-right space-y-1">
              <h3 className="text-lg font-semibold text-foreground">
                {isAr ? 'مكتبة قوالب Excel المعتمدة' : 'Official Excel Templates Repository'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isAr
                  ? 'قم بتحميل القالب المناسب، واملأ البيانات ثم أعد رفعه من خلال معالج الاستيراد'
                  : 'Download official templates with validation headers and sample rows.'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.values(ENTITY_CONFIGS).map((cfg) => (
                <DesignPanel
                  key={cfg.id}
                  className="p-5 border border-border/80 rounded-xl flex flex-col justify-between space-y-4 hover:shadow-sm transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                        {getEntityIcon(cfg.icon)}
                      </div>
                      <Badge variant="default" className="text-[11px]">
                        {cfg.columns.length} {isAr ? 'أعمدة' : 'columns'}
                      </Badge>
                    </div>

                    <h4 className="font-semibold text-base text-foreground">{isAr ? cfg.titleAr : cfg.titleEn}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {isAr ? cfg.descriptionAr : cfg.descriptionEn}
                    </p>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-border/40">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs gap-1.5 justify-center"
                        onClick={() => ExcelService.downloadTemplate(cfg.id, 'ar')}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{isAr ? 'قالب عربي (.xlsx)' : 'Arabic Template'}</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs gap-1.5 text-muted-foreground"
                        onClick={() => ExcelService.downloadTemplate(cfg.id, 'en')}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>EN</span>
                      </Button>
                    </div>
                  </div>
                </DesignPanel>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: OPERATION AUDIT LOGS */}
        {/* ========================================================================= */}
        {activeTab === 'logs' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {isAr ? 'سجل عمليات الاستيراد والتصدير' : 'Import & Export Operations Log'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isAr ? 'أرشيف موثق لجميع عمليات Excel السابقة مع تقارير الأخطاء' : 'Comprehensive historical audit trail of all spreadsheet operations'}
                </p>
              </div>

              {operationLogs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    localStorage.removeItem('premier_import_export_logs');
                    setOperationLogs([]);
                  }}
                  className="text-xs text-destructive"
                >
                  {isAr ? 'مسح السجل' : 'Clear History'}
                </Button>
              )}
            </div>

            {operationLogs.length === 0 ? (
              <DesignPanel className="p-12 text-center text-muted-foreground space-y-2">
                <Clock className="w-10 h-10 mx-auto text-muted-foreground/50" />
                <p className="text-sm">{isAr ? 'لا توجد عمليات استيراد أو تصدير مسجلة بعد' : 'No recorded operations yet.'}</p>
              </DesignPanel>
            ) : (
              <div className="overflow-x-auto border rounded-xl bg-card">
                <table className="w-full text-xs text-right divide-y divide-border">
                  <thead className="bg-muted/30 text-muted-foreground font-semibold">
                    <tr>
                      <th className="p-3">{isAr ? 'التاريخ والوقت' : 'Timestamp'}</th>
                      <th className="p-3">{isAr ? 'العملية' : 'Operation'}</th>
                      <th className="p-3">{isAr ? 'نوع البيانات' : 'Entity'}</th>
                      <th className="p-3">{isAr ? 'اسم الملف' : 'File Name'}</th>
                      <th className="p-3">{isAr ? 'المستخدم والفرع' : 'User & Branch'}</th>
                      <th className="p-3">{isAr ? 'السجلات' : 'Records'}</th>
                      <th className="p-3">{isAr ? 'الحالة' : 'Status'}</th>
                      <th className="p-3">{isAr ? 'تقرير الأخطاء' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {operationLogs.map((log) => {
                      const isImport = log.operation === 'import';
                      return (
                        <tr key={log.id} className="hover:bg-muted/20">
                          <td className="p-3 font-mono text-muted-foreground">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="p-3">
                            <Badge variant={isImport ? 'primary' : 'default'} className="text-[10px]">
                              {isImport ? (isAr ? 'استيراد' : 'Import') : isAr ? 'تصدير' : 'Export'}
                            </Badge>
                          </td>
                          <td className="p-3 font-semibold text-foreground">
                            {ENTITY_CONFIGS[log.entity]?.titleAr || log.entity}
                          </td>
                          <td className="p-3 font-mono text-muted-foreground truncate max-w-xs">{log.fileName}</td>
                          <td className="p-3 text-muted-foreground">
                            {log.performedByName || log.performedBy} ({log.branchName || 'العام'})
                          </td>
                          <td className="p-3">
                            <span className="font-semibold text-foreground">{log.totalRecords}</span>
                            {isImport && (
                              <span className="text-muted-foreground text-[10px] ml-1">
                                ({log.successCount} {isAr ? 'نجاح' : 'ok'} / {log.errorCount} {isAr ? 'خطأ' : 'err'})
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={
                                log.status === 'completed'
                                  ? 'success'
                                  : log.status === 'partial'
                                  ? 'warning'
                                  : 'danger'
                              }
                              className="text-[10px]"
                            >
                              {log.status === 'completed'
                                ? isAr
                                  ? 'ناجح بالكامل'
                                  : 'Completed'
                                : log.status === 'partial'
                                ? isAr
                                  ? 'ناجح جزئياً'
                                  : 'Partial'
                                : isAr
                                ? 'فشل'
                                : 'Failed'}
                            </Badge>
                          </td>
                          <td className="p-3">
                            {log.errors && log.errors.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-[11px] text-rose-600 gap-1 h-7 p-1"
                                onClick={() =>
                                  ExcelService.downloadErrorReport(log.errors!, log.entity, isAr ? 'ar' : 'en')
                                }
                              >
                                <Download className="w-3 h-3" />
                                <span>{isAr ? 'تقرير الأخطاء' : 'Error Log'}</span>
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </DesignSurface>
  );
}

export default ImportExportCenterPage;
