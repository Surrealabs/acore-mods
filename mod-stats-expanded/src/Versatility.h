#ifndef VERSATILITY_H
#define VERSATILITY_H

#include "Player.h"

class Versatility
{
public:
    // Get versatility percentage from defense rating
    static float GetVersatilityPercent(Player* player);
    
    // Get damage done modifier
    static float GetDamageModifier(Player* player);
    
    // Get damage taken modifier
    static float GetDamageTakenModifier(Player* player);
    
    // Apply versatility to outgoing damage
    static void ModifyDamageDealt(Player* player, uint32& damage);
    
    // Apply versatility to incoming damage
    static void ModifyDamageTaken(Player* player, uint32& damage);
    
private:
    static constexpr float VERSATILITY_RATING_CONVERSION = 0.1f; // 10% of defense rating
    static constexpr float VERSATILITY_TO_PERCENT = 1.0f; // 1 vers = 1% damage
};

#endif
