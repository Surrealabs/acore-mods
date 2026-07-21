-- NOTE on spell_script_names: its unique key covers BOTH (spell_id, ScriptName) together, not
-- spell_id alone. That means "ON DUPLICATE KEY UPDATE" only fires when the exact same pair is
-- re-inserted - it does NOT remove/replace a different pre-existing ScriptName bound to the
-- same spell_id (that would just add a second row, leaving both the old orphaned core script
-- and the new module script attached to the same spell). Every rebind below must explicitly
-- DELETE the specific old (spell_id, ScriptName) pair first (safe/idempotent even if it was
-- already removed by a previous run of this file), then INSERT the new pair with an
-- ON DUPLICATE KEY UPDATE safety net in case this exact file is re-run unchanged.

-- Divine Aegis: replace vanilla crit-heal-conversion proc with the overheal-pooling absorb.
DELETE FROM `spell_script_names` WHERE `spell_id` = -47509 AND `ScriptName` = 'spell_pri_divine_aegis';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-47509, 'spell_priest_expanded_divine_aegis')
ON DUPLICATE KEY UPDATE `ScriptName` = VALUES(`ScriptName`);

-- Lightwell Renew: re-bound to the module's copy (Glyph of Lightwell scaling only).
DELETE FROM `spell_script_names` WHERE `spell_id` = -7001 AND `ScriptName` = 'spell_pri_lightwell_renew';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-7001, 'spell_priest_expanded_lightwell_renew')
ON DUPLICATE KEY UPDATE `ScriptName` = VALUES(`ScriptName`);

-- Lightwell (60123): the vanilla spellclick script effect is no longer used, Lightwell now
-- casts automatically via npc_pet_pri_lightwell_expanded. Unbind it (no replacement needed).
DELETE FROM `spell_script_names` WHERE `spell_id` = 60123 AND `ScriptName` = 'spell_pri_lightwell';

-- Vampiric Embrace: was previously hardcoded as case 15286 inside core
-- Unit::HandleDummyAuraProc (never had a spell_script_names entry at all) - now a portable
-- AuraScript instead. No DELETE needed since nothing was ever bound to this spell before.
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(15286, 'spell_priest_expanded_vampiric_embrace')
ON DUPLICATE KEY UPDATE `ScriptName` = VALUES(`ScriptName`);

-- Psychic Link custom mechanic (Shadow Word: Death, Mind Flay Damage/Psychic Link trigger,
-- Devouring Plague, Shadow Word: Pain, Vampiric Touch) - moved out of core spell_priest.cpp
-- into PsychicLink.cpp since it's entirely custom (Psychic Link itself, spell 900041, isn't
-- a real Blizzard spell). Shadow Word: Death also now spreads dots on survive instead of
-- backfiring self-damage.
DELETE FROM `spell_script_names` WHERE `spell_id` = -32379 AND `ScriptName` = 'spell_pri_shadow_word_death';
DELETE FROM `spell_script_names` WHERE `spell_id` = 58381 AND `ScriptName` = 'spell_pri_psychic_link';
DELETE FROM `spell_script_names` WHERE `spell_id` = -2944 AND `ScriptName` = 'spell_pri_devouring_plague';
DELETE FROM `spell_script_names` WHERE `spell_id` = -589 AND `ScriptName` = 'spell_pri_shadow_word_pain';
DELETE FROM `spell_script_names` WHERE `spell_id` = -34914 AND `ScriptName` = 'spell_pri_vampiric_touch';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-32379, 'spell_priest_expanded_shadow_word_death'),
(58381, 'spell_priest_expanded_psychic_link'),
(-2944, 'spell_priest_expanded_devouring_plague'),
(-589, 'spell_priest_expanded_shadow_word_pain'),
(-34914, 'spell_priest_expanded_vampiric_touch')
ON DUPLICATE KEY UPDATE `ScriptName` = VALUES(`ScriptName`);
