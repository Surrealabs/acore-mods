-- Stats Expanded Configuration Table
-- Stores the scaling requirements for custom stats
-- Each stat defines how much of that rating is needed for 1% at level 60

DROP TABLE IF EXISTS `custom_character_stats`;
CREATE TABLE `custom_character_stats` (
  `stat_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `rating_per_percent` FLOAT NOT NULL DEFAULT 100,
  `description` VARCHAR(256) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `last_updated` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Custom stat scaling configuration for Stats Expanded module';

-- Insert default stat scaling values
-- These represent how much of each rating type is needed for 1% benefit
-- Formula: percentage = rawRating / rating_per_percent
-- Example: 10 resilience rating = 1% multistrike chance
INSERT INTO `custom_character_stats` (`stat_name`, `rating_per_percent`, `description`, `enabled`) VALUES
('CRIT_DAMAGE_RATING', 10, 'Crit Rating -> Crit Damage Bonus (1% bonus multiplier per 10 crit rating)', 1),
('MULTISTRIKE_RATING', 10, 'Resilience Rating -> Multistrike Chance (1% spell duplication per 10 resilience rating)', 1),
('VERSATILITY_RATING', 10, 'Defense Rating -> Versatility (1% damage dealt/taken per 10 defense rating)', 1),
('POTENCY_RATING', 10, 'Armor Pen Rating -> Damage Increase (1% damage per 10 armor pen rating)', 1),
('HASTE_RATING', 10, 'Haste Rating -> Haste (1% haste per 10 haste rating, GCD reduced 2% per % haste, min 750ms)', 1),
('MASTERY_RATING', 10, 'Expertise Rating -> Mastery (1% mastery per 10 expertise rating)', 1);
