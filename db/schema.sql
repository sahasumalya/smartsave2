-- SmartSave DB Schema (MySQL)

-- 1. user_profile
CREATE TABLE IF NOT EXISTS user_profile (
  user_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. user_card_information
CREATE TABLE IF NOT EXISTS user_card_information (
  card_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  last_four CHAR(4) NOT NULL,
  card_type VARCHAR(20),
  cardholder_name VARCHAR(100),
  expiry_date VARCHAR(7),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE
);

-- 3. email_validation
CREATE TABLE IF NOT EXISTS email_validation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
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

-- 5. assets (reference for investment proportion)
CREATE TABLE IF NOT EXISTS assets (
  asset_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. user_investments_proportion
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

-- Seed example assets
INSERT IGNORE INTO assets (asset_id, name) VALUES
  ('EQUITY_FUND_01', 'Global Equity Fund'),
  ('GOVT_BOND_02', 'Treasury Bonds'),
  ('CRYPTO_INDEX', 'Crypto Index');
