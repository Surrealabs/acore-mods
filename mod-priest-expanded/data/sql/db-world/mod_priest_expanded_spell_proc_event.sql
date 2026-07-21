-- Divine Aegis no longer requires a critical heal to proc; remove the vanilla procEx=2
-- (crit-only) gate so it triggers off any heal that leaves overheal to pool into a shield.
DELETE FROM `spell_proc_event` WHERE `entry` = -47509;
INSERT INTO `spell_proc_event` (`entry`, `SchoolMask`, `SpellFamilyName`, `SpellFamilyMask0`, `SpellFamilyMask1`, `SpellFamilyMask2`, `procFlags`, `procEx`, `procPhase`, `ppmRate`, `CustomChance`, `Cooldown`) VALUES
(-47509, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
