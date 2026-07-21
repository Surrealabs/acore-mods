-- 12-column rotation schema migration.
-- Widens the `role` enum to include the 2 new DoT roles, and adds the new
-- flat 12-column layout (filler, rotation_1..5, interrupt, mobility,
-- defensive_1..2, damage_cooldown, party_buff) alongside the old columns.
-- Run this FIRST, then run `node migrate_to_12column.js` to populate the
-- new columns from the old data (best-effort), THEN run
-- bot_rotations_12column_drop_old.sql to remove the old columns.

ALTER TABLE `bot_rotations`
    MODIFY COLUMN `role` enum('tank','healer','melee_dps','ranged_dps','melee_healer','ranged_healer','ranged_dot','melee_dot') NOT NULL DEFAULT 'melee_dps';

ALTER TABLE `bot_rotations`
    ADD COLUMN `filler`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `preferred_range`,
    ADD COLUMN `rotation_1`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `filler`,
    ADD COLUMN `rotation_2`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `rotation_1`,
    ADD COLUMN `rotation_3`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `rotation_2`,
    ADD COLUMN `rotation_4`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `rotation_3`,
    ADD COLUMN `rotation_5`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `rotation_4`,
    ADD COLUMN `interrupt`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `rotation_5`,
    ADD COLUMN `mobility`        MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `interrupt`,
    ADD COLUMN `damage_cooldown` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `defensive_2`,
    ADD COLUMN `party_buff`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0 AFTER `damage_cooldown`;

-- Note: `defensive_1`/`defensive_2` are reused as-is from the old schema
-- (already the first 2 of the old 5 defensive slots) - no new columns
-- needed for those, they just keep their old data.
