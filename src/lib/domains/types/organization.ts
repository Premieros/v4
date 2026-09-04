export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  name: string;
  name_en: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  organization_id: string | null;
  created_at: string;
}

export interface BranchSettings {
  branch_id: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  logo_url: string | null;
  tax_rate: number | null;
  tax_enabled: boolean | null;
  currency: string | null;
  low_stock_threshold: number | null;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  id: string;
  store_name: string;
  store_name_en: string | null;
  store_address: string | null;
  store_phone: string | null;
  currency: string;
  tax_rate: number;
  tax_enabled: boolean;
  receipt_footer: string | null;
  receipt_header: string | null;
  logo_url: string | null;
  language: string;
  theme: string;
  brand_color: string | null;
  pos_default_payment_method: string;
  pos_barcode_autofocus: boolean;
  pos_line_discount: boolean;
  invoice_prefix: string;
  invoice_next_number: number;
  invoice_decimal_places: number;
  receipt_width_mm: number;
  receipt_copies: number;
  receipt_auto_print: boolean;
  receipt_show_tax: boolean;
  receipt_show_qr: boolean;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
}
