-- Normalize new healer role variants
-- 1) Convert legacy healer rows to ranged_healer
UPDATE `rpgbots`.`bot_rotations`
SET `role` = 'ranged_healer'
WHERE `role` = 'healer';

-- 2) Holy Paladin currently acts as melee_healer
UPDATE `rpgbots`.`bot_rotations`
SET `role` = 'melee_healer'
WHERE `class_id` = 2
  AND (`spec_name` LIKE '%Holy%' OR `spec_name` LIKE '%holy%');
