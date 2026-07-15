// PersonalitySystem.h
// Handles character personalities, XP, and affixes for mod-rpgbots

#ifndef MODULE_RPG_BOTS_PERSONALITY_SYSTEM_H
#define MODULE_RPG_BOTS_PERSONALITY_SYSTEM_H

#include "ScriptMgr.h"
#include "Player.h"

class PersonalitySystem : public PlayerScript
{
public:
    PersonalitySystem();

    void OnPlayerLogin(Player* player) override;
    void OnPlayerLogout(Player* player) override;
    void OnPlayerGiveXP(Player* player, uint32& amount, Unit* victim, uint8 xpSource) override;
};

#endif // MODULE_RPG_BOTS_PERSONALITY_SYSTEM_H
