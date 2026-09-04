-- PHASE 0.2: read-only integrity audit helpers
-- These functions NEVER modify business data. They return counts only.

create or replace function public.system_integrity_audit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  n bigint;
begin
  -- Orphan / consistency checks. Missing tables are reported as null rather than
  -- making the whole audit fail on installations with optional modules.
  if to_regclass('public.orders') is not null and to_regclass('public.order_items') is not null then
    select count(*) into n from public.orders o
    where not exists (select 1 from public.order_items i where i.order_id = o.id)
      and coalesce(o.status, '') not in ('cancelled','void','deleted');
    result := result || jsonb_build_object('orders_without_items', n);
  end if;

  if to_regclass('public.order_items') is not null and to_regclass('public.products') is not null then
    select count(*) into n from public.order_items i
    where i.product_id is not null
      and not exists (select 1 from public.products p where p.id = i.product_id);
    result := result || jsonb_build_object('order_items_missing_product', n);
  end if;

  if to_regclass('public.products') is not null and to_regclass('public.branches') is not null then
    select count(*) into n from public.products p
    where p.branch_id is not null
      and not exists (select 1 from public.branches b where b.id = p.branch_id);
    result := result || jsonb_build_object('products_missing_branch', n);
  end if;

  if to_regclass('public.inventory') is not null and to_regclass('public.products') is not null then
    select count(*) into n from public.inventory s
    where s.product_id is not null
      and not exists (select 1 from public.products p where p.id = s.product_id);
    result := result || jsonb_build_object('inventory_missing_product', n);
  elsif to_regclass('public.warehouse_stock') is not null and to_regclass('public.products') is not null then
    select count(*) into n from public.warehouse_stock s
    where s.product_id is not null
      and not exists (select 1 from public.products p where p.id = s.product_id);
    result := result || jsonb_build_object('warehouse_stock_missing_product', n);
  end if;

  if to_regclass('public.purchase_items') is not null and to_regclass('public.purchases') is not null then
    select count(*) into n from public.purchase_items pi
    where pi.purchase_id is not null
      and not exists (select 1 from public.purchases p where p.id = pi.purchase_id);
    result := result || jsonb_build_object('purchase_items_missing_purchase', n);
  end if;

  if to_regclass('public.users') is not null and to_regclass('public.branches') is not null then
    select count(*) into n from public.users u
    where u.branch_id is not null
      and not exists (select 1 from public.branches b where b.id = u.branch_id);
    result := result || jsonb_build_object('users_missing_branch', n);
  end if;

  return result;
end;
$$;

revoke all on function public.system_integrity_audit() from public;
grant execute on function public.system_integrity_audit() to authenticated;
