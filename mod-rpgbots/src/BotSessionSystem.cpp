// BotSessionSystem.cpp
// Implementation of bot session scaffolding for mod-rpgbots

#include "BotSessionSystem.h"
#include "Player.h"
#include "ScriptMgr.h"

BotSessionSystem::BotSessionSystem() : PlayerScript("BotSessionSystem") {}

void BotSessionSystem::ActivateAltSession(Player* altPlayer)
{
    // TODO: Activate a world session for the alt character
    // This should allow the alt to persist in the world without full bot logic
}

void AddBotSessionSystem()
{
    new BotSessionSystem();
}
