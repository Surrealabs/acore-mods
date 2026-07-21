/*
 * ════════════════════════════════════════════════════════════════════════
 *  Sweeping Strikes — one charge per ability cast, not per target hit
 *  (mod-warrior-expanded override, spells 12328/18765/35429)
 *
 *  Core's spell_warr_sweeping_strikes (spell_warrior.cpp) already has a
 *  narrow workaround for Whirlwind specifically: after it procs once from a
 *  Whirlwind cast, it slaps a 500ms self-cooldown on the extra-attack spell
 *  so the SAME Whirlwind cast's other simultaneous target hits don't each
 *  burn a separate charge. That workaround only covers Whirlwind by hardcoded
 *  spell ID.
 *
 *  This override generalizes that idea to ANY ability: instead of a
 *  hardcoded ID + time-based cooldown, it tracks the actual `Spell*` instance
 *  that triggered the proc and skips any further proc from that exact same
 *  cast. A cast that cleaves/hits multiple targets (Whirlwind, or any custom
 *  cleave ability) reuses the same Spell instance for every target it hits,
 *  so this only lets the FIRST of those hits consume a charge. Two separate
 *  swings/casts (even back-to-back) always have distinct Spell instances (or
 *  no Spell instance at all for plain white-swing melee, which is passed
 *  through unconditionally), so normal charge consumption per swing is
 *  unaffected. *
 *  Additionally, plain auto attacks (main-hand or off-hand white swings) are
 *  refunded their charge in HandleProc - they still trigger the cleave extra
 *  attack, but never burn down Sweeping Strikes' limited charge count. Only
 *  ability-triggered procs (Heroic Strike, Bloodthirst, Execute, Whirlwind,
 *  etc.) consume a charge, so the buff no longer fizzles out almost
 *  instantly from normal swings/extra attacks alone. * ════════════════════════════════════════════════════════════════════════
 */

#include "ScriptMgr.h"
#include "Player.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "SpellScript.h"

namespace
{
    constexpr uint32 SPELL_WARRIOR_EXECUTE                          = 20647;
    constexpr uint32 SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_1   = 12723;
    constexpr uint32 SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_2   = 26654;
    constexpr uint32 SPELL_WARRIOR_WHIRLWIND_OFF                    = 44949;
}

// 12328, 18765, 35429 - Sweeping Strikes (mod-warrior-expanded override)
class spell_warrior_expanded_sweeping_strikes : public AuraScript
{
    PrepareAuraScript(spell_warrior_expanded_sweeping_strikes);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_1, SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_2 });
    }

    bool Load() override
    {
        _procTarget = nullptr;
        _lastProcSpell = nullptr;
        return true;
    }

    bool CheckProc(ProcEventInfo& eventInfo)
    {
        Unit* actor = eventInfo.GetActor();
        if (!actor)
            return false;

        if (SpellInfo const* spellInfo = eventInfo.GetSpellInfo())
        {
            switch (spellInfo->Id)
            {
                case SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_1:
                case SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_2:
                case SPELL_WARRIOR_WHIRLWIND_OFF:
                    return false;
                default:
                    break;
            }
        }

        // Only consume one charge per ability cast, even if that cast hits/cleaves multiple
        // targets at once. Plain melee swings have no backing Spell instance (procSpell ==
        // nullptr) and are always allowed through - only a genuine repeat proc from the exact
        // same multi-target cast gets skipped here.
        Spell const* procSpell = eventInfo.GetProcSpell();
        if (procSpell && procSpell == _lastProcSpell)
            return false;

        _procTarget = actor->SelectNearbyNoTotemTarget(eventInfo.GetProcTarget());
        return _procTarget != nullptr;
    }

    void HandleProc(AuraEffect const* aurEff, ProcEventInfo& eventInfo)
    {
        PreventDefaultAction();

        _lastProcSpell = eventInfo.GetProcSpell();

        // Plain melee swings (main-hand or off-hand, no backing Spell instance) should
        // proc the extra attack for free without spending one of Sweeping Strikes' limited
        // charges - only ability-triggered procs (Heroic Strike, Bloodthirst, Execute, etc.)
        // consume a charge. The native proc pipeline (Unit::ProcDamageAndSpell) drops the
        // charge AFTER this script runs, so refunding it here nets to zero for auto attacks.
        if (!_lastProcSpell)
            ModCharges(1);

        if (DamageInfo* damageInfo = eventInfo.GetDamageInfo())
        {
            SpellInfo const* spellInfo = damageInfo->GetSpellInfo();
            if (spellInfo && spellInfo->Id == SPELL_WARRIOR_EXECUTE && !_procTarget->HasAuraState(AURA_STATE_HEALTHLESS_20_PERCENT))
            {
                // If triggered by Execute (while target is not under 20% hp) deals normalized weapon damage
                GetTarget()->CastSpell(_procTarget, SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_2, aurEff);
            }
            else
            {
                int32 damage = damageInfo->GetUnmitigatedDamage();
                GetTarget()->CastCustomSpell(_procTarget, SPELL_WARRIOR_SWEEPING_STRIKES_EXTRA_ATTACK_1, &damage, 0, 0, true, nullptr, aurEff);
            }
        }
    }

    void Register() override
    {
        DoCheckProc += AuraCheckProcFn(spell_warrior_expanded_sweeping_strikes::CheckProc);
        OnEffectProc += AuraEffectProcFn(spell_warrior_expanded_sweeping_strikes::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }

private:
    Unit* _procTarget = nullptr;
    Spell const* _lastProcSpell = nullptr;
};

void AddSweepingStrikesScripts()
{
    RegisterSpellScript(spell_warrior_expanded_sweeping_strikes);
}
