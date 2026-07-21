-- Lightwell is no longer interacted with via spellclick; it casts automatically instead
-- (see npc_pet_pri_lightwell_expanded). Remove the vanilla spellclick bindings.
DELETE FROM `npc_spellclick_spells` WHERE `npc_entry` IN (31883, 31893, 31894, 31895, 31896, 31897) AND `spell_id` = 60123;

-- Point the Lightwell creatures at the module's autonomous AI instead of the vanilla
-- Interact/spellclick AI (npc_pet_pri_lightwell).
UPDATE `creature_template` SET `ScriptName` = 'npc_pet_pri_lightwell_expanded' WHERE `entry` IN (31883, 31893, 31894, 31895, 31896, 31897) AND `ScriptName` = 'npc_pet_pri_lightwell';
