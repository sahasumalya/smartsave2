-- Set is_default = 1 for any user who has exactly one card (so single card is always default)
UPDATE user_card_information c
SET c.is_default = 1
WHERE c.is_default = 0
  AND (SELECT COUNT(*) FROM user_card_information c2 WHERE c2.user_id = c.user_id) = 1;
