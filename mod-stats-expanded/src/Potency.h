#ifndef POTENCY_H
#define POTENCY_H

#include "Player.h"

class Potency
{
public:
    // Get potency damage modifier from armor penetration rating
    static float GetPotencyModifier(Player* player);
    
    // Apply potency damage increase
    static void ModifyDamage(Player* player, uint32& damage);
    
private:
    static constexpr float POTENCY_RATING_CONVERSION = 1.0f; // 1 rating = 1 potency
    static constexpr float POTENCY_TO_PERCENT = 0.01f; // 1 potency = 0.01% damage
};

#endif
