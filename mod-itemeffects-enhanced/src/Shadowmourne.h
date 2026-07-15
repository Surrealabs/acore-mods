#ifndef SHADOWMOURNE_H
#define SHADOWMOURNE_H

#include "SharedDefines.h"

namespace Shadowmourne
{
    // ── Spell IDs ────────────────────────────────────────────────────
    constexpr uint32 SHADOWMOURNE_EQUIP_AURA     = 71903;  // passive aura when weapon is equipped
    constexpr uint32 SOUL_FRAGMENT                = 71905;  // stacking buff (max 10)
    constexpr uint32 CHAOS_BANE_DAMAGE            = 71904;  // AoE shadowfrost damage release
    constexpr uint32 CHAOS_BANE_BUFF              = 73422;  // buff applied after release (prevents re-proc)

    // ── Config ───────────────────────────────────────────────────────
    constexpr uint8  FRAGMENTS_TO_RELEASE         = 10;     // stacks needed before Chaos Bane fires
    constexpr int32  PROC_CHANCE                  = 75;     // % chance per melee hit to gain a fragment
}

#endif // SHADOWMOURNE_H
