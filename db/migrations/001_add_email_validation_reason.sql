-- Add reason and verification_token columns for existing MySQL DBs (idempotent where possible)
ALTER TABLE email_validation ADD COLUMN reason VARCHAR(255) NULL;
ALTER TABLE email_validation MODIFY COLUMN verification_token VARCHAR(255) NULL;
