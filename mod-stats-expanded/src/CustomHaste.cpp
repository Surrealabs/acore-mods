#include "CustomHaste.h"
#include "StatsExpandedScaling.h"
#include "SharedDefines.h"

float CustomHaste::GetHastePercent(Player* player)
{
    if (!player)
        return 0.0f;
    
    // Haste reads from Defense Rating (CR 1) per SwappedStats.md
    // 10 rating = 1% haste at max level
    float hasteRating = (float)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_DEFENSE_SKILL));
    
    return StatsExpandedScaling::GetScaledConversion(player, "HASTE_RATING", hasteRating) / 100.0f;
}

uint32 CustomHaste::GetModifiedGCD(Player* player, uint32 baseGCD)
{
    float hastePct = GetHastePercent(player);
    
    // GCD reduction: 2% per percent of haste, capped at 750ms
    // Example: 50% haste = 100% GCD reduction (but capped to 750ms minimum)
    // baseGCD is typically 1500ms
    uint32 gcdReduction = uint32(baseGCD * (hastePct * 0.02f));  // 2% reduction per percent haste
    uint32 modifiedGCD = baseGCD - gcdReduction;
    
    // Cap at 750ms minimum
    return std::max(modifiedGCD, 750U);
}

void CustomHaste::ModifyCastTime(Player* player, uint32& castTime)
{
    if (castTime == 0)
        return;
    
    float hastePct = GetHastePercent(player);
    float hasteModifier = 1.0f / (1.0f + hastePct);
    
    castTime = uint32(castTime * hasteModifier);
}
