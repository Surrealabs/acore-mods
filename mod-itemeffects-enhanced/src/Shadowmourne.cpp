#include "Shadowmourne.h"
#include "ScriptMgr.h"
#include "ScriptDefines/UnitScript.h"
#include "Player.h"
#include "Unit.h"
#include "SpellAuras.h"
#include "SpellAuraEffects.h"
#include "Map.h"

using namespace Shadowmourne;

// ════════════════════════════════════════════════════════════════════════
//  Shadowmourne — Standalone UnitScript
//
//  On every melee hit (DIRECT_DAMAGE) by a player who has the
//  Shadowmourne equip aura (71903), there is a 75% chance to gain a
//  Soul Fragment stack.  At 10 stacks the fragments are consumed and
//  Chaos Bane fires.  Disabled while Chaos Bane buff is active.
//  Does NOT proc inside battlegrounds / arenas.
// ════════════════════════════════════════════════════════════════════════

class ShadowmourneUnitScript : public UnitScript
{
public:
    ShadowmourneUnitScript() : UnitScript("ShadowmourneUnitScript") {}

    uint32 DealDamage(Unit* attacker, Unit* /*victim*/, uint32 damage, DamageEffectType damagetype) override
    {
        if (!attacker || damage == 0 || damagetype != DIRECT_DAMAGE)
            return damage;

        Player* player = attacker->ToPlayer();
        if (!player)
            return damage;

        // Must have Shadowmourne equipped (passive aura 71903)
        if (!player->HasAura(SHADOWMOURNE_EQUIP_AURA))
            return damage;

        // Don't proc while Chaos Bane buff is still active
        if (player->HasAura(CHAOS_BANE_BUFF))
            return damage;

        // No Shadowmourne procs in BGs / arenas
        if (player->FindMap() && player->FindMap()->IsBattlegroundOrArena())
            return damage;

        // Roll for a Soul Fragment
        if (!roll_chance_i(PROC_CHANCE))
            return damage;

        player->CastSpell(player, SOUL_FRAGMENT, true);

        // Check if we've hit the threshold
        if (Aura* fragments = player->GetAura(SOUL_FRAGMENT))
        {
            if (fragments->GetStackAmount() >= FRAGMENTS_TO_RELEASE)
            {
                player->CastSpell(player, CHAOS_BANE_DAMAGE, true);
                fragments->Remove();
            }
        }

        return damage;
    }
};

void AddShadowmourneScripts()
{
    new ShadowmourneUnitScript();
}
