#include "CreatureScript.h"
#include "Group.h"
#include "Player.h"
#include "ScriptMgr.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "SpellScript.h"
#include "TemporarySummon.h"
#include "TotemAI.h"
#include "Utilities/DataMap.h"

// ════════════════════════════════════════════════════════════════════════
//  mod-priest-expanded — Custom Priest mechanics
// ════════════════════════════════════════════════════════════════════════

namespace
{
    constexpr uint32 SPELL_PRIEST_DIVINE_AEGIS               = 47753;
    constexpr uint32 SPELL_PRIEST_GLYPH_OF_LIGHTWELL         = 55673;
    constexpr uint32 SPELL_PRIEST_VOID_SHIELD                = 15290;

    constexpr uint32 DIVINE_AEGIS_MAX_ABSORB_HEALTH_PCT      = 50;
    constexpr uint32 VAMPIRIC_EMBRACE_MAX_SHIELD_HEALTH_PCT  = 50;

    constexpr uint32 LIGHTWELL_CAST_INTERVAL_MS              = 3000;
    constexpr float  LIGHTWELL_HEAL_RANGE                    = 30.0f;

    // Lightwell NPC entries, paired with the Lightwell Renew rank and a matching
    // Flash Heal rank used for the new instant top-up cast (see CastOnLowestHealthAlly).
    struct LightwellRankData
    {
        uint32 npcEntry;
        uint32 renewSpellId;
        uint32 flashHealSpellId;
    };

    // NOTE: flashHealSpellId values are verified real "Flash Heal" spell IDs
    // (2061=R1, 9474=R4, 10915=R5, 25233=R8, 25235=R9, 48071=R11). Two earlier
    // picks (25236 = Execute, 48072 = Prayer of Healing) were wrong spells that
    // silently failed to cast on a friendly single target - do not reuse those.
    constexpr LightwellRankData LIGHTWELL_RANKS[] =
    {
        { 31897, 7001,  2061  }, // Rank 1
        { 31896, 27873, 9474  }, // Rank 2
        { 31895, 27874, 10915 }, // Rank 3
        { 31894, 28276, 25233 }, // Rank 4
        { 31893, 48084, 25235 }, // Rank 5
        { 31883, 48085, 48071 }, // Rank 6
    };

    LightwellRankData const* GetLightwellRankData(uint32 npcEntry)
    {
        for (LightwellRankData const& rank : LIGHTWELL_RANKS)
            if (rank.npcEntry == npcEntry)
                return &rank;

        return nullptr;
    }

    // Per-creature cast timer, stored on the Lightwell instance itself so the same countdown
    // works no matter which CreatureAI (if any) actually ends up attached to it.
    class Uint32Data : public DataMap::Base
    {
    public:
        explicit Uint32Data(uint32 initial = 0) : value(initial) { }
        uint32 value;
    };

    // Finds the lowest health-percent ally (party/raid member of owner, or owner itself
    // when unfriended) within range of me that isn't already at full health.
    Unit* SelectLowestHealthAlly(Creature* me, Unit* owner, float range)
    {
        Unit* result = nullptr;
        float lowestPct = 100.0f;

        auto consider = [&](Unit* unit)
        {
            if (!unit || !unit->IsAlive() || unit->IsFullHealth())
                return;

            if (!me->IsWithinDistInMap(unit, range))
                return;

            float pct = unit->GetHealthPct();
            if (!result || pct < lowestPct)
            {
                result = unit;
                lowestPct = pct;
            }
        };

        Player* ownerPlayer = owner->ToPlayer();
        Group* group = ownerPlayer ? ownerPlayer->GetGroup() : nullptr;
        if (group)
        {
            for (GroupReference* itr = group->GetFirstMember(); itr != nullptr; itr = itr->next())
                if (Player* member = itr->GetSource())
                    consider(member);
        }
        else
        {
            consider(owner);
        }

        return result;
    }
}

// -47509 - Divine Aegis (mod-priest-expanded override)
// Pools overhealing into an absorb shield instead of converting a % of crit heals.
// Proc no longer requires a critical heal (see data/sql/db-world spell_proc_event override).
class spell_priest_expanded_divine_aegis : public AuraScript
{
    PrepareAuraScript(spell_priest_expanded_divine_aegis);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_PRIEST_DIVINE_AEGIS });
    }

    bool CheckProc(ProcEventInfo& eventInfo)
    {
        HealInfo* healInfo = eventInfo.GetHealInfo();
        return healInfo && eventInfo.GetProcTarget() && healInfo->GetHeal() > healInfo->GetEffectiveHeal();
    }

    void HandleProc(AuraEffect const* aurEff, ProcEventInfo& eventInfo)
    {
        PreventDefaultAction();

        HealInfo* healInfo = eventInfo.GetHealInfo();
        Unit* procTarget = eventInfo.GetProcTarget();
        if (!healInfo || !procTarget)
            return;

        int32 overheal = int32(healInfo->GetHeal() - healInfo->GetEffectiveHeal());
        if (overheal <= 0)
            return;

        int32 absorb = overheal;

        // Divine Aegis shields stack, so add to any existing shield on the target.
        if (AuraEffect const* aegis = procTarget->GetAuraEffect(SPELL_PRIEST_DIVINE_AEGIS, EFFECT_0))
            absorb += aegis->GetAmount();

        // Cap the total absorb at 50% of the target's max health.
        absorb = std::min(absorb, int32(procTarget->CountPctFromMaxHealth(DIVINE_AEGIS_MAX_ABSORB_HEALTH_PCT)));

        GetTarget()->CastCustomSpell(SPELL_PRIEST_DIVINE_AEGIS, SPELLVALUE_BASE_POINT0, absorb, procTarget, true, nullptr, aurEff);
    }

    void Register() override
    {
        DoCheckProc += AuraCheckProcFn(spell_priest_expanded_divine_aegis::CheckProc);
        OnEffectProc += AuraEffectProcFn(spell_priest_expanded_divine_aegis::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }
};

// -15286 - Vampiric Embrace (mod-priest-expanded override)
// Effectively Divine Aegis for damage instead of healing: pools a % of damage dealt into a
// Void Shield absorb (15290) on the priest and their group, instead of the vanilla
// self-heal-on-damage-dealt effect. Portable version of the mechanic that used to be
// hardcoded in Unit::HandleDummyAuraProc (case 15286) in core Unit.cpp - registering this
// AuraScript's OnEffectProc + PreventDefaultAction() fully supersedes that hardcoded case
// (CallScriptEffectProcHandlers short-circuits it once a script handles the proc), so the
// core case was removed rather than left as unreachable dead code.
class spell_priest_expanded_vampiric_embrace : public AuraScript
{
    PrepareAuraScript(spell_priest_expanded_vampiric_embrace);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_PRIEST_VOID_SHIELD });
    }

    bool CheckProc(ProcEventInfo& eventInfo)
    {
        Unit* victim = eventInfo.GetProcTarget();
        if (!victim || !victim->IsAlive())
            return false;

        // Original vanilla exclusion: doesn't proc off this Priest spell family flag.
        SpellInfo const* procSpell = eventInfo.GetSpellInfo();
        if (procSpell && (procSpell->SpellFamilyFlags[1] & 0x80000))
            return false;

        DamageInfo* damageInfo = eventInfo.GetDamageInfo();
        return damageInfo && damageInfo->GetDamage() > 0;
    }

    void HandleProc(AuraEffect const* aurEff, ProcEventInfo& eventInfo)
    {
        PreventDefaultAction();

        Player* priest = GetTarget()->ToPlayer();
        if (!priest)
            return;

        DamageInfo* damageInfo = eventInfo.GetDamageInfo();
        if (!damageInfo)
            return;

        int32 total = CalculatePct(int32(damageInfo->GetDamage()), aurEff->GetAmount());
        if (total <= 0)
            return;

        // Cap is based on the priest's own max health, applied uniformly to every
        // recipient (matches the original mechanic).
        int32 maxShieldAmount = int32(priest->CountPctFromMaxHealth(VAMPIRIC_EMBRACE_MAX_SHIELD_HEALTH_PCT));

        auto applyShield = [&](Unit* shieldTarget)
        {
            if (!shieldTarget || !shieldTarget->IsAlive())
                return;

            // Void Shield stacks (merges), so add to any existing shield on the target.
            if (Aura* existing = shieldTarget->GetAura(SPELL_PRIEST_VOID_SHIELD, priest->GetGUID()))
            {
                for (uint8 i = 0; i < MAX_SPELL_EFFECTS; ++i)
                {
                    if (AuraEffect* shieldEff = existing->GetEffect(i))
                    {
                        if (shieldEff->GetAuraType() == SPELL_AURA_SCHOOL_ABSORB)
                        {
                            int32 amount = std::abs(shieldEff->GetAmount());
                            shieldEff->SetAmount(std::min(amount + total, maxShieldAmount));
                            existing->RefreshDuration();
                            return;
                        }
                    }
                }
            }

            CustomSpellValues values;
            values.AddSpellMod(SPELLVALUE_BASE_POINT0, 0);
            values.AddSpellMod(SPELLVALUE_BASE_POINT1, std::min(total, maxShieldAmount));
            shieldTarget->CastCustomSpell(SPELL_PRIEST_VOID_SHIELD, values, shieldTarget,
                TRIGGERED_FULL_MASK, nullptr, aurEff, priest->GetGUID());
        };

        applyShield(priest);

        if (Group* group = priest->GetGroup())
        {
            for (GroupReference* itr = group->GetFirstMember(); itr != nullptr; itr = itr->next())
            {
                Player* member = itr->GetSource();
                if (!member || member == priest)
                    continue;
                if (!priest->IsInSameGroupWith(member))
                    continue;
                if (!member->IsInMap(priest))
                    continue;

                applyShield(member);
            }
        }
    }

    void Register() override
    {
        DoCheckProc += AuraCheckProcFn(spell_priest_expanded_vampiric_embrace::CheckProc);
        OnEffectProc += AuraEffectProcFn(spell_priest_expanded_vampiric_embrace::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }
};

// -7001 - Lightwell Renew (mod-priest-expanded override)
// Keeps the vanilla Glyph of Lightwell scaling; re-registered here because Lightwell is now
// driven entirely by npc_pet_pri_lightwell_expanded instead of the vanilla spellclick model.
class spell_priest_expanded_lightwell_renew : public AuraScript
{
    PrepareAuraScript(spell_priest_expanded_lightwell_renew);

    void CalculateAmount(AuraEffect const* /*aurEff*/, int32& amount, bool& /*canBeRecalculated*/)
    {
        if (Unit* caster = GetCaster())
            if (AuraEffect* modHealing = caster->GetAuraEffect(SPELL_PRIEST_GLYPH_OF_LIGHTWELL, EFFECT_0))
                AddPct(amount, modHealing->GetAmount());
    }

    void Register() override
    {
        DoEffectCalcAmount += AuraEffectCalcAmountFn(spell_priest_expanded_lightwell_renew::CalculateAmount, EFFECT_0, SPELL_AURA_PERIODIC_HEAL);
    }
};

// npc_pet_pri_lightwell_expanded (mod-priest-expanded override)
// Handles Lightwell's health/level scaling on summon. NOTE: the actual "cast every 3 seconds"
// logic does NOT live here - see PriestExpandedLightwellUnitScript below. On this server
// casting the Lightwell summon spell creates a real Pet (character_pet gets a row, PetType
// SUMMON_PET), and CreatureAISelector::SelectAI() hardcodes "if (creature->IsPet()) return
// PetAI" BEFORE it ever consults creature_template.ScriptName - so this custom TotemAI-derived
// class never actually runs for it, PetAI does instead. Keeping InitializeAI here still helps
// in case Lightwell is ever summoned as a plain totem (non-Pet) in some other context.
struct npc_pet_pri_lightwell_expanded : public TotemAI
{
    npc_pet_pri_lightwell_expanded(Creature* creature) : TotemAI(creature) { }

    void InitializeAI() override
    {
        if (TempSummon* tempSummon = me->ToTempSummon())
        {
            if (Unit* owner = tempSummon->GetSummonerUnit())
            {
                uint32 hp = uint32(owner->GetMaxHealth() * 0.3f);
                me->SetMaxHealth(hp);
                me->SetHealth(hp);
                me->SetLevel(owner->GetLevel());
            }
        }

        TotemAI::InitializeAI();
    }
};

// Drives Lightwell's periodic cast regardless of which CreatureAI (TotemAI vs the hardcoded
// PetAI forced on real Pets) ends up attached to it. UnitScript::OnUnitUpdate fires from
// Unit::Update() for every unit every tick, completely independent of CreatureAI selection,
// so this works whether Lightwell is a plain totem or a real Pet. Lightwell now casts
// indefinitely for as long as it exists, like a normal healer pet - no charge limit.
class PriestExpandedLightwellUnitScript : public UnitScript
{
public:
    PriestExpandedLightwellUnitScript() : UnitScript("PriestExpandedLightwellUnitScript") { }

    void OnUnitUpdate(Unit* unit, uint32 diff) override
    {
        Creature* creature = unit->ToCreature();
        if (!creature)
            return;

        LightwellRankData const* rank = GetLightwellRankData(creature->GetEntry());
        if (!rank)
            return;

        Uint32Data* timer = creature->CustomData.Get<Uint32Data>("LightwellCastTimer");
        if (!timer)
        {
            timer = new Uint32Data(LIGHTWELL_CAST_INTERVAL_MS);
            creature->CustomData.Set("LightwellCastTimer", timer);
        }

        if (timer->value > diff)
        {
            timer->value -= diff;
            return;
        }

        timer->value = LIGHTWELL_CAST_INTERVAL_MS;

        Unit* owner = creature->GetOwner();
        if (!owner)
            return;

        Unit* target = SelectLowestHealthAlly(creature, owner, LIGHTWELL_HEAL_RANGE);
        if (!target)
            return;

        // Triggered (instant, uninterruptible) casts - Flash Heal has a real cast time, and
        // casting Renew right after it with a normal (non-triggered) cast would interrupt it.
        creature->CastSpell(target, rank->flashHealSpellId, true);
        creature->CastSpell(target, rank->renewSpellId, true);
    }
};

// Grants Lightwell 50% of its owner's healing power on every heal it casts (Flash Heal and
// each Lightwell Renew tick both go through Unit::HealBySpell -> ModifyHealReceived, so this
// covers both with one hook instead of hand-computing heal amounts per spell).
class PriestExpandedLightwellHealBonusScript : public UnitScript
{
public:
    PriestExpandedLightwellHealBonusScript() : UnitScript("PriestExpandedLightwellHealBonusScript") { }

    void ModifyHealReceived(Unit* /*target*/, Unit* healer, uint32& heal, SpellInfo const* spellInfo) override
    {
        if (!healer || heal == 0)
            return;

        Creature* creature = healer->ToCreature();
        if (!creature || !GetLightwellRankData(creature->GetEntry()))
            return;

        Unit* owner = creature->GetOwner();
        if (!owner)
            return;

        SpellSchoolMask schoolMask = spellInfo ? spellInfo->GetSchoolMask() : SPELL_SCHOOL_MASK_HOLY;
        int32 bonus = int32(owner->SpellBaseHealingBonusDone(schoolMask) * 0.5f);
        if (bonus > 0)
            heal += uint32(bonus);
    }
};

void Addmod_priest_expandedScripts()
{
    extern void AddPsychicLinkScripts();

    RegisterSpellScript(spell_priest_expanded_divine_aegis);
    RegisterSpellScript(spell_priest_expanded_vampiric_embrace);
    RegisterSpellScript(spell_priest_expanded_lightwell_renew);
    RegisterCreatureAI(npc_pet_pri_lightwell_expanded);
    new PriestExpandedLightwellUnitScript();
    new PriestExpandedLightwellHealBonusScript();
    AddPsychicLinkScripts();
}
