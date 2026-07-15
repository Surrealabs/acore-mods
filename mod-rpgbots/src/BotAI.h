// BotAI.h
// Bot AI update loop — follow master, assist in combat, role-based behavior.
// Called from a WorldScript::OnUpdate hook every tick.

#pragma once

#include "Player.h"
#include "BotBehavior.h"
#include <unordered_map>
#include <vector>
#include <optional>

// ─── Extended Bot Entry (replaces the simple struct in ArmyOfAlts) ─────────────
struct BotInfo
{
    Player*       player;
    WorldSession* session;
    BotRole       role;
    uint8         specIndex;   // Which spec from the class profile (0, 1, 2)
    bool          isFollowing; // Currently in follow mode
    bool          isInCombat;  // Currently fighting

    // Spell queue: when casting/channeling, the next spell to cast is queued
    uint32        queuedSpellId  = 0;
    ObjectGuid    queuedTargetGuid;
};

// ─── Bot Manager Singleton ─────────────────────────────────────────────────────
// Central registry of all active bots and their masters.
// ArmyOfAlts registers bots here on spawn, removes on dismiss.
class BotManager
{
public:
    static BotManager& Instance()
    {
        static BotManager instance;
        return instance;
    }

    // Register a newly spawned bot
    void AddBot(ObjectGuid::LowType masterGuid, BotInfo info)
    {
        _bots[masterGuid].push_back(info);
    }

    // Remove all bots for a master (returns them for cleanup)
    std::vector<BotInfo> RemoveAllBots(ObjectGuid::LowType masterGuid)
    {
        auto it = _bots.find(masterGuid);
        if (it == _bots.end())
            return {};
        auto bots = std::move(it->second);
        _bots.erase(it);
        return bots;
    }

    // Check if a master has any bots
    bool HasBots(ObjectGuid::LowType masterGuid) const
    {
        auto it = _bots.find(masterGuid);
        return it != _bots.end() && !it->second.empty();
    }

    // Get bots for a master (mutable reference for AI updates)
    std::vector<BotInfo>* GetBots(ObjectGuid::LowType masterGuid)
    {
        auto it = _bots.find(masterGuid);
        if (it != _bots.end())
            return &it->second;
        return nullptr;
    }

    // Get all tracked masters + bots (for the world update loop)
    std::unordered_map<ObjectGuid::LowType, std::vector<BotInfo>>& GetAll()
    {
        return _bots;
    }

    // Find a specific bot by GUID across all masters
    BotInfo* FindBot(ObjectGuid botGuid)
    {
        for (auto& [masterLow, bots] : _bots)
            for (auto& info : bots)
                if (info.player && info.player->GetGUID() == botGuid)
                    return &info;
        return nullptr;
    }

    // Find a specific bot by master + character name
    BotInfo* FindBot(ObjectGuid::LowType masterGuid, const std::string& name)
    {
        auto it = _bots.find(masterGuid);
        if (it == _bots.end()) return nullptr;
        for (auto& info : it->second)
            if (info.player && info.player->GetName() == name)
                return &info;
        return nullptr;
    }

    // Remove a single bot by name, return it for cleanup
    std::optional<BotInfo> RemoveBot(ObjectGuid::LowType masterGuid, const std::string& name)
    {
        auto it = _bots.find(masterGuid);
        if (it == _bots.end()) return std::nullopt;
        auto& vec = it->second;
        for (auto vit = vec.begin(); vit != vec.end(); ++vit)
        {
            if (vit->player && vit->player->GetName() == name)
            {
                BotInfo info = *vit;
                vec.erase(vit);
                if (vec.empty())
                    _bots.erase(it);
                return info;
            }
        }
        return std::nullopt;
    }

private:
    BotManager() = default;
    std::unordered_map<ObjectGuid::LowType, std::vector<BotInfo>> _bots;
};

#define sBotMgr BotManager::Instance()

// ─── Role Auto-Detection ───────────────────────────────────────────────────────
// Determines a bot's role based on its talent spec and class profile.
BotRole DetectBotRole(Player* bot);

// Returns the spec index into the class profile based on talent tree
uint8 DetectSpecIndex(Player* bot);
