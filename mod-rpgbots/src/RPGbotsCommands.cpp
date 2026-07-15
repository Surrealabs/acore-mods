// RPGbotsCommands.cpp
// Adds commands to give a random temperament or psychology aura from the DB

#include "Chat.h"
#include "CommandScript.h"
#include "ScriptMgr.h"
#include "Player.h"
#include "DatabaseEnv.h"
#include "RPGBotsConfig.h"
#include <vector>
#include <random>

using namespace Acore::ChatCommands;

namespace
{
    // Helper to get a random aura_id from a table
    uint32 GetRandomAuraIdFromTable(const char* table)
    {
        QueryResult result = CharacterDatabase.Query("SELECT spell FROM {}", table);
        std::vector<uint32> auraIds;
        if (result)
        {
            do {
                auraIds.push_back((*result)[0].Get<uint32>());
            } while (result->NextRow());
        }
        if (auraIds.empty())
            return 0;
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<> dis(0, auraIds.size() - 1);
        return auraIds[dis(gen)];
    }

    // Remove all auras from a list of aura_ids
    void RemoveAuras(Player* player, const char* table)
    {
        QueryResult result = CharacterDatabase.Query("SELECT spell FROM {}", table);
        if (result)
        {
            do {
                uint32 auraId = (*result)[0].Get<uint32>();
                player->RemoveAurasDueToSpell(auraId);
            } while (result->NextRow());
        }
    }
} // anonymous namespace

class RPGbotsCommands : public CommandScript
{
public:
    RPGbotsCommands() : CommandScript("RPGbotsCommands") { }

    ChatCommandTable GetCommands() const override
    {
        static ChatCommandTable rpgTable =
        {
            { "temperament", HandleRandomTemperamentCommand, SEC_PLAYER,     Console::No },
            { "psych",       HandleRandomPsychCommand,       SEC_PLAYER,     Console::No },
            { "reload",      HandleRPGReloadCommand,         SEC_GAMEMASTER, Console::No },
        };
        static ChatCommandTable commandTable =
        {
            { "rpg", rpgTable },
        };
        return commandTable;
    }

    static bool HandleRandomTemperamentCommand(ChatHandler* handler)
    {
        if (!RPGBotsConfig::PsychEnabled)
        {
            handler->PSendSysMessage("|cffff0000Psychology/Temperament system is disabled in server config.|r");
            return true;
        }

        Player* player = handler->GetSession()->GetPlayer();
        if (!player)
            return false;
        RemoveAuras(player, "rpgbots.rpg_temperaments");
        uint32 auraId = GetRandomAuraIdFromTable("rpgbots.rpg_temperaments");
        if (auraId)
        {
            player->AddAura(auraId, player);
            handler->PSendSysMessage("You have been given a new random temperament.");
        }
        else
        {
            handler->PSendSysMessage("No temperaments found in the database.");
        }
        return true;
    }

    static bool HandleRandomPsychCommand(ChatHandler* handler)
    {
        if (!RPGBotsConfig::PsychEnabled)
        {
            handler->PSendSysMessage("|cffff0000Psychology/Temperament system is disabled in server config.|r");
            return true;
        }

        Player* player = handler->GetSession()->GetPlayer();
        if (!player)
            return false;
        RemoveAuras(player, "rpgbots.rpg_psychology");
        uint32 auraId = GetRandomAuraIdFromTable("rpgbots.rpg_psychology");
        if (auraId)
        {
            player->AddAura(auraId, player);
            handler->PSendSysMessage("You have been given a new random psychology.");
        }
        else
        {
            handler->PSendSysMessage("No psychologies found in the database.");
        }
        return true;
    }

    // .rpg reload — reload psych, temperament, and character RPG data
    static bool HandleRPGReloadCommand(ChatHandler* handler)
    {
        // Count psych entries
        QueryResult psychResult = CharacterDatabase.Query("SELECT COUNT(*) FROM rpgbots.rpg_psychology");
        uint32 psychCount = psychResult ? (*psychResult)[0].Get<uint32>() : 0;

        // Count temperament entries
        QueryResult tempResult = CharacterDatabase.Query("SELECT COUNT(*) FROM rpgbots.rpg_temperaments");
        uint32 tempCount = tempResult ? (*tempResult)[0].Get<uint32>() : 0;

        // Count character RPG data entries
        QueryResult charResult = CharacterDatabase.Query("SELECT COUNT(*) FROM rpgbots.character_rpg_data");
        uint32 charCount = charResult ? (*charResult)[0].Get<uint32>() : 0;

        handler->PSendSysMessage("|cff00ff00[RPG] Reload complete:|r");
        handler->PSendSysMessage("  Psychologies: |cffffd700{}|r", psychCount);
        handler->PSendSysMessage("  Temperaments: |cffffd700{}|r", tempCount);
        handler->PSendSysMessage("  Character profiles: |cffffd700{}|r", charCount);
        return true;
    }
};

void AddRPGbotsCommands()
{
    new RPGbotsCommands();
}
