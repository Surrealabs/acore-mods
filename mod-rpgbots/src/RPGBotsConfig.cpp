// RPGBotsConfig.cpp
// Reads mod_rpgbots.conf.dist values via sConfigMgr,
// and exposes them as simple statics that every system can check.

#include "RPGBotsConfig.h"
#include "Config.h"
#include "Log.h"
#include "ScriptMgr.h"

// ── static defaults (overwritten on config load) ─────────────────────────────
bool   RPGBotsConfig::PsychEnabled   = true;
bool   RPGBotsConfig::SelfBotEnabled = true;
uint32 RPGBotsConfig::AltArmyMaxBots = 4;

// ── WorldScript that fires before the config is fully committed ──────────────
class RPGBotsConfigLoader : public WorldScript
{
public:
    RPGBotsConfigLoader() : WorldScript("RPGBotsConfigLoader") {}

    void OnBeforeConfigLoad(bool reload) override
    {
        (void)reload; // values re-read on every config load/reload
    }

    void OnAfterConfigLoad(bool reload) override
    {
        RPGBotsConfig::PsychEnabled   = sConfigMgr->GetOption<bool>("RPGBots.Psych.Enable", true);
        RPGBotsConfig::SelfBotEnabled = sConfigMgr->GetOption<bool>("RPGBots.SelfBot.Enable", true);
        RPGBotsConfig::AltArmyMaxBots = sConfigMgr->GetOption<uint32>("RPGBots.AltArmy.MaxBots", 4);

        LOG_INFO("module", "RPGBots config {}loaded: Psych={}, SelfBot={}, MaxBots={}",
            reload ? "re" : "",
            RPGBotsConfig::PsychEnabled  ? "ON" : "OFF",
            RPGBotsConfig::SelfBotEnabled ? "ON" : "OFF",
            RPGBotsConfig::AltArmyMaxBots);
    }
};

void AddRPGBotsConfig()
{
    new RPGBotsConfigLoader();
}
