DELETE FROM `spell_script_names`
WHERE `spell_id` = -49998
	AND `ScriptName` IN ('spell_dk_death_strike', 'spell_dkx_death_strike_retail');

INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-49998, 'spell_dkx_death_strike_retail');
