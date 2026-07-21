import React, { useEffect, useMemo, useRef, useState } from 'react';

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

type TabId = 'base' | 'targetsProcs' | 'effects' | 'items' | 'flags' | 'icon' | 'visual';
type SelectOption = { value: number; label: string };
type ModifiedEntry = {
  spellId: number;
  name: string;
  icon?: string | null;
  changedFields: string[];
  action: 'edit' | 'create' | 'batch';
  timestamp: number;
};
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

const TAB_FIELDS: Record<TabId, string[]> = {
  base: ['SpellName', 'SpellRank', 'SpellDescription', 'SpellToolTip', 'Category', 'Dispel', 'Mechanic', 'CastingTimeIndex', 'DurationIndex', 'RangeIndex', 'MaximumLevel', 'BaseLevel', 'SpellLevel', 'RecoveryTime', 'CategoryRecoveryTime', 'StartRecoveryCategory', 'StartRecoveryTime', 'PowerType', 'ManaCost', 'ManaCostPerLevel', 'ManaPerSecond', 'ManaPerSecondPerLevel', 'ManaCostPercentage', 'Speed', 'StackAmount', 'ModalNextSpell', 'MaximumTargetLevel', 'MaximumAffectedTargets', 'RequiresSpellFocus', 'PreventionType', 'DamageClass', 'SpellFamilyName', 'SchoolMask', 'SpellMissileID', 'SpellVisual1', 'SpellVisual2', 'SpellPriority', 'RuneCostID', 'SpellDescriptionVariableID', 'SpellDifficultyID'],
  targetsProcs: ['Targets', 'TargetCreatureType', 'FacingCasterFlags', 'ProcFlags', 'ProcChance', 'ProcCharges', 'CasterAuraState', 'TargetAuraState', 'CasterAuraStateNot', 'TargetAuraStateNot', 'CasterAuraSpell', 'TargetAuraSpell', 'ExcludeCasterAuraSpell', 'ExcludeTargetAuraSpell'],
  effects: ['Effect1', 'Effect2', 'Effect3', 'EffectDieSides1', 'EffectDieSides2', 'EffectDieSides3', 'EffectRealPointsPerLevel1', 'EffectRealPointsPerLevel2', 'EffectRealPointsPerLevel3', 'EffectBasePoints1', 'EffectBasePoints2', 'EffectBasePoints3', 'EffectMechanic1', 'EffectMechanic2', 'EffectMechanic3', 'EffectImplicitTargetA1', 'EffectImplicitTargetA2', 'EffectImplicitTargetA3', 'EffectImplicitTargetB1', 'EffectImplicitTargetB2', 'EffectImplicitTargetB3', 'EffectRadiusIndex1', 'EffectRadiusIndex2', 'EffectRadiusIndex3', 'EffectApplyAuraName1', 'EffectApplyAuraName2', 'EffectApplyAuraName3', 'EffectAmplitude1', 'EffectAmplitude2', 'EffectAmplitude3', 'EffectMultipleValue1', 'EffectMultipleValue2', 'EffectMultipleValue3', 'EffectChainTarget1', 'EffectChainTarget2', 'EffectChainTarget3', 'EffectItemType1', 'EffectItemType2', 'EffectItemType3', 'EffectMiscValue1', 'EffectMiscValue2', 'EffectMiscValue3', 'EffectMiscValueB1', 'EffectMiscValueB2', 'EffectMiscValueB3', 'EffectTriggerSpell1', 'EffectTriggerSpell2', 'EffectTriggerSpell3'],
  items: ['Totem1', 'Totem2', 'Reagent1', 'Reagent2', 'Reagent3', 'Reagent4', 'Reagent5', 'Reagent6', 'Reagent7', 'Reagent8', 'ReagentCount1', 'ReagentCount2', 'ReagentCount3', 'ReagentCount4', 'ReagentCount5', 'ReagentCount6', 'ReagentCount7', 'ReagentCount8', 'EquippedItemClass', 'EquippedItemSubClassMask', 'EquippedItemInventoryTypeMask', 'TotemCategory1', 'TotemCategory2'],
  flags: ['Attributes', 'AttributesEx', 'AttributesEx2', 'AttributesEx3', 'AttributesEx4', 'AttributesEx5', 'AttributesEx6', 'AttributesEx7', 'InterruptFlags', 'AuraInterruptFlags', 'ChannelInterruptFlags', 'Stances', 'StancesNot'],
  icon: ['SpellIconID', 'ActiveIconID'],
  visual: ['SpellVisual1', 'SpellVisual2', 'SpellMissileID', 'PowerDisplayId', 'AreaGroupID', 'RequiredAuraVision'],
};

const TEXT_FIELDS = new Set(['SpellName', 'SpellRank', 'SpellToolTip', 'SpellDescription']);
const REFERENCE_FIELDS = new Set(['SpellIconID', 'ActiveIconID', 'SpellVisual1', 'SpellVisual2', 'SpellMissileID']);

// Effect-dependent Misc Value hints (like StoneHarry's Spell Editor) - keyed by
// numeric SPELL_EFFECT_* id (see SharedDefines.h). Only covers effects whose
// EffectMiscValue/EffectMiscValueB meaning is well established; unlisted
// effects simply show no hint rather than guessing.
const EFFECT_MISC_HINTS: Record<number, { a?: string; b?: string }> = {
  8: { a: 'Power Type (0=Mana,1=Rage,2=Focus,3=Energy,6=RunicPower)' },       // POWER_DRAIN
  16: { a: 'Quest ID' },                                                      // QUEST_COMPLETE
  24: { a: 'Item ID (item_template entry)' },                                 // CREATE_ITEM
  28: { a: 'Creature Entry (creature_template ID)', b: 'Summon Properties ID (SummonProperties.dbc)' }, // SUMMON
  30: { a: 'Power Type (0=Mana,1=Rage,2=Focus,3=Energy,6=RunicPower)' },      // ENERGIZE
  33: { a: 'Lock skill required (matches Lock.dbc requirement type)' },      // OPEN_LOCK
  34: { a: 'Item ID (item_template entry)' },                                 // SUMMON_CHANGE_ITEM
  36: { a: 'Spell ID to learn' },                                             // LEARN_SPELL
  38: { a: 'Dispel Type mask' },                                              // DISPEL
  39: { a: 'Language ID' },                                                  // LANGUAGE
  53: { a: 'Item Enchantment ID (spell_item_enchantment)' },                 // ENCHANT_ITEM
  54: { a: 'Item Enchantment ID (spell_item_enchantment)' },                 // ENCHANT_ITEM_TEMPORARY
  56: { a: 'Creature Entry (pet creature_template ID)' },                    // SUMMON_PET
  57: { a: 'Spell ID to learn' },                                            // LEARN_PET_SPELL
  59: { a: 'Reference loot/item group (see spell_loot_template)' },          // CREATE_RANDOM_ITEM
  61: { a: 'Event ID (used by scripts / EventAI)' },                         // SEND_EVENT
  62: { a: 'Power Type (0=Mana,1=Rage,2=Focus,3=Energy,6=RunicPower)' },     // POWER_BURN
  66: { a: 'Item ID (item_template entry)' },                                // CREATE_MANA_GEM
  74: { a: 'Glyph Slot / GlyphProperties ID' },                              // APPLY_GLYPH
  76: { a: 'GameObject Entry (gameobject_template ID)' },                    // SUMMON_OBJECT_WILD
  90: { a: 'Creature Entry (kill credit target, 0 = self)' },                // KILL_CREDIT
  92: { a: 'Item Enchantment ID (spell_item_enchantment)' },                 // ENCHANT_HELD_ITEM
  101: { a: 'Item ID (food item, item_template entry)' },                    // FEED_PET
  103: { a: 'Faction ID (Faction.dbc)' },                                   // REPUTATION
  104: { a: 'GameObject Entry (gameobject_template ID)' },                   // SUMMON_OBJECT_SLOT1
  105: { a: 'GameObject Entry (gameobject_template ID)' },                   // SUMMON_OBJECT_SLOT2
  106: { a: 'GameObject Entry (gameobject_template ID)' },                   // SUMMON_OBJECT_SLOT3
  107: { a: 'GameObject Entry (gameobject_template ID)' },                   // SUMMON_OBJECT_SLOT4
  108: { a: 'Mechanic Type' },                                               // DISPEL_MECHANIC
  118: { a: 'Skill Line ID (SkillLine.dbc)' },                               // SKILL
  131: { a: 'Sound ID (SoundEntries.dbc)' },                                 // PLAY_SOUND
  132: { a: 'Sound ID (SoundEntries.dbc, music track)' },                    // PLAY_MUSIC
};

// Effects whose EffectMiscValue meaning is actually governed by the aura type
// (EffectApplyAuraNameN) rather than the effect itself.
const AURA_EFFECT_IDS = new Set([6, 35, 65, 119, 128, 129, 143]);

// Aura-dependent Misc Value hints - keyed by numeric SPELL_AURA_* id (see
// SpellAuraDefines.h). Used when the effect is one of the "Apply (Area) Aura"
// family above.
const AURA_MISC_HINTS: Record<number, { a?: string; b?: string }> = {
  4: { a: 'Script-defined (see spell_script)' },        // DUMMY
  10: { a: 'School Mask (schools affected)' },           // MOD_THREAT
  13: { a: 'School Mask (schools affected)' },           // MOD_DAMAGE_DONE
  22: { a: 'School Mask (resistance school affected)' }, // MOD_RESISTANCE
  24: { a: 'Power Type (0=Mana,1=Rage,2=Focus,3=Energy,6=RunicPower)' }, // PERIODIC_ENERGIZE
  29: { a: 'Stat (-1=All, 0=Str,1=Agi,2=Stam,3=Int,4=Spirit)' }, // MOD_STAT
  30: { a: 'Skill Line ID (SkillLine.dbc)' },            // MOD_SKILL
  36: { a: 'Shapeshift Form ID' },                       // MOD_SHAPESHIFT
  44: { a: 'Tracking Icon Index (hunter/rogue tracking UI slot)' }, // TRACK_CREATURES
  45: { a: 'Tracking Icon Index (gathering skill UI slot)' },      // TRACK_RESOURCES
  56: { a: 'Creature Entry (model sourced from creature_template)' }, // TRANSFORM
  69: { a: 'School Mask (schools absorbed)' },           // SCHOOL_ABSORB
  75: { a: 'Language ID' },                              // MOD_LANGUAGE
  77: { a: 'Mechanic Type (immune to)' },                // MECHANIC_IMMUNITY
  78: { a: 'Creature Display ID (mount model, CreatureDisplayInfo.dbc)' }, // MOUNTED
  79: { a: 'School Mask (schools affected)' },           // MOD_DAMAGE_PERCENT_DONE
  87: { a: 'School Mask (schools affected)' },           // MOD_DAMAGE_PERCENT_TAKEN
  101: { a: 'School Mask (resistance school affected)' }, // MOD_RESISTANCE_PCT
  107: { a: 'Spell Modifier Type (SpellModOp)' },        // ADD_FLAT_MODIFIER
  108: { a: 'Spell Modifier Type (SpellModOp)' },        // ADD_PCT_MODIFIER
  123: { a: 'School Mask (resistance school affected)' }, // MOD_TARGET_RESISTANCE
  135: { a: 'School Mask (usually irrelevant for healing)' }, // MOD_HEALING_DONE
  137: { a: 'Stat (-1=All, 0=Str,1=Agi,2=Stam,3=Int,4=Spirit)' }, // MOD_TOTAL_STAT_PERCENTAGE
  189: { a: 'Combat Rating Mask (bitmask, see CombatRating enum)' }, // MOD_RATING
  243: { a: 'Faction ID (Faction.dbc)' },                // MOD_FACTION
};

function getEffectMiscHint(field: string, editFields: Record<string, any>): string | null {
  const match = /^EffectMiscValue(B?)([123])$/.exec(field);
  if (!match) return null;
  const isB = match[1] === 'B';
  const slot = match[2];
  const effectValue = Number(editFields[`Effect${slot}`] ?? 0);
  if (!effectValue) return null;

  if (AURA_EFFECT_IDS.has(effectValue)) {
    const auraValue = Number(editFields[`EffectApplyAuraName${slot}`] ?? 0);
    const auraHint = AURA_MISC_HINTS[auraValue];
    if (auraHint) return (isB ? auraHint.b : auraHint.a) || null;
    return isB ? null : `Depends on Aura Type (EffectApplyAuraName${slot})`;
  }

  const effectHint = EFFECT_MISC_HINTS[effectValue];
  if (!effectHint) return null;
  return (isB ? effectHint.b : effectHint.a) || null;
}

type ChainRowInfo = { id: number; row: Record<string, any>; sharedCount: number };
type VisualChainBundle = {
  spellId: number;
  spellVisual1: number;
  spellVisual2: number;
  spellMissileId: number;
  visual: ChainRowInfo | null;
  kits: Record<string, ChainRowInfo>;
  effects: Record<string, Record<string, any>>;
  modelAttach: Record<string, Record<string, any>[]>;
  missile: ChainRowInfo | null;
  missileMotion: ChainRowInfo | null;
  areaModels: Record<string, any>[];
};

const VISUAL_KIT_FIELD_NAMES = ['PrecastKit', 'CastKit', 'ImpactKit', 'StateKit', 'StateDoneKit', 'ChannelKit', 'CasterImpactKit', 'TargetImpactKit'];
const AREA_KIT_FIELD_NAMES = ['InstantAreaKit', 'ImpactAreaKit', 'PersistentAreaKit'];
const KIT_EFFECT_FIELD_NAMES = ['HeadEffect', 'ChestEffect', 'BaseEffect', 'LeftHandEffect', 'RightHandEffect', 'BreathEffect', 'LeftWeaponEffect', 'RightWeaponEffect', 'SpecialEffect1', 'SpecialEffect2', 'SpecialEffect3', 'WorldEffect'];
const KIT_MISC_FIELD_NAMES = ['StartAnimId', 'AnimationId', 'SoundID', 'ShakeID', 'CharProc1', 'CharProc2', 'CharProc3', 'CharProc4', 'Flags'];
const KIT_PARAM_FIELD_NAMES = ['CharParamZero1', 'CharParamZero2', 'CharParamZero3', 'CharParamZero4', 'CharParamOne1', 'CharParamOne2', 'CharParamOne3', 'CharParamOne4', 'CharParamTwo1', 'CharParamTwo2', 'CharParamTwo3', 'CharParamTwo4', 'CharParamThree1', 'CharParamThree2', 'CharParamThree3', 'CharParamThree4'];
const MISSILE_VISUAL_FIELD_NAMES = ['HasMissile', 'MissileModel', 'MissilePathType', 'MissileDestinationAttachment', 'MissileAttachment', 'MissileSound', 'AnimEventSoundId', 'MissileTargetingKit', 'MissileFollowGroundHeight', 'MissileFollowDropSpeed', 'MissileFollowApproach', 'MissileFollowGroundFlags', 'MissileCastOffsetX', 'MissileCastOffsetY', 'MissileCastOffsetZ', 'MissileImpactOffsetX', 'MissileImpactOffsetY', 'MissileImpactOffsetZ', 'Flags'];
const MISSILE_PHYSICS_FIELD_NAMES = ['flags', 'defaultPitchMin', 'defaultPitchMax', 'defaultSpeedMin', 'defaultSpeedMax', 'randomizeFacingMin', 'randomizeFacingMax', 'randomizePitchMin', 'randomizePitchMax', 'randomizeSpeedMin', 'randomizeSpeedMax', 'gravity', 'maxDuration', 'collisionRadius'];
const MOTION_FIELD_NAMES = ['name', 'script', 'flags', 'missileCount'];
const VISUAL_FLOAT_FIELDS = new Set(['MissileCastOffsetX', 'MissileCastOffsetY', 'MissileCastOffsetZ', 'MissileImpactOffsetX', 'MissileImpactOffsetY', 'MissileImpactOffsetZ']);
const KIT_PARAM_FLOAT_FIELDS = new Set(KIT_PARAM_FIELD_NAMES);
const MISSILE_PHYSICS_FLOAT_FIELDS = new Set(['defaultPitchMin', 'defaultPitchMax', 'defaultSpeedMin', 'defaultSpeedMax', 'randomizeFacingMin', 'randomizeFacingMax', 'randomizePitchMin', 'randomizePitchMax', 'randomizeSpeedMin', 'randomizeSpeedMax', 'gravity', 'maxDuration', 'collisionRadius']);
const MOTION_TEXT_FIELDS = new Set(['name', 'script']);
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

const inputStyle: React.CSSProperties = { width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb', boxSizing: 'border-box' };
const smallLabelStyle: React.CSSProperties = { fontSize: 12 };
const sectionHeaderStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 6 };
const savePanelButtonStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700 };

// ── Icon tab: picture-grid picker ─────────────────────────────────────────
type IconManifestEntry = { id: number; name: string; thumbnail?: boolean; inDbc?: boolean };

function IconPickerPanel({
  spellIconId,
  activeIconId,
  onPick,
  onSave,
  saveLoading,
}: {
  spellIconId: string | number | null | undefined;
  activeIconId: string | number | null | undefined;
  onPick: (field: 'SpellIconID' | 'ActiveIconID', id: number) => void;
  onSave: () => void;
  saveLoading: boolean;
}) {
  const [icons, setIcons] = useState<IconManifestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [targetField, setTargetField] = useState<'SpellIconID' | 'ActiveIconID'>('SpellIconID');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/icon-manifest');
        const data = await res.json();
        if (!mounted || !res.ok) return;
        setIcons(Array.isArray(data.icons) ? data.icons : []);
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term ? icons.filter((icon) => icon.name.toLowerCase().includes(term)) : icons;
    return list.slice(0, 400);
  }, [icons, search]);

  const currentValue = Number(targetField === 'SpellIconID' ? spellIconId : activeIconId) || 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label style={{ ...smallLabelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="radio" checked={targetField === 'SpellIconID'} onChange={() => setTargetField('SpellIconID')} />
          Spell Icon ({Number(spellIconId) || 0})
        </label>
        <label style={{ ...smallLabelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="radio" checked={targetField === 'ActiveIconID'} onChange={() => setTargetField('ActiveIconID')} />
          Active (Shapeshift) Icon ({Number(activeIconId) || 0})
        </label>
        <input
          type="text"
          placeholder="Search icon name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220, marginLeft: 'auto' }}
        />
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading icons...</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))',
            gap: 6,
            maxHeight: 380,
            overflowY: 'auto',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: 8,
          }}
        >
          {filtered.map((icon) => {
            const thumb = toThumbnailUrl(icon.name);
            const selected = icon.id === currentValue;
            return (
              <button
                key={`icon-${icon.id}-${icon.name}`}
                title={`${icon.name} (ID ${icon.id})`}
                onClick={() => onPick(targetField, icon.id)}
                style={{
                  width: 56,
                  height: 56,
                  padding: 0,
                  borderRadius: 6,
                  border: selected ? '2px solid #22c55e' : '1px solid #374151',
                  background: '#111827',
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
              >
                {thumb ? <img src={thumb} alt={icon.name} loading="lazy" style={{ width: '100%', height: '100%' }} /> : null}
              </button>
            );
          })}
          {!filtered.length ? <div style={{ color: '#94a3b8', fontSize: 12, gridColumn: '1 / -1' }}>No icons match.</div> : null}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={onSave} disabled={saveLoading} style={savePanelButtonStyle}>
          {saveLoading ? 'Saving...' : 'Save Spell'}
        </button>
      </div>
    </div>
  );
}

// ── Visual tab: 5 sub-tab clone-safe editor ───────────────────────────────
function RefNumberInput({
  value,
  onChange,
  refField,
}: {
  value: any;
  onChange: (v: string) => void;
  refField: string;
}) {
  const [options, setOptions] = useState<RefOption[]>([]);
  const listId = `visual-ref-${refField}-${Math.random().toString(36).slice(2, 8)}`;
  const fetchOptions = async (q: string) => {
    try {
      const res = await fetch(`/api/spell-ref-options?field=${encodeURIComponent(refField)}&q=${encodeURIComponent(q || '')}&limit=30`);
      const data = await res.json();
      if (res.ok) setOptions(Array.isArray(data?.options) ? data.options : []);
    } catch {
      // ignore
    }
  };
  return (
    <>
      <input
        type="number"
        list={listId}
        value={String(value ?? '')}
        onChange={(e) => {
          onChange(e.target.value);
          fetchOptions(e.target.value);
        }}
        onFocus={() => fetchOptions(String(value ?? ''))}
        style={inputStyle}
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={`${listId}-${opt.value}`} value={String(opt.value)} label={`${opt.value} - ${opt.label}`} />
        ))}
      </datalist>
    </>
  );
}

function FieldGrid({
  fields,
  row,
  edits,
  onChange,
  floatFields,
  textFields,
  refFieldMap,
  columns = 2,
}: {
  fields: string[];
  row: Record<string, any>;
  edits: Record<string, string>;
  onChange: (field: string, value: string) => void;
  floatFields?: Set<string>;
  textFields?: Set<string>;
  refFieldMap?: Record<string, string>;
  columns?: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 8 }}>
      {fields.map((field) => {
        const value = edits[field] !== undefined ? edits[field] : row?.[field];
        const refField = refFieldMap?.[field];
        return (
          <label key={field} style={smallLabelStyle}>
            <div style={{ marginBottom: 4 }}>{field}</div>
            {refField ? (
              <RefNumberInput value={value} onChange={(v) => onChange(field, v)} refField={refField} />
            ) : textFields?.has(field) ? (
              <textarea rows={field === 'script' ? 4 : 2} value={String(value ?? '')} onChange={(e) => onChange(field, e.target.value)} style={inputStyle} />
            ) : (
              <input
                type="number"
                step={floatFields?.has(field) ? 'any' : 1}
                value={String(value ?? '')}
                onChange={(e) => onChange(field, e.target.value)}
                style={inputStyle}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

type VisualSubTab = 'base' | 'missile' | 'kits' | 'motion' | 'map';

function VisualChainPanel({
  spellId,
  onStatus,
  onChainSaved,
}: {
  spellId: number;
  onStatus: (msg: string) => void;
  onChainSaved: () => void;
}) {
  const [subTab, setSubTab] = useState<VisualSubTab>('base');
  const [bundle, setBundle] = useState<VisualChainBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [visualEdits, setVisualEdits] = useState<Record<string, string>>({});
  const [missileVisualEdits, setMissileVisualEdits] = useState<Record<string, string>>({});
  const [missilePhysicsEdits, setMissilePhysicsEdits] = useState<Record<string, string>>({});
  const [motionEdits, setMotionEdits] = useState<Record<string, string>>({});
  const [kitEditsByKit, setKitEditsByKit] = useState<Record<string, Record<string, string>>>({});
  const [selectedKitField, setSelectedKitField] = useState<string>('ImpactKit');

  const load = async () => {
    if (!spellId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spells/${spellId}/visual-chain`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      setBundle(data);
      setVisualEdits({});
      setMissileVisualEdits({});
      setMissilePhysicsEdits({});
      setMotionEdits({});
      setKitEditsByKit({});
      const firstKitField = [...VISUAL_KIT_FIELD_NAMES, ...AREA_KIT_FIELD_NAMES].find((f) => Number(data?.visual?.row?.[f]) > 0);
      setSelectedKitField(firstKitField || 'ImpactKit');
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spellId]);

  const saveChainEdit = async (table: string, id: number, fields: Record<string, string>, ownerRepoint?: any) => {
    const numericFields: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === '' || v === undefined) continue;
      const n = Number(v);
      numericFields[k] = Number.isFinite(n) ? n : v;
    }
    if (!Object.keys(numericFields).length) {
      onStatus('No changes to save.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/visual-chain/edit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id, fields: numericFields, ownerRepoint }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      onStatus(
        data.cloned
          ? `Cloned shared ${table} row ${id} → new ID ${data.finalId} (was shared by ${data.sharedCountBefore}).`
          : `Updated ${table} row ${id} in place.`
      );
      await load();
      onChainSaved();
    } catch (err: any) {
      onStatus(`Visual save failed: ${err.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>Loading visual chain...</div>;
  if (error) return <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{error}</div>;
  if (!bundle) return null;

  const visual = bundle.visual;
  const missile = bundle.missile;
  const missileMotion = bundle.missileMotion;
  const kitIds = Object.keys(bundle.kits || {});
  const selectedKitId = visual ? Number(visual.row?.[selectedKitField]) || 0 : 0;
  const selectedKit = selectedKitId ? bundle.kits[String(selectedKitId)] : undefined;
  const kitAttachRows = selectedKitId ? bundle.modelAttach?.[String(selectedKitId)] || [] : [];

  const subTabs: Array<[VisualSubTab, string]> = [
    ['base', 'Base'],
    ['missile', 'Missile Model'],
    ['kits', 'Kits and Effects'],
    ['motion', 'Motion'],
    ['map', 'Map Builder'],
  ];

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {subTabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid #374151',
              background: subTab === id ? '#334155' : 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {!visual ? (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>This spell has no SpellVisual1 assigned.</div>
      ) : (
        <>
          {visual.sharedCount > 1 ? (
            <div style={{ color: '#fbbf24', fontSize: 11, marginBottom: 8 }}>
              ⚠ SpellVisual {visual.id} is shared by {visual.sharedCount} spells. Saving any change here will clone it to a new private ID and repoint this spell automatically.
            </div>
          ) : (
            <div style={{ color: '#86efac', fontSize: 11, marginBottom: 8 }}>SpellVisual {visual.id} is private to this spell.</div>
          )}

          {subTab === 'base' && (
            <>
              <div style={sectionHeaderStyle}>Kit Assignments</div>
              <FieldGrid
                fields={VISUAL_KIT_FIELD_NAMES}
                row={visual.row}
                edits={visualEdits}
                onChange={(f, v) => setVisualEdits((p) => ({ ...p, [f]: v }))}
                refFieldMap={Object.fromEntries(VISUAL_KIT_FIELD_NAMES.map((f) => [f, 'VisualKit']))}
              />
              <div style={sectionHeaderStyle}>Flags</div>
              <FieldGrid
                fields={['Flags']}
                row={visual.row}
                edits={visualEdits}
                onChange={(f, v) => setVisualEdits((p) => ({ ...p, [f]: v }))}
              />
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() =>
                    saveChainEdit('spellvisual', visual.id, visualEdits, { table: 'spell', id: spellId, column: 'SpellVisual1' })
                  }
                  disabled={saving}
                  style={savePanelButtonStyle}
                >
                  {saving ? 'Saving...' : 'Save Base'}
                </button>
              </div>
            </>
          )}

          {subTab === 'missile' && (
            <>
              <div style={sectionHeaderStyle}>Missile Visual (SpellVisual row)</div>
              <FieldGrid
                fields={MISSILE_VISUAL_FIELD_NAMES}
                row={visual.row}
                edits={missileVisualEdits}
                onChange={(f, v) => setMissileVisualEdits((p) => ({ ...p, [f]: v }))}
                floatFields={VISUAL_FLOAT_FIELDS}
                refFieldMap={{ MissileModel: 'VisualEffectName' }}
              />
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() =>
                    saveChainEdit('spellvisual', visual.id, missileVisualEdits, { table: 'spell', id: spellId, column: 'SpellVisual1' })
                  }
                  disabled={saving}
                  style={savePanelButtonStyle}
                >
                  {saving ? 'Saving...' : 'Save Missile Visual'}
                </button>
              </div>

              <div style={sectionHeaderStyle}>Missile Physics (SpellMissile row)</div>
              {missile ? (
                <>
                  {missile.sharedCount > 1 ? (
                    <div style={{ color: '#fbbf24', fontSize: 11, marginBottom: 6 }}>
                      ⚠ Shared by {missile.sharedCount} spells — saving will clone to a private copy.
                    </div>
                  ) : null}
                  <FieldGrid
                    fields={MISSILE_PHYSICS_FIELD_NAMES}
                    row={missile.row}
                    edits={missilePhysicsEdits}
                    onChange={(f, v) => setMissilePhysicsEdits((p) => ({ ...p, [f]: v }))}
                    floatFields={MISSILE_PHYSICS_FLOAT_FIELDS}
                    columns={3}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={() =>
                        saveChainEdit('spellmissile', missile.id, missilePhysicsEdits, { table: 'spell', id: spellId, column: 'SpellMissileID' })
                      }
                      disabled={saving}
                      style={savePanelButtonStyle}
                    >
                      {saving ? 'Saving...' : 'Save Missile Physics'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 12 }}>
                  No SpellMissileID assigned on this spell (set it via the Base tab's SpellMissileID field to link a physics preset).
                </div>
              )}
            </>
          )}

          {subTab === 'kits' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <label style={smallLabelStyle}>
                  Kit slot:&nbsp;
                  <select
                    value={selectedKitField}
                    onChange={(e) => setSelectedKitField(e.target.value)}
                    style={{ ...inputStyle, width: 'auto', display: 'inline-block' }}
                  >
                    {[...VISUAL_KIT_FIELD_NAMES, ...AREA_KIT_FIELD_NAMES].map((f) => (
                      <option key={f} value={f}>
                        {f} ({Number(visual.row?.[f]) || 0})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {!selectedKit ? (
                <div style={{ color: '#94a3b8', fontSize: 12 }}>No kit assigned to {selectedKitField} on this SpellVisual.</div>
              ) : (
                <>
                  {selectedKit.sharedCount > 1 ? (
                    <div style={{ color: '#fbbf24', fontSize: 11, marginBottom: 6 }}>
                      ⚠ SpellVisualKit {selectedKit.id} shared by {selectedKit.sharedCount} kit slots — saving will clone to a private copy.
                    </div>
                  ) : (
                    <div style={{ color: '#86efac', fontSize: 11, marginBottom: 6 }}>SpellVisualKit {selectedKit.id} is private.</div>
                  )}
                  <div style={sectionHeaderStyle}>Anim / Sound / Misc</div>
                  <FieldGrid
                    fields={KIT_MISC_FIELD_NAMES}
                    row={selectedKit.row}
                    edits={kitEditsByKit[selectedKit.id] || {}}
                    onChange={(f, v) => setKitEditsByKit((p) => ({ ...p, [selectedKit.id]: { ...(p[selectedKit.id] || {}), [f]: v } }))}
                    columns={3}
                  />
                  <div style={sectionHeaderStyle}>Effects (each is a SpellVisualEffectName ID)</div>
                  <FieldGrid
                    fields={KIT_EFFECT_FIELD_NAMES}
                    row={selectedKit.row}
                    edits={kitEditsByKit[selectedKit.id] || {}}
                    onChange={(f, v) => setKitEditsByKit((p) => ({ ...p, [selectedKit.id]: { ...(p[selectedKit.id] || {}), [f]: v } }))}
                    refFieldMap={Object.fromEntries(KIT_EFFECT_FIELD_NAMES.map((f) => [f, 'VisualEffectName']))}
                    columns={3}
                  />
                  <div style={sectionHeaderStyle}>Char Params (scale/speed/misc floats)</div>
                  <FieldGrid
                    fields={KIT_PARAM_FIELD_NAMES}
                    row={selectedKit.row}
                    edits={kitEditsByKit[selectedKit.id] || {}}
                    onChange={(f, v) => setKitEditsByKit((p) => ({ ...p, [selectedKit.id]: { ...(p[selectedKit.id] || {}), [f]: v } }))}
                    floatFields={KIT_PARAM_FLOAT_FIELDS}
                    columns={4}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={() =>
                        saveChainEdit('spellvisualkit', selectedKit.id, kitEditsByKit[selectedKit.id] || {}, {
                          table: 'spellvisual',
                          id: visual.id,
                          column: selectedKitField,
                        })
                      }
                      disabled={saving}
                      style={savePanelButtonStyle}
                    >
                      {saving ? 'Saving...' : 'Save Kit'}
                    </button>
                  </div>

                  {kitAttachRows.length ? (
                    <>
                      <div style={sectionHeaderStyle}>Model Attach Points (read-only)</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                        Attachment points defined on this kit. Editing isn't supported yet — clone the kit above first if you need
                        a private copy, then request attach-point editing as a follow-up.
                      </div>
                      <div style={{ display: 'grid', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                        {kitAttachRows.map((row) => (
                          <div key={row.ID} style={{ fontSize: 11, color: '#cbd5e1', border: '1px solid #1f2937', borderRadius: 4, padding: 6 }}>
                            AttachmentId {row.AttachmentId} · Offset ({row.OffsetX}, {row.OffsetY}, {row.OffsetZ}) · Rotation ({row.Yaw}, {row.Pitch}, {row.Roll})
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </>
          )}

          {subTab === 'motion' && (
            <>
              <div style={sectionHeaderStyle}>Motion Preset Assignment</div>
              <FieldGrid
                fields={['MissileMotion']}
                row={visual.row}
                edits={motionEdits}
                onChange={(f, v) => setMotionEdits((p) => ({ ...p, [f]: v }))}
                refFieldMap={{ MissileMotion: 'MissileMotionPreset' }}
              />
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() =>
                    saveChainEdit('spellvisual', visual.id, motionEdits, { table: 'spell', id: spellId, column: 'SpellVisual1' })
                  }
                  disabled={saving}
                  style={savePanelButtonStyle}
                >
                  {saving ? 'Saving...' : 'Save Motion Assignment'}
                </button>
              </div>

              {missileMotion ? (
                <>
                  <div style={sectionHeaderStyle}>Motion Preset Details</div>
                  {missileMotion.sharedCount > 1 ? (
                    <div style={{ color: '#fbbf24', fontSize: 11, marginBottom: 6 }}>
                      ⚠ Shared by {missileMotion.sharedCount} visuals — saving will clone to a private copy.
                    </div>
                  ) : null}
                  <FieldGrid
                    fields={MOTION_FIELD_NAMES}
                    row={missileMotion.row}
                    edits={{}}
                    onChange={() => {}}
                    textFields={MOTION_TEXT_FIELDS}
                    columns={1}
                  />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Motion preset field editing coming soon — use the assignment dropdown above to switch presets for now.
                  </div>
                </>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 12 }}>No motion preset assigned.</div>
              )}
            </>
          )}

          {subTab === 'map' && (
            <>
              <div style={sectionHeaderStyle}>Area Kit Assignments</div>
              <FieldGrid
                fields={AREA_KIT_FIELD_NAMES}
                row={visual.row}
                edits={visualEdits}
                onChange={(f, v) => setVisualEdits((p) => ({ ...p, [f]: v }))}
                refFieldMap={Object.fromEntries(AREA_KIT_FIELD_NAMES.map((f) => [f, 'VisualKit']))}
              />
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() =>
                    saveChainEdit('spellvisual', visual.id, visualEdits, { table: 'spell', id: spellId, column: 'SpellVisual1' })
                  }
                  disabled={saving}
                  style={savePanelButtonStyle}
                >
                  {saving ? 'Saving...' : 'Save Area Kits'}
                </button>
              </div>

              <div style={sectionHeaderStyle}>Ground Model Catalog (reference only)</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                SpellVisualKitAreaModel.dbc — {bundle.areaModels.length} ground-decal models available client-side. Not directly
                referenced by numeric ID from these tables; shown for context only.
              </div>
              <div style={{ display: 'grid', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {bundle.areaModels.map((row) => (
                  <div key={row.ID} style={{ fontSize: 11, color: '#cbd5e1' }}>
                    #{row.enumID}: {row.Name}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const LIST_CHUNK_SIZE = 200;
const LIST_MAX_WINDOW = 1000;
const LIST_SCROLL_THRESHOLD = 300;

export default function SpellEditor({ textColor, contentBoxColor }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('base');
  const [batchMode, setBatchMode] = useState(false);

  const [listSearchTerm, setListSearchTerm] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [allSpells, setAllSpells] = useState<SpellSearchResult[]>([]);
  const [allSpellsTotal, setAllSpellsTotal] = useState(0);
  const [listWindowOffset, setListWindowOffset] = useState(0);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const listRequestSeq = useRef(0);

  const [selected, setSelected] = useState<SpellSearchResult | null>(null);
  const [lookup, setLookup] = useState<SpellLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, RefOption[]>>({});
  const [editFields, setEditFields] = useState<Record<string, string | number | null>>({});
  const [spellEnums, setSpellEnums] = useState<SpellEnumPayload | null>(null);
  const [newSpellId, setNewSpellId] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [templatePanelCollapsed, setTemplatePanelCollapsed] = useState(false);

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

  const [modifiedHistory, setModifiedHistory] = useState<ModifiedEntry[]>([]);

  const recordModification = (
    spellId: number,
    name: string,
    icon: string | null | undefined,
    changedFields: string[],
    action: ModifiedEntry['action']
  ) => {
    if (!spellId || !changedFields.length) return;
    setModifiedHistory((prev) => {
      const existing = prev.find((e) => e.spellId === spellId);
      const merged = existing
        ? Array.from(new Set([...existing.changedFields, ...changedFields]))
        : changedFields;
      const entry: ModifiedEntry = { spellId, name, icon: icon ?? existing?.icon ?? null, changedFields: merged, action, timestamp: Date.now() };
      return [entry, ...prev.filter((e) => e.spellId !== spellId)];
    });
  };

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

  const fetchListChunk = async (offset: number, limit: number, term: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(Math.max(0, offset)) });
    if (term) params.set('q', term);
    const res = await fetch(`/api/spell-list?${params.toString()}`, { signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `List failed (${res.status})`);
    return {
      spells: Array.isArray(data.spells) ? (data.spells as SpellSearchResult[]) : [],
      total: Number(data.total) || 0,
    };
  };

  // Reset + load the first chunk whenever the search term changes.
  useEffect(() => {
    const controller = new AbortController();
    const seq = ++listRequestSeq.current;
    const handle = setTimeout(async () => {
      try {
        setListLoading(true);
        setListError(null);
        const { spells, total } = await fetchListChunk(0, LIST_CHUNK_SIZE, listSearchTerm.trim(), controller.signal);
        if (seq !== listRequestSeq.current) return;
        setAllSpells(spells);
        setAllSpellsTotal(total);
        setListWindowOffset(0);
        if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setListError(err.message || String(err));
        }
      } finally {
        setListLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listSearchTerm]);

  const listHasMoreTop = listWindowOffset > 0;
  const listHasMoreBottom = listWindowOffset + allSpells.length < allSpellsTotal;

  const loadMoreBottom = async () => {
    if (listLoadingMore || !listHasMoreBottom) return;
    const seq = listRequestSeq.current;
    try {
      setListLoadingMore(true);
      const fetchOffset = listWindowOffset + allSpells.length;
      const { spells } = await fetchListChunk(fetchOffset, LIST_CHUNK_SIZE, listSearchTerm.trim());
      if (seq !== listRequestSeq.current) return;
      setAllSpells((prev) => {
        let merged = [...prev, ...spells];
        let trimStart = 0;
        if (merged.length > LIST_MAX_WINDOW) {
          trimStart = merged.length - LIST_MAX_WINDOW;
          merged = merged.slice(trimStart);
        }
        if (trimStart > 0) setListWindowOffset((off) => off + trimStart);
        return merged;
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setListError(err.message || String(err));
    } finally {
      setListLoadingMore(false);
    }
  };

  const loadMoreTop = async () => {
    if (listLoadingMore || !listHasMoreTop) return;
    const seq = listRequestSeq.current;
    try {
      setListLoadingMore(true);
      const fetchLimit = Math.min(LIST_CHUNK_SIZE, listWindowOffset);
      const fetchOffset = listWindowOffset - fetchLimit;
      const { spells } = await fetchListChunk(fetchOffset, fetchLimit, listSearchTerm.trim());
      if (seq !== listRequestSeq.current) return;
      const container = listScrollRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;
      const prevScrollTop = container?.scrollTop ?? 0;
      setAllSpells((prev) => {
        let merged = [...spells, ...prev];
        if (merged.length > LIST_MAX_WINDOW) {
          merged = merged.slice(0, LIST_MAX_WINDOW);
        }
        return merged;
      });
      setListWindowOffset(fetchOffset);
      // Preserve scroll position so prepending doesn't jump the viewport.
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        }
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setListError(err.message || String(err));
    } finally {
      setListLoadingMore(false);
    }
  };

  const onListScroll = () => {
    const el = listScrollRef.current;
    if (!el) return;
    if (el.scrollTop < LIST_SCROLL_THRESHOLD) {
      loadMoreTop();
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < LIST_SCROLL_THRESHOLD) {
      loadMoreBottom();
    }
  };

  // Jump the infinite-scroll window so the given spell ID lands at the top
  // of the list (used for manual ID lookups and history clicks) — avoids
  // paging through everything before it, e.g. to reach the 900000+ range.
  const jumpToSpellInList = async (spellId: number) => {
    const seq = ++listRequestSeq.current;
    try {
      setListLoading(true);
      setListError(null);
      const term = listSearchTerm.trim();
      const params = new URLSearchParams({ id: String(spellId) });
      if (term) params.set('q', term);
      const offsetRes = await fetch(`/api/spell-list-offset?${params.toString()}`);
      const offsetData = await offsetRes.json();
      if (!offsetRes.ok) throw new Error(offsetData.error || `Could not locate spell ${spellId} in list`);
      if (seq !== listRequestSeq.current) return;
      const targetOffset = Number(offsetData.offset) || 0;
      const { spells, total } = await fetchListChunk(targetOffset, LIST_CHUNK_SIZE, term);
      if (seq !== listRequestSeq.current) return;
      setAllSpells(spells);
      setAllSpellsTotal(total);
      setListWindowOffset(targetOffset);
      if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
    } catch (err: any) {
      setListError(err.message || String(err));
    } finally {
      setListLoading(false);
    }
  };

  const selectedThumb = useMemo(
    () => toThumbnailUrl(lookup?.icon || selected?.icon),
    [lookup?.icon, selected]
  );

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
      setLookupError(null);
    } catch (err: any) {
      setLookup(null);
      setLookupError(err.message || String(err));
    } finally {
      setLookupLoading(false);
    }
  };

  const onPickResult = async (spell: SpellSearchResult, opts?: { jump?: boolean }) => {
    setSelected(spell);
    setBatchMode(false);
    await loadSpellDetails(spell.id);
    if (opts?.jump) {
      jumpToSpellInList(spell.id);
    }
  };

  const onManualLookup = async () => {
    const id = Number(manualSpellId);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelected({ id, name: `Spell ${id}`, icon: null });
    await loadSpellDetails(id);
    jumpToSpellInList(id);
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
      recordModification(parsedNewId, newSelected.name, newSelected.icon, ['(created from template)', ...Object.keys(fields)], 'create');
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
      if (data.updatedFields?.length) {
        recordModification(selected.id, lookup?.name || selected.name, lookup?.icon || selected.icon, data.updatedFields, 'edit');
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

  const [visualExportLoading, setVisualExportLoading] = useState(false);

  const exportVisualDbcs = async () => {
    try {
      setVisualExportLoading(true);
      setSaveStatus(null);
      const res = await fetch('/api/spells/export-visual-dbcs', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Export failed (${res.status})`);
      const summary = (data.exported || [])
        .map((e: any) => `${e.dbc} (${e.recordCount})`)
        .join(', ');
      setSaveStatus(`Visual DBCs exported: ${summary}`);
    } catch (err: any) {
      setSaveStatus(`Visual DBC export failed: ${err.message || String(err)}`);
    } finally {
      setVisualExportLoading(false);
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
      const changedFieldNames = data.updatedFields?.length ? data.updatedFields : Object.keys(fields);
      for (const id of spellIds) {
        recordModification(id, `Spell ${id}`, null, changedFieldNames, 'batch');
      }
    } catch (err: any) {
      setBatchStatus(`Batch edit failed: ${err.message || String(err)}`);
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, color: textColor }}>
      <h2 style={{ marginTop: 0 }}>Spell Editor</h2>
      <p style={{ color: '#999', marginTop: 0 }}>Browse every spell by ID, edit it across tabbed field groups, and track everything you changed this session.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 320px', gap: 16, alignItems: 'start' }}>
        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>All Spells ({allSpellsTotal})</h3>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
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

          <input
            type="text"
            value={listSearchTerm}
            onChange={(e) => setListSearchTerm(e.target.value)}
            placeholder="Filter by ID or name..."
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              border: '1px solid #444',
              background: '#111827',
              color: '#e5e7eb',
              marginBottom: 10,
              boxSizing: 'border-box',
            }}
          />

          {listError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{listError}</div>}

          <div
            ref={listScrollRef}
            onScroll={onListScroll}
            style={{ border: '1px solid #30363d', borderRadius: 6, height: 480, overflowY: 'auto' }}
          >
            {listLoading ? (
              <div style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>Loading...</div>
            ) : allSpells.length === 0 ? (
              <div style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>No spells found.</div>
            ) : (
              <>
                {listHasMoreTop && (
                  <div style={{ padding: '6px 10px', color: '#64748b', fontSize: 11, textAlign: 'center' }}>
                    {listLoadingMore ? 'Loading...' : `↑ ${listWindowOffset} more above`}
                  </div>
                )}
                {allSpells.map((spell) => {
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
                })}
                {listHasMoreBottom && (
                  <div style={{ padding: '6px 10px', color: '#64748b', fontSize: 11, textAlign: 'center' }}>
                    {listLoadingMore ? 'Loading...' : `↓ ${allSpellsTotal - listWindowOffset - allSpells.length} more below`}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
            Showing {allSpells.length ? listWindowOffset + 1 : 0}
            {allSpells.length ? `–${listWindowOffset + allSpells.length}` : ''} of {allSpellsTotal} (scroll to load more)
          </div>
        </div>

        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([
                ['base', 'Base'],
                ['targetsProcs', 'Targets/Procs'],
                ['effects', 'Effects'],
                ['items', 'Items'],
                ['flags', 'Flags'],
                ['icon', 'Icon'],
                ['visual', 'Visual'],
              ] as Array<[TabId, string]>).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setActiveTab(id);
                    setBatchMode(false);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #374151',
                    background: !batchMode && activeTab === id ? '#2563eb' : 'transparent',
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={exportSpellDbc}
                disabled={exportLoading}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#0ea5e9',
                  color: '#fff',
                  cursor: exportLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {exportLoading ? 'Exporting...' : 'Export Spell.dbc'}
              </button>
              <button
                onClick={exportVisualDbcs}
                disabled={visualExportLoading}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#0891b2',
                  color: '#fff',
                  cursor: visualExportLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {visualExportLoading ? 'Exporting...' : 'Export Visual DBCs'}
              </button>
              <button
                onClick={() => setBatchMode((v) => !v)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #9333ea',
                  background: batchMode ? '#9333ea' : 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Batch Edit
              </button>
            </div>
          </div>

          {saveStatus ? <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 10 }}>{saveStatus}</div> : null}

          {batchMode ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 4 }}>Spell IDs (comma or space separated)</div>
                <textarea
                  rows={3}
                  value={batchIds}
                  onChange={(e) => setBatchIds(e.target.value)}
                  placeholder="36298, 47241, 54817"
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb', boxSizing: 'border-box' }}
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
                      style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb', boxSizing: 'border-box' }}
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
          ) : !selected ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Select a spell from the list on the left or look one up by ID.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 6, border: '1px solid #374151', overflow: 'hidden', flexShrink: 0 }}>
                  {selectedThumb ? (
                    <img src={selectedThumb} alt={selected.name} style={{ width: '100%', height: '100%' }} />
                  ) : null}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>Spell ID: {selected.id}{lookup?.rank ? ` · ${lookup.rank}` : ''}</div>
                </div>
              </div>

              <div style={{ border: '1px solid #30363d', borderRadius: 6, padding: 10, fontSize: 13 }}>
                {lookupLoading ? (
                  <div style={{ color: '#94a3b8' }}>Loading spell mapping...</div>
                ) : lookupError ? (
                  <div style={{ color: '#fca5a5' }}>{lookupError}</div>
                ) : lookup ? (
                  <>
                    {(activeTab === 'icon' || activeTab === 'visual') && lookup.referenceTables ? (
                      <div style={{ borderTop: 'none', paddingTop: 0 }}>
                        <strong>Reference Tables (sdbeditor):</strong>
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

                    {activeTab === 'icon' ? (
                      <IconPickerPanel
                        spellIconId={editFields.SpellIconID}
                        activeIconId={editFields.ActiveIconID}
                        onPick={(field, id) => setField(field, String(id))}
                        onSave={saveSpell}
                        saveLoading={saveLoading}
                      />
                    ) : activeTab === 'visual' ? (
                      <VisualChainPanel
                        spellId={selected.id}
                        onStatus={setSaveStatus}
                        onChainSaved={() => loadSpellDetails(selected.id)}
                      />
                    ) : (
                    <>
                    <div style={{ display: 'grid', gridTemplateColumns: activeTab === 'effects' ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8, marginTop: 8, maxHeight: 380, overflowY: 'auto' }}>
                      {(TAB_FIELDS[activeTab] || []).map((field) => {
                        const miscHint = activeTab === 'effects' ? getEffectMiscHint(field, editFields) : null;
                        return (
                        <label key={field} style={{ fontSize: 12, gridColumn: TEXT_FIELDS.has(field) ? '1 / -1' : undefined }}>
                          <div style={{ marginBottom: 4 }}>
                            {field}
                            {miscHint ? <div style={{ color: '#facc15', fontWeight: 400, fontSize: 11, marginTop: 2 }}>{miscHint}</div> : null}
                          </div>
                          {TEXT_FIELDS.has(field) ? (
                            <textarea
                              value={String(editFields[field] ?? '')}
                              onChange={(e) => setField(field, e.target.value)}
                              rows={field === 'SpellToolTip' || field === 'SpellDescription' ? 4 : field === 'SpellName' ? 1 : 2}
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
                        );
                      })}
                    </div>

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
                    </div>
                    </>
                    )}
                  </>
                ) : (
                  <div style={{ color: '#fca5a5' }}>No mapping found or lookup failed.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Modified Spells ({modifiedHistory.length})</h3>
            {modifiedHistory.length > 0 && (
              <button
                onClick={() => setModifiedHistory([])}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #374151',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Clear
              </button>
            )}
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 0 }}>Session edit history — every spell you've saved, created, or batch-edited since opening this page.</p>
          {modifiedHistory.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>No spells modified yet this session.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8, maxHeight: 640, overflowY: 'auto' }}>
              {modifiedHistory.map((entry) => {
                const thumb = toThumbnailUrl(entry.icon);
                return (
                  <button
                    key={entry.spellId}
                    onClick={() => onPickResult({ id: entry.spellId, name: entry.name, icon: entry.icon }, { jump: true })}
                    style={{
                      textAlign: 'left',
                      border: '1px solid #30363d',
                      borderRadius: 6,
                      background: selected?.id === entry.spellId ? '#1d4ed8' : '#111827',
                      color: '#e5e7eb',
                      padding: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ width: 28, height: 28, borderRadius: 4, overflow: 'hidden', border: '1px solid #374151', flexShrink: 0 }}>
                        {thumb ? <img src={thumb} alt={entry.name} style={{ width: '100%', height: '100%' }} /> : null}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</div>
                        <div style={{ fontSize: 10, opacity: 0.75 }}>ID: {entry.spellId} · {entry.action}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
                      {entry.changedFields.slice(0, 6).join(', ')}
                      {entry.changedFields.length > 6 ? ` +${entry.changedFields.length - 6} more` : ''}
                    </div>
                    <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>{new Date(entry.timestamp).toLocaleTimeString()}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: 16, background: contentBoxColor, borderRadius: 8 }}>
          <div
            onClick={() => setTemplatePanelCollapsed((v) => !v)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          >
            <h3 style={{ margin: 0 }}>Create From Template</h3>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{templatePanelCollapsed ? '▸ Expand' : '▾ Collapse'}</span>
          </div>
          {!templatePanelCollapsed ? (
            !selected || !lookup ? (
              <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>Select a spell first to clone/copy it.</div>
            ) : (
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Cloning: <strong style={{ color: textColor }}>{lookup.name || selected.name}</strong> (ID {selected.id})</div>
                <label style={{ fontSize: 12 }}>
                  <div style={{ marginBottom: 4 }}>New Spell ID</div>
                  <input
                    type="number"
                    value={newSpellId}
                    onChange={(e) => setNewSpellId(e.target.value)}
                    placeholder="New spell ID"
                    style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb', boxSizing: 'border-box' }}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                      fontSize: 12,
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
                      fontSize: 12,
                    }}
                  >
                    {createLoading ? 'Creating...' : 'Create From Template'}
                  </button>
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
                      fontSize: 12,
                    }}
                  >
                    Copy Spell
                  </button>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
