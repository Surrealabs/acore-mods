/*
 * ════════════════════════════════════════════════════════════════════════
 *  Execute — 100% Attack Power scaling (mod-warrior-expanded override)
 *
 *  Replaces core's spell_warr_execute (src/server/scripts/Spells/spell_warrior.cpp,
 *  spell -5308) with an identical copy, except the attack power coefficient:
 *  core hardcodes 20% of AP added to Execute's damage, this override uses
 *  100% AP instead. All rage logic (rage consumed/capped at 30, Sudden Death
 *  rage-save, Glyph of Execution rage bonus) is left completely untouched,
 *  copied verbatim from core.
 * ════════════════════════════════════════════════════════════════════════
 */

#include "ScriptMgr.h"
#include "SpellAuraEffects.h"
#include "SpellScript.h"
#include <algorithm>

namespace
{
    constexpr uint32 SPELL_WARRIOR_EXECUTE               = 20647;
    constexpr uint32 SPELL_WARRIOR_GLYPH_OF_EXECUTION    = 58367;
    constexpr uint32 WARRIOR_ICON_ID_SUDDEN_DEATH        = 1989;
    constexpr float  EXECUTE_ATTACK_POWER_COEFFICIENT    = 3.0f; // core uses 0.2f (20%)
}

// -5308 - Execute (mod-warrior-expanded override: 100% AP instead of core's 20%)
class spell_warrior_expanded_execute : public SpellScript
{
    PrepareSpellScript(spell_warrior_expanded_execute);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_WARRIOR_EXECUTE, SPELL_WARRIOR_GLYPH_OF_EXECUTION });
    }

    void SendMiss(SpellMissInfo missInfo)
    {
        if (missInfo != SPELL_MISS_NONE)
        {
            if (Unit* caster = GetCaster())
                if (Unit* target = GetHitUnit())
                    caster->SendSpellMiss(target, SPELL_WARRIOR_EXECUTE, missInfo);
        }
    }

    void HandleEffect(SpellEffIndex effIndex)
    {
        Unit* caster = GetCaster();
        if (Unit* target = GetHitUnit())
        {
            SpellInfo const* spellInfo = GetSpellInfo();
            int32 rageUsed = std::min<int32>(300 - spellInfo->CalcPowerCost(caster, SpellSchoolMask(spellInfo->SchoolMask)), caster->GetPower(POWER_RAGE));
            int32 newRage = std::max<int32>(0, caster->GetPower(POWER_RAGE) - rageUsed);

            // Sudden Death rage save
            if (AuraEffect* aurEff = caster->GetAuraEffect(SPELL_AURA_PROC_TRIGGER_SPELL, SPELLFAMILY_GENERIC, WARRIOR_ICON_ID_SUDDEN_DEATH, EFFECT_0))
            {
                int32 ragesave = aurEff->GetSpellInfo()->Effects[EFFECT_1].CalcValue() * 10;
                newRage = std::max(newRage, ragesave);
            }

            caster->SetPower(POWER_RAGE, uint32(newRage));

            // Glyph of Execution bonus
            if (AuraEffect* aurEff = caster->GetAuraEffect(SPELL_WARRIOR_GLYPH_OF_EXECUTION, EFFECT_0))
                rageUsed += aurEff->GetAmount() * 10;

            int32 bp = GetEffectValue() + int32(rageUsed * spellInfo->Effects[effIndex].DamageMultiplier
                       + caster->GetTotalAttackPowerValue(BASE_ATTACK) * EXECUTE_ATTACK_POWER_COEFFICIENT);
            caster->CastCustomSpell(target, SPELL_WARRIOR_EXECUTE, &bp, nullptr, nullptr, true, nullptr, nullptr, GetOriginalCaster()->GetGUID());
        }
    }

    void Register() override
    {
        BeforeHit += BeforeSpellHitFn(spell_warrior_expanded_execute::SendMiss);
        OnEffectHitTarget += SpellEffectFn(spell_warrior_expanded_execute::HandleEffect, EFFECT_0, SPELL_EFFECT_DUMMY);
    }
};

void AddExecuteScripts()
{
    RegisterSpellScript(spell_warrior_expanded_execute);
}
