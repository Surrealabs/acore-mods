#include "CritDamage.h"
#include "StatsExpandedScaling.h"
#include "StatsExpandedData.h"
#include "SharedDefines.h"

float CritDamage::GetCritDamageBonus(Player* player)
{
    if (!player)
        return 0.0f;

    // Crit reads from Dodge Rating (CR 2) per SwappedStats.md
    // 10 rating = 1% crit chance + 2% crit damage bonus
    //
    // NOTE: the live CR_DODGE combat rating field can NOT be read directly
    // here — UpdateDerivedStats() (mod_stats_expanded.cpp) reads it once
    // per recalc (login/equip/unequip/level-change), caches the raw value
    // into CustomData["Crit"], and then explicitly ZEROES CR_DODGE back
    // out (it's just a transport slot from gear item stats, not a real
    // stat). Since this function is called from ModifyCritDamageBonus on
    // every actual crit hit — i.e. well after that neutralization has
    // already run — reading CR_DODGE directly here always returned 0,
    // meaning the crit damage bonus never actually applied in real combat
    // regardless of what any tooltip/addon showed. Read the cached value
    // instead, same pattern as ignite_mastery.cpp's Mastery fix.
    FloatData* crit = player->CustomData.Get<FloatData>("Crit");
    float critRating = crit ? crit->value : 0.0f;

    // 10 rating = 2% crit damage (5 rating per 1% bonus)
    return StatsExpandedScaling::GetScaledConversion(player, "CRIT_DAMAGE_RATING", critRating) / 100.0f;
}

void CritDamage::ModifyCriticalDamage(Player* player, uint32& damage)
{
    // Base crit is 200%, add bonus crit damage on top
    float critBonus = GetCritDamageBonus(player);
    float totalMultiplier = BASE_CRIT_MULTIPLIER + critBonus;
    
    damage = uint32(damage * totalMultiplier);
}
