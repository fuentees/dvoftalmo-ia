-- Fix FK on correction_audit_log.applied_by to point to public.profiles instead
-- of auth.users. The API join "applier:applied_by(full_name)" requires the FK
-- to target the table that actually has the full_name column (public.profiles).
ALTER TABLE correction_audit_log
  DROP CONSTRAINT IF EXISTS correction_audit_log_applied_by_fkey,
  ADD CONSTRAINT correction_audit_log_applied_by_fkey
    FOREIGN KEY (applied_by) REFERENCES public.profiles(id);
