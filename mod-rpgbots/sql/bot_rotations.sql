-- ============================================================================
-- RPGBots: Flat Rotation Table — one row per spec, 12 spell columns
-- ============================================================================
-- Dead simple. Each spec gets ONE row with 12 spell-ID slots. The C++ AI is
-- role-aware: it knows who to target/how to gate each slot based on the
-- role column - see RotationEngine.h/BotAI.cpp for the exact logic.
--
--   filler            — instant "weave" spell, castable WITHOUT interrupting
--                        the bot's current cast (e.g. Fire Blast while
--                        casting Fireball). Checked every tick regardless of
--                        casting state, and again as the final fallback if
--                        nothing else in the waterfall fired.
--   rotation_1..5     — the 5 real rotational abilities. Role decides usage:
--                          healer roles → heals, target lowest-HP ally,
--                            skip a slot if that aura's already up (HoTs)
--                          dot roles (ranged_dot/melee_dot) → DoTs, target
--                            enemy, skip a slot if already ticking
--                          tank/dps roles → plain priority cast on enemy;
--                            any slot that's a self-buff (positive spell)
--                            auto-targets self and skips once already up
--   interrupt         — cast on enemy ONLY while it's actively casting a
--                        generic/channeled spell; idle otherwise.
--   mobility          — gap closer, self-cast when out of preferred range.
--   defensive_1..2    — emergency, self-cast when HP < 35%.
--   damage_cooldown   — offensive CD (Recklessness/Combustion-style),
--                        self-cast as soon as off cooldown while fighting.
--   party_buff        — timed buff-on-cast (Heroism/Power Infusion-style,
--                        NOT a passive stat aura), self-cast as soon as off
--                        cooldown while fighting.
--   rotation_sequence - OPTIONAL explicit press order for tank/dps roles,
--                        e.g. "1-4-5-f-2-4-5-f-3-4-5-f" (digits 1-5 = that
--                        rotation_N slot, 'f' = filler). Overrides the
--                        default top-to-bottom scan so same-category
--                        abilities (1/2/3) can be deliberately interleaved
--                        with always-up secondary/filler presses (4/5)
--                        instead of the first-available slot always
--                        winning. Leave empty for legacy behavior.
--
-- To change a rotation: UPDATE one row, then `.army reload` in-game.
-- To add a new class: INSERT one row per spec.  No recompile.
-- ============================================================================

DROP TABLE IF EXISTS `rpgbots`.`bot_rotations`;
CREATE TABLE `rpgbots`.`bot_rotations` (
    `class_id`        TINYINT UNSIGNED NOT NULL  COMMENT '1=War 2=Pal 3=Hunt 4=Rog 5=Pri 6=DK 7=Sha 8=Mag 9=Lock 11=Dru',
    `spec_index`      TINYINT UNSIGNED NOT NULL  COMMENT 'Talent tree 0/1/2',
    `spec_name`       VARCHAR(32)  NOT NULL DEFAULT '',
    `role`            ENUM('tank','healer','melee_dps','ranged_dps','melee_healer','ranged_healer','ranged_dot','melee_dot') NOT NULL DEFAULT 'melee_dps',
    `preferred_range` FLOAT        NOT NULL DEFAULT 0  COMMENT '0 = melee, 30 = caster',

    `filler`          MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    `rotation_1`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `rotation_2`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `rotation_3`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `rotation_4`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `rotation_5`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    `interrupt`       MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `mobility`        MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    `defensive_1`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `defensive_2`     MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    `damage_cooldown` MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,
    `party_buff`      MEDIUMINT UNSIGNED NOT NULL DEFAULT 0,

    `rotation_sequence` VARCHAR(64) NOT NULL DEFAULT ''  COMMENT 'Optional explicit press order, e.g. 1-4-5-f-2-4-5-f-3-4-5-f',

    PRIMARY KEY (`class_id`, `spec_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='One row per spec — 12 spell slots';

-- INSERT rows here per class/spec.  Example:
-- INSERT INTO `rpgbots`.`bot_rotations` VALUES
-- (class_id, spec_index, 'SpecName', 'role', preferred_range,
--     filler,
--     rotation_1, rotation_2, rotation_3, rotation_4, rotation_5,
--     interrupt, mobility,
--     defensive_1, defensive_2,
--     damage_cooldown, party_buff);
