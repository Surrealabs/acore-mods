// module entry point for mod-rpgbots

#include "ScriptMgr.h"

void AddRPGBotsConfig();

void Addmod_rpgbots_PersonalitySystem();

void AddRPGbotsCommands();

void AddCustomPsychology();
void AddCustomTemperament();

void AddBotSessionSystem();

void AddArmyOfAlts();

void AddRotationEngine();
void AddBotAI();

void AddBotTalentSystem();
void AddBotEquipSystem();
void AddSelfBotSystem();

void Addmod_rpgbotsScripts()
{
    // Config — must be first so all other systems can read config values
    AddRPGBotsConfig();

    // Rotation Engine — loads SQL rotation data at startup
    AddRotationEngine();

    Addmod_rpgbots_PersonalitySystem();
    AddRPGbotsCommands();
    AddCustomPsychology();
    AddCustomTemperament();
    AddBotSessionSystem();
    AddArmyOfAlts();

    // Bot AI — follow, assist, combat (must be after ArmyOfAlts)
    AddBotAI();

    // Talent & Equipment management
    AddBotTalentSystem();
    AddBotEquipSystem();

    // Selfbot — autoplay mode
    AddSelfBotSystem();
}
