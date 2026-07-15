#ifndef MULTISTRIKE_H
#define MULTISTRIKE_H

#include "Player.h"
#include "SpellInfo.h"

class Multistrike
{
public:
    // Calculate multistrike chance from resilience rating
    static float GetMultistrikeChance(Player* player);
    
    // Check if spell should multistrike
    static bool RollMultistrike(Player* player);
    
    // Process multistrike spell (duplicate cast at 50% effectiveness)
    static void ProcessMultistrike(Player* player, Unit* victim, SpellInfo const* spellInfo, uint32 originalDamage);
    
private:
    static constexpr float MULTISTRIKE_RATING_CONVERSION = 1.0f; // 1 rating = 1% chance
    static constexpr float MULTISTRIKE_EFFECTIVENESS = 0.33f; // 33% of original damage per SwappedStats.md
};

#endif
