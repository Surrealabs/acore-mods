-- Adds the optional "rotation_sequence" override to an already-deployed
-- rpgbots.bot_rotations table. rotation_sequence is an explicit press
-- order for tank/dps roles, e.g. "1-4-5-f-2-4-5-f-3-4-5-f" (digits 1-5 =
-- that rotation_N slot, 'f' = filler). It overrides the default plain
-- top-to-bottom scan so abilities that share a category cooldown can be
-- deliberately interleaved with always-up secondary/filler presses instead
-- of the first-available slot always winning every tick. The sequence
-- resumes from wherever the last successful pick left off (persisted
-- per-bot), so it behaves like a repeating loop. Leave empty (default) to
-- keep the legacy top-to-bottom behavior for a spec. Healer/DoT roles
-- ignore this column entirely. See RotationEngine.h for full details.
ALTER TABLE `rpgbots`.`bot_rotations`
    ADD COLUMN `rotation_sequence` VARCHAR(64) NOT NULL DEFAULT '' AFTER `party_buff`;
