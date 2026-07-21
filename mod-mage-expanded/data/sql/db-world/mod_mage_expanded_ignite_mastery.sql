-- Bind spell_mage_ignite_full (mod-mage-expanded) to the Ignite talent
-- (-11119, all ranks). Core's own spell_mage_ignite is now a no-op
-- (PreventDefaultAction only) — this script fully replaces it, combining
-- the base 8%/rank roll-in with the Mastery-scaled bonus using a true
-- non-decaying rolling-DoT pool (see ignite_mastery.cpp header comment).
DELETE FROM `spell_script_names` WHERE `spell_id` = -11119 AND `ScriptName` IN ('spell_mage_ignite_mastery', 'spell_mage_ignite_full');
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-11119, 'spell_mage_ignite_full');

