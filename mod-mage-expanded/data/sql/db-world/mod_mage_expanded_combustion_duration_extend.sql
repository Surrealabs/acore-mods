-- Bind the new hardcoded Combustion-duration-extension SpellScripts
-- (mod-mage-expanded, combustion_mechanics.cpp) directly to Pyroblast,
-- Flamestrike and Fireball. Negative spell_id binds the whole rank chain
-- rooted at that base spell (AC convention). These replace the old
-- behavior of extending Combustion's duration from the Hot Streak proc
-- (which also fired on DoT ticks from Ignite/Living Bomb and let
-- Combustion's duration extend indefinitely).
DELETE FROM `spell_script_names` WHERE `spell_id` IN (-11366, -2120, -133)
    AND `ScriptName` IN ('spell_mage_pyroblast_combustion_extend', 'spell_mage_flamestrike_combustion_extend', 'spell_mage_fireball_combustion_extend');
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(-11366, 'spell_mage_pyroblast_combustion_extend'),
(-2120, 'spell_mage_flamestrike_combustion_extend'),
(-133, 'spell_mage_fireball_combustion_extend');
