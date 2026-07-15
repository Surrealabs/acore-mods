import React, { useEffect, useMemo, useState } from 'react';

type Props = {
  textColor: string;
  contentBoxColor: string;
};

type SpellSearchResult = {
  id: number;
  name: string;
  icon?: string | null;
};

type SpellLookup = {
  spellId: number;
  spellIconId: number;
  icon?: string | null;
  name?: string;
  rank?: string;
  description?: string;
  toolTip?: string;
  editable?: {
    selectSpell?: Record<string, string | number | null>;
    base?: Record<string, string | number | null>;
    targetsProcs?: Record<string, string | number | null>;
    effects?: Record<string, string | number | null>;
    items?: Record<string, string | number | null>;
    flags?: Record<string, string | number | null>;
    icon?: Record<string, string | number | null>;
    visual?: Record<string, string | number | null>;
  };
  customSpell?: {
    available?: boolean;
    hasRecord?: boolean;
    source?: string;
  };
  referenceTables?: Record<string, {
    value?: number;
    exists?: boolean;
    label?: string | null;
    table?: string;
  }>;
};

type RefOption = { value: number; label: string };

type TabId = 'selectSpell' | 'base' | 'targetsProcs' | 'effects' | 'items' | 'flags' | 'icon' | 'visual' | 'batch';
type SelectOption = { value: number; label: string };
type SpellEnumPayload = {
  spellFamilyName?: SelectOption[];
  effectTargets?: SelectOption[];
  effectTypes?: SelectOption[];
  auraTypes?: SelectOption[];
  mechanics?: SelectOption[];
  dispelTypes?: SelectOption[];
  powerTypes?: SelectOption[];
  preventionTypes?: SelectOption[];
  damageClasses?: SelectOption[];
  auraStates?: SelectOption[];
  creatureTypes?: SelectOption[];
  targetFlags?: SelectOption[];
  procFlags?: SelectOption[];
  interruptFlags?: SelectOption[];
  auraInterruptFlags?: SelectOption[];
  channelInterruptFlags?: SelectOption[];
  stancesMask?: SelectOption[];
  spellAttr0?: SelectOption[];
  spellAttr1?: SelectOption[];
  spellAttr2?: SelectOption[];
  spellAttr3?: SelectOption[];
  spellAttr4?: SelectOption[];
  spellAttr5?: SelectOption[];
  spellAttr6?: SelectOption[];
  spellAttr7?: SelectOption[];
  schoolMaskBits?: SelectOption[];
};

const TAB_FIELDS: Record<Exclude<TabId, 'batch'>, string[]> = {
  selectSpell: ['SpellName', 'SpellRank', 'SpellToolTip', 'SpellDescription'],
  base: ['Category', 'Dispel', 'Mechanic', 'CastingTimeIndex', 'DurationIndex', 'RangeIndex', 'MaximumLevel', 'BaseLevel', 'SpellLevel', 'RecoveryTime', 'CategoryRecoveryTime', 'StartRecoveryCategory', 'StartRecoveryTime', 'PowerType', 'ManaCost', 'ManaCostPerLevel', 'ManaPerSecond', 'ManaPerSecondPerLevel', 'ManaCostPercentage', 'Speed', 'StackAmount', 'ModalNextSpell', 'MaximumTargetLevel', 'MaximumAffectedTargets', 'RequiresSpellFocus', 'PreventionType', 'DamageClass', 'SpellFamilyName', 'SchoolMask', 'SpellMissileID', 'SpellVisual1', 'SpellVisual2', 'SpellPriority', 'RuneCostID', 'SpellDescriptionVariableID', 'SpellDifficultyID'],
  targetsProcs: ['Targets', 'TargetCreatureType', 'FacingCasterFlags', 'ProcFlags', 'ProcChance', 'ProcCharges', 'CasterAuraState', 'TargetAuraState', 'CasterAuraStateNot', 'TargetAuraStateNot', 'CasterAuraSpell', 'TargetAuraSpell', 'ExcludeCasterAuraSpell', 'ExcludeTargetAuraSpell'],
  effects: ['Effect1', 'Effect2', 'Effect3', 'EffectDieSides1', 'EffectDieSides2', 'EffectDieSides3', 'EffectRealPointsPerLevel1', 'EffectRealPointsPerLevel2', 'EffectRealPointsPerLevel3', 'EffectBasePoints1', 'EffectBasePoints2', 'EffectBasePoints3', 'EffectMechanic1', 'EffectMechanic2', 'EffectMechanic3', 'EffectImplicitTargetA1', 'EffectImplicitTargetA2', 'EffectImplicitTargetA3', 'EffectImplicitTargetB1', 'EffectImplicitTargetB2', 'EffectImplicitTargetB3', 'EffectRadiusIndex1', 'EffectRadiusIndex2', 'EffectRadiusIndex3', 'EffectApplyAuraName1', 'EffectApplyAuraName2', 'EffectApplyAuraName3', 'EffectAmplitude1', 'EffectAmplitude2', 'EffectAmplitude3', 'EffectMultipleValue1', 'EffectMultipleValue2', 'EffectMultipleValue3', 'EffectChainTarget1', 'EffectChainTarget2', 'EffectChainTarget3', 'EffectItemType1', 'EffectItemType2', 'EffectItemType3', 'EffectMiscValue1', 'EffectMiscValue2', 'EffectMiscValue3', 'EffectMiscValueB1', 'EffectMiscValueB2', 'EffectMiscValueB3', 'EffectTriggerSpell1', 'EffectTriggerSpell2', 'EffectTriggerSpell3'],
  items: ['Totem1', 'Totem2', 'Reagent1', 'Reagent2', 'Reagent3', 'Reagent4', 'Reagent5', 'Reagent6', 'Reagent7', 'Reagent8', 'ReagentCount1', 'ReagentCount2', 'ReagentCount3', 'ReagentCount4', 'ReagentCount5', 'ReagentCount6', 'ReagentCount7', 'ReagentCount8', 'EquippedItemClass', 'EquippedItemSubClassMask', 'EquippedItemInventoryTypeMask', 'TotemCategory1', 'TotemCategory2'],
  flags: ['Attributes', 'AttributesEx', 'AttributesEx2', 'AttributesEx3', 'AttributesEx4', 'AttributesEx5', 'AttributesEx6', 'AttributesEx7', 'InterruptFlags', 'AuraInterruptFlags', 'ChannelInterruptFlags', 'Stances', 'StancesNot'],
  icon: ['SpellIconID', 'ActiveIconID'],
  visual: ['SpellVisual1', 'SpellVisual2', 'SpellMissileID', 'PowerDisplayId', 'AreaGroupID', 'RequiredAuraVision'],
};

const TEXT_FIELDS = new Set(['SpellName', 'SpellRank', 'SpellToolTip', 'SpellDescription']);
const REFERENCE_FIELDS = new Set(['SpellIconID', 'ActiveIconID', 'SpellVisual1', 'SpellVisual2', 'SpellMissileID']);
const BITMASK_FIELDS = new Set([
  'Targets',
  'ProcFlags',
  'Attributes',
  'AttributesEx',
  'AttributesEx2',
  'AttributesEx3',
  'AttributesEx4',
  'AttributesEx5',
  'AttributesEx6',
  'AttributesEx7',
  'SchoolMask',
  'InterruptFlags',
  'AuraInterruptFlags',
  'ChannelInterruptFlags',
  'Stances',
  'StancesNot',
]);

const DISPEL_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Magic' },
  { value: 2, label: 'Curse' },
  { value: 3, label: 'Disease' },
  { value: 4, label: 'Poison' },
  { value: 5, label: 'Stealth' },
  { value: 6, label: 'Invisibility' },
  { value: 7, label: 'All' },
  { value: 8, label: 'Enrage' },
];

const MECHANIC_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Charm' },
  { value: 2, label: 'Disoriented' },
  { value: 3, label: 'Disarm' },
  { value: 4, label: 'Distract' },
  { value: 5, label: 'Fear' },
  { value: 6, label: 'Grip' },
  { value: 7, label: 'Root' },
  { value: 8, label: 'Slow Attack' },
  { value: 9, label: 'Silence' },
  { value: 10, label: 'Sleep' },
  { value: 11, label: 'Snare' },
  { value: 12, label: 'Stun' },
  { value: 13, label: 'Freeze' },
  { value: 14, label: 'Knockout' },
  { value: 15, label: 'Bleed' },
  { value: 16, label: 'Bandage' },
  { value: 17, label: 'Polymorph' },
  { value: 18, label: 'Banish' },
  { value: 19, label: 'Shield' },
  { value: 20, label: 'Shackle' },
  { value: 21, label: 'Mount' },
  { value: 22, label: 'Infected' },
  { value: 23, label: 'Turn' },
  { value: 24, label: 'Horror' },
  { value: 25, label: 'Invulnerability' },
  { value: 26, label: 'Interrupt' },
  { value: 27, label: 'Daze' },
  { value: 28, label: 'Discovery' },
  { value: 29, label: 'Immune Shield' },
  { value: 30, label: 'Sapped' },
  { value: 31, label: 'Enrage' },
];

const POWER_TYPE_OPTIONS: SelectOption[] = [
  { value: -2, label: 'Health' },
  { value: -1, label: 'None' },
  { value: 0, label: 'Mana' },
  { value: 1, label: 'Rage' },
  { value: 2, label: 'Focus' },
  { value: 3, label: 'Energy' },
  { value: 4, label: 'Happiness' },
  { value: 5, label: 'Runes' },
  { value: 6, label: 'Runic Power' },
];

const PREVENTION_TYPE_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Silence' },
  { value: 2, label: 'Pacify' },
  { value: 4, label: 'No Actions' },
];

const DAMAGE_CLASS_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Magic' },
  { value: 2, label: 'Melee' },
  { value: 3, label: 'Ranged' },
];

const SCHOOL_MASK_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Physical' },
  { value: 2, label: 'Holy' },
  { value: 4, label: 'Fire' },
  { value: 8, label: 'Nature' },
  { value: 16, label: 'Frost' },
  { value: 32, label: 'Shadow' },
  { value: 64, label: 'Arcane' },
  { value: 126, label: 'All Magic' },
  { value: 127, label: 'All Schools' },
];

const SPELL_FAMILY_OPTIONS: SelectOption[] = [
  { value: 0, label: 'Generic' },
  { value: 3, label: 'Mage' },
  { value: 4, label: 'Warrior' },
  { value: 5, label: 'Warlock' },
  { value: 6, label: 'Priest' },
  { value: 7, label: 'Druid' },
  { value: 8, label: 'Rogue' },
  { value: 9, label: 'Hunter' },
  { value: 10, label: 'Paladin' },
  { value: 11, label: 'Shaman' },
  { value: 15, label: 'Death Knight' },
  { value: 17, label: 'Pet' },
];

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Category 1' },
  { value: 2, label: 'Category 2' },
  { value: 3, label: 'Category 3' },
  { value: 4, label: 'Category 4' },
  { value: 5, label: 'Category 5' },
  { value: 6, label: 'Category 6' },
  { value: 7, label: 'Category 7' },
  { value: 8, label: 'Category 8' },
  { value: 9, label: 'Category 9' },
  { value: 10, label: 'Category 10' },
];

const EFFECT_TYPE_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Instakill' },
  { value: 2, label: 'School Damage' },
  { value: 3, label: 'Dummy' },
  { value: 6, label: 'Apply Aura' },
  { value: 10, label: 'Heal' },
  { value: 24, label: 'Create Item' },
  { value: 27, label: 'Persistent Area Aura' },
  { value: 28, label: 'Summon' },
  { value: 30, label: 'Energize' },
  { value: 35, label: 'Apply Area Aura Party' },
  { value: 36, label: 'Learn Spell' },
  { value: 39, label: 'Apply Area Aura Raid' },
  { value: 64, label: 'Trigger Spell' },
  { value: 74, label: 'Apply Area Aura Pet' },
  { value: 77, label: 'Script Effect' },
  { value: 87, label: 'Knock Back' },
  { value: 97, label: 'Charge' },
  { value: 113, label: 'Apply Area Aura Friend' },
  { value: 119, label: 'Apply Area Aura Enemy' },
];

const AURA_TYPE_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 3, label: 'Periodic Damage' },
  { value: 8, label: 'Periodic Heal' },
  { value: 13, label: 'Mod Damage Done' },
  { value: 15, label: 'Mod Speed' },
  { value: 20, label: 'Mod Resistance' },
  { value: 22, label: 'Periodic Trigger Spell' },
  { value: 29, label: 'Mod Stat' },
  { value: 34, label: 'Mod Attack Power' },
  { value: 42, label: 'Proc Trigger Spell' },
  { value: 69, label: 'School Absorb' },
  { value: 79, label: 'Mod Damage Percent Taken' },
  { value: 85, label: 'Mod Spell Crit Chance' },
  { value: 99, label: 'Mod Health Regen %' },
  { value: 107, label: 'Periodic Health Funnel' },
  { value: 117, label: 'Periodic Energize' },
  { value: 135, label: 'Mod Healing Done %' },
  { value: 189, label: 'Mod Attack Speed' },
];

const EFFECT_TARGET_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Unit Caster' },
  { value: 2, label: 'Unit Nearby Enemy' },
  { value: 5, label: 'Unit Pet' },
  { value: 6, label: 'Unit Target Enemy' },
  { value: 7, label: 'Unit Scripted' },
  { value: 8, label: 'Unit Target Ally' },
  { value: 15, label: 'Dest Caster Front' },
  { value: 17, label: 'Dest Caster Back' },
  { value: 18, label: 'Dest Caster Right' },
  { value: 19, label: 'Dest Caster Left' },
  { value: 21, label: 'Dest Target Enemy' },
  { value: 22, label: 'Dest Target Ally' },
  { value: 30, label: 'Unit Cone Enemy 24' },
  { value: 31, label: 'Unit Target Any' },
  { value: 33, label: 'Unit Caster Area Party' },
  { value: 35, label: 'Unit Caster Area Raid' },
  { value: 37, label: 'Unit Caster Area Enemy' },
  { value: 42, label: 'Unit Target Area Enemy' },
  { value: 45, label: 'Dest DynObj Enemy' },
  { value: 46, label: 'Unit Channel Target' },
  { value: 53, label: 'Dest Caster Random' },
  { value: 56, label: 'Dest Area Entry' },
  { value: 57, label: 'Dest Caster Fishing' },
  { value: 71, label: 'Unit Caster Area Summon' },
  { value: 77, label: 'Unit Dest Area Enemy' },
];

const TARGET_FLAG_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 2, label: 'Unit' },
  { value: 4, label: 'Unit Raid' },
  { value: 8, label: 'Unit Party' },
  { value: 16, label: 'Item' },
  { value: 32, label: 'Source Location' },
  { value: 64, label: 'Dest Location' },
  { value: 128, label: 'Unit Enemy' },
  { value: 256, label: 'Unit Ally' },
  { value: 512, label: 'Corpse Enemy' },
  { value: 1024, label: 'Unit Dead' },
  { value: 2048, label: 'GameObject' },
  { value: 16384, label: 'Corpse Ally' },
  { value: 65536, label: 'Minipet' },
  { value: 131072, label: 'Glyph' },
  { value: 262144, label: 'Dest Target' },
  { value: 524288, label: 'Extra Targets' },
];

const CREATURE_TYPE_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Beast' },
  { value: 2, label: 'Dragonkin' },
  { value: 3, label: 'Demon' },
  { value: 4, label: 'Elemental' },
  { value: 5, label: 'Giant' },
  { value: 6, label: 'Undead' },
  { value: 7, label: 'Humanoid' },
  { value: 8, label: 'Critter' },
  { value: 9, label: 'Mechanical' },
  { value: 10, label: 'Not Specified' },
  { value: 11, label: 'Totem' },
  { value: 12, label: 'Non-Combat Pet' },
  { value: 13, label: 'Gas Cloud' },
];

const AURA_STATE_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Defensive' },
  { value: 2, label: 'Healthless 20 Percent' },
  { value: 3, label: 'Berserking' },
  { value: 4, label: 'Frozen' },
  { value: 5, label: 'Judgement' },
  { value: 6, label: 'Hunters Parry' },
  { value: 7, label: 'Rogue Attack From Stealth' },
  { value: 8, label: 'Warrior Victory Rush' },
  { value: 10, label: 'Faerie Fire' },
  { value: 11, label: 'Healthless 35 Percent' },
  { value: 12, label: 'Conflagrate' },
  { value: 13, label: 'Swiftmend' },
  { value: 14, label: 'Deadly Poison' },
  { value: 15, label: 'Enrage' },
];

const PROC_FLAG_OPTIONS: SelectOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Done Melee Auto Attack' },
  { value: 2, label: 'Taken Melee Auto Attack' },
  { value: 4, label: 'Done Spell Melee Dmg Class' },
  { value: 8, label: 'Taken Spell Melee Dmg Class' },
  { value: 16, label: 'Done Ranged Auto Attack' },
  { value: 32, label: 'Taken Ranged Auto Attack' },
  { value: 64, label: 'Done Spell Ranged Dmg Class' },
  { value: 128, label: 'Taken Spell Ranged Dmg Class' },
  { value: 256, label: 'Done Spell None Dmg Class Positive' },
  { value: 512, label: 'Taken Spell None Dmg Class Positive' },
  { value: 1024, label: 'Done Spell None Dmg Class Negative' },
  { value: 2048, label: 'Taken Spell None Dmg Class Negative' },
  { value: 4096, label: 'Done Spell Magic Dmg Class Positive' },
  { value: 8192, label: 'Taken Spell Magic Dmg Class Positive' },
  { value: 16384, label: 'Done Spell Magic Dmg Class Negative' },
  { value: 32768, label: 'Taken Spell Magic Dmg Class Negative' },
  { value: 65536, label: 'Done Periodic' },
  { value: 131072, label: 'Taken Periodic' },
  { value: 262144, label: 'Taken Damage' },
  { value: 524288, label: 'Done Trap Activation' },
  { value: 1048576, label: 'Done Mainhand Attack' },
  { value: 2097152, label: 'Done Offhand Attack' },
  { value: 4194304, label: 'Death' },
];

const FIELD_SELECT_OPTIONS: Record<string, SelectOption[]> = {
  Category: CATEGORY_OPTIONS,
  Dispel: DISPEL_OPTIONS,
  Mechanic: MECHANIC_OPTIONS,
  PowerType: POWER_TYPE_OPTIONS,
  PreventionType: PREVENTION_TYPE_OPTIONS,
  DamageClass: DAMAGE_CLASS_OPTIONS,
  SpellFamilyName: SPELL_FAMILY_OPTIONS,
  SchoolMask: SCHOOL_MASK_OPTIONS,
  Targets: TARGET_FLAG_OPTIONS,
  TargetCreatureType: CREATURE_TYPE_OPTIONS,
  ProcFlags: PROC_FLAG_OPTIONS,
  CasterAuraState: AURA_STATE_OPTIONS,
  TargetAuraState: AURA_STATE_OPTIONS,
  CasterAuraStateNot: AURA_STATE_OPTIONS,
  TargetAuraStateNot: AURA_STATE_OPTIONS,
};

function getSelectOptionsForField(field: string, spellEnums?: SpellEnumPayload | null): SelectOption[] | null {
  if (field === 'Attributes' && spellEnums?.spellAttr0?.length) return spellEnums.spellAttr0;
  if (field === 'AttributesEx' && spellEnums?.spellAttr1?.length) return spellEnums.spellAttr1;
  if (field === 'AttributesEx2' && spellEnums?.spellAttr2?.length) return spellEnums.spellAttr2;
  if (field === 'AttributesEx3' && spellEnums?.spellAttr3?.length) return spellEnums.spellAttr3;
  if (field === 'AttributesEx4' && spellEnums?.spellAttr4?.length) return spellEnums.spellAttr4;
  if (field === 'AttributesEx5' && spellEnums?.spellAttr5?.length) return spellEnums.spellAttr5;
  if (field === 'AttributesEx6' && spellEnums?.spellAttr6?.length) return spellEnums.spellAttr6;
  if (field === 'AttributesEx7' && spellEnums?.spellAttr7?.length) return spellEnums.spellAttr7;
  if (field === 'SchoolMask' && spellEnums?.schoolMaskBits?.length) return spellEnums.schoolMaskBits;
  if (field === 'SpellFamilyName' && spellEnums?.spellFamilyName?.length) return spellEnums.spellFamilyName;
  if (field === 'Dispel' && spellEnums?.dispelTypes?.length) return spellEnums.dispelTypes;
  if (field === 'Mechanic' && spellEnums?.mechanics?.length) return spellEnums.mechanics;
  if (field === 'PowerType' && spellEnums?.powerTypes?.length) return spellEnums.powerTypes;
  if (field === 'PreventionType' && spellEnums?.preventionTypes?.length) return spellEnums.preventionTypes;
  if (field === 'DamageClass' && spellEnums?.damageClasses?.length) return spellEnums.damageClasses;
  if (field === 'Targets' && spellEnums?.targetFlags?.length) return spellEnums.targetFlags;
  if (field === 'InterruptFlags' && spellEnums?.interruptFlags?.length) return spellEnums.interruptFlags;
  if (field === 'AuraInterruptFlags' && spellEnums?.auraInterruptFlags?.length) return spellEnums.auraInterruptFlags;
  if (field === 'ChannelInterruptFlags' && spellEnums?.channelInterruptFlags?.length) return spellEnums.channelInterruptFlags;
  if ((field === 'Stances' || field === 'StancesNot') && spellEnums?.stancesMask?.length) return spellEnums.stancesMask;
  if (field === 'TargetCreatureType' && spellEnums?.creatureTypes?.length) return spellEnums.creatureTypes;
  if (field === 'ProcFlags' && spellEnums?.procFlags?.length) return spellEnums.procFlags;
  if (/^(CasterAuraState|TargetAuraState|CasterAuraStateNot|TargetAuraStateNot)$/.test(field) && spellEnums?.auraStates?.length) {
    return spellEnums.auraStates;
  }
  if (/^Effect[123]$/.test(field) && spellEnums?.effectTypes?.length) return spellEnums.effectTypes;
  if (/^EffectApplyAuraName[123]$/.test(field) && spellEnums?.auraTypes?.length) return spellEnums.auraTypes;
  if (/^EffectImplicitTarget[AB][123]$/.test(field) && spellEnums?.effectTargets?.length) return spellEnums.effectTargets;
  if (/^EffectMechanic[123]$/.test(field) && spellEnums?.mechanics?.length) return spellEnums.mechanics;

  if (FIELD_SELECT_OPTIONS[field]) return FIELD_SELECT_OPTIONS[field];
  if (/^Effect[123]$/.test(field)) return EFFECT_TYPE_OPTIONS;
  if (/^EffectApplyAuraName[123]$/.test(field)) return AURA_TYPE_OPTIONS;
  if (/^EffectImplicitTarget[AB][123]$/.test(field)) return EFFECT_TARGET_OPTIONS;
  if (/^EffectMechanic[123]$/.test(field)) return MECHANIC_OPTIONS;
  return null;
}

function withCurrentValueOption(options: SelectOption[], currentRaw: string): SelectOption[] {
  const current = Number(currentRaw);
  if (!Number.isFinite(current)) return options;
  if (options.some((o) => o.value === current)) return options;
  return [{ value: current, label: `${current} (Current)` }, ...options];
}

function parseMaskValue(raw: string | number | null | undefined): bigint {
  if (raw === null || raw === undefined || raw === '') return 0n;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0n;
  return BigInt(Math.trunc(parsed));
}

function isPowerOfTwoValue(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const big = BigInt(Math.trunc(value));
  return (big & (big - 1n)) === 0n;
}

function getBitmaskOptions(field: string, spellEnums?: SpellEnumPayload | null): SelectOption[] {
  const options = getSelectOptionsForField(field, spellEnums) || [];
  const seen = new Set<number>();
  return options.filter((opt) => {
    if (!Number.isFinite(opt.value) || opt.value < 0) return false;
    if (seen.has(opt.value)) return false;
    seen.add(opt.value);
    return opt.value === 0 || isPowerOfTwoValue(opt.value);
  });
}

function updateBitmaskValue(raw: string | number | null | undefined, bitValue: number, enabled: boolean): string {
  const bit = BigInt(Math.max(0, Math.trunc(bitValue)));
  let mask = parseMaskValue(raw);
  if (enabled) {
    mask |= bit;
  } else {
    mask &= ~bit;
  }
  if (mask < 0n) return '0';
  return mask.toString();
}

function toThumbnailUrl(iconName?: string | null): string | null {
  if (!iconName) return null;
  const normalized = iconName.replace(/\\/g, '/').split('/').pop() || iconName;
  const base = normalized.replace(/\.blp$/i, '');
  return `/thumbnails/${base}.png`;
}

export default function SpellEditor({ textColor, contentBoxColor }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('selectSpell');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SpellSearchResult[]>([]);

  const [selected, setSelected] = useState<SpellSearchResult | null>(null);
  const [lookup, setLookup] = useState<SpellLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, RefOption[]>>({});
  const [editFields, setEditFields] = useState<Record<string, string | number | null>>({});
  const [spellEnums, setSpellEnums] = useState<SpellEnumPayload | null>(null);
  const [newSpellId, setNewSpellId] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [manualSpellId, setManualSpellId] = useState('');
  const [batchIds, setBatchIds] = useState('');
  const [batchFields, setBatchFields] = useState<Record<string, string>>({
    SpellIconID: '',
    ActiveIconID: '',
    SpellVisual1: '',
    SpellVisual2: '',
    SpellMissileID: '',
  });
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/spell-enums');
        const data = await res.json();
        if (!res.ok) return;
        if (mounted) {
          setSpellEnums(data || null);
        }
      } catch {
        // Keep static fallback options
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);
        const res = await fetch(`/api/spell-search?q=${encodeURIComponent(term)}&limit=80`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSearchError(err.message || String(err));
        }
      } finally {
        setSearchLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [searchTerm]);

  const selectedThumb = useMemo(
    () => toThumbnailUrl(lookup?.icon || selected?.icon),
    [lookup?.icon, selected]
  );
  const expandDetailsView = !!selected && activeTab !== 'selectSpell';

  const loadSpellDetails = async (spellId: number) => {
    if (!spellId || Number.isNaN(spellId)) return;
    try {
      setLookupLoading(true);
      const res = await fetch(`/api/spells/${spellId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`);
      setLookup(data);
      setEditFields({
        ...(data?.editable?.selectSpell || {}),
        ...(data?.editable?.base || {}),
        ...(data?.editable?.targetsProcs || {}),
        ...(data?.editable?.effects || {}),
        ...(data?.editable?.items || {}),
        ...(data?.editable?.flags || {}),
        ...(data?.editable?.icon || {}),
        ...(data?.editable?.visual || {}),
      });
      setSaveStatus(null);
    } catch (err: any) {
      setLookup(null);
      setSearchError(err.message || String(err));
    } finally {
      setLookupLoading(false);
    }
  };

  const onPickResult = async (spell: SpellSearchResult) => {
    setSelected(spell);
    await loadSpellDetails(spell.id);
  };

  const onManualLookup = async () => {
    const id = Number(manualSpellId);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelected({ id, name: `Spell ${id}`, icon: null });
    await loadSpellDetails(id);
  };

  const setField = (field: string, value: string) => {
    setEditFields((prev) => ({ ...prev, [field]: value }));
  };

  const fetchReferenceOptions = async (field: string, q: string) => {
    if (!REFERENCE_FIELDS.has(field)) return;
    try {
      const res = await fetch(`/api/spell-ref-options?field=${encodeURIComponent(field)}&q=${encodeURIComponent(String(q || ''))}&limit=30`);
      const data = await res.json();
      if (!res.ok) return;
      setReferenceOptions((prev) => ({
        ...prev,
        [field]: Array.isArray(data?.options) ? data.options : [],
      }));
    } catch {
      // ignore transient lookup errors
    }
  };

  useEffect(() => {
    if (!lookup?.editable) return;
    const preloadFields = ['SpellIconID', 'ActiveIconID', 'SpellVisual1', 'SpellVisual2', 'SpellMissileID'];
    for (const field of preloadFields) {
      const value = String(editFields[field] ?? '').trim();
      if (value) fetchReferenceOptions(field, value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup?.spellId]);

  const copySpell = async () => {
    if (!selected) return;
    try {
      const payload = {
        spellId: selected.id,
        name: lookup?.name || selected.name,
        rank: lookup?.rank || '',
        description: lookup?.description || '',
        toolTip: lookup?.toolTip || '',
        fields: editFields,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setSaveStatus('Spell copied to clipboard.');
    } catch (err: any) {
      setSaveStatus(`Copy failed: ${err.message || String(err)}`);
    }
  };

  const buildFieldPayload = (): Record<string, string | number> => {
    const fields: Record<string, string | number> = {};
    for (const [key, raw] of Object.entries(editFields)) {
      if (raw === null || raw === undefined) continue;
      const value = String(raw).trim();
      if (value === '') continue;
      const asNum = Number(value);
      fields[key] = Number.isFinite(asNum) && !TEXT_FIELDS.has(key) ? asNum : value;
    }
    return fields;
  };

  const createSpellFromTemplate = async () => {
    if (!selected) return;
    const parsedNewId = Number(newSpellId);
    if (!Number.isFinite(parsedNewId) || parsedNewId <= 0) {
      setSaveStatus('Provide a valid new spell ID.');
      return;
    }

    try {
      setCreateLoading(true);
      setSaveStatus(null);

      const fields = buildFieldPayload();
      const res = await fetch('/api/spells/create-from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateSpellId: selected.id,
          newSpellId: parsedNewId,
          fields,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`);

      const newSelected = {
        id: parsedNewId,
        name: data?.details?.name || `Spell ${parsedNewId}`,
        icon: data?.details?.icon || null,
      };
      setSelected(newSelected);
      if (data?.details) {
        setLookup(data.details);
        setEditFields({
          ...(data?.details?.editable?.selectSpell || {}),
          ...(data?.details?.editable?.base || {}),
          ...(data?.details?.editable?.targetsProcs || {}),
          ...(data?.details?.editable?.effects || {}),
          ...(data?.details?.editable?.items || {}),
          ...(data?.details?.editable?.flags || {}),
          ...(data?.details?.editable?.icon || {}),
          ...(data?.details?.editable?.visual || {}),
        });
      } else {
        await loadSpellDetails(parsedNewId);
      }
      setSaveStatus(`Created spell ${parsedNewId} from template ${selected.id}.`);
    } catch (err: any) {
      setSaveStatus(`Create failed: ${err.message || String(err)}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const suggestSpellId = async () => {
    try {
      setSuggestLoading(true);
      const res = await fetch('/api/spell-suggest-id');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Suggest failed (${res.status})`);
      const suggested = String(data?.suggestion || '');
      if (suggested) {
        setNewSpellId(suggested);
        setSaveStatus(`Suggested free spell ID: ${suggested} (current max: ${data?.maxExistingId ?? 'n/a'}).`);
      }
    } catch (err: any) {
      setSaveStatus(`Suggest failed: ${err.message || String(err)}`);
    } finally {
      setSuggestLoading(false);
    }
  };

  const saveSpell = async () => {
    if (!selected) return;
    try {
      setSaveLoading(true);
      setSaveStatus(null);

      const fields = buildFieldPayload();

      const res = await fetch(`/api/spells/${selected.id}/edit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);

      setSaveStatus(`Saved ${data.updatedFields?.length || 0} fields.`);
      if (data.details) {
        setLookup(data.details);
      } else {
        await loadSpellDetails(selected.id);
      }
    } catch (err: any) {
      setSaveStatus(`Save failed: ${err.message || String(err)}`);
    } finally {
      setSaveLoading(false);
    }
  };

  const exportSpellDbc = async () => {
    try {
      setExportLoading(true);
      setSaveStatus(null);

      const res = await fetch('/api/spells/export');
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try {
          const data = await res.json();
          msg = data?.error || msg;
        } catch {
          // ignore parse errors
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'Spell.dbc';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);

      setSaveStatus('Export successful.');
    } catch {
      setSaveStatus('Export not successful.');
    } finally {
      setExportLoading(false);
    }
  };

  const runBatchEdit = async () => {
    try {
      setBatchLoading(true);
      setBatchStatus(null);

      const spellIds = batchIds
        .split(/[,\s]+/)
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0);

      const fields: Record<string, number> = {};
      for (const [key, val] of Object.entries(batchFields)) {
        const trimmed = val.trim();
        if (!trimmed) continue;
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) fields[key] = parsed;
      }

      if (!spellIds.length) throw new Error('Provide one or more spell IDs.');
      if (!Object.keys(fields).length) throw new Error('Provide at least one visual field value.');

      const res = await fetch('/api/spells/batch-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spellIds, fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Batch edit failed (${res.status})`);

      setBatchStatus(`Updated ${data.updatedSpells}/${data.requestedSpells} spells. Fields: ${(data.updatedFields || []).join(', ')}`);
    } catch (err: any) {
      setBatchStatus(`Batch edit failed: ${err.message || String(err)}`);
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, color: textColor }}>
      <h2 style={{ marginTop: 0 }}>Spell Editor</h2>
      <p style={{ color: '#999', marginTop: 0 }}>Stoneharry-style spell workflow with tabbed field groups and batch updates.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {([
          ['selectSpell', 'Select Spell'],
          ['base', 'Base'],
          ['targetsProcs', 'Targets/Procs'],
          ['effects', 'Effects'],
          ['items', 'Items'],
          ['flags', 'Flags'],
          ['icon', 'Icon'],
          ['visual', 'Visual'],
          ['batch', 'Batch Edit'],
        ] as Array<[TabId, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #374151',
              background: activeTab === id ? '#2563eb' : 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: expandDetailsView ? '1fr' : '1.4fr 1fr', gap: 16 }}>
        {!expandDetailsView && (
        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Find Spell</h3>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search spell name (min 2 chars)..."
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              border: '1px solid #444',
              background: '#111827',
              color: '#e5e7eb',
              marginBottom: 10,
            }}
          />

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="number"
              value={manualSpellId}
              onChange={(e) => setManualSpellId(e.target.value)}
              placeholder="Spell ID"
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 6,
                border: '1px solid #444',
                background: '#111827',
                color: '#e5e7eb',
              }}
            />
            <button
              onClick={onManualLookup}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Lookup
            </button>
          </div>

          {searchLoading && <div style={{ color: '#94a3b8', fontSize: 12 }}>Searching...</div>}
          {searchError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{searchError}</div>}

          <div style={{ border: '1px solid #30363d', borderRadius: 6, maxHeight: 420, overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>
                {searchTerm.trim().length < 2 ? 'Type at least 2 characters to search.' : 'No spells found.'}
              </div>
            ) : (
              results.map((spell) => {
                const thumb = toThumbnailUrl(spell.icon);
                const active = selected?.id === spell.id;
                return (
                  <button
                    key={spell.id}
                    onClick={() => onPickResult(spell)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      border: 'none',
                      borderBottom: '1px solid #1f2937',
                      background: active ? '#1d4ed8' : 'transparent',
                      color: active ? '#fff' : textColor,
                      textAlign: 'left',
                      padding: '8px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: 4, overflow: 'hidden', border: '1px solid #374151', flexShrink: 0 }}>
                      {thumb ? (
                        <img src={thumb} alt={spell.name} loading="lazy" style={{ width: '100%', height: '100%' }} />
                      ) : null}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spell.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>ID: {spell.id}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
        )}

        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Spell Details</h3>
          <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={exportSpellDbc}
              disabled={exportLoading}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: 'none',
                background: '#0ea5e9',
                color: '#fff',
                cursor: exportLoading ? 'not-allowed' : 'pointer',
                fontWeight: 700,
              }}
            >
              {exportLoading ? 'Exporting...' : 'Export Spell.dbc'}
            </button>
            {saveStatus ? <span style={{ fontSize: 12, color: '#cbd5e1' }}>{saveStatus}</span> : null}
          </div>
          {!selected ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Select a spell from search results or lookup by ID.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 6, border: '1px solid #374151', overflow: 'hidden' }}>
                  {selectedThumb ? (
                    <img src={selectedThumb} alt={selected.name} style={{ width: '100%', height: '100%' }} />
                  ) : null}
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>Spell ID: {selected.id}</div>
                </div>
              </div>

              <div style={{ border: '1px solid #30363d', borderRadius: 6, padding: 10, fontSize: 13 }}>
                {lookupLoading ? (
                  <div style={{ color: '#94a3b8' }}>Loading spell mapping...</div>
                ) : lookup ? (
                  <>
                    <div><strong>Spell.dbc ID:</strong> {lookup.spellId}</div>
                    <div><strong>SpellIconID:</strong> {lookup.spellIconId}</div>
                    <div><strong>Custom Spell DB:</strong> {lookup.customSpell?.available ? (lookup.customSpell?.hasRecord ? 'Record Exists' : 'No Row Yet') : 'Unavailable'}</div>
                    {lookup.customSpell?.source ? <div><strong>Source:</strong> {lookup.customSpell.source}</div> : null}
                    {lookup.rank ? <div><strong>Rank:</strong> {lookup.rank}</div> : null}
                    {(activeTab === 'icon' || activeTab === 'visual') && lookup.referenceTables ? (
                      <div style={{ marginTop: 8, borderTop: '1px solid #1f2937', paddingTop: 8 }}>
                        <strong>Reference Tables ({lookup.customSpell?.source === 'custom-override' ? 'sdbeditor' : 'dbc+sdbeditor'}):</strong>
                        <div style={{ marginTop: 4, display: 'grid', gap: 4 }}>
                          {Object.entries(lookup.referenceTables)
                            .filter(([fieldName]) => activeTab === 'icon' ? (fieldName === 'SpellIconID' || fieldName === 'ActiveIconID') : (fieldName === 'SpellVisual1' || fieldName === 'SpellVisual2' || fieldName === 'SpellMissileID'))
                            .map(([fieldName, ref]) => (
                              <div key={`ref-${fieldName}`} style={{ color: ref?.exists ? '#86efac' : '#fca5a5' }}>
                                {fieldName}: {ref?.value ?? 0} {ref?.exists ? `✓ ${ref?.label || ref?.table || ''}` : `✗ missing in ${ref?.table || 'table'}`}
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {activeTab === 'selectSpell' && (
                      <>
                        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                          <label style={{ fontSize: 12 }}>
                            <div style={{ marginBottom: 4 }}><strong>Template → New Spell ID</strong></div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                type="number"
                                value={newSpellId}
                                onChange={(e) => setNewSpellId(e.target.value)}
                                placeholder="New spell ID"
                                style={{ width: 180, padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                              />
                              <button
                                onClick={suggestSpellId}
                                disabled={suggestLoading}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#334155',
                                  color: '#fff',
                                  cursor: suggestLoading ? 'not-allowed' : 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                {suggestLoading ? 'Suggesting...' : 'Suggest ID'}
                              </button>
                              <button
                                onClick={createSpellFromTemplate}
                                disabled={createLoading}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#7c3aed',
                                  color: '#fff',
                                  cursor: createLoading ? 'not-allowed' : 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                {createLoading ? 'Creating...' : 'Create From Template'}
                              </button>
                            </div>
                          </label>
                        </div>

                        <div style={{ marginTop: 8 }}>
                          <strong>Tooltip:</strong>
                          <div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', marginTop: 4 }}>
                            {lookup.toolTip || 'No tooltip text present.'}
                          </div>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <strong>Description:</strong>
                          <div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', marginTop: 4 }}>
                            {lookup.description || 'No description text present.'}
                          </div>
                        </div>
                      </>
                    )}

                    {activeTab !== 'batch' && activeTab !== 'selectSpell' && (
                      <div style={{ display: 'grid', gridTemplateColumns: activeTab === 'effects' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8, marginTop: 8, maxHeight: 380, overflowY: 'auto' }}>
                        {(TAB_FIELDS[activeTab] || []).map((field) => (
                          <label key={field} style={{ fontSize: 12 }}>
                            <div style={{ marginBottom: 4 }}>{field}</div>
                            {TEXT_FIELDS.has(field) ? (
                              <textarea
                                value={String(editFields[field] ?? '')}
                                onChange={(e) => setField(field, e.target.value)}
                                rows={field === 'SpellToolTip' ? 4 : 3}
                                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                              />
                            ) : BITMASK_FIELDS.has(field) ? (
                              <div style={{ border: '1px solid #374151', borderRadius: 6, background: '#111827', color: '#e5e7eb', padding: 8 }}>
                                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>Value: {parseMaskValue(editFields[field]).toString()}</div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 6 }}>
                                  <input
                                    type="checkbox"
                                    checked={parseMaskValue(editFields[field]) === 0n}
                                    onChange={(e) => {
                                      if (e.target.checked) setField(field, '0');
                                    }}
                                  />
                                  <span>0 - None</span>
                                </label>
                                <div style={{ maxHeight: 180, overflowY: 'auto', borderTop: '1px solid #1f2937', paddingTop: 6, display: 'grid', gap: 4 }}>
                                  {getBitmaskOptions(field, spellEnums)
                                    .filter((opt) => opt.value > 0)
                                    .map((opt) => {
                                      const isChecked = (parseMaskValue(editFields[field]) & BigInt(opt.value)) !== 0n;
                                      return (
                                        <label key={`${field}-bit-${opt.value}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => setField(field, updateBitmaskValue(editFields[field], opt.value, e.target.checked))}
                                          />
                                          <span>{opt.value} - {opt.label}</span>
                                        </label>
                                      );
                                    })}
                                </div>
                              </div>
                            ) : getSelectOptionsForField(field, spellEnums) ? (
                              <select
                                value={String(editFields[field] ?? '')}
                                onChange={(e) => setField(field, e.target.value)}
                                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                              >
                                <option value="">-- Select --</option>
                                {withCurrentValueOption(getSelectOptionsForField(field, spellEnums) || [], String(editFields[field] ?? '')).map((opt) => (
                                  <option key={`${field}-${opt.value}`} value={String(opt.value)}>{opt.value} - {opt.label}</option>
                                ))}
                              </select>
                            ) : REFERENCE_FIELDS.has(field) ? (
                              <>
                                <input
                                  type="number"
                                  list={`ref-options-${field}`}
                                  value={String(editFields[field] ?? '')}
                                  onChange={(e) => {
                                    setField(field, e.target.value);
                                    fetchReferenceOptions(field, e.target.value);
                                  }}
                                  onFocus={() => fetchReferenceOptions(field, String(editFields[field] ?? ''))}
                                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                                />
                                <datalist id={`ref-options-${field}`}>
                                  {(referenceOptions[field] || []).map((opt) => (
                                    <option key={`${field}-ref-${opt.value}`} value={String(opt.value)} label={`${opt.value} - ${opt.label}`} />
                                  ))}
                                </datalist>
                              </>
                            ) : (
                              <input
                                type="number"
                                value={String(editFields[field] ?? '')}
                                onChange={(e) => setField(field, e.target.value)}
                                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}

                    {activeTab === 'batch' && (
                      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                        <label style={{ fontSize: 12 }}>
                          <div style={{ marginBottom: 4 }}>Spell IDs (comma or space separated)</div>
                          <textarea
                            rows={3}
                            value={batchIds}
                            onChange={(e) => setBatchIds(e.target.value)}
                            placeholder="36298, 47241, 54817"
                            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                          />
                        </label>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          {Object.keys(batchFields).map((field) => (
                            <label key={field} style={{ fontSize: 12 }}>
                              <div style={{ marginBottom: 4 }}>{field}</div>
                              <input
                                type="number"
                                value={batchFields[field]}
                                onChange={(e) => setBatchFields((prev) => ({ ...prev, [field]: e.target.value }))}
                                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }}
                              />
                            </label>
                          ))}
                        </div>

                        <button
                          onClick={runBatchEdit}
                          disabled={batchLoading}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: 'none',
                            background: '#9333ea',
                            color: '#fff',
                            cursor: batchLoading ? 'not-allowed' : 'pointer',
                            fontWeight: 700,
                          }}
                        >
                          {batchLoading ? 'Applying...' : 'Apply Batch Visual Edit'}
                        </button>
                        {batchStatus ? <div style={{ color: '#a7f3d0', fontSize: 12 }}>{batchStatus}</div> : null}
                      </div>
                    )}

                    {activeTab !== 'batch' && (
                      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          onClick={saveSpell}
                          disabled={saveLoading}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: 'none',
                            background: '#16a34a',
                            color: '#fff',
                            cursor: saveLoading ? 'not-allowed' : 'pointer',
                            fontWeight: 700,
                          }}
                        >
                          {saveLoading ? 'Saving...' : 'Save Spell'}
                        </button>
                        {activeTab === 'selectSpell' && (
                          <button
                            onClick={copySpell}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 6,
                              border: 'none',
                              background: '#1d4ed8',
                              color: '#fff',
                              cursor: 'pointer',
                              fontWeight: 700,
                            }}
                          >
                            Copy Spell
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: '#fca5a5' }}>No mapping found or lookup failed.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
