-- Sweeping Strikes (12328, 18765, 35429): bind all 3 ranks to the module's override so a
-- multi-target cast (Whirlwind, or any custom cleave) only consumes one charge instead of
-- one per target hit. See SweepingStrikes.cpp for details.
DELETE FROM `spell_script_names` WHERE `spell_id` IN (12328, 18765, 35429) AND `ScriptName` = 'spell_warr_sweeping_strikes';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(12328, 'spell_warrior_expanded_sweeping_strikes'),
(18765, 'spell_warrior_expanded_sweeping_strikes'),
(35429, 'spell_warrior_expanded_sweeping_strikes');
