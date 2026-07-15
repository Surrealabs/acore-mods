/*
 * AzerothCore module loader for mod-autolearn-spells
 */

#include "mod_autolearn_spells.cpp"

void Addmod_autolearn_spellsScripts();

extern "C" void AddModuleScripts()
{
    Addmod_autolearn_spellsScripts();
}
