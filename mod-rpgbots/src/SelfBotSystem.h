// SelfBotSystem.h
// Public API for the selfbot system — used by ArmyOfAlts for the .army selfbot command

#ifndef SELFBOT_SYSTEM_H
#define SELFBOT_SYSTEM_H

class Player;

bool IsSelfBotActive(Player* player);
void EnableSelfBot(Player* player);
void DisableSelfBot(Player* player);

#endif // SELFBOT_SYSTEM_H
