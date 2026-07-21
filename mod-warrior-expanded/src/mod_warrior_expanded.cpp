#include "ScriptMgr.h"

// ════════════════════════════════════════════════════════════════════════
//  mod-warrior-expanded — Custom Warrior mechanics
// ════════════════════════════════════════════════════════════════════════

extern void AddHeroicStrikesScripts();
extern void AddFuryMasteryScripts();
extern void AddExecuteScripts();
extern void AddSweepingStrikesScripts();

void Addmod_warrior_expandedScripts()
{
    AddHeroicStrikesScripts();
    AddFuryMasteryScripts();
    AddExecuteScripts();
    AddSweepingStrikesScripts();
}
