
INSERT INTO `creature_template` (
entry, difficulty_entry_1, difficulty_entry_2, difficulty_entry_3, KillCredit1, KillCredit2, name, subname, IconName, gossip_menu_id, minlevel, maxlevel, exp, faction, npcflag, speed_walk, speed_run, speed_swim, speed_flight, detection_range, scale, `rank`, dmgschool, DamageModifier, BaseAttackTime, RangeAttackTime, BaseVariance, RangeVariance, unit_class, unit_flags, unit_flags2, dynamicflags, family, type, type_flags, lootid, pickpocketloot, skinloot, PetSpellDataId, VehicleId, mingold, maxgold, AIName, MovementType, HoverHeight, HealthModifier, ManaModifier, ArmorModifier, ExperienceModifier, RacialLeader, movementId, RegenHealth, mechanic_immune_mask, spell_school_immune_mask, flags_extra, ScriptName, VerifiedBuild
) VALUES
(150000,0,0,0,0,0,'SPELLS\\ENCHANTMENTS\\BattleMasterGlow_High.m2','','',0,1,1,0,35,0,1,1.14286,1,1,20,1,0,0,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,'',0,1,1,1,1,1,0,0,0,0,0,0,'',NULL),
(150001,0,0,0,0,0,'SPELLS\\ENCHANTMENTS\\BlackFlame_Low.m2','','',0,1,1,0,35,0,1,1.14286,1,1,20,1,0,0,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,'',0,1,1,1,1,1,0,0,0,0,0,0,'',NULL),
(150002,0,0,0,0,0,'SPELLS\\ENCHANTMENTS\\BlackGlow_High.m2','','',0,1,1,0,35,0,1,1.14286,1,1,20,1,0,0,1,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,'',0,1,1,1,1,1,0,0,0,0,0,0,'',NULL);

INSERT INTO `creature_model_info` (
DisplayID, BoundingRadius, CombatReach, Gender, DisplayID_Other_Gender, VerifiedBuild
) VALUES
(150000,0,0,2,0,NULL),
(150001,0,0,2,0,NULL),
(150002,0,0,2,0,NULL);
