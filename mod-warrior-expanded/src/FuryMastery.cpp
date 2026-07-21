/*
 * ════════════════════════════════════════════════════════════════════════
 *  Fury Mastery: Rampage
 *
 *  Fury Warriors auto-learn Rampage (29801), a proc buff that grants crit to
 *  nearby party members. It also carries 2 extra caster-only Dummy marker
 *  effects (EFFECT_1, EFFECT_2) used purely as on/off switches for the
 *  mastery behaviors below, independent of the party crit buff on EFFECT_0:
 *
 *    EFFECT_1 - Any damaging ability cast spends up to 10 extra rage (on top
 *               of its normal cost). Spending the full 10 rage grants +2x
 *               mastery%% damage, scaled proportionally below that (e.g. 24%%
 *               mastery, full 10 rage spent = +48%% damage on that ability;
 *               5 rage spent = +24%% damage).
 *    EFFECT_2 - Heroic Strike (see HeroicStrikes.cpp, spell 900016) gets an
 *               extra flat +2x mastery% damage bonus on top of the above.
 * ════════════════════════════════════════════════════════════════════════
 */

#include "ScriptMgr.h"
#include "Player.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "SpellScript.h"
#include "StatsExpandedData.h"
#include "StatsExpandedScaling.h"
#include <algorithm>

namespace
{
    constexpr uint32 SPELL_WARRIOR_RAMPAGE             = 29801;
    constexpr uint32 SPELL_WARRIOR_HEROIC_STRIKE_CAST  = 900016; // matches HeroicStrikes.cpp

    constexpr uint32 MAX_EXTRA_RAGE                    = 10;
    constexpr float  HEROIC_STRIKE_MASTERY_MULTIPLIER  = 2.0f;

    // mod-stats-expanded repurposes CR_PARRY as Mastery, but neutralizes the native rating
    // after capturing its raw value into CustomData["Mastery"] - so
    // GetRatingBonusValue(CR_PARRY) always reads ~0 everywhere. Read the raw cached value
    // instead and convert with the same DB-configurable ratio the rest of the system uses.
    float GetFuryMasteryPercent(Player* player)
    {
        if (!player || !StatsExpandedScaling::IsStatEnabled("MASTERY_RATING"))
            return 0.0f;

        float ratingPerPercent = StatsExpandedScaling::GetBaseRequirement("MASTERY_RATING");
        if (ratingPerPercent <= 0.0f)
            return 0.0f;

        FloatData* masteryData = player->CustomData.Get<FloatData>("Mastery");
        float masteryRaw = masteryData ? masteryData->value : 0.0f;
        return std::max(0.0f, masteryRaw / ratingPerPercent);
    }
}

class WarriorExpandedMasteryRampageUnitScript : public UnitScript
{
public:
    WarriorExpandedMasteryRampageUnitScript() : UnitScript("WarriorExpandedMasteryRampageUnitScript") { }

    void ModifySpellDamageTaken(Unit* /*target*/, Unit* attacker, int32& damage, SpellInfo const* spellInfo) override
    {
        if (!attacker || !spellInfo || damage <= 0)
            return;

        Player* player = attacker->ToPlayer();
        if (!player || player->getClass() != CLASS_WARRIOR)
            return;

        float masteryPct = GetFuryMasteryPercent(player);
        if (masteryPct <= 0.0f)
            return;

        // EFFECT_1 - spend up to MAX_EXTRA_RAGE extra rage on this ability. Spending the full
        // amount grants +2x mastery% damage; less rage spent scales that bonus down linearly.
        // (NOT rage-points * mastery% directly - that produced runaway multipliers, e.g. 20
        // rage * 24% mastery = +480% damage, one-shotting geared tanks.)
        if (player->HasAuraEffect(SPELL_WARRIOR_RAMPAGE, EFFECT_1))
        {
            uint32 availableRage = player->GetPower(POWER_RAGE) / 10;
            uint32 rageToSpend = std::min(availableRage, MAX_EXTRA_RAGE);
            if (rageToSpend > 0)
            {
                player->ModifyPower(POWER_RAGE, -int32(rageToSpend * 10));
                float bonusPct = masteryPct * HEROIC_STRIKE_MASTERY_MULTIPLIER * (float(rageToSpend) / float(MAX_EXTRA_RAGE));
                damage = int32(damage * (1.0f + bonusPct / 100.0f));
            }
        }

        // EFFECT_2 - Heroic Strike gets an extra flat +2x mastery% on top of the above.
        if (spellInfo->Id == SPELL_WARRIOR_HEROIC_STRIKE_CAST && player->HasAuraEffect(SPELL_WARRIOR_RAMPAGE, EFFECT_2))
        {
            float bonusPct = masteryPct * HEROIC_STRIKE_MASTERY_MULTIPLIER;
            damage = int32(damage * (1.0f + bonusPct / 100.0f));
        }
    }
};

void AddFuryMasteryScripts()
{
    new WarriorExpandedMasteryRampageUnitScript();
}
