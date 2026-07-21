/*
 * ════════════════════════════════════════════════════════════════════════
 *  Psychic Link (mod-priest-expanded) — custom Shadow Priest mechanic
 *
 *  Psychic Link (900041) is an entirely custom aura (not a real Blizzard
 *  spell) that mirrors the caster's Shadow Word: Pain on a target: whenever
 *  Mind Flay, Devouring Plague, or Vampiric Touch deal damage to a target
 *  that also has the caster's Shadow Word: Pain on it, a % of that target's
 *  current DoT tick damage (from any Priest dot) is dealt to every OTHER
 *  hostile unit in range that also has the caster's Shadow Word: Pain on
 *  them, and their dots get extended slightly (mastery-scaled). Shadow
 *  Word: Death also triggers this on hit.
 *
 *  This file was moved out of core src/server/scripts/Spells/spell_priest.cpp
 *  (previously spell_pri_shadow_word_pain, spell_pri_vampiric_touch,
 *  spell_pri_devouring_plague, spell_pri_psychic_link, spell_pri_shadow_word_death
 *  plus their shared anonymous-namespace helpers) so this entirely custom
 *  system is portable/module-scoped instead of living in a core file.
 * ════════════════════════════════════════════════════════════════════════
 */

#include "Cell.h"
#include "CellImpl.h"
#include "GridNotifiers.h"
#include "GridNotifiersImpl.h"
#include "Player.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "SpellScript.h"
#include "SpellScriptLoader.h"
#include <unordered_set>

namespace
{
    constexpr uint32 SPELL_PRIEST_MIND_FLAY_DAMAGE            = 58381;
    constexpr uint32 SPELL_PRIEST_SHADOW_WORD_PAIN_R1         = 589;
    constexpr uint32 SPELL_PRIEST_PSYCHIC_LINK                = 900041;
    constexpr uint32 SPELL_PRIEST_VAMPIRIC_TOUCH_DISPEL       = 64085;
    constexpr uint32 SPELL_PRIEST_DEVOURING_PLAGUE_R1         = 2944;

    constexpr int32 PRIEST_PSYCHIC_LINK_DOT_PCT               = 25;
    constexpr int32 PRIEST_DOT_EXTENSION_MS                   = 200;
    constexpr float PRIEST_SHADOW_WORD_DEATH_DOT_SPREAD_RANGE = 10.0f;

    float GetPriestMasteryPct(Unit* caster)
    {
        if (!caster)
            return 0.0f;

        if (Player* playerCaster = caster->ToPlayer())
            return std::max(0.0f, playerCaster->GetRatingBonusValue(CR_PARRY));

        return 0.0f;
    }

    Aura* GetCasterShadowWordPainAura(Unit* caster, Unit* target)
    {
        if (!caster || !target)
            return nullptr;

        if (AuraEffect* swpEffect = target->GetAuraEffect(SPELL_AURA_PERIODIC_DAMAGE, SPELLFAMILY_PRIEST, 0x8000, 0, 0, caster->GetGUID()))
            return swpEffect->GetBase();

        return nullptr;
    }

    void SyncPsychicLinkWithShadowWordPain(Unit* caster, Unit* target)
    {
        if (!caster || !target)
            return;

        Aura* shadowWordPain = GetCasterShadowWordPainAura(caster, target);
        if (!shadowWordPain)
        {
            target->RemoveAura(SPELL_PRIEST_PSYCHIC_LINK, caster->GetGUID());
            return;
        }

        Aura* psychicLink = target->GetAura(SPELL_PRIEST_PSYCHIC_LINK, caster->GetGUID());
        if (!psychicLink)
            psychicLink = caster->AddAura(SPELL_PRIEST_PSYCHIC_LINK, target);

        if (!psychicLink)
            return;

        psychicLink->SetMaxDuration(shadowWordPain->GetMaxDuration());
        psychicLink->SetDuration(shadowWordPain->GetDuration());
    }

    int32 GetCasterDotTickDamageOnTarget(Unit* caster, Unit* target)
    {
        if (!caster || !target)
            return 0;

        int32 totalDotTickDamage = 0;
        auto accumulateDotDamage = [&](Unit::AuraEffectList const& auraList)
        {
            for (AuraEffect const* auraEffect : auraList)
            {
                if (!auraEffect || auraEffect->GetCasterGUID() != caster->GetGUID())
                    continue;

                SpellInfo const* auraSpellInfo = auraEffect->GetSpellInfo();
                if (!auraSpellInfo || auraSpellInfo->SpellFamilyName != SPELLFAMILY_PRIEST)
                    continue;

                int32 amount = auraEffect->GetAmount();
                if (amount < 0)
                    amount = -amount;

                totalDotTickDamage += amount;
            }
        };

        accumulateDotDamage(target->GetAuraEffectsByType(SPELL_AURA_PERIODIC_DAMAGE));
        accumulateDotDamage(target->GetAuraEffectsByType(SPELL_AURA_PERIODIC_LEECH));

        return totalDotTickDamage;
    }

    void ExtendCasterDotsOnTarget(Unit* caster, Unit* target, int32 durationMs)
    {
        if (!caster || !target || durationMs <= 0)
            return;

        std::unordered_set<Aura*> processedAuras;
        auto extendDotAuras = [&](Unit::AuraEffectList const& auraList)
        {
            for (AuraEffect const* auraEffect : auraList)
            {
                if (!auraEffect)
                    continue;

                SpellInfo const* auraSpellInfo = auraEffect->GetSpellInfo();
                if (!auraSpellInfo || auraSpellInfo->SpellFamilyName != SPELLFAMILY_PRIEST)
                    continue;

                Aura* aura = auraEffect->GetBase();
                if (!aura || aura->GetCasterGUID() != caster->GetGUID())
                    continue;

                if (!processedAuras.insert(aura).second)
                    continue;

                if (aura->IsPermanent())
                    continue;

                int32 maxDuration = aura->GetMaxDuration();
                int32 duration = aura->GetDuration();
                if (maxDuration <= 0 || duration <= 0)
                    continue;

                aura->SetMaxDuration(maxDuration + durationMs);
                aura->SetDuration(duration + durationMs);
            }
        };

        extendDotAuras(target->GetAuraEffectsByType(SPELL_AURA_PERIODIC_DAMAGE));
        extendDotAuras(target->GetAuraEffectsByType(SPELL_AURA_PERIODIC_LEECH));

        SyncPsychicLinkWithShadowWordPain(caster, target);
    }

    void TriggerPsychicLinkDamage(Unit* caster, Unit* triggerTarget, SpellInfo const* triggerSpellInfo)
    {
        if (!caster || !triggerTarget || !triggerTarget->IsAlive())
            return;

        SpellInfo const* psychicLinkSpellInfo = sSpellMgr->GetSpellInfo(SPELL_PRIEST_PSYCHIC_LINK);
        SpellInfo const* damageSpellInfo = psychicLinkSpellInfo ? psychicLinkSpellInfo : triggerSpellInfo;
        if (!damageSpellInfo)
            return;

        float const masteryPct = GetPriestMasteryPct(caster);
        int32 const masteryScaledExtensionMs = PRIEST_DOT_EXTENSION_MS + int32((PRIEST_DOT_EXTENSION_MS * masteryPct) / 100.0f);

        std::list<Unit*> targets;
        float const searchRange = caster->GetVisibilityRange();
        Acore::AnyUnfriendlyUnitInObjectRangeCheck check(caster, caster, searchRange);
        Acore::UnitListSearcher<Acore::AnyUnfriendlyUnitInObjectRangeCheck> searcher(caster, targets, check);
        Cell::VisitObjects(caster, searcher, searchRange);

        for (Unit* linkedTarget : targets)
        {
            if (!linkedTarget || !linkedTarget->IsAlive())
                continue;

            Aura* shadowWordPain = GetCasterShadowWordPainAura(caster, linkedTarget);
            if (!shadowWordPain)
                continue;

            SyncPsychicLinkWithShadowWordPain(caster, linkedTarget);

            int32 psychicLinkPct = PRIEST_PSYCHIC_LINK_DOT_PCT;
            if (Aura* psychicLinkAura = linkedTarget->GetAura(SPELL_PRIEST_PSYCHIC_LINK, caster->GetGUID()))
                if (AuraEffect const* psychicLinkEff = psychicLinkAura->GetEffect(EFFECT_0))
                    psychicLinkPct = psychicLinkEff->GetAmount() > 0 ? psychicLinkEff->GetAmount() : PRIEST_PSYCHIC_LINK_DOT_PCT;

            psychicLinkPct += int32(masteryPct);

            int32 dotTickDamage = GetCasterDotTickDamageOnTarget(caster, linkedTarget);
            int32 linkDamage = CalculatePct(dotTickDamage, psychicLinkPct);

            if (linkDamage <= 0)
                continue;

            if (linkedTarget->HasUnitState(UNIT_STATE_ISOLATED) || linkedTarget->IsImmunedToDamageOrSchool(damageSpellInfo))
                continue;

            SpellNonMeleeDamage damageLog(caster, linkedTarget, damageSpellInfo, damageSpellInfo->GetSchoolMask());
            caster->CalculateSpellDamageTaken(&damageLog, linkDamage, damageSpellInfo);
            Unit::DealDamageMods(damageLog.target, damageLog.damage, &damageLog.absorb);
            caster->SendSpellNonMeleeDamageLog(&damageLog);
            caster->DealSpellDamage(&damageLog, true);

            ExtendCasterDotsOnTarget(caster, linkedTarget, masteryScaledExtensionMs);
        }
    }

    // Shadow Word: Death (when it doesn't kill the target) - collects every Priest dot the
    // caster has on the target and casts a fresh copy of each onto every other hostile unit
    // within range of the target, instead of the vanilla self-damage backfire.
    void SpreadCasterDotsToNearbyEnemies(Unit* caster, Unit* target, float range)
    {
        if (!caster || !target)
            return;

        std::unordered_set<uint32> dotSpellIds;
        auto collectDots = [&](Unit::AuraEffectList const& auraList)
        {
            for (AuraEffect const* auraEffect : auraList)
            {
                if (!auraEffect || auraEffect->GetCasterGUID() != caster->GetGUID())
                    continue;

                SpellInfo const* auraSpellInfo = auraEffect->GetSpellInfo();
                if (!auraSpellInfo || auraSpellInfo->SpellFamilyName != SPELLFAMILY_PRIEST)
                    continue;

                dotSpellIds.insert(auraSpellInfo->Id);
            }
        };

        collectDots(target->GetAuraEffectsByType(SPELL_AURA_PERIODIC_DAMAGE));
        collectDots(target->GetAuraEffectsByType(SPELL_AURA_PERIODIC_LEECH));

        if (dotSpellIds.empty())
            return;

        // Broad "any alive unit in range" search rather than a strict hostility check -
        // Training Dummies and other neutral-but-attackable creatures are friendly-flagged
        // (IsFriendlyTo/IsHostileTo can say "not hostile" for them), so a strict
        // unfriendly-only search would silently exclude them, same as the earlier Heroic
        // Strike Training Dummy bug. Only exclude the original target itself and friendly
        // Players (party/raid/self) - Training Dummies, neutral mobs, and real enemies all
        // count.
        std::list<Unit*> nearbyUnits;
        Acore::AnyUnitInObjectRangeCheck check(target, range);
        Acore::UnitListSearcher<Acore::AnyUnitInObjectRangeCheck> searcher(target, nearbyUnits, check);
        Cell::VisitObjects(target, searcher, range);

        for (Unit* unit : nearbyUnits)
        {
            if (!unit || unit == target || !unit->IsAlive())
                continue;

            if (Player* player = unit->ToPlayer())
                if (!caster->IsHostileTo(player))
                    continue;

            for (uint32 dotSpellId : dotSpellIds)
                caster->CastSpell(unit, dotSpellId, true);
        }
    }
}

// -32379 - Shadow Word Death (mod-priest-expanded override)
// If the target survives the hit, spreads every Priest dot the caster has on the target to
// every other non-friendly unit within 10 yards of the target (Training Dummies and neutral
// creatures included, not just true-hostile enemies), instead of dealing self-damage back to
// the caster.
class spell_priest_expanded_shadow_word_death : public SpellScript
{
    PrepareSpellScript(spell_priest_expanded_shadow_word_death);

    void HandleDamage()
    {
        Unit* caster = GetCaster();
        Unit* hitTarget = GetHitUnit();
        int32 damage = GetHitDamage();

        bool targetSurvives = hitTarget && hitTarget->IsAlive() && int64(hitTarget->GetHealth()) > int64(damage);
        if (targetSurvives)
            SpreadCasterDotsToNearbyEnemies(caster, hitTarget, PRIEST_SHADOW_WORD_DEATH_DOT_SPREAD_RANGE);

        if (caster && hitTarget && GetHitDamage() > 0)
            TriggerPsychicLinkDamage(caster, hitTarget, GetSpellInfo());
    }

    void Register() override
    {
        OnHit += SpellHitFn(spell_priest_expanded_shadow_word_death::HandleDamage);
    }
};

// -58381 - Mind Flay (Damage) (mod-priest-expanded override)
class spell_priest_expanded_psychic_link : public SpellScript
{
    PrepareSpellScript(spell_priest_expanded_psychic_link);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_PRIEST_MIND_FLAY_DAMAGE, SPELL_PRIEST_SHADOW_WORD_PAIN_R1, SPELL_PRIEST_PSYCHIC_LINK });
    }

    void HandleHit()
    {
        Unit* caster = GetCaster();
        Unit* triggerTarget = GetHitUnit();
        if (!caster || !triggerTarget || !triggerTarget->IsAlive())
            return;

        if (GetHitDamage() <= 0)
            return;

        TriggerPsychicLinkDamage(caster, triggerTarget, GetSpellInfo());
    }

    void Register() override
    {
        OnHit += SpellHitFn(spell_priest_expanded_psychic_link::HandleHit);
    }
};

// -2944 - Devouring Plague (mod-priest-expanded override)
class spell_priest_expanded_devouring_plague : public AuraScript
{
    PrepareAuraScript(spell_priest_expanded_devouring_plague);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_PRIEST_DEVOURING_PLAGUE_R1, SPELL_PRIEST_PSYCHIC_LINK });
    }

    void HandlePeriodic(AuraEffect const* /*aurEff*/)
    {
        Unit* caster = GetCaster();
        Unit* target = GetTarget();
        if (!caster || !target || !target->IsAlive())
            return;

        TriggerPsychicLinkDamage(caster, target, GetSpellInfo());
    }

    void Register() override
    {
        OnEffectPeriodic += AuraEffectPeriodicFn(spell_priest_expanded_devouring_plague::HandlePeriodic, EFFECT_0, SPELL_AURA_PERIODIC_DAMAGE);
    }
};

// -589 - Shadow Word: Pain (mod-priest-expanded override)
class spell_priest_expanded_shadow_word_pain : public AuraScript
{
    PrepareAuraScript(spell_priest_expanded_shadow_word_pain);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_PRIEST_SHADOW_WORD_PAIN_R1, SPELL_PRIEST_PSYCHIC_LINK });
    }

    void HandleApply(AuraEffect const* /*aurEff*/, AuraEffectHandleModes /*mode*/)
    {
        Unit* caster = GetCaster();
        Unit* target = GetTarget();
        if (!caster || !target)
            return;

        SyncPsychicLinkWithShadowWordPain(caster, target);
    }

    void HandleRemove(AuraEffect const* /*aurEff*/, AuraEffectHandleModes /*mode*/)
    {
        Unit* caster = GetCaster();
        Unit* target = GetTarget();
        if (!caster || !target)
            return;

        target->RemoveAura(SPELL_PRIEST_PSYCHIC_LINK, caster->GetGUID());
    }

    void Register() override
    {
        AfterEffectApply += AuraEffectApplyFn(spell_priest_expanded_shadow_word_pain::HandleApply, EFFECT_0, SPELL_AURA_PERIODIC_DAMAGE, AURA_EFFECT_HANDLE_REAL_OR_REAPPLY_MASK);
        AfterEffectRemove += AuraEffectRemoveFn(spell_priest_expanded_shadow_word_pain::HandleRemove, EFFECT_0, SPELL_AURA_PERIODIC_DAMAGE, AURA_EFFECT_HANDLE_REAL);
    }
};

// -34914 - Vampiric Touch (mod-priest-expanded override)
class spell_priest_expanded_vampiric_touch : public AuraScript
{
    PrepareAuraScript(spell_priest_expanded_vampiric_touch);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_PRIEST_VAMPIRIC_TOUCH_DISPEL, SPELL_PRIEST_PSYCHIC_LINK });
    }

    void HandlePeriodic(AuraEffect const* /*aurEff*/)
    {
        Unit* caster = GetCaster();
        Unit* target = GetTarget();
        if (!caster || !target || !target->IsAlive())
            return;

        TriggerPsychicLinkDamage(caster, target, GetSpellInfo());
    }

    void HandleDispel(DispelInfo* /*dispelInfo*/)
    {
        if (Unit* caster = GetCaster())
            if (Unit* target = GetUnitOwner())
                if (AuraEffect const* aurEff = GetEffect(EFFECT_1))
                {
                    int32 damage = aurEff->GetBaseAmount();
                    damage = aurEff->GetSpellInfo()->Effects[EFFECT_1].CalcValue(caster, &damage, nullptr) * 8;
                    // backfire damage
                    caster->CastCustomSpell(target, SPELL_PRIEST_VAMPIRIC_TOUCH_DISPEL, &damage, nullptr, nullptr, true, nullptr, aurEff);
                }
    }

    bool CheckProc(ProcEventInfo& eventInfo)
    {
        if (!eventInfo.GetActionTarget() || GetOwner()->GetGUID() != eventInfo.GetActionTarget()->GetGUID())
        {
            return false;
        }

        SpellInfo const* spellInfo = eventInfo.GetSpellInfo();
        if (!spellInfo || spellInfo->SpellFamilyName != SPELLFAMILY_PRIEST || !(spellInfo->SpellFamilyFlags[0] & 0x00002000))
        {
            return false;
        }

        return true;
    }

    void HandleProc(AuraEffect const* aurEff, ProcEventInfo& eventInfo)
    {
        PreventDefaultAction();
        if (Unit* actor = eventInfo.GetActor())
        {
            actor->CastSpell(actor, 57669, true, nullptr, aurEff);
        }
    }

    void Register() override
    {
        AfterDispel += AuraDispelFn(spell_priest_expanded_vampiric_touch::HandleDispel);
        DoCheckProc += AuraCheckProcFn(spell_priest_expanded_vampiric_touch::CheckProc);
        OnEffectPeriodic += AuraEffectPeriodicFn(spell_priest_expanded_vampiric_touch::HandlePeriodic, EFFECT_ALL, SPELL_AURA_PERIODIC_DAMAGE);
        OnEffectProc += AuraEffectProcFn(spell_priest_expanded_vampiric_touch::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }
};

void AddPsychicLinkScripts()
{
    RegisterSpellScript(spell_priest_expanded_shadow_word_death);
    RegisterSpellScript(spell_priest_expanded_psychic_link);
    RegisterSpellScript(spell_priest_expanded_devouring_plague);
    RegisterSpellScript(spell_priest_expanded_shadow_word_pain);
    RegisterSpellScript(spell_priest_expanded_vampiric_touch);
}
