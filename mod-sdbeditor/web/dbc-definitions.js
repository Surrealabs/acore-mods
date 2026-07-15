/**
 * DBC Definitions for WoW 3.3.5a (Build 12340)
 * 
 * Each definition describes the schema of a DBC file:
 *   - name: filename without extension
 *   - fields: array of { name, type, ref?, hidden?, array? }
 * 
 * Field types:
 *   uint32  - unsigned 32-bit integer
 *   int32   - signed 32-bit integer
 *   float   - 32-bit IEEE 754 float
 *   string  - uint32 offset into string block (resolved to string value)
 *   flags   - uint32 displayed as hex
 * 
 * 'ref' indicates a foreign-key lookup, e.g. ref: 'ChrClasses' means the
 * value is an ID in ChrClasses.dbc and should show its name.
 * 
 * Localized strings in 3.3.5a have 16 locale slots + 1 flags field = 17 uint32.
 * Use the locString() helper to expand them.
 */

const LOCALES = [
  'enUS', 'koKR', 'frFR', 'deDE', 'enCN', 'enTW', 'esES', 'esMX',
  'ruRU', 'jaJP', 'ptPT', 'itIT', 'Unk12', 'Unk13', 'Unk14', 'Unk15',
];

/**
 * Expand a localized string into 17 field definitions.
 * Only enUS is visible by default.
 */
function locString(name) {
  return LOCALES.map((loc, i) => ({
    name: i === 0 ? name : `${name}_${loc}`,
    type: 'string',
    hidden: i !== 0,
    locale: loc,
  })).concat([{
    name: `${name}_Flags`,
    type: 'uint32',
    hidden: true,
  }]);
}

/** Repeat a field definition N times as an indexed array */
function arrayField(baseName, type, count, extra = {}) {
  return Array.from({ length: count }, (_, i) => ({
    name: `${baseName}_${i + 1}`,
    type,
    ...extra,
  }));
}

// ─── DEFINITIONS ─────────────────────────────────────────────────────────

const definitions = {};

// ── Talent.dbc ──────────────────────────────────────────────────────────
definitions['Talent'] = {
  name: 'Talent',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'TabID', type: 'uint32', ref: 'TalentTab' },
    { name: 'TierID', type: 'uint32' },
    { name: 'ColumnIndex', type: 'uint32' },
    ...arrayField('SpellRank', 'uint32', 9),
    ...arrayField('PrereqTalent', 'uint32', 3),
    ...arrayField('PrereqRank', 'uint32', 3),
    { name: 'Flags', type: 'flags' },
    { name: 'RequiredSpellID', type: 'uint32' },
    ...arrayField('AllowForPetFlags', 'uint32', 2),
  ],
};

// ── TalentTab.dbc ───────────────────────────────────────────────────────
definitions['TalentTab'] = {
  name: 'TalentTab',
  fields: [
    { name: 'ID', type: 'uint32' },
    ...locString('Name'),
    { name: 'SpellIconID', type: 'uint32', ref: 'SpellIcon' },
    { name: 'RaceMask', type: 'flags' },
    { name: 'ClassMask', type: 'flags' },
    { name: 'PetTalentMask', type: 'uint32' },
    { name: 'OrderIndex', type: 'uint32' },
    { name: 'BackgroundFile', type: 'string' },
  ],
};

// ── CharStartOutfit.dbc ─────────────────────────────────────────────────
definitions['CharStartOutfit'] = {
  name: 'CharStartOutfit',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'RaceID', type: 'uint32', ref: 'ChrRaces' },
    { name: 'ClassID', type: 'uint32', ref: 'ChrClasses' },
    { name: 'SexID', type: 'uint32' },
    { name: 'OutfitID', type: 'uint32' },
    ...arrayField('ItemID', 'int32', 24),
    ...arrayField('DisplayItemID', 'int32', 24),
    ...arrayField('InventoryType', 'int32', 24),
  ],
};

// ── ChrClasses.dbc ──────────────────────────────────────────────────────
definitions['ChrClasses'] = {
  name: 'ChrClasses',
  fields: [
    { name: 'ClassID', type: 'uint32' },
    ...locString('Name'),
    ...locString('NameFemale'),
    ...locString('NameMale'),
    { name: 'Filename', type: 'string' },
    { name: 'SpellClassSet', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'CinematicSequenceID', type: 'uint32' },
    { name: 'Required_Expansion', type: 'uint32' },
  ],
};

// ── ChrRaces.dbc ────────────────────────────────────────────────────────
definitions['ChrRaces'] = {
  name: 'ChrRaces',
  fields: [
    { name: 'RaceID', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'FactionID', type: 'uint32', ref: 'Faction' },
    { name: 'ExplorationSoundID', type: 'uint32' },
    { name: 'MaleDisplayID', type: 'uint32' },
    { name: 'FemaleDisplayID', type: 'uint32' },
    { name: 'ClientPrefix', type: 'string' },
    { name: 'BaseLanguage', type: 'uint32' },
    { name: 'CreatureType', type: 'uint32' },
    { name: 'ResSicknessSpellID', type: 'uint32' },
    { name: 'SplashSoundID', type: 'uint32' },
    { name: 'ClientFileString', type: 'string' },
    { name: 'CinematicSequenceID', type: 'uint32' },
    { name: 'Alliance', type: 'uint32' },
    ...locString('Name'),
    ...locString('NameFemale'),
    ...locString('NameMale'),
    { name: 'FacialHairCustomization_1', type: 'string', hidden: true },
    { name: 'FacialHairCustomization_2', type: 'string', hidden: true },
    { name: 'HairCustomization', type: 'string', hidden: true },
    { name: 'Required_Expansion', type: 'uint32' },
  ],
};

// ── SkillLine.dbc ───────────────────────────────────────────────────────
definitions['SkillLine'] = {
  name: 'SkillLine',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'CategoryID', type: 'int32' },
    { name: 'SkillCostsID', type: 'uint32' },
    ...locString('DisplayName'),
    ...locString('Description'),
    { name: 'SpellIconID', type: 'uint32', ref: 'SpellIcon' },
    ...locString('AlternateVerb'),
    { name: 'CanLink', type: 'uint32' },
  ],
};

// ── SkillLineAbility.dbc ────────────────────────────────────────────────
definitions['SkillLineAbility'] = {
  name: 'SkillLineAbility',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'SkillLine', type: 'uint32', ref: 'SkillLine' },
    { name: 'SpellID', type: 'uint32' },
    { name: 'RaceMask', type: 'flags' },
    { name: 'ClassMask', type: 'flags' },
    { name: 'RaceMaskNot', type: 'flags' },
    { name: 'ClassMaskNot', type: 'flags' },
    { name: 'MinSkillLineRank', type: 'uint32' },
    { name: 'SupercededBySpell', type: 'uint32' },
    { name: 'AcquireMethod', type: 'uint32' },
    { name: 'TrivialSkillLineRankHigh', type: 'uint32' },
    { name: 'TrivialSkillLineRankLow', type: 'uint32' },
    ...arrayField('CharacterPoints', 'uint32', 2),
  ],
};

// ── SpellIcon.dbc ───────────────────────────────────────────────────────
definitions['SpellIcon'] = {
  name: 'SpellIcon',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'IconPath', type: 'string' },
  ],
};

// ── Spell.dbc (simplified – only key fields named) ──────────────────────
// Full Spell.dbc has 234 fields; we name the commonly edited ones.
definitions['Spell'] = {
  name: 'Spell',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Category', type: 'uint32' },
    { name: 'DispelType', type: 'uint32' },
    { name: 'Mechanic', type: 'uint32' },
    { name: 'Attributes', type: 'flags' },
    { name: 'AttributesEx', type: 'flags' },
    { name: 'AttributesEx2', type: 'flags' },
    { name: 'AttributesEx3', type: 'flags' },
    { name: 'AttributesEx4', type: 'flags' },
    { name: 'AttributesEx5', type: 'flags' },
    { name: 'AttributesEx6', type: 'flags' },
    { name: 'AttributesEx7', type: 'flags' },
    { name: 'Stances', type: 'flags' },
    { name: 'Stances_2', type: 'flags', hidden: true },
    { name: 'StancesNot', type: 'flags' },
    { name: 'StancesNot_2', type: 'flags', hidden: true },
    { name: 'Targets', type: 'flags' },
    { name: 'TargetCreatureType', type: 'flags' },
    { name: 'RequiresSpellFocus', type: 'uint32' },
    { name: 'FacingCasterFlags', type: 'uint32' },
    { name: 'CasterAuraState', type: 'uint32' },
    { name: 'TargetAuraState', type: 'uint32' },
    { name: 'CasterAuraStateNot', type: 'uint32' },
    { name: 'TargetAuraStateNot', type: 'uint32' },
    { name: 'CasterAuraSpell', type: 'uint32' },
    { name: 'TargetAuraSpell', type: 'uint32' },
    { name: 'ExcludeCasterAuraSpell', type: 'uint32' },
    { name: 'ExcludeTargetAuraSpell', type: 'uint32' },
    { name: 'CastingTimeIndex', type: 'uint32' },
    { name: 'RecoveryTime', type: 'uint32' },
    { name: 'CategoryRecoveryTime', type: 'uint32' },
    { name: 'InterruptFlags', type: 'flags' },
    { name: 'AuraInterruptFlags', type: 'flags' },
    { name: 'ChannelInterruptFlags', type: 'flags' },
    { name: 'ProcFlags', type: 'flags' },
    { name: 'ProcChance', type: 'uint32' },
    { name: 'ProcCharges', type: 'uint32' },
    { name: 'MaxLevel', type: 'uint32' },
    { name: 'BaseLevel', type: 'uint32' },
    { name: 'SpellLevel', type: 'uint32' },
    { name: 'DurationIndex', type: 'uint32' },
    { name: 'PowerType', type: 'int32' },
    { name: 'ManaCost', type: 'uint32' },
    { name: 'ManaCostPerLevel', type: 'uint32' },
    { name: 'ManaPerSecond', type: 'uint32' },
    { name: 'ManaPerSecondPerLevel', type: 'uint32' },
    { name: 'RangeIndex', type: 'uint32' },
    { name: 'Speed', type: 'float' },
    { name: 'ModalNextSpell', type: 'uint32' },
    { name: 'StackAmount', type: 'uint32' },
    ...arrayField('Totem', 'uint32', 2),
    ...arrayField('Reagent', 'int32', 8),
    ...arrayField('ReagentCount', 'int32', 8),
    { name: 'EquippedItemClass', type: 'int32' },
    { name: 'EquippedItemSubClassMask', type: 'int32' },
    { name: 'EquippedItemInventoryTypeMask', type: 'int32' },
    ...arrayField('Effect', 'uint32', 3),
    ...arrayField('EffectDieSides', 'int32', 3),
    { name: 'EffectRealPointsPerLevel_1', type: 'float' },
    { name: 'EffectRealPointsPerLevel_2', type: 'float' },
    { name: 'EffectRealPointsPerLevel_3', type: 'float' },
    ...arrayField('EffectBasePoints', 'int32', 3),
    ...arrayField('EffectMechanic', 'uint32', 3),
    ...arrayField('EffectImplicitTargetA', 'uint32', 3),
    ...arrayField('EffectImplicitTargetB', 'uint32', 3),
    ...arrayField('EffectRadiusIndex', 'uint32', 3),
    ...arrayField('EffectApplyAuraName', 'uint32', 3),
    ...arrayField('EffectAmplitude', 'uint32', 3),
    { name: 'EffectMultipleValue_1', type: 'float' },
    { name: 'EffectMultipleValue_2', type: 'float' },
    { name: 'EffectMultipleValue_3', type: 'float' },
    ...arrayField('EffectChainTarget', 'uint32', 3),
    ...arrayField('EffectItemType', 'uint32', 3),
    ...arrayField('EffectMiscValue', 'int32', 3),
    ...arrayField('EffectMiscValueB', 'int32', 3),
    ...arrayField('EffectTriggerSpell', 'uint32', 3),
    { name: 'EffectPointsPerComboPoint_1', type: 'float' },
    { name: 'EffectPointsPerComboPoint_2', type: 'float' },
    { name: 'EffectPointsPerComboPoint_3', type: 'float' },
    ...arrayField('EffectSpellClassMaskA', 'flags', 3),
    ...arrayField('EffectSpellClassMaskB', 'flags', 3),
    ...arrayField('EffectSpellClassMaskC', 'flags', 3),
    ...arrayField('SpellVisual', 'uint32', 2),
    { name: 'SpellIconID', type: 'uint32', ref: 'SpellIcon' },
    { name: 'ActiveIconID', type: 'uint32', ref: 'SpellIcon' },
    { name: 'SpellPriority', type: 'uint32' },
    ...locString('SpellName'),
    ...locString('Rank'),
    ...locString('Description'),
    ...locString('ToolTip'),
    { name: 'ManaCostPercentage', type: 'uint32' },
    { name: 'StartRecoveryCategory', type: 'uint32' },
    { name: 'StartRecoveryTime', type: 'uint32' },
    { name: 'MaxTargetLevel', type: 'uint32' },
    { name: 'SpellFamilyName', type: 'uint32' },
    { name: 'SpellFamilyFlags_1', type: 'flags' },
    { name: 'SpellFamilyFlags_2', type: 'flags' },
    { name: 'SpellFamilyFlags_3', type: 'flags' },
    { name: 'MaxAffectedTargets', type: 'uint32' },
    { name: 'DmgClass', type: 'uint32' },
    { name: 'PreventionType', type: 'uint32' },
    { name: 'StanceBarOrder', type: 'int32' },
    { name: 'DmgMultiplier_1', type: 'float' },
    { name: 'DmgMultiplier_2', type: 'float' },
    { name: 'DmgMultiplier_3', type: 'float' },
    { name: 'MinFactionID', type: 'uint32' },
    { name: 'MinReputation', type: 'uint32' },
    { name: 'RequiredAuraVision', type: 'uint32' },
    ...arrayField('TotemCategory', 'uint32', 2),
    { name: 'AreaGroupID', type: 'int32' },
    { name: 'SchoolMask', type: 'uint32' },
    { name: 'RuneCostID', type: 'uint32' },
    { name: 'SpellMissileID', type: 'uint32' },
    { name: 'PowerDisplayID', type: 'int32' },
    { name: 'EffectBonusMultiplier_1', type: 'float' },
    { name: 'EffectBonusMultiplier_2', type: 'float' },
    { name: 'EffectBonusMultiplier_3', type: 'float' },
    { name: 'SpellDescriptionVariableID', type: 'uint32' },
    { name: 'SpellDifficultyID', type: 'uint32' },
  ],
};

// ── Map.dbc ─────────────────────────────────────────────────────────────
definitions['Map'] = {
  name: 'Map',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Directory', type: 'string' },
    { name: 'InstanceType', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'PVP', type: 'uint32' },
    ...locString('MapName'),
    { name: 'AreaTableID', type: 'uint32' },
    ...locString('MapDescription0'),
    ...locString('MapDescription1'),
    { name: 'LoadingScreenID', type: 'uint32' },
    { name: 'MinimapIconScale', type: 'float' },
    { name: 'CorpseMapID', type: 'int32' },
    { name: 'CorpseEntranceX', type: 'float' },
    { name: 'CorpseEntranceY', type: 'float' },
    { name: 'TimeOfDayOverride', type: 'int32' },
    { name: 'ExpansionID', type: 'uint32' },
    { name: 'RaidOffset', type: 'uint32' },
    { name: 'MaxPlayers', type: 'uint32' },
  ],
};

// ── Faction.dbc ─────────────────────────────────────────────────────────
definitions['Faction'] = {
  name: 'Faction',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'ReputationIndex', type: 'int32' },
    ...arrayField('ReputationRaceMask', 'flags', 4),
    ...arrayField('ReputationClassMask', 'flags', 4),
    ...arrayField('ReputationBase', 'int32', 4),
    ...arrayField('ReputationFlags', 'flags', 4),
    { name: 'ParentFactionID', type: 'uint32' },
    { name: 'ParentFactionMod_1', type: 'float' },
    { name: 'ParentFactionMod_2', type: 'float' },
    { name: 'ParentFactionCap_1', type: 'uint32' },
    { name: 'ParentFactionCap_2', type: 'uint32' },
    ...locString('Name'),
    ...locString('Description'),
  ],
};

// ── AreaTable.dbc ───────────────────────────────────────────────────────
definitions['AreaTable'] = {
  name: 'AreaTable',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'ContinentID', type: 'uint32' },
    { name: 'ParentAreaID', type: 'uint32' },
    { name: 'AreaBit', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'SoundProviderPreference', type: 'uint32' },
    { name: 'SoundProviderPreferenceUnderwater', type: 'uint32' },
    { name: 'AmbienceID', type: 'uint32' },
    { name: 'ZoneMusic', type: 'uint32' },
    { name: 'IntroMusic', type: 'uint32' },
    { name: 'ExplorationLevel', type: 'uint32' },
    ...locString('AreaName'),
    { name: 'FactionGroupMask', type: 'uint32' },
    ...arrayField('LiquidType', 'uint32', 4),
    { name: 'MinElevation', type: 'float' },
    { name: 'AmbientMultiplier', type: 'float' },
    { name: 'LightID', type: 'uint32' },
  ],
};

// ── Achievement.dbc ─────────────────────────────────────────────────────
definitions['Achievement'] = {
  name: 'Achievement',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Faction', type: 'int32' },
    { name: 'MapID', type: 'int32' },
    { name: 'Supercedes', type: 'uint32' },
    ...locString('Title'),
    ...locString('Description'),
    { name: 'Category', type: 'uint32' },
    { name: 'Points', type: 'uint32' },
    { name: 'OrderInCategory', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'SpellIconID', type: 'uint32', ref: 'SpellIcon' },
    ...locString('Reward'),
    { name: 'MinimumCriteria', type: 'uint32' },
    { name: 'SharesCriteria', type: 'uint32' },
  ],
};

// ── CharTitles.dbc ──────────────────────────────────────────────────────
definitions['CharTitles'] = {
  name: 'CharTitles',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Condition_ID', type: 'uint32' },
    ...locString('Name'),
    ...locString('Name1'),
    { name: 'MaskID', type: 'uint32' },
  ],
};

// ── SpellItemEnchantment.dbc ────────────────────────────────────────────
definitions['SpellItemEnchantment'] = {
  name: 'SpellItemEnchantment',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Charges', type: 'uint32' },
    ...arrayField('Effect', 'uint32', 3),
    ...arrayField('EffectPointsMin', 'uint32', 3),
    ...arrayField('EffectPointsMax', 'uint32', 3),
    ...arrayField('EffectArg', 'uint32', 3),
    ...locString('Name'),
    { name: 'ItemVisual', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'Src_ItemID', type: 'uint32' },
    { name: 'Condition_Id', type: 'uint32' },
    { name: 'RequiredSkillID', type: 'uint32' },
    { name: 'RequiredSkillRank', type: 'uint32' },
    { name: 'MinLevel', type: 'uint32' },
  ],
};

// ── Item.dbc ────────────────────────────────────────────────────────────
definitions['Item'] = {
  name: 'Item',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'ClassID', type: 'uint32' },
    { name: 'SubclassID', type: 'uint32' },
    { name: 'SoundOverrideSubclassID', type: 'int32' },
    { name: 'Material', type: 'int32' },
    { name: 'DisplayInfoID', type: 'uint32' },
    { name: 'InventoryType', type: 'uint32' },
    { name: 'SheatheType', type: 'uint32' },
  ],
};

// ── ItemSet.dbc ─────────────────────────────────────────────────────────
definitions['ItemSet'] = {
  name: 'ItemSet',
  fields: [
    { name: 'ID', type: 'uint32' },
    ...locString('Name'),
    ...arrayField('ItemID', 'uint32', 17),
    ...arrayField('SetSpellID', 'uint32', 8),
    ...arrayField('SetThreshold', 'uint32', 8),
    { name: 'RequiredSkillID', type: 'uint32' },
    { name: 'RequiredSkillRank', type: 'uint32' },
  ],
};

// ── SpellCastTimes.dbc ──────────────────────────────────────────────────
definitions['SpellCastTimes'] = {
  name: 'SpellCastTimes',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Base', type: 'int32' },
    { name: 'PerLevel', type: 'int32' },
    { name: 'Minimum', type: 'int32' },
  ],
};

// ── SpellDuration.dbc ───────────────────────────────────────────────────
definitions['SpellDuration'] = {
  name: 'SpellDuration',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Duration', type: 'int32' },
    { name: 'DurationPerLevel', type: 'uint32' },
    { name: 'MaxDuration', type: 'int32' },
  ],
};

// ── SpellRange.dbc ──────────────────────────────────────────────────────
definitions['SpellRange'] = {
  name: 'SpellRange',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'RangeMin_1', type: 'float' },
    { name: 'RangeMin_2', type: 'float' },
    { name: 'RangeMax_1', type: 'float' },
    { name: 'RangeMax_2', type: 'float' },
    { name: 'Flags', type: 'uint32' },
    ...locString('DisplayName'),
    ...locString('DisplayNameShort'),
  ],
};

// ── SpellRadius.dbc ─────────────────────────────────────────────────────
definitions['SpellRadius'] = {
  name: 'SpellRadius',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Radius', type: 'float' },
    { name: 'RadiusPerLevel', type: 'float' },
    { name: 'RadiusMax', type: 'float' },
  ],
};

// ── CreatureFamily.dbc ──────────────────────────────────────────────────
definitions['CreatureFamily'] = {
  name: 'CreatureFamily',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'MinScale', type: 'float' },
    { name: 'MinScaleLevel', type: 'uint32' },
    { name: 'MaxScale', type: 'float' },
    { name: 'MaxScaleLevel', type: 'uint32' },
    ...arrayField('SkillLine', 'uint32', 2),
    { name: 'PetFoodMask', type: 'uint32' },
    { name: 'PetTalentType', type: 'int32' },
    { name: 'CategoryEnumID', type: 'int32' },
    ...locString('Name'),
    { name: 'IconFile', type: 'string' },
  ],
};

// ── TotemCategory.dbc ───────────────────────────────────────────────────
definitions['TotemCategory'] = {
  name: 'TotemCategory',
  fields: [
    { name: 'ID', type: 'uint32' },
    ...locString('Name'),
    { name: 'TotemCategoryType', type: 'uint32' },
    { name: 'TotemCategoryMask', type: 'flags' },
  ],
};

// ── GemProperties.dbc ───────────────────────────────────────────────────
definitions['GemProperties'] = {
  name: 'GemProperties',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'EnchantID', type: 'uint32', ref: 'SpellItemEnchantment' },
    { name: 'MaxCountInv', type: 'uint32' },
    { name: 'MaxCountItem', type: 'uint32' },
    { name: 'Type', type: 'uint32' },
  ],
};

// ── GlyphProperties.dbc ────────────────────────────────────────────────
definitions['GlyphProperties'] = {
  name: 'GlyphProperties',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'SpellID', type: 'uint32' },
    { name: 'TypeFlags', type: 'uint32' },
    { name: 'SpellIconID', type: 'uint32', ref: 'SpellIcon' },
  ],
};

// ── BattlemasterList.dbc ────────────────────────────────────────────────
definitions['BattlemasterList'] = {
  name: 'BattlemasterList',
  fields: [
    { name: 'ID', type: 'uint32' },
    ...arrayField('MapID', 'int32', 8),
    { name: 'InstanceType', type: 'uint32' },
    { name: 'GroupsAllowed', type: 'uint32' },
    ...locString('Name'),
    { name: 'MaxGroupSize', type: 'uint32' },
    { name: 'HolidayWorldState', type: 'uint32' },
    { name: 'MinLevel', type: 'uint32' },
    { name: 'MaxLevel', type: 'uint32' },
  ],
};

// ── MapDifficulty.dbc ───────────────────────────────────────────────────
definitions['MapDifficulty'] = {
  name: 'MapDifficulty',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'MapID', type: 'uint32', ref: 'Map' },
    { name: 'Difficulty', type: 'uint32' },
    ...locString('Message'),
    { name: 'RaidDuration', type: 'uint32' },
    { name: 'MaxPlayers', type: 'uint32' },
    { name: 'Difficultystring', type: 'string' },
  ],
};

// ── FactionTemplate.dbc ─────────────────────────────────────────────────
definitions['FactionTemplate'] = {
  name: 'FactionTemplate',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'Faction', type: 'uint32', ref: 'Faction' },
    { name: 'Flags', type: 'flags' },
    { name: 'FactionGroup', type: 'flags' },
    { name: 'FriendGroup', type: 'flags' },
    { name: 'EnemyGroup', type: 'flags' },
    ...arrayField('Enemies', 'uint32', 4),
    ...arrayField('Friends', 'uint32', 4),
  ],
};

// ── SpellShapeshiftForm.dbc ─────────────────────────────────────────────
definitions['SpellShapeshiftForm'] = {
  name: 'SpellShapeshiftForm',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'BonusActionBar', type: 'uint32' },
    ...locString('Name'),
    { name: 'Flags', type: 'flags' },
    { name: 'CreatureType', type: 'uint32' },
    { name: 'AttackIconID', type: 'uint32' },
    { name: 'CombatRoundTime', type: 'uint32' },
    ...arrayField('CreatureDisplayID', 'uint32', 4),
    ...arrayField('PresetSpellID', 'uint32', 8),
  ],
};

// ── Emotes.dbc ──────────────────────────────────────────────────────────
definitions['Emotes'] = {
  name: 'Emotes',
  fields: [
    { name: 'ID', type: 'uint32' },
    { name: 'EmoteSlashCommand', type: 'string' },
    { name: 'AnimID', type: 'uint32' },
    { name: 'EmoteFlags', type: 'flags' },
    { name: 'EmoteSpecProc', type: 'uint32' },
    { name: 'EmoteSpecProcParam', type: 'uint32' },
    { name: 'EventSoundID', type: 'uint32' },
  ],
};

// ── LFGDungeons.dbc ─────────────────────────────────────────────────────
definitions['LFGDungeons'] = {
  name: 'LFGDungeons',
  fields: [
    { name: 'ID', type: 'uint32' },
    ...locString('Name'),
    { name: 'MinLevel', type: 'uint32' },
    { name: 'MaxLevel', type: 'uint32' },
    { name: 'TargetLevel', type: 'uint32' },
    { name: 'TargetLevelMin', type: 'uint32' },
    { name: 'TargetLevelMax', type: 'uint32' },
    { name: 'MapID', type: 'int32', ref: 'Map' },
    { name: 'Difficulty', type: 'uint32' },
    { name: 'Flags', type: 'flags' },
    { name: 'TypeID', type: 'uint32' },
    { name: 'Faction', type: 'int32' },
    { name: 'TextureFilename', type: 'string' },
    { name: 'ExpansionLevel', type: 'uint32' },
    { name: 'Order_Index', type: 'uint32' },
    { name: 'GroupID', type: 'uint32' },
    ...locString('Description'),
  ],
};

// ─── Name lookup configuration ─────────────────────────────────────────
// Maps ref names to { file, nameField } for building lookup tables
const LOOKUP_SOURCES = {
  ChrClasses: { file: 'ChrClasses.dbc', nameFieldIndex: 1 },   // Name_enUS
  ChrRaces:   { file: 'ChrRaces.dbc',   nameFieldIndex: 14 },  // Name_enUS  
  TalentTab:  { file: 'TalentTab.dbc',  nameFieldIndex: 1 },   // Name_enUS
  SpellIcon:  { file: 'SpellIcon.dbc',  nameFieldIndex: 1 },   // IconPath
  Faction:    { file: 'Faction.dbc',    nameFieldIndex: 23 },  // Name_enUS
  Map:        { file: 'Map.dbc',        nameFieldIndex: 5 },   // MapName_enUS
  SkillLine:  { file: 'SkillLine.dbc',  nameFieldIndex: 3 },   // DisplayName_enUS
  SpellItemEnchantment: { file: 'SpellItemEnchantment.dbc', nameFieldIndex: 14 }, // Name_enUS
};

export { definitions, LOOKUP_SOURCES, locString, arrayField };
