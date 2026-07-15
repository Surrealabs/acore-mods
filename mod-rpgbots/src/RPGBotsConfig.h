// RPGBotsConfig.h
// Central configuration for mod-rpgbots.
// Values are read from mod_rpgbots.conf.dist / worldserver.conf
// on server start (and on .reload config).

#ifndef RPGBOTS_CONFIG_H
#define RPGBOTS_CONFIG_H

#include "Define.h"

struct RPGBotsConfig
{
    static bool   PsychEnabled;     // RPGBots.Psych.Enable
    static bool   SelfBotEnabled;   // RPGBots.SelfBot.Enable
    static uint32 AltArmyMaxBots;   // RPGBots.AltArmy.MaxBots
};

#endif // RPGBOTS_CONFIG_H
