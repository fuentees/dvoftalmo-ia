-- Add soft-delete column to documents table.
-- Documents with a non-null deleted_at are hidden from queries but recoverable by admins.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
