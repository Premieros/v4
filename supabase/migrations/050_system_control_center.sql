-- 050. Centralized System Control Center
-- Stores configurable business/UI behavior without changing application code.
CREATE TABLE IF NOT EXISTS public.system_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_select_admin" ON public.system_settings;
CREATE POLICY "system_settings_select_admin" ON public.system_settings
  FOR SELECT TO authenticated
  USING (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_insert_admin" ON public.system_settings;
CREATE POLICY "system_settings_insert_admin" ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_pos_admin());

DROP POLICY IF EXISTS "system_settings_update_admin" ON public.system_settings;
CREATE POLICY "system_settings_update_admin" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (is_pos_admin())
  WITH CHECK (is_pos_admin());

INSERT INTO public.system_settings (id, config)
VALUES (1, '{
  "general": {"default_language":"ar","default_currency":"EGP","date_format":"DD/MM/YYYY","time_format":"24h","week_starts":"saturday"},
  "pos": {"default_order_type":"quick","ask_table_people":true,"allow_hold":true,"allow_split":true,"allow_discount":true,"allow_price_override":false,"require_customer":false,"auto_print":false,"auto_close_order":false,"show_product_images":true},
  "order_types": {"dine_in":true,"delivery":true,"takeaway":true,"quick":true,"car":true},
  "payments": {"cash":true,"card":true,"wallet":true,"credit":false,"other":false,"default_method":"cash"},
  "sales": {"tax_enabled":false,"tax_rate":0,"discount_max_percent":100,"allow_returns":true,"return_requires_approval":false,"negative_stock":false,"invoice_prefix":"INV-"},
  "inventory": {"low_stock_threshold":5,"allow_negative":false,"auto_deduct_on_sale":true,"auto_deduct_components":true,"allow_zero_cost":false,"enable_expiry":false},
  "purchases": {"auto_post_inventory":true,"require_receiving":false,"allow_edit_posted":false,"default_payment_status":"unpaid"},
  "manufacturing": {"auto_consume_components":true,"allow_overproduction":false,"require_approval":false,"rounding_decimals":3},
  "accounting": {"auto_journal":true,"fiscal_year_start":"01-01","decimal_places":2,"cost_method":"weighted_average"},
  "customers_suppliers": {"allow_customer_credit":false,"allow_supplier_credit":true,"credit_limit_default":0,"require_phone":false},
  "printing": {"paper":"80mm","copies":1,"show_logo":true,"show_tax":true,"show_cashier":true,"show_customer":true,"show_barcode":true,"footer":"شكراً لزيارتكم"},
  "dashboard": {"default_range":"today","show_sales":true,"show_expenses":true,"show_profit":true,"show_inventory":true,"show_top_products":true,"show_recent_sales":true,"show_payment_chart":true,"show_employee_chart":true},
  "reports": {"default_range":"today","default_rows":25,"show_zero_rows":false,"allow_export_excel":true,"allow_export_pdf":true,"allow_print":true},
  "notifications": {"low_stock":true,"shift_open":true,"shift_close":true,"purchase_due":true,"customer_due":false},
  "security": {"session_timeout_minutes":480,"max_login_attempts":5,"lockout_minutes":15,"require_password_change":false,"audit_all_changes":true},
  "ui": {"compact_tables":false,"animations":true,"confirm_delete":true,"confirm_post":true,"rtl":true,"show_help":true}
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_system_settings()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_system_settings ON public.system_settings;
CREATE TRIGGER trg_touch_system_settings
BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_system_settings();
