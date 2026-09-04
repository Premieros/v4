-- 061. Allow users to view only their own branch's InstaPay payment history.
DROP POLICY IF EXISTS subscription_payments_branch_read ON public.subscription_payments;
CREATE POLICY subscription_payments_branch_read
ON public.subscription_payments
FOR SELECT TO authenticated
USING (
  public.is_super_admin()
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.is_active
      AND u.branch_id = subscription_payments.branch_id
  )
);
