-- ============================================================================
-- RPGBots: Flat Rotation Table — one row per spec, 30 spell columns
-- ============================================================================
-- Dead simple.  Each spec gets ONE row with six buckets of 5 spells each.
-- The C++ AI is role-aware: it knows who to target based on the role column.
--
--   ability_1..5   — Core rotation.  Healer: cast on lowest-HP ally (<90%).
--                    DPS/Tank: cast on master's target (priority order).
--                    melee_healer: reserved for melee DPS rotation (heals use hot_1..5).
--   buff_1..5      — Self-buffs.  Cast on self if the aura is missing.
--   defensive_1..5 — Emergency.  Cast on self when HP drops below 35%.
--   dot_1..5       — DoTs.  Cast on enemy if aura missing on target.
--   hot_1..5       — HoTs.  Cast on lowest-HP ally if aura missing.
--   mobility_1..5  — Positioning. Cast when out of preferred range.
--
-- To change a rotation: UPDATE one row, then `.rpg reload` in-game.
-- To add a new class: INSERT one row per spec.  No recompile.
-- ============================================================================

DROP TABLE IF EXISTS `rpgbots`.`bot_rotations`;
CREATE TABLE `rpgbots`.`bot_rotations` (
    `class_id`        TINYINT UNSIGNED NOT NULL  COMMENT '1=War 2=Pal 3=Hunt 4=Rog 5=Pri 6=DK 7=Sha 8=Mag 9=Lock 11=Dru',
    `spec_index`      TINYINT UNSIGNED NOT NULL  COMMENT 'Talent tree 0/1/2',
    `spec_name`       VARCHAR(32)  NOT NULL DEFAULT '',
    `role`            ENUM('tank','healer','melee_dps','ranged_dps','melee_healer','ranged_healer') NOT NULL DEFAULT 'melee_dps',
    `preferred_range` FLOAT        NOT NULL DEFAULT 0  COMMENT '0 = melee, 30 = caster',

    -- Bucket 1: Core abilities (priority 1 = highest)
    `ability_1`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `ability_2`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `ability_3`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `ability_4`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `ability_5`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    -- Bucket 2: Self-buffs (cast if aura missing)
    `buff_1`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `buff_2`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `buff_3`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `buff_4`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `buff_5`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    -- Bucket 3: Defensives (cast when HP < 35%)
    `defensive_1`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `defensive_2`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `defensive_3`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `defensive_4`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `defensive_5`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    -- Bucket 4: DoTs (cast on enemy if aura missing on target)
    `dot_1`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `dot_2`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `dot_3`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `dot_4`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `dot_5`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    -- Bucket 5: HoTs (cast on lowest-HP ally if aura missing)
    --            melee_healer uses this bucket as instant heal-priority row
    `hot_1`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `hot_2`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `hot_3`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `hot_4`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `hot_5`           MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    -- Bucket 6: Mobility (cast when out of range)
    `mobility_1`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `mobility_2`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `mobility_3`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `mobility_4`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `mobility_5`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (`class_id`, `spec_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='One row per spec — 30 spells, 6 buckets';

-- INSERT rows here per class/spec.  Example:
-- INSERT INTO `rpgbots`.`bot_rotations` VALUES
-- (class_id, spec_index, 'SpecName', 'role', preferred_range,
--     ability_1, ability_2, ability_3, ability_4, ability_5,
--     buff_1, buff_2, buff_3, buff_4, buff_5,
--     defensive_1, defensive_2, defensive_3, defensive_4, defensive_5,
--     mobility_1, mobility_2, mobility_3, mobility_4, mobility_5);
