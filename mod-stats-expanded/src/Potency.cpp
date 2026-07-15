#include "Potency.h"
#include "StatsExpandedScaling.h"
#include "SharedDefines.h"

float Potency::GetPotencyModifier(Player* player)
{
    if (!player)
        return 1.0f;
    
    float armorPen = player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + CR_ARMOR_PENETRATION);
    float potencyPercent = StatsExpandedScaling::GetScaledConversion(player, "POTENCY_RATING", armorPen);
    
    // Convert to damage multiplier: 1% damage increase per rating point
    // Example: 120 armor pen rating = 1% damage increase = 1.01x multiplier
    return 1.0f + (potencyPercent / 100.0f);
}

void Potency::ModifyDamage(Player* player, uint32& damage)
{
    float modifier = GetPotencyModifier(player);
    damage = uint32(damage * modifier);
}
