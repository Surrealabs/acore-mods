#include "Versatility.h"
#include "StatsExpandedScaling.h"
#include "SharedDefines.h"

float Versatility::GetVersatilityPercent(Player* player)
{
    if (!player)
        return 0.0f;
    
    // Versatility reads from Hit Melee Rating (CR 5) per SwappedStats.md
    // 10 rating = 1% versatility
    float hitMeleeRating = (float)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_HIT_MELEE));
    return StatsExpandedScaling::GetScaledConversion(player, "VERSATILITY_RATING", hitMeleeRating);
}

float Versatility::GetDamageModifier(Player* player)
{
    float versPct = GetVersatilityPercent(player);
    return 1.0f + (versPct / 100.0f);
}

float Versatility::GetDamageTakenModifier(Player* player)
{
    // -0.5% damage taken per 1% versatility per SwappedStats.md
    float versPct = GetVersatilityPercent(player);
    return 1.0f - (versPct * 0.5f / 100.0f);
}

void Versatility::ModifyDamageDealt(Player* player, uint32& damage)
{
    float modifier = GetDamageModifier(player);
    damage = uint32(damage * modifier);
}

void Versatility::ModifyDamageTaken(Player* player, uint32& damage)
{
    float modifier = GetDamageTakenModifier(player);
    damage = uint32(damage * modifier);
}
