-- Ejecutar una vez en SQL Editor del proyecto Supabase usado por loan-tracker.
-- Pagos anteriores: installment_number NULL; se distribuyen por antigüedad desde la primera cuota.
ALTER TABLE public.loan_tracker_payments
  ADD COLUMN IF NOT EXISTS installment_number integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_tracker_payments_installment_positive') THEN
    ALTER TABLE public.loan_tracker_payments
      ADD CONSTRAINT loan_tracker_payments_installment_positive
      CHECK (installment_number IS NULL OR installment_number > 0);
  END IF;
END $$;
