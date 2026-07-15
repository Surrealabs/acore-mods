// BotBehavior.h
// Role enum and role-name helper used across the bot system.

#pragma once

#include "SharedDefines.h"
#include <cstdint>

// ─── Role Tags ─────────────────────────────────────────────────────────────────
enum class BotRole : uint8
{
    ROLE_TANK       = 0,
    ROLE_HEALER     = 1,
    ROLE_MELEE_DPS  = 2,
    ROLE_RANGED_DPS = 3,
    ROLE_MELEE_HEALER = 4,
    ROLE_RANGED_HEALER = 5,
};

inline const char* BotRoleName(BotRole role)
{
    switch (role)
    {
        case BotRole::ROLE_TANK:       return "Tank";
        case BotRole::ROLE_HEALER:     return "Healer";
        case BotRole::ROLE_MELEE_DPS:  return "Melee DPS";
        case BotRole::ROLE_RANGED_DPS: return "Ranged DPS";
        case BotRole::ROLE_MELEE_HEALER: return "Melee Healer";
        case BotRole::ROLE_RANGED_HEALER: return "Ranged Healer";
        default:                       return "Unknown";
    }
}
