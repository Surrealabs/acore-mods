#ifndef CUSTOM_HASTE_H
#define CUSTOM_HASTE_H

#include "Player.h"

class CustomHaste
{
public:
    // Get total haste percent including GCD reduction
    static float GetHastePercent(Player* player);
    
    // Get modified GCD based on haste
    static uint32 GetModifiedGCD(Player* player, uint32 baseGCD);
    
    // Apply haste to cast time
    static void ModifyCastTime(Player* player, uint32& castTime);
    
private:
    static constexpr float HASTE_RATING_CONVERSION = 1.0f; // Base haste conversion
    static constexpr uint32 MIN_GCD = 750; // Minimum GCD in milliseconds (0.75s)
    static constexpr uint32 BASE_GCD = 1500; // Base GCD in milliseconds (1.5s)
};

#endif
