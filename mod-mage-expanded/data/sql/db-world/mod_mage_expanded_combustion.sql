-- Bind spell_mage_hot_streak_combustion (mod-mage-expanded) to all three
-- Hot Streak ranks so it fires regardless of which rank the player has
-- learned. This script piggybacks on the core's existing Hot Streak proc
-- (Unit::HandleDummyAuraProc's SpellIconID==2999 branch) without preventing
-- it -- it just adds Combustion stacking/duration/cooldown side effects.
DELETE FROM `spell_script_names` WHERE `spell_id` IN (44445, 44446, 44448) AND `ScriptName` = 'spell_mage_hot_streak_combustion';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(44445, 'spell_mage_hot_streak_combustion'),
(44446, 'spell_mage_hot_streak_combustion'),
(44448, 'spell_mage_hot_streak_combustion');

-- Clean up the stale binding left over from the old (now-deleted)
-- spell_mage_combustion_proc class in core's spell_mage.cpp.
DELETE FROM `spell_script_names` WHERE `spell_id` = 28682 AND `ScriptName` = 'spell_mage_combustion_proc';
