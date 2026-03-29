-- Add designation column to user_profile
ALTER TABLE user_profile ADD COLUMN designation VARCHAR(150) NULL AFTER date_of_birth;
