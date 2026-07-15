// affliction_mechanics.cpp
// Affliction warlock spec mechanics:
//   1. Drain Soul (1120): each periodic tick adds a stack of Curse of Agony (980)
//      on the target and deals instant shadow damage (via dummy spell 900011)
//      equal to CoA's per-tick damage × current stacks. Can crit.
//      Also reduces Haunt cooldown by 0.5s per tick.
//   2. Haunt (48181): on cast, refreshes the duration of Curse of Agony (980)
//      and Everlasting Affliction (30108) on the target.

#include "warlock_expanded.h"

using namespace WarlockExpanded;

// ─── Drain Soul: tick all DoTs on each periodic damage event ───────────────────
class AfflictionDrainSoulUnitScript : public UnitScript
{
public:
    AfflictionDrainSoulUnitScript()
        : UnitScript("AfflictionDrainSoulUnitScript", true,
                      { UNITHOOK_MODIFY_PERIODIC_DAMAGE_AURAS_TICK }) { }

    void ModifyPeriodicDamageAurasTick(Unit* target, Unit* attacker,
                                       uint32& /*damage*/,
                                       SpellInfo const* spellInfo) override
    {
        if (!spellInfo || spellInfo->Id != DRAIN_SOUL_SPELL)
            return;

        if (!attacker || !attacker->IsPlayer())
            return;

        Player* warlock = attacker->ToPlayer();
        if (!warlock || warlock->getClass() != CLASS_WARLOCK)
            return;

        if (!target || !target->IsAlive())
            return;

        // Add a stack of Curse of Agony on the target
        Aura* coa = target->GetAura(CURSE_OF_AGONY_SPELL, warlock->GetGUID());
        if (coa)
        {
            coa->ModStackAmount(1);
        }
        else
        {
            // Apply CoA if not already present
            warlock->CastSpell(target, CURSE_OF_AGONY_SPELL, true);
            coa = target->GetAura(CURSE_OF_AGONY_SPELL, warlock->GetGUID());
        }

        // Deal instant agony damage via dummy spell 900011
        // Damage = (BasePoints% of CoA per-tick amount) × current stacks, can crit
        if (coa)
        {
            SpellInfo const* dummyInfo = sSpellMgr->GetSpellInfo(INSTANT_AGONY_SPELL);
            if (dummyInfo)
            {
                // Get the coefficient from the dummy spell's base points (e.g. 20 = 20%)
                float coeff = static_cast<float>(dummyInfo->Effects[EFFECT_0].CalcValue()) / 100.0f;

                // Get CoA periodic damage amount
                uint32 coaDmg = 0;
                for (uint8 i = 0; i < MAX_SPELL_EFFECTS; ++i)
                {
                    AuraEffect* eff = coa->GetEffect(i);
                    if (eff && eff->GetAuraType() == SPELL_AURA_PERIODIC_DAMAGE)
                    {
                        coaDmg = static_cast<uint32>(eff->GetAmount());
                        break;
                    }
                }

                uint32 stacks = coa->GetStackAmount();
                uint32 totalDmg = static_cast<uint32>(coaDmg * stacks * coeff);

                if (totalDmg > 0)
                {
                    // Roll crit using warlock's shadow spell crit chance
                    float critChance = warlock->GetFloatValue(PLAYER_SPELL_CRIT_PERCENTAGE1 + SPELL_SCHOOL_SHADOW);
                    bool isCrit = roll_chance_f(critChance);

                    if (isCrit)
                        totalDmg = Unit::SpellCriticalDamageBonus(warlock, dummyInfo, totalDmg, target);

                    SpellNonMeleeDamage damageInfo(warlock, target, dummyInfo, SPELL_SCHOOL_MASK_SHADOW);
                    damageInfo.damage = totalDmg;
                    if (isCrit)
                        damageInfo.HitInfo |= SPELL_HIT_TYPE_CRIT;
                    Unit::DealDamageMods(target, damageInfo.damage, &damageInfo.absorb);
                    warlock->SendSpellNonMeleeDamageLog(&damageInfo);
                    warlock->DealSpellDamage(&damageInfo, false);
                }
            }
        }

        // Reduce Haunt cooldown by 0.5 sec per tick
        warlock->ModifySpellCooldown(HAUNT_SPELL, -500);
    }
};

// ─── Haunt: refresh CoA and Everlasting Affliction on cast ─────────────────────
class AfflictionHauntSpellScript : public AllSpellScript
{
public:
    AfflictionHauntSpellScript() : AllSpellScript("AfflictionHauntSpellScript") { }

    void OnSpellCast(Spell* spell, Unit* caster,
                     SpellInfo const* spellInfo, bool /*skipCheck*/) override
    {
        if (!spell || !caster || !spellInfo)
            return;

        if (spellInfo->Id != HAUNT_SPELL)
            return;

        if (!caster->IsPlayer())
            return;

        Player* warlock = caster->ToPlayer();
        if (!warlock || warlock->getClass() != CLASS_WARLOCK)
            return;

        Unit* target = spell->m_targets.GetUnitTarget();
        if (!target)
            return;

        RefreshAura(warlock, target, CURSE_OF_AGONY_SPELL);
        RefreshAura(warlock, target, EVERLASTING_AFFLICTION);
    }
};

void AddSC_AfflictionMechanics()
{
    new AfflictionDrainSoulUnitScript();
    new AfflictionHauntSpellScript();
}
