#ifndef CRIT_DAMAGE_H
#define CRIT_DAMAGE_H

#include "Player.h"

class CritDamage
{
public:
    // Get crit damage bonus from crit rating
    static float GetCritDamageBonus(Player* player);
    
    // Modify critical strike damage
    static void ModifyCriticalDamage(Player* player, uint32& damage);
    
private:
    static constexpr float CRIT_TO_CRITDMG_CONVERSION = 0.5f; // 50% of crit rating
    static constexpr float BASE_CRIT_MULTIPLIER = 2.0f; // 200% base crit damage
};

#endif
