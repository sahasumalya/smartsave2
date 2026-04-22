-- Migration 013: Plaid accounts, transactions, cron infrastructure
-- Date: 2026-04-21

-- 1. Add is_bank_linked flag to user_profile
ALTER TABLE user_profile ADD COLUMN is_bank_linked TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash;

-- 2. Create user_bank_accounts (Plaid account details; account_id, name, mask are AES-256 encrypted)
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

-- 3. Create transaction_cursors (Plaid /transactions/sync cursor per user+item)
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

-- 4. Create monthly_account_summary (rolling-month credits/debits per account)
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

-- 5. Create cron_transaction_jobs (tracks user-level progress during monthly cron sync)
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
