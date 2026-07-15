// destruction_mechanics.cpp
// Destruction warlock spec mechanics:
//   1. Searing Pain (5676) reduces Chaos Bolt (50796) cooldown by 2s per cast
//   2. Conflagrate (17962) refreshes Immolate (348) duration instead of consuming it
//   3. Chaos Bolt (50796) adds +1 stack of Immolation Aura (900008) on ALL active infernals (max 5)

#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    constexpr int32  CHAOS_BOLT_CD_REDUCTION_MS = -2000;  // reduce CD by 2 seconds
    constexpr uint8  MAX_IMMOLATION_STACKS   = 5;
}

class DestructionMechanicsSpellScript : public AllSpellScript
{
public:
    DestructionMechanicsSpellScript() : AllSpellScript("DestructionMechanicsSpellScript") { }

    void OnSpellCast(Spell* spell, Unit* caster,
                     SpellInfo const* spellInfo, bool /*skipCheck*/) override
    {
        if (!spell || !caster || !spellInfo)
            return;

        Player* player = GetWarlockCaster(caster);
        if (!player)
            return;

        uint32 spellId = spellInfo->Id;

        // ── Searing Pain → reduce Chaos Bolt cooldown ──────────────────────
        if (spellId == SEARING_PAIN_SPELL)
        {
            if (player->HasSpellCooldown(CHAOS_BOLT_SPELL))
                player->ModifySpellCooldown(CHAOS_BOLT_SPELL, CHAOS_BOLT_CD_REDUCTION_MS);
            return;
        }

        // ── Conflagrate → refresh Immolate instead of consuming it ─────────
        if (spellId == CONFLAGRATE_SPELL)
        {
            Unit* target = spell->m_targets.GetUnitTarget();
            if (!target)
                return;

            // Find the warlock's Immolate aura on the target and refresh it
            Aura* immolate = target->GetAura(IMMOLATE_SPELL, player->GetGUID());
            if (immolate)
                RefreshAura(player, target, IMMOLATE_SPELL);
        }

        // ── Chaos Bolt → add +1 stack of Immolation Aura on all living infernals
        if (spellId == CHAOS_BOLT_SPELL)
        {
            std::list<Creature*> infernals;
            GetPlayerInfernals(player, infernals);
            for (Creature* infernal : infernals)
            {
                Aura* aura = infernal->GetAura(IMMOLATION_AURA_SPELL);
                if (aura)
                {
                    if (aura->GetStackAmount() < MAX_IMMOLATION_STACKS)
                        aura->ModStackAmount(1);
                }
                else
                {
                    infernal->CastSpell(infernal, IMMOLATION_AURA_SPELL, true);
                }
            }
        }
    }
};

// ─── Infernal AI: stick to owner's target, melee forever ───────────────────────
struct infernal_ai : public CreatureAI
{
    explicit infernal_ai(Creature* creature)
        : CreatureAI(creature) { }

    Player* OwnerPlayer()
    {
        return WarlockExpanded::GetOwnerPlayer(me);
    }

    void UpdateAI(uint32 /*diff*/) override
    {
        Player* owner = OwnerPlayer();
        if (!owner || !owner->IsAlive())
            return;

        // Always follow owner's current target
        Unit* ownerTarget = owner->GetVictim();
        if (ownerTarget && ownerTarget->IsAlive() && me->IsValidAttackTarget(ownerTarget))
        {
            if (me->GetVictim() != ownerTarget)
            {
                me->AttackStop();
                me->GetMotionMaster()->Clear();
                AttackStart(ownerTarget);
            }
        }
        else if (!ownerTarget)
        {
            // Also try selected target
            Unit* sel = owner->GetSelectedUnit();
            if (sel && sel->IsAlive() && me->IsValidAttackTarget(sel))
            {
                if (me->GetVictim() != sel)
                {
                    me->AttackStop();
                    me->GetMotionMaster()->Clear();
                    AttackStart(sel);
                }
            }
        }

        if (!me->GetVictim())
            return;

        DoMeleeAttackIfReady();
    }

    void OnCharmed(bool /*apply*/) override { }
};

class InfernalCreatureScript : public CreatureScript
{
public:
    InfernalCreatureScript() : CreatureScript("InfernalCreatureScript") { }

    CreatureAI* GetAI(Creature* creature) const override
    {
        if (creature->GetEntry() == INFERNAL_ENTRY)
            return new infernal_ai(creature);
        return nullptr;
    }
};

void AddSC_DestructionMechanics()
{
    new DestructionMechanicsSpellScript();
    new InfernalCreatureScript();
}
