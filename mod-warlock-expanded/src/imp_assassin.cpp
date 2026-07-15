// imp_assassin.cpp — Imp Assassin AI & CreatureScript
// Combat AI only. Summoning, spell interactions, stat sync, and
// formation are handled by guardian_manager.cpp.

#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    constexpr uint32 DEADLY_POISON_CD_MS = 6000;
    constexpr uint32 RUPTURE_CD_MS       = 15000;
}

// ─── Imp Assassin combat AI ────────────────────────────────────────────────────
struct imp_assassin_ai : public CreatureAI
{
    explicit imp_assassin_ai(Creature* creature)
        : CreatureAI(creature),
          deadlyPoisonTimer(1000), ruptureTimer(3000),
          followingOwner(true) { }

    uint32 deadlyPoisonTimer;
    uint32 ruptureTimer;
    bool   followingOwner;

    void Reset() override
    {
        deadlyPoisonTimer = 1000;
        ruptureTimer      = 3000;
    }

    Player* OwnerPlayer() { return GetOwnerPlayer(me); }

    void UpdateAI(uint32 diff) override
    {
        Player* owner = OwnerPlayer();
        if (!owner || !owner->IsAlive())
        {
            if (me->GetVictim())
            {
                me->AttackStop();
                me->GetMotionMaster()->Clear();
            }
            return;
        }

        // Read shared combat state (written by guardian_manager)
        Unit* desiredTarget = ResolveOwnerTarget(owner);
        bool ownerIdle = IsOwnerIdle(owner);

        // If owner idle or no target, drop combat and follow
        if (ownerIdle || !desiredTarget)
        {
            if (me->GetVictim())
            {
                me->AttackStop();
                me->CombatStop(true);
                me->GetMotionMaster()->Clear();
            }
            if (!followingOwner)
            {
                float angle = GetGuardianFollowAngle(me, owner);
                me->GetMotionMaster()->MoveFollow(owner, MELEE_FOLLOW_DIST, angle);
                followingOwner = true;
            }
            return;
        }

        // Leash check
        if (me->GetDistance(owner) > LEASH_RANGE)
        {
            if (me->GetVictim())
            {
                me->AttackStop();
                me->CombatStop(true);
                me->GetMotionMaster()->Clear();
            }
            float angle = GetGuardianFollowAngle(me, owner);
            me->GetMotionMaster()->MoveFollow(owner, MELEE_FOLLOW_DIST, angle);
            followingOwner = true;
            return;
        }

        // Engage desired target
        if (me->GetVictim() != desiredTarget)
        {
            me->AttackStop();
            me->GetMotionMaster()->Clear();
            AttackStart(desiredTarget);
            followingOwner = false;
        }

        // Shadowstep if far from target
        if (me->GetDistance(desiredTarget) > 15.0f)
            me->CastSpell(desiredTarget, SPELL_SHADOWSTEP, true);

        if (!me->GetVictim()) return;
        Unit* victim = me->GetVictim();

        // ── DoT rotation (filler/heavy/special triggered by guardian_manager) ──
        if (deadlyPoisonTimer <= diff)
        {
            if (victim && victim->IsAlive())
                me->CastSpell(victim, SPELL_DEADLY_POISON, true);
            deadlyPoisonTimer = DEADLY_POISON_CD_MS;
        }
        else deadlyPoisonTimer -= diff;

        if (ruptureTimer <= diff)
        {
            if (victim && victim->IsAlive() && !victim->HasAura(SPELL_RUPTURE, me->GetGUID()))
                me->CastSpell(victim, SPELL_RUPTURE, true);
            ruptureTimer = RUPTURE_CD_MS;
        }
        else ruptureTimer -= diff;

        DoMeleeAttackIfReady();
    }

    void OnCharmed(bool /*apply*/) override { }
};

// ─── CreatureScript ────────────────────────────────────────────────────────────
class ImpAssassinCreatureScript : public CreatureScript
{
public:
    ImpAssassinCreatureScript() : CreatureScript("ImpAssassinCreatureScript") { }

    CreatureAI* GetAI(Creature* creature) const override
    {
        if (creature->GetEntry() == IMP_ASSASSIN_ENTRY)
            return new imp_assassin_ai(creature);
        return nullptr;
    }
};

void AddSC_ImpAssassin()
{
    new ImpAssassinCreatureScript();
}
