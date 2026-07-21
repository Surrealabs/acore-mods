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

        // Must have the passive learned. Checking HasSpell() instead of HasAura() here on
        // purpose: this is a self-cast (TARGET_UNIT_CASTER) Dummy aura, so it only actually
        // gets applied if something casts it once after it's learned. If the talent system
        // grants it by inserting straight into character_spell (no auto-cast on learn), the
        // warrior has the spell but the aura is never actually up, and HasAura() silently
        // never procs. HasSpell() only depends on spellbook knowledge, not aura state.
        if (!player->HasSpell(SPELL_HEROIC_STRIKES_PASSIVE))
            return damage;

        // Any real attack target counts (including Training Dummies, which are friendly
        // Creatures, not hostile, but perfectly valid to test/farm this rotation against).
        // We only need to explicitly exclude the warrior themself and friendly players
        // (party/raid members, or any other player not currently hostile - e.g. not dueling).
        // Non-player targets (Training Dummies included) are never excluded by this check.
        if (!victim || !victim->IsAlive() || victim == player)
            return damage;

        if (Player* victimPlayer = victim->ToPlayer())
        {
            if (!player->IsHostileTo(victimPlayer))
                return damage;
        }

        // Increment auto-attack counter
        uint64 guid = player->GetGUID().GetCounter();
        uint8& count = _attackCounter[guid];
        count++;

        if (count >= ATTACKS_TO_TRIGGER)
        {
            count = 0;
            SpellCastResult result = player->CastSpell(victim, SPELL_HEROIC_STRIKE_CAST, true);
            if (result != SPELL_CAST_OK)
                LOG_ERROR("scripts", "mod_warrior_heroic_strikes: CastSpell({}) on {} by {} failed with result {}",
                    uint32(SPELL_HEROIC_STRIKE_CAST), victim->GetGUID().ToString(), player->GetGUID().ToString(), uint32(result));
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
