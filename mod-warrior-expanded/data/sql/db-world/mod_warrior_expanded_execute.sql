-- Execute (-5308): bind to the module's override so it scales off 100% Attack Power instead
-- of core's hardcoded 20%. Rage consumption/Sudden Death/Glyph of Execution logic is
-- otherwise byte-for-byte identical to core's spell_warr_execute.
DELETE FROM `spell_script_names` WHERE `spell_id` = -5308 AND `ScriptName` = 'spell_warr_execute';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-5308, 'spell_warrior_expanded_execute');
