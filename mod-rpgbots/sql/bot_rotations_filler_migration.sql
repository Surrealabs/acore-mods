-- Adds the "filler" bucket (5 columns) to an already-deployed
-- rpgbots.bot_rotations table. Filler spells are instant "weave" abilities
-- that can be cast WITHOUT interrupting the bot's current cast (e.g. Fire
-- Blast while casting Fireball) — checked every tick regardless of casting
-- state, before the normal waterfall. See RotationEngine.h for details.
ALTER TABLE `rpgbots`.`bot_rotations`
    ADD COLUMN `filler_1` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `mobility_5`,
    ADD COLUMN `filler_2` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `filler_1`,
    ADD COLUMN `filler_3` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `filler_2`,
    ADD COLUMN `filler_4` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `filler_3`,
    ADD COLUMN `filler_5` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `filler_4`;
