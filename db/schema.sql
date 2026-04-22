-- SmartSave DB Schema (MySQL)

DROP TABLE IF EXISTS cron_transaction_jobs;
DROP TABLE IF EXISTS monthly_account_summary;
DROP TABLE IF EXISTS transaction_cursors;
DROP TABLE IF EXISTS user_bank_accounts;
DROP TABLE IF EXISTS bank_tokens;
DROP TABLE IF EXISTS user_investments_proportion;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS card_verification_initiated;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS email_validation_limit;
DROP TABLE IF EXISTS email_validation;
DROP TABLE IF EXISTS user_card_information;
DROP TABLE IF EXISTS user_profile;

-- 1. user_profile (phone_number, date_of_birth stored AES-256 encrypted)
CREATE TABLE IF NOT EXISTS user_profile (
  user_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone_number TEXT,
  date_of_birth TEXT NULL,
  designation VARCHAR(150) NULL,
  profile_image_url TEXT NULL,
  password_hash TEXT NOT NULL,
  is_bank_linked TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. user_card_information (full card number, CVV, cardholder name, expiry stored AES-256 encrypted)
-- last_four, cardholder_name, expiry_date are legacy nullable columns for backward compat with pre-encryption rows
CREATE TABLE IF NOT EXISTS user_card_information (
  card_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  card_number_encrypted TEXT,
  cvv_encrypted TEXT,
  card_type VARCHAR(20),
  cardholder_name_encrypted TEXT,
  expiry_date_encrypted TEXT,
  last_four CHAR(4) NULL,
  cardholder_name VARCHAR(100) NULL,
  expiry_date VARCHAR(7) NULL,
  is_default TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 3. email_validation
CREATE TABLE IF NOT EXISTS email_validation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(4) NOT NULL,
  is_used TINYINT(1) DEFAULT 0,
  reason VARCHAR(255),
  verification_token VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4. email_validation_limit
CREATE TABLE IF NOT EXISTS email_validation_limit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  request_count INT DEFAULT 1,
  last_request_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reset_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 5. password_reset_tokens (for forgot-password link)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  is_used TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_email_created (email, created_at)
);

-- 6. card_verification_initiated (tracks user initiated card 2FA; used for rate limit and pending check; is_used prevents replay)
CREATE TABLE IF NOT EXISTS card_verification_initiated (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  is_used TINYINT(1) DEFAULT 0,
  INDEX idx_user_expires (user_id, expires_at),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 7. assets (reference for investment proportion)
CREATE TABLE IF NOT EXISTS assets (
  asset_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. user_investments_proportion
CREATE TABLE IF NOT EXISTS user_investments_proportion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  asset_id VARCHAR(50) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_asset (user_id, asset_id),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(asset_id)
);

-- 9. bank_tokens (Plaid link tokens and access tokens, stored AES-256 encrypted)
CREATE TABLE IF NOT EXISTS bank_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  item_id TEXT DEFAULT NULL,
  link_token TEXT DEFAULT NULL,
  link_token_expiry DATETIME DEFAULT NULL,
  link_request_id VARCHAR(255) DEFAULT NULL,
  access_token TEXT DEFAULT NULL,
  exchange_request_id VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_token_id (token_id),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 10. user_bank_accounts (Plaid account details; account_id, name, mask are AES-256 encrypted)
CREATE TABLE IF NOT EXISTS user_bank_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type VARCHAR(50) NOT NULL,
  account_subtype VARCHAR(50) DEFAULT NULL,
  mask TEXT DEFAULT NULL,
  is_investment_account TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 11. transaction_cursors (stores Plaid /transactions/sync cursor per user+item)
CREATE TABLE IF NOT EXISTS transaction_cursors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  item_id VARCHAR(255) NOT NULL,
  cursor_value TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_user_item (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 12. monthly_account_summary (rolling-month credits/debits per account for analytics)
CREATE TABLE IF NOT EXISTS monthly_account_summary (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  month_start DATE NOT NULL,
  total_credits DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_debits DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_user_account_month (user_id, account_id, month_start),
  INDEX idx_user_month (user_id, month_start),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 13. cron_transaction_jobs (tracks user-level progress during monthly cron sync)
CREATE TABLE IF NOT EXISTS cron_transaction_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  status ENUM('pending', 'in_progress', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  error_message TEXT DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_run_id (run_id),
  INDEX idx_run_status (run_id, status),
  INDEX idx_user_run (user_id, run_id),
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- Seed example assets
INSERT IGNORE INTO assets (asset_id, name) VALUES
  ('EQUITY_FUND_01', 'Global Equity Fund'),
  ('GOVT_BOND_02', 'Treasury Bonds'),
  ('CRYPTO_INDEX', 'Crypto Index');
