#include "ScriptMgr.h"

// ════════════════════════════════════════════════════════════════════════
//  mod-itemeffects-enhanced
//
//  Custom item proc / effect scripts.  Each effect lives in its own
//  .cpp/.h pair and exposes an Add*Scripts() function called here.
// ════════════════════════════════════════════════════════════════════════

extern void AddShadowmourneScripts();

void Addmod_itemeffects_enhancedScripts()
{
    AddShadowmourneScripts();
}
