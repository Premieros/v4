-- Security hardening: REVOKE EXECUTE FROM PUBLIC for kitchen/order-status RPCs.
-- The REVOKE FROM anon in 080 was ineffective because PostgreSQL grants EXECUTE
-- to PUBLIC by default, and anon inherits from PUBLIC.
-- Fix: REVOKE from PUBLIC, then RE-GRANT to authenticated + service_role only.
REVOKE EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_to_kitchen(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_status(uuid, text, text) TO service_role;
