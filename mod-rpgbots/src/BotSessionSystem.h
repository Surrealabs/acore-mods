// BotSessionSystem.h
// Handles bot session scaffolding for mod-rpgbots

#ifndef MODULE_RPG_BOTS_BOT_SESSION_SYSTEM_H
#define MODULE_RPG_BOTS_BOT_SESSION_SYSTEM_H

#include "ScriptMgr.h"
#include "Player.h"

class BotSessionSystem : public PlayerScript
{
public:
    BotSessionSystem();

    // Called to activate a session for an alt character
    void ActivateAltSession(Player* altPlayer);
    // Add more hooks as needed for bot session management
};

#endif // MODULE_RPG_BOTS_BOT_SESSION_SYSTEM_H
