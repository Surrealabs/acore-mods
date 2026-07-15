// PersonalitySystem.cpp
// Implementation of the PersonalitySystem for mod-rpgbots

#include "PersonalitySystem.h"
#include "DatabaseEnv.h"
#include "Player.h"
#include "Chat.h"
#include "Log.h"
#include "RPGBotsConfig.h"

PersonalitySystem::PersonalitySystem() : PlayerScript("PersonalitySystem",
    {PLAYERHOOK_ON_LOGIN, PLAYERHOOK_ON_LOGOUT, PLAYERHOOK_ON_GIVE_EXP}) {}

void PersonalitySystem::OnPlayerLogin(Player* player)
{
    if (!player)
        return;

    // If psych system is disabled, skip all personality logic
    if (!RPGBotsConfig::PsychEnabled)
        return;

    uint32 guid = player->GetGUID().GetCounter();

    // Check if this character already has RPG data
    QueryResult result = CharacterDatabase.Query(
        "SELECT mechanics, mechanics_xp, rotation, rotation_xp, heroism, heroism_xp, "
        "temperament_id, psych_id FROM rpgbots.character_rpg_data WHERE guid = {}",
        guid);

    if (!result)
    {
        // First login - create default entry with random temperament & psychology
        QueryResult tempResult = CharacterDatabase.Query(
            "SELECT id FROM rpgbots.rpg_temperaments ORDER BY RAND() LIMIT 1");
        QueryResult psychResult = CharacterDatabase.Query(
            "SELECT id FROM rpgbots.rpg_psychology ORDER BY RAND() LIMIT 1");

        uint32 tempId = tempResult ? (*tempResult)[0].Get<uint32>() : 1;
        uint32 psychId = psychResult ? (*psychResult)[0].Get<uint32>() : 1;

        CharacterDatabase.Execute(
            "INSERT INTO rpgbots.character_rpg_data "
            "(guid, mechanics, mechanics_xp, rotation, rotation_xp, heroism, heroism_xp, temperament_id, psych_id) "
            "VALUES ({}, 1, 0, 1, 0, 1, 0, {}, {})",
            guid, tempId, psychId);

        // Apply the temperament and psychology auras
        QueryResult spellResult = CharacterDatabase.Query(
            "SELECT spell FROM rpgbots.rpg_temperaments WHERE id = {}", tempId);
        if (spellResult)
        {
            uint32 spellId = (*spellResult)[0].Get<uint32>();
            if (spellId)
                player->AddAura(spellId, player);
        }

        spellResult = CharacterDatabase.Query(
            "SELECT spell FROM rpgbots.rpg_psychology WHERE id = {}", psychId);
        if (spellResult)
        {
            uint32 spellId = (*spellResult)[0].Get<uint32>();
            if (spellId)
                player->AddAura(spellId, player);
        }

        ChatHandler(player->GetSession()).PSendSysMessage("|cff00ff00[RPG] Character RPG profile created! You have been assigned a temperament and psychology.|r");
    }
    else
    {
        // Returning player - load and re-apply auras
        Field* fields = result->Fetch();
        uint32 tempId  = fields[6].Get<uint32>();
        uint32 psychId = fields[7].Get<uint32>();

        // Apply temperament aura
        QueryResult spellResult = CharacterDatabase.Query(
            "SELECT spell FROM rpgbots.rpg_temperaments WHERE id = {}", tempId);
        if (spellResult)
        {
            uint32 spellId = (*spellResult)[0].Get<uint32>();
            if (spellId)
                player->AddAura(spellId, player);
        }

        // Apply psychology aura
        spellResult = CharacterDatabase.Query(
            "SELECT spell FROM rpgbots.rpg_psychology WHERE id = {}", psychId);
        if (spellResult)
        {
            uint32 spellId = (*spellResult)[0].Get<uint32>();
            if (spellId)
                player->AddAura(spellId, player);
        }

        ChatHandler(player->GetSession()).PSendSysMessage("|cff00ff00[RPG] Welcome back! Your RPG profile has been loaded.|r");
    }
}

void PersonalitySystem::OnPlayerLogout(Player* player)
{
    if (!player)
        return;

    // Save current RPG state on logout (persist any runtime changes)
    // For now, the DB row is already saved/updated on login and via commands,
    // but this hook can save any runtime-modified fields in the future.
    LOG_INFO("module", "RPGBots: Player {} ({}) logged out, RPG data preserved.",
        player->GetName(), player->GetGUID().GetCounter());
}

void PersonalitySystem::OnPlayerGiveXP(Player* player, uint32& amount, Unit* /*victim*/, uint8 /*xpSource*/)
{
    if (!player)
        return;

    // Award mechanics XP alongside normal XP (1:1 ratio for now)
    uint32 guid = player->GetGUID().GetCounter();
    CharacterDatabase.Execute(
        "UPDATE rpgbots.character_rpg_data SET mechanics_xp = mechanics_xp + {} WHERE guid = {}",
        amount, guid);
}

// Register the script
void Addmod_rpgbots_PersonalitySystem()
{
    new PersonalitySystem();
}
