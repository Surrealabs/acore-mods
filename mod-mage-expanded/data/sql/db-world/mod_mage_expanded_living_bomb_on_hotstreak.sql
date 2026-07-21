-- Bind spell_mage_living_bomb_on_hotstreak (mod-mage-expanded) to the Hot
-- Streak talent spells (44445/44446/44448 — all ranks), ALONGSIDE the
-- already-bound spell_mage_hot_streak_combustion. Multiple ScriptName rows
-- per spell_id are supported; both scripts run independently on the same
-- proc event, neither calls PreventDefaultAction().
--
-- Casts Living Bomb (whichever rank the player knows) on the target you
-- procced Hot Streak against, as a passive Fire-mage synergy.
DELETE FROM `spell_script_names` WHERE `spell_id` IN (44445, 44446, 44448) AND `ScriptName` = 'spell_mage_living_bomb_on_hotstreak';
INSERT INTO `spell_script_names` (`spell_id`, `ScriptName`) VALUES
(44445, 'spell_mage_living_bomb_on_hotstreak'),
(44446, 'spell_mage_living_bomb_on_hotstreak'),
(44448, 'spell_mage_living_bomb_on_hotstreak');
