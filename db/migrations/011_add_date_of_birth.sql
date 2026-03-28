-- Add date_of_birth column to user_profile (stored AES-256 encrypted like phone_number)
ALTER TABLE user_profile ADD COLUMN date_of_birth TEXT NULL AFTER phone_number;
