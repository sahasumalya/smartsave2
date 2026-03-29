-- Add profile_image_url column to user_profile (stores S3 object key, not a full URL)
ALTER TABLE user_profile ADD COLUMN profile_image_url TEXT NULL AFTER date_of_birth;
