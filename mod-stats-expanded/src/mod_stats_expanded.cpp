#include "Common.h"
#include "Utilities/DataMap.h"
#include "ScriptMgr.h"
#include "Player.h"
#include "SharedDefines.h"
#include "Multistrike.h"
#include "Versatility.h"
#include "CritDamage.h"
#include "StatsExpandedScaling.h"
#include "StatsExpandedData.h"
#include "ScriptDefines/UnitScript.h"
#include "Unit.h"
#include "SpellInfo.h"
#include "SpellAuras.h"
#include "SpellAuraEffects.h"
#include <cmath>

namespace
{
    constexpr uint32 SPELL_DK_FROST_PRESENCE = 48263;
    constexpr uint32 SPELL_PAL_RIGHTEOUS_FURY = 25780;
    constexpr int32 TANK_PASSIVE_RATING_PER_PERCENT = 10;
    constexpr int32 TANK_PASSIVE_PARRY_CAP_PERCENT = 20;
    constexpr int32 TANK_PASSIVE_DODGE_CAP_PERCENT = 20;
    constexpr int32 TANK_PASSIVE_PARRY_CAP_RATING = TANK_PASSIVE_PARRY_CAP_PERCENT * TANK_PASSIVE_RATING_PER_PERCENT;
    constexpr int32 TANK_PASSIVE_DODGE_CAP_RATING = TANK_PASSIVE_DODGE_CAP_PERCENT * TANK_PASSIVE_RATING_PER_PERCENT;
    constexpr float HASTE_CRIT_BASELINE_RATING_PER_PERCENT = 10.0f;

    int32 GetScaledRatingFromDb(Player* player, const char* statName, int32 rawRating)
    {
        if (!player || rawRating <= 0)
            return 0;

        if (!StatsExpandedScaling::IsStatEnabled(statName))
            return 0;

        float ratingPerPercent = StatsExpandedScaling::GetBaseRequirement(statName);
        if (ratingPerPercent <= 0.0f)
            return rawRating;

        float factor = HASTE_CRIT_BASELINE_RATING_PER_PERCENT / ratingPerPercent;
        return std::max(0, int32(std::lround(float(rawRating) * factor)));
    }

    bool IsTankPassiveActive(Player* player)
    {
        if (!player)
            return false;

        switch (player->getClass())
        {
            case CLASS_DEATH_KNIGHT:
                return player->HasAura(SPELL_DK_FROST_PRESENCE);
            case CLASS_DRUID:
            {
                ShapeshiftForm form = player->GetShapeshiftForm();
                return form == FORM_BEAR || form == FORM_DIREBEAR;
            }
            case CLASS_PALADIN:
                return player->HasAura(SPELL_PAL_RIGHTEOUS_FURY);
            case CLASS_WARRIOR:
                return player->GetShapeshiftForm() == FORM_DEFENSIVESTANCE;
            default:
                return false;
        }
    }
}

// ============================================================================
// mod-stats-expanded — Secondary Stat System
//
// Remaps old combat ratings to new stats per SwappedStats.md:
//   CR 1 (Defense Rating)  -> Haste          10 rating = 1% @LvlMax
//   CR 2 (Dodge Rating)    -> Crit           10 rating = 1% crit + 2% crit dmg
//   CR 3 (Parry Rating)    -> Mastery        10 rating = % (class-specific)
//   CR 4 (Block Rating)    -> Multistrike    10 rating = 1% recast at 33%
//   CR 5 (Hit Melee)       -> Versatility    10 rating = +1% dmg/heal, -0.5% taken
// ============================================================================

// Free function so it can be called from both PlayerScript and UnitScript hooks
static void UpdateDerivedStats(Player* player)
{
        if (!player)
            return;

        if (BoolData* guard = player->CustomData.Get<BoolData>("StatsExpanded_RecalcGuard"))
        {
            if (guard->value)
                return;
        }

        player->CustomData.Set("StatsExpanded_RecalcGuard", new BoolData(true));

        // -------------------------------------------------------
        // 0. Remove previously applied base stat bonuses
        // -------------------------------------------------------

        // INT -> Spell Damage (remove old)
        DataMap::Base* oldSpDmgData = player->CustomData.GetDefault<DataMap::Base>("SpellDmg_Applied");
        if (oldSpDmgData)
        {
            int32 v = (int32)static_cast<FloatData*>(oldSpDmgData)->value;
            if (v > 0)
                player->ApplySpellDamageBonus(v, false);
        }

        // SPI -> Spell Healing (remove old)
        DataMap::Base* oldSpHealData = player->CustomData.GetDefault<DataMap::Base>("SpellHeal_Applied");
        if (oldSpHealData)
        {
            int32 v = (int32)static_cast<FloatData*>(oldSpHealData)->value;
            if (v > 0)
                player->ApplySpellHealingBonus(v, false);
        }

        // -------------------------------------------------------
        // 1. Remove previously applied rating transfers
        // -------------------------------------------------------

        // Haste (Defense -> Haste)
        DataMap::Base* oldHasteData = player->CustomData.GetDefault<DataMap::Base>("Haste_Applied");
        if (oldHasteData)
        {
            FloatData* d = static_cast<FloatData*>(oldHasteData);
            int32 v = (int32)d->value;
            if (v > 0)
            {
                player->ApplyRatingMod(CR_HASTE_MELEE,  v, false);
                player->ApplyRatingMod(CR_HASTE_RANGED, v, false);
                player->ApplyRatingMod(CR_HASTE_SPELL,  v, false);
            }
        }

        // Crit (Dodge -> Crit)
        DataMap::Base* oldCritData = player->CustomData.GetDefault<DataMap::Base>("Crit_Applied");
        if (oldCritData)
        {
            FloatData* d = static_cast<FloatData*>(oldCritData);
            int32 v = (int32)d->value;
            if (v > 0)
            {
                player->ApplyRatingMod(CR_CRIT_MELEE,  v, false);
                player->ApplyRatingMod(CR_CRIT_RANGED, v, false);
                player->ApplyRatingMod(CR_CRIT_SPELL,  v, false);
            }
        }

        // Remove previously applied swap neutralization (old native effects)
        DataMap::Base* oldNeutralDefense = player->CustomData.GetDefault<DataMap::Base>("SwapNeutralize_Defense_Applied");
        if (oldNeutralDefense)
        {
            int32 v = (int32)static_cast<FloatData*>(oldNeutralDefense)->value;
            if (v > 0)
                player->ApplyRatingMod(CR_DEFENSE_SKILL, v, true);
        }

        DataMap::Base* oldNeutralDodge = player->CustomData.GetDefault<DataMap::Base>("SwapNeutralize_Dodge_Applied");
        if (oldNeutralDodge)
        {
            int32 v = (int32)static_cast<FloatData*>(oldNeutralDodge)->value;
            if (v > 0)
                player->ApplyRatingMod(CR_DODGE, v, true);
        }

        DataMap::Base* oldNeutralParry = player->CustomData.GetDefault<DataMap::Base>("SwapNeutralize_Parry_Applied");
        if (oldNeutralParry)
        {
            int32 v = (int32)static_cast<FloatData*>(oldNeutralParry)->value;
            if (v > 0)
                player->ApplyRatingMod(CR_PARRY, v, true);
        }

        DataMap::Base* oldNeutralBlock = player->CustomData.GetDefault<DataMap::Base>("SwapNeutralize_Block_Applied");
        if (oldNeutralBlock)
        {
            int32 v = (int32)static_cast<FloatData*>(oldNeutralBlock)->value;
            if (v > 0)
                player->ApplyRatingMod(CR_BLOCK, v, true);
        }

        // Tank passive (remove old): Crit -> Parry, Multistrike -> Dodge
        DataMap::Base* oldTankParryData = player->CustomData.GetDefault<DataMap::Base>("TankPassive_Parry_Applied");
        if (oldTankParryData)
        {
            FloatData* d = static_cast<FloatData*>(oldTankParryData);
            int32 v = (int32)d->value;
            if (v > 0)
                player->ApplyRatingMod(CR_PARRY, v, false);
        }

        DataMap::Base* oldTankDodgeData = player->CustomData.GetDefault<DataMap::Base>("TankPassive_Dodge_Applied");
        if (oldTankDodgeData)
        {
            FloatData* d = static_cast<FloatData*>(oldTankDodgeData);
            int32 v = (int32)d->value;
            if (v > 0)
                player->ApplyRatingMod(CR_DODGE, v, false);
        }

        // -------------------------------------------------------
        // 2. Read raw ratings from the swapped CR slots
        // -------------------------------------------------------

        // SwappedStats.md mapping:
        // CR 1 (Defense) -> Haste    | CR 2 (Dodge) -> Crit
        // CR 3 (Parry)   -> Mastery  | CR 4 (Block) -> Multistrike
        // CR 5 (Hit Melee) -> Versatility

        int32 hasteRaw       = (int32)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_DEFENSE_SKILL));
        int32 critRaw        = (int32)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_DODGE));
        int32 masteryRaw     = (int32)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_PARRY));
        int32 multistrikeRaw = (int32)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_BLOCK));
        int32 versatilityRaw = (int32)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_HIT_MELEE));

        // -------------------------------------------------------
        // 3. Apply rating transfers for stats the core handles
        //    natively (haste and crit). We pipe the raw rating
        //    from the swapped slot into the native rating slots
        //    so the engine applies attack/cast speed and crit%.
        // -------------------------------------------------------

        int32 hasteScaled = GetScaledRatingFromDb(player, "HASTE_RATING", hasteRaw);
        int32 critScaled = GetScaledRatingFromDb(player, "CRIT_RATING", critRaw);

        // Haste: pipe Defense rating into native haste slots (DB-scaled)
        player->ApplyRatingMod(CR_HASTE_MELEE,  hasteScaled, true);
        player->ApplyRatingMod(CR_HASTE_RANGED, hasteScaled, true);
        player->ApplyRatingMod(CR_HASTE_SPELL,  hasteScaled, true);
        player->CustomData.Set("Haste_Applied", new FloatData((float)hasteScaled));

        // Crit chance: pipe Dodge rating into native crit slots (DB-scaled)
        player->ApplyRatingMod(CR_CRIT_MELEE,  critScaled, true);
        player->ApplyRatingMod(CR_CRIT_RANGED, critScaled, true);
        player->ApplyRatingMod(CR_CRIT_SPELL,  critScaled, true);
        player->CustomData.Set("Crit_Applied", new FloatData((float)critScaled));

        // -------------------------------------------------------
        // 4. Store all new-stat raw values for custom handlers
        //    (Multistrike, Versatility, Mastery are fully custom —
        //     their effects are applied in UnitScript hooks below)
        // -------------------------------------------------------

        player->CustomData.Set("Haste",       new FloatData((float)hasteRaw));
        player->CustomData.Set("Crit",        new FloatData((float)critRaw));
        player->CustomData.Set("Mastery",     new FloatData((float)masteryRaw));
        player->CustomData.Set("Multistrike", new FloatData((float)multistrikeRaw));
        player->CustomData.Set("Versatility", new FloatData((float)versatilityRaw));

        // -------------------------------------------------------
        // 4a. Neutralize old native effects from swapped CR slots
        //     so remapped stats do not also grant legacy bonuses.
        // -------------------------------------------------------
        if (hasteRaw > 0)
            player->ApplyRatingMod(CR_DEFENSE_SKILL, hasteRaw, false);
        if (critRaw > 0)
            player->ApplyRatingMod(CR_DODGE, critRaw, false);
        if (masteryRaw > 0)
            player->ApplyRatingMod(CR_PARRY, masteryRaw, false);
        if (multistrikeRaw > 0)
            player->ApplyRatingMod(CR_BLOCK, multistrikeRaw, false);

        // Safety scrub: after neutralization these remapped legacy slots should not carry residual rating.
        // Clearing residuals prevents accumulation drift from event-order edge cases.
        int32 residualDodge = int32(player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_DODGE)));
        if (residualDodge > 0)
            player->ApplyRatingMod(CR_DODGE, residualDodge, false);

        int32 residualParry = int32(player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_PARRY)));
        if (residualParry > 0)
            player->ApplyRatingMod(CR_PARRY, residualParry, false);

        int32 residualDefense = int32(player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_DEFENSE_SKILL)));
        if (residualDefense > 0)
            player->ApplyRatingMod(CR_DEFENSE_SKILL, residualDefense, false);

        player->CustomData.Set("SwapNeutralize_Defense_Applied", new FloatData((float)std::max(0, hasteRaw)));
        player->CustomData.Set("SwapNeutralize_Dodge_Applied", new FloatData((float)std::max(0, critRaw)));
        player->CustomData.Set("SwapNeutralize_Parry_Applied", new FloatData((float)std::max(0, masteryRaw)));
        player->CustomData.Set("SwapNeutralize_Block_Applied", new FloatData((float)std::max(0, multistrikeRaw)));

        // -------------------------------------------------------
        // 4b. Tank passive (stance/form gated):
        //     Crit rating -> Parry rating
        //     Multistrike rating -> Dodge rating
        //     Active only for DK/Druid/Paladin/Warrior in tank state
        // -------------------------------------------------------

        int32 tankParryBonus = 0;
        int32 tankDodgeBonus = 0;
        if (IsTankPassiveActive(player))
        {
            tankParryBonus = std::min(critRaw, TANK_PASSIVE_PARRY_CAP_RATING);
            tankDodgeBonus = std::min(multistrikeRaw, TANK_PASSIVE_DODGE_CAP_RATING);

            if (tankParryBonus > 0)
                player->ApplyRatingMod(CR_PARRY, tankParryBonus, true);

            if (tankDodgeBonus > 0)
                player->ApplyRatingMod(CR_DODGE, tankDodgeBonus, true);
        }

        player->CustomData.Set("TankPassive_Parry_Applied", new FloatData((float)std::max(0, tankParryBonus)));
        player->CustomData.Set("TankPassive_Dodge_Applied", new FloatData((float)std::max(0, tankDodgeBonus)));

        // -------------------------------------------------------
        // 5. Apply base stat conversions per SwappedStats.md
        //    1 INT = 2 Spell Damage
        //    1 SPI = 2 Spell Healing
        //    1 STA = 10 HP (already native)
        // -------------------------------------------------------

        int32 intellect = (int32)player->GetStat(STAT_INTELLECT);
        int32 spirit    = (int32)player->GetStat(STAT_SPIRIT);

        // INT -> 2x Spell Damage
        int32 bonusSpDmg = intellect * 2;
        player->ApplySpellDamageBonus(bonusSpDmg, true);
        player->CustomData.Set("SpellDmg_Applied", new FloatData((float)bonusSpDmg));

        // SPI -> 2x Spell Healing
        int32 bonusSpHeal = spirit * 2;
        player->ApplySpellHealingBonus(bonusSpHeal, true);
        player->CustomData.Set("SpellHeal_Applied", new FloatData((float)bonusSpHeal));

        player->CustomData.Erase("StatsExpanded_RecalcGuard");

}

class StatsExpandedPlayerScript : public PlayerScript
{
public:
    StatsExpandedPlayerScript() : PlayerScript("StatsExpandedPlayerScript") { }

    void OnPlayerLogin(Player* player) override
    {
        UpdateDerivedStats(player);
    }

    void OnPlayerLevelChanged(Player* player, uint8 /*oldLevel*/) override
    {
        UpdateDerivedStats(player);
    }

    void OnPlayerEquip(Player* player, Item* /*it*/, uint8 /*bag*/, uint8 /*slot*/, bool /*update*/) override
    {
        UpdateDerivedStats(player);
    }

    void OnPlayerUnequip(Player* player, Item* /*it*/) override
    {
        UpdateDerivedStats(player);
    }
};

// ============================================================================
// Aura watcher — recalculates derived stats when buffs/auras change
// ============================================================================

class StatsExpandedAuraScript : public UnitScript
{
public:
    StatsExpandedAuraScript() : UnitScript("StatsExpandedAuraScript") { }

    void OnAuraApply(Unit* unit, Aura* aura) override
    {
        if (!unit || !aura)
            return;

        Player* player = unit->ToPlayer();
        if (!player)
            return;

        // Only recalc for auras that could affect stats
        // Check if the aura has any stat-modifying effect
        if (AuraAffectsStats(aura))
            UpdateDerivedStats(player);
    }

    void OnAuraRemove(Unit* unit, AuraApplication* aurApp, AuraRemoveMode /*mode*/) override
    {
        if (!unit || !aurApp)
            return;

        Player* player = unit->ToPlayer();
        if (!player)
            return;

        Aura* aura = aurApp->GetBase();
        if (!aura)
            return;

        if (AuraAffectsStats(aura))
            UpdateDerivedStats(player);
    }

private:
    static bool AuraAffectsStats(Aura const* aura)
    {
        SpellInfo const* spellInfo = aura->GetSpellInfo();
        if (!spellInfo)
            return false;

        for (uint8 i = 0; i < MAX_SPELL_EFFECTS; ++i)
        {
            if (!spellInfo->Effects[i].IsEffect())
                continue;

            switch (spellInfo->Effects[i].ApplyAuraName)
            {
                // Stat modifiers
                case SPELL_AURA_MOD_STAT:
                case SPELL_AURA_MOD_PERCENT_STAT:
                case SPELL_AURA_MOD_TOTAL_STAT_PERCENTAGE:
                // Rating modifiers
                case SPELL_AURA_MOD_RATING:
                case SPELL_AURA_MOD_RATING_FROM_STAT:
                // Attack power
                case SPELL_AURA_MOD_ATTACK_POWER:
                case SPELL_AURA_MOD_RANGED_ATTACK_POWER:
                case SPELL_AURA_MOD_ATTACK_POWER_PCT:
                // Spell power / healing
                case SPELL_AURA_MOD_HEALING_DONE:
                case SPELL_AURA_MOD_SPELL_DAMAGE_OF_STAT_PERCENT:
                case SPELL_AURA_MOD_SPELL_HEALING_OF_STAT_PERCENT:
                case SPELL_AURA_MOD_DAMAGE_DONE:
                    return true;
                default:
                    break;
            }
        }
        return false;
    }
};

// ============================================================================
// Multistrike — triggers on spell damage (reads from CR_BLOCK / CR 4)
// ============================================================================

class MultistrikeUnitScript : public UnitScript
{
public:
    MultistrikeUnitScript() : UnitScript("MultistrikeUnitScript") { }

    void ModifyMeleeDamage(Unit* target, Unit* attacker, uint32& damage) override
    {
        if (!target || !attacker || damage == 0)
            return;

        Player* player = attacker->ToPlayer();
        if (!player)
            return;

        if (BoolData* flag = player->CustomData.Get<BoolData>("Multistrike_InProgress"))
        {
            if (flag->value)
                return;
        }

        if (!Multistrike::RollMultistrike(player))
            return;

        uint32 extraDamage = uint32(float(damage) * 0.33f);
        if (extraDamage == 0)
            return;

        player->CustomData.Set("Multistrike_InProgress", new BoolData(true));
        damage += extraDamage;
        player->CustomData.Erase("Multistrike_InProgress");
    }

    void ModifySpellDamageTaken(Unit* target, Unit* attacker, int32& damage, SpellInfo const* spellInfo) override
    {
        if (!target || !attacker || !spellInfo || damage <= 0)
            return;

        Player* player = attacker->ToPlayer();
        if (!player)
            return;

        if (spellInfo->IsPositive())
            return;

        // Prevent recursive multistrike
        if (BoolData* flag = player->CustomData.Get<BoolData>("Multistrike_InProgress"))
        {
            if (flag->value)
                return;
        }

        if (!Multistrike::RollMultistrike(player))
            return;

        player->CustomData.Set("Multistrike_InProgress", new BoolData(true));
        Multistrike::ProcessMultistrike(player, target, spellInfo, uint32(damage));
        player->CustomData.Erase("Multistrike_InProgress");
    }
};

// ============================================================================
// Versatility — modifies damage dealt, damage taken, and healing
// Reads from CR_HIT_MELEE (CR 5)
// +1% damage/healing per 1% versatility, -0.5% damage taken per 1%
// ============================================================================

class VersatilityUnitScript : public UnitScript
{
public:
    VersatilityUnitScript() : UnitScript("VersatilityUnitScript") { }

    void ModifySpellDamageTaken(Unit* target, Unit* attacker, int32& damage, SpellInfo const* spellInfo) override
    {
        if (!target || !attacker || !spellInfo || damage <= 0)
            return;

        // Attacker bonus: increase outgoing spell damage
        if (Player* atkPlayer = attacker->ToPlayer())
        {
            float dmgMod = Versatility::GetDamageModifier(atkPlayer);
            damage = int32(damage * dmgMod);
        }

        // Target bonus: reduce incoming spell damage
        if (Player* tgtPlayer = target->ToPlayer())
        {
            float redMod = Versatility::GetDamageTakenModifier(tgtPlayer);
            damage = int32(damage * redMod);
        }
    }

    void ModifyMeleeDamage(Unit* target, Unit* attacker, uint32& damage) override
    {
        if (!target || !attacker || damage == 0)
            return;

        // Attacker bonus: increase outgoing melee damage
        if (Player* atkPlayer = attacker->ToPlayer())
        {
            float dmgMod = Versatility::GetDamageModifier(atkPlayer);
            damage = uint32(damage * dmgMod);
        }

        // Target bonus: reduce incoming melee damage
        if (Player* tgtPlayer = target->ToPlayer())
        {
            float redMod = Versatility::GetDamageTakenModifier(tgtPlayer);
            damage = uint32(damage * redMod);
        }
    }

    void ModifyHealReceived(Unit* target, Unit* healer, uint32& heal, SpellInfo const* /*spellInfo*/) override
    {
        if (!healer || heal == 0)
            return;

        // Healer bonus: increase outgoing healing (same +1% rate as damage)
        if (Player* healPlayer = healer->ToPlayer())
        {
            float healMod = Versatility::GetDamageModifier(healPlayer);
            heal = uint32(heal * healMod);
        }
    }
};

// ============================================================================
// CritDamage — modifies critical strike damage bonus
// Reads from CR_DODGE (CR 2): 10 rating = 2% extra crit damage
// Uses the new ModifyCritDamageBonus hook in Unit.cpp
// ============================================================================

class CritDamageBonusUnitScript : public UnitScript
{
public:
    CritDamageBonusUnitScript() : UnitScript("CritDamageBonusUnitScript") { }

    void ModifyCritDamageBonus(Unit const* attacker, Unit const* /*victim*/, uint32& crit_bonus, SpellInfo const* /*spellInfo*/) override
    {
        if (!attacker || crit_bonus == 0)
            return;

        Player const* player = attacker->ToPlayer();
        if (!player)
            return;

        float critDmgMod = CritDamage::GetCritDamageBonus(const_cast<Player*>(player));
        if (critDmgMod > 0.0f)
        {
            crit_bonus = uint32(crit_bonus * (1.0f + critDmgMod));
        }
    }
};

void Addmod_stats_expandedScripts()
{
    new StatsExpandedPlayerScript();
    new StatsExpandedAuraScript();
    new MultistrikeUnitScript();
    new VersatilityUnitScript();
    new CritDamageBonusUnitScript();
}
