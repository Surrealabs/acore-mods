// imp_warlock.cpp — Imp Warlock AI & CreatureScript
// Imp AI handles casting rotation (Shadow Bolt + Soul Fire custom copies)
// and death effects (Decimation aura). Summoning, spell echoes, damage
// calculation, formation, and mana generation are handled by
// guardian_manager.cpp.

#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    constexpr uint32 SHADOW_BOLT_CD_MS  = 12000;
    constexpr uint32 SOUL_FIRE_CD_MS    = 8000;
    constexpr float  IMP_CAST_RANGE     = 40.0f;
}

// ─── Imp Warlock AI ────────────────────────────────────────────────────────────
struct imp_warlock_ai : public CreatureAI
{
    explicit imp_warlock_ai(Creature* creature)
        : CreatureAI(creature),
          shadowBoltTimer(1000), soulFireTimer(4000) { }

    uint32 shadowBoltTimer;
    uint32 soulFireTimer;

    void Reset() override
    {
        shadowBoltTimer = 1000;
        soulFireTimer   = 4000;
    }

    void UpdateAI(uint32 diff) override
    {
        Player* owner = GetOwnerPlayer(me);
        if (!owner || !owner->IsAlive())
            return;

        Unit* target = ResolveOwnerTarget(owner);
        if (!target || !target->IsAlive() || IsOwnerIdle(owner))
            return;

        // Imps stay near the warlock — only cast if in range
        if (me->GetDistance(target) > IMP_CAST_RANGE)
            return;

        // ── Casting rotation (filler/heavy/special triggered by guardian_manager) ──
        if (shadowBoltTimer <= diff)
        {
            if (target && target->IsAlive())
                me->CastSpell(target, IMP_SHADOW_BOLT, true);
            shadowBoltTimer = SHADOW_BOLT_CD_MS;
        }
        else shadowBoltTimer -= diff;

        if (soulFireTimer <= diff)
        {
            if (target && target->IsAlive())
                me->CastSpell(target, IMP_SOUL_FIRE, true);
            soulFireTimer = SOUL_FIRE_CD_MS;
        }
        else soulFireTimer -= diff;
    }

    void OnCharmed(bool /*apply*/) override { }

    void JustDied(Unit* /*killer*/) override
    {
        if (Unit* owner = me->GetOwner())
            if (Player* player = owner->ToPlayer())
                player->AddAura(DECIMATION_AURA, player);
    }
};

// ─── CreatureScript ────────────────────────────────────────────────────────────
class ImpWarlockCreatureScript : public CreatureScript
{
public:
    ImpWarlockCreatureScript() : CreatureScript("ImpWarlockCreatureScript") { }

    CreatureAI* GetAI(Creature* creature) const override
    {
        if (creature->GetEntry() == WILD_IMP_ENTRY)
            return new imp_warlock_ai(creature);
        return nullptr;
    }
};

void AddSC_ImpWarlock()
{
    new ImpWarlockCreatureScript();
}
