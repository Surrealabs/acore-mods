/*
 * ════════════════════════════════════════════════════════════════════════
 *  Heroic Strikes — Passive (Spell 78)
 *
 *  Every 3rd melee auto-attack deals bonus Heroic Strike damage.
 *  The DBC spell should be:
 *    - Passive attribute
 *    - Effect 0: SPELL_EFFECT_APPLY_AURA (6)
 *    - Aura:     SPELL_AURA_DUMMY (4)
 *    - NO periodic trigger, NO damage effect
 * ════════════════════════════════════════════════════════════════════════
 */

#include "ScriptMgr.h"
#include "Player.h"
#include "Unit.h"
#include "SpellAuras.h"
#include <unordered_map>

enum HeroicStrikesConfig
{
    SPELL_HEROIC_STRIKES_PASSIVE = 78,       // The passive aura the warrior learns
    SPELL_HEROIC_STRIKE_CAST     = 900016,   // The actual Heroic Strike spell to cast
    ATTACKS_TO_TRIGGER           = 3,         // Every Nth auto-attack
};

class mod_warrior_heroic_strikes : public UnitScript
{
public:
    mod_warrior_heroic_strikes() : UnitScript("mod_warrior_heroic_strikes") {}

    uint32 DealDamage(Unit* attacker, Unit* victim, uint32 damage, DamageEffectType damagetype) override
    {
        // Only melee auto-attacks (DIRECT_DAMAGE), not spells/dots
        if (damagetype != DIRECT_DAMAGE)
            return damage;

        // Must be a warrior player
        Player* player = attacker ? attacker->ToPlayer() : nullptr;
        if (!player || player->getClass() != CLASS_WARRIOR)
            return damage;

        // Must have the passive aura
        if (!player->HasAura(SPELL_HEROIC_STRIKES_PASSIVE))
            return damage;

        // Don't count hits on friendly targets or totems
        if (!victim || !victim->IsAlive() || !player->IsHostileTo(victim))
            return damage;

        // Increment auto-attack counter
        uint64 guid = player->GetGUID().GetCounter();
        uint8& count = _attackCounter[guid];
        count++;

        if (count >= ATTACKS_TO_TRIGGER)
        {
            count = 0;
            player->CastSpell(victim, SPELL_HEROIC_STRIKE_CAST, true);
        }

        return damage;
    }

private:
    static std::unordered_map<uint64, uint8> _attackCounter;
};

std::unordered_map<uint64, uint8> mod_warrior_heroic_strikes::_attackCounter;

void AddHeroicStrikesScripts()
{
    new mod_warrior_heroic_strikes();
}
