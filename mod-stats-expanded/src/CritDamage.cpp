#include "CritDamage.h"
#include "StatsExpandedScaling.h"
#include "SharedDefines.h"

float CritDamage::GetCritDamageBonus(Player* player)
{
    if (!player)
        return 0.0f;
    
    // Crit reads from Dodge Rating (CR 2) per SwappedStats.md
    // 10 rating = 1% crit chance + 2% crit damage bonus
    float critRating = (float)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_DODGE));
    
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
