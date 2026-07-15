DELETE FROM `spell_script_names` WHERE `spell_id` IN (53563, -53563) AND `ScriptName` = 'spell_paladin_expanded_beacon_passive';
DELETE FROM `spell_script_names` WHERE `spell_id` = 53385 AND `ScriptName` IN ('spell_pal_divine_storm', 'spell_paladin_expanded_divine_storm');
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(53385, 'spell_paladin_expanded_divine_storm');
