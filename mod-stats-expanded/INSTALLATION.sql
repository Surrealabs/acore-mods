-- STATS EXPANDED MODULE - INSTALLATION GUIDE
-- 
-- Follow these steps to set up the Stats Expanded module:
--
-- 1. SQL Setup (Run this FIRST on acore_characters database)
-- 2. Module Already Compiled (it's part of the build)
-- 3. Server Restart/Reload

-- ============================================================
-- STEP 1: Run this SQL on acore_characters database
-- ============================================================

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

-- ============================================================
-- STEP 2: Module Compilation
-- ============================================================
-- The module is automatically compiled as part of AzerothCore
-- Location: /modules/mod-stats-expanded/
-- No additional compilation needed

-- ============================================================
-- STEP 3: Runtime Configuration
-- ============================================================
-- After server start, you can adjust stats on the fly:

-- View current configuration
SELECT * FROM custom_character_stats;

-- Example: Make multistrike more accessible (lower requirement)
UPDATE custom_character_stats SET base_requirement = 100 WHERE stat_name = 'MULTISTRIKE_RATING';

-- Example: Disable versatility temporarily
UPDATE custom_character_stats SET enabled = 0 WHERE stat_name = 'VERSATILITY_RATING';

-- Example: Make haste more powerful (higher requirement = less rating needed for same effect)
UPDATE custom_character_stats SET base_requirement = 150 WHERE stat_name = 'HASTE_RATING';

-- ============================================================
-- CUSTOM STAT EFFECTS
-- ============================================================
--
-- CRIT_DAMAGE_RATING (Source: Crit Rating)
--   - Increases crit multiplier bonus beyond base 200%
--   - Formula: 100 crit rating = 50% bonus crit multiplier
--   - Example: 200 crit rating = 1x crit multiplier bonus → 3x total damage on crit
--
-- MULTISTRIKE_RATING (Source: Resilience Rating)
--   - Chance to cast duplicate spell at 50% effectiveness
--   - Spell-only mechanic (no auto-attacks)
--   - Can crit normally
--   - Formula: 105 resilience rating = 1% chance at level 60
--
-- VERSATILITY_RATING (Source: Defense Rating)
--   - Increases outgoing damage AND reduces incoming damage
--   - Formula: 110 defense rating = 0.1 versatility at level 60
--   - 10% of defense rating becomes versatility percentage
--   - Scales with level linearly
--
-- POTENCY_RATING (Source: Armor Pen Rating)
--   - Direct damage percentage increase
--   - Formula: 1 armor pen rating = 0.01% damage increase
--   - 120 armor pen rating = 1.2% damage at level 60
--
-- HASTE_RATING (Source: Haste Rating)
--   - Reduces cast time and global cooldown
--   - GCD minimum: 750ms (down from 1500ms base)
--   - Formula: 130 haste rating = 1% haste at level 60
--
-- MASTERY_RATING (Source: Expertise Rating)
--   - Scales expertise rating to mastery effect
--   - Formula: 140 expertise rating = 1% mastery at level 60
--
-- ============================================================
-- LEVEL SCALING
-- ============================================================
-- All stats scale linearly by level:
--   percentage = (rawRating * 60) / (playerLevel * baseRequirement)
--
-- Examples with MULTISTRIKE_RATING = 105:
--   Level 60: 105 resilience → 1% multistrike chance
--   Level 30: 105 resilience → 0.5% multistrike chance  
--   Level 1:  105 resilience → 0.017% multistrike chance
--
-- ============================================================

-- For detailed module documentation, see:
-- /modules/mod-stats-expanded/README.md
