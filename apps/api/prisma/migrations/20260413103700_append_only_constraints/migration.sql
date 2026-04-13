-- Append-only constraints for audit_logs and asset_movements tables
-- These tables should NEVER have UPDATE or DELETE operations performed on them

-- Revoke UPDATE and DELETE on audit_logs
REVOKE UPDATE, DELETE ON "audit_logs" FROM PUBLIC;

-- Revoke UPDATE and DELETE on asset_movements
REVOKE UPDATE, DELETE ON "asset_movements" FROM PUBLIC;
