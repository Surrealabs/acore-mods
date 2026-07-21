-- Bind spell_mage_hot_streak_proc_duration to 48108 ("Hot Streak!" proc
-- buff) itself. Forces a generous fixed duration on the buff every time
-- it's applied/refreshed — its DBC duration was too short for multiple
-- charges to survive until the player could use them, so it was expiring
-- (AURA_REMOVE_BY_EXPIRE) and dropping everything at once.
--
-- NOTE: the buff's per-cast consumption is now handled entirely by
-- AzerothCore's native ProcCharges system (set ProcCharges=3, StackAmount=1
-- on spell 48108 in the spell editor) — no SpellScript needed on
-- Pyroblast/Flamestrike anymore.
DELETE FROM `spell_script_names` WHERE `spell_id` IN (-11366, -2120) AND `ScriptName` = 'spell_mage_hot_streak_consume';
DELETE FROM `spell_script_names` WHERE `spell_id` = 48108 AND `ScriptName` = 'spell_mage_hot_streak_proc_duration';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(48108, 'spell_mage_hot_streak_proc_duration');


