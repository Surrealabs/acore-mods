// BotTalentSystem.cpp
// Talent management for bot alts:
//   .army talent show  <name>              — Points per tree + free points
//   .army talent reset <name>              — Reset all talents (free)
//   .army talent learn <name> <talentId>   — Learn next rank of a talent
//   .army talent list  <name> [tree]       — List talents in a tree with IDs
//   .army talent fill  <name> <tree>       — Fill all free points into a tree

#include "ScriptMgr.h"
#include "Chat.h"
#include "CommandScript.h"
#include "Player.h"
#include "BotAI.h"
#include "DBCStores.h"
#include "SpellMgr.h"
#include "SpellInfo.h"
#include <algorithm>
#include <vector>

using namespace Acore::ChatCommands;

namespace
{
    // ─── Hardcoded WotLK talent tree names per class ───────────────────────
    static const char* const kTreeNames[][3] =
    {
        /* 0  unused  */ { "", "", "" },
        /* 1  Warrior */ { "Arms", "Fury", "Protection" },
        /* 2  Paladin */ { "Holy", "Protection", "Retribution" },
        /* 3  Hunter  */ { "Beast Mastery", "Marksmanship", "Survival" },
        /* 4  Rogue   */ { "Assassination", "Combat", "Subtlety" },
        /* 5  Priest  */ { "Discipline", "Holy", "Shadow" },
        /* 6  DK      */ { "Blood", "Frost", "Unholy" },
        /* 7  Shaman  */ { "Elemental", "Enhancement", "Restoration" },
        /* 8  Mage    */ { "Arcane", "Fire", "Frost" },
        /* 9  Warlock */ { "Affliction", "Demonology", "Destruction" },
        /* 10 unused  */ { "", "", "" },
        /* 11 Druid   */ { "Balance", "Feral Combat", "Restoration" },
    };

    const char* GetTreeName(uint8 classId, uint8 treeIdx)
    {
        if (classId < 12 && treeIdx < 3)
            return kTreeNames[classId][treeIdx];
        return "Unknown";
    }

    // ─── Map class → 3 talent tab IDs ordered by tabpage ──────────────────
    struct ClassTabs { uint32 id[3] = {}; };

    ClassTabs GetClassTabs(uint8 classId)
    {
        ClassTabs ct;
        uint32 classMask = 1u << (classId - 1);
        for (uint32 i = 0; i < sTalentTabStore.GetNumRows(); ++i)
        {
            auto const* tab = sTalentTabStore.LookupEntry(i);
            if (!tab || !(tab->ClassMask & classMask)) continue;
            if (tab->tabpage < 3)
                ct.id[tab->tabpage] = tab->TalentTabID;
        }
        return ct;
    }

    // ─── Lightweight talent descriptor ─────────────────────────────────────
    struct TalentDesc
    {
        uint32 talentId;
        uint32 row, col;
        std::array<uint32, MAX_TALENT_RANK> rankSpells;
        uint32 maxRanks; // 1-5
    };

    // All talents in a tab, sorted by row then col
    std::vector<TalentDesc> GetTreeTalents(uint32 tabId)
    {
        std::vector<TalentDesc> v;
        for (uint32 i = 0; i < sTalentStore.GetNumRows(); ++i)
        {
            auto const* t = sTalentStore.LookupEntry(i);
            if (!t || t->TalentTab != tabId) continue;
            TalentDesc d;
            d.talentId   = t->TalentID;
            d.row        = t->Row;
            d.col        = t->Col;
            d.rankSpells = t->RankID;
            d.maxRanks   = 0;
            for (uint32 r = 0; r < MAX_TALENT_RANK; ++r)
                if (t->RankID[r]) d.maxRanks = r + 1;
            v.push_back(d);
        }
        std::sort(v.begin(), v.end(), [](auto& a, auto& b) {
            return a.row != b.row ? a.row < b.row : a.col < b.col;
        });
        return v;
    }

    // How many ranks the player has learned in this talent (0 = none)
    uint32 GetCurrentRank(Player* bot, const TalentDesc& td)
    {
        for (int r = MAX_TALENT_RANK - 1; r >= 0; --r)
            if (td.rankSpells[r] && bot->HasTalent(td.rankSpells[r], bot->GetActiveSpec()))
                return uint32(r + 1);
        return 0;
    }

    // Human-readable talent name from first-rank spell
    std::string GetTalentName(const TalentDesc& td)
    {
        if (td.rankSpells[0])
        {
            SpellInfo const* si = sSpellMgr->GetSpellInfo(td.rankSpells[0]);
            if (si && si->SpellName[0])
                return si->SpellName[0];
        }
        return "Unknown";
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
class BotTalentCommands : public CommandScript
{
public:
    BotTalentCommands() : CommandScript("BotTalentCommands") {}

    ChatCommandTable GetCommands() const override
    {
        static ChatCommandTable talentTable =
        {
            { "show",  HandleShowCmd,  SEC_GAMEMASTER, Console::No },
            { "reset", HandleResetCmd, SEC_GAMEMASTER, Console::No },
            { "learn", HandleLearnCmd, SEC_GAMEMASTER, Console::No },
            { "list",  HandleListCmd,  SEC_GAMEMASTER, Console::No },
            { "fill",  HandleFillCmd,  SEC_GAMEMASTER, Console::No },
        };
        static ChatCommandTable armyTable =
        {
            { "talent", talentTable },
        };
        static ChatCommandTable topTable =
        {
            { "army", armyTable },
        };
        return topTable;
    }

    // ─── .army talent show <name> ──────────────────────────────────────────
    static bool HandleShowCmd(ChatHandler* handler, std::string name)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        Player* bot   = info->player;
        uint8 classId = bot->getClass();
        ClassTabs ct  = GetClassTabs(classId);

        uint8 pts[3] = {};
        bot->GetTalentTreePoints(pts);

        handler->PSendSysMessage("|cff00ff00=== Talents for {} ===|r", bot->GetName());
        for (int t = 0; t < 3; ++t)
            if (ct.id[t])
                handler->PSendSysMessage("  {}: {} points", GetTreeName(classId, t), pts[t]);
        handler->PSendSysMessage("  Free points: {}", bot->GetFreeTalentPoints());
        return true;
    }

    // ─── .army talent reset <name> ─────────────────────────────────────────
    static bool HandleResetCmd(ChatHandler* handler, std::string name)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        Player* bot = info->player;
        bot->resetTalents(true);
        info->specIndex = DetectSpecIndex(bot);
        info->role      = DetectBotRole(bot);
        bot->SaveToDB(false, true);

        handler->PSendSysMessage("|cff00ff00{}'s talents have been reset. Free points: {}|r",
                                 name, bot->GetFreeTalentPoints());
        return true;
    }

    // ─── .army talent learn <name> <talentId> ──────────────────────────────
    static bool HandleLearnCmd(ChatHandler* handler, std::string name, uint32 talentId)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        Player* bot = info->player;
        if (bot->GetFreeTalentPoints() == 0)
        {
            handler->PSendSysMessage("|cffff0000{} has no free talent points.|r", name);
            return true;
        }

        TalentEntry const* te = sTalentStore.LookupEntry(talentId);
        if (!te)
        {
            handler->PSendSysMessage("|cffff0000Invalid talent ID {}.|r", talentId);
            return true;
        }

        // Current rank (1-indexed count, 0 = none)
        uint32 curRank = 0;
        for (int r = MAX_TALENT_RANK - 1; r >= 0; --r)
            if (te->RankID[r] && bot->HasTalent(te->RankID[r], bot->GetActiveSpec()))
            { curRank = r + 1; break; }

        uint32 maxRank = 0;
        for (uint32 r = 0; r < MAX_TALENT_RANK; ++r)
            if (te->RankID[r]) maxRank = r + 1;

        if (curRank >= maxRank)
        {
            handler->PSendSysMessage("|cffff0000Talent already at max rank ({}/{}).|r", curRank, maxRank);
            return true;
        }

        uint32 oldPts = bot->GetFreeTalentPoints();
        bot->LearnTalent(talentId, curRank); // curRank = 0-indexed next rank

        if (bot->GetFreeTalentPoints() < oldPts)
        {
            std::string talentName = "Unknown";
            if (te->RankID[0])
            {
                SpellInfo const* si = sSpellMgr->GetSpellInfo(te->RankID[0]);
                if (si && si->SpellName[0]) talentName = si->SpellName[0];
            }

            info->specIndex = DetectSpecIndex(bot);
            info->role      = DetectBotRole(bot);
            bot->SaveToDB(false, true);

            handler->PSendSysMessage("|cff00ff00{} learned {} (rank {}/{}). Free: {}|r",
                                     name, talentName, curRank + 1, maxRank, bot->GetFreeTalentPoints());
        }
        else
            handler->PSendSysMessage("|cffff0000Failed — requirements not met (prerequisites or tier).|r");

        return true;
    }

    // ─── .army talent list <name> [tree] ───────────────────────────────────
    static bool HandleListCmd(ChatHandler* handler, std::string name, Optional<uint8> treeArg)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        Player* bot   = info->player;
        uint8 classId = bot->getClass();
        ClassTabs ct  = GetClassTabs(classId);

        for (uint8 t = 0; t < 3; ++t)
        {
            if (treeArg && *treeArg != t) continue;
            if (!ct.id[t]) continue;

            handler->PSendSysMessage("|cff00ff00=== {} (tree {}) ===|r", GetTreeName(classId, t), t);
            auto talents = GetTreeTalents(ct.id[t]);
            for (auto& td : talents)
            {
                uint32 cur = GetCurrentRank(bot, td);
                handler->PSendSysMessage("  [{}] {} — {}/{} (Row {} Col {})",
                    td.talentId, GetTalentName(td), cur, td.maxRanks,
                    td.row + 1, td.col + 1);
            }
        }
        handler->PSendSysMessage("Free points: {}", bot->GetFreeTalentPoints());
        return true;
    }

    // ─── .army talent fill <name> <tree> ───────────────────────────────────
    // Spends all free talent points into the specified tree (0/1/2),
    // picking talents top-to-bottom, left-to-right.
    static bool HandleFillCmd(ChatHandler* handler, std::string name, uint8 treeIndex)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        if (treeIndex > 2)
        {
            handler->PSendSysMessage("|cffff0000Tree index must be 0, 1, or 2.|r");
            return true;
        }

        Player* bot   = info->player;
        uint8 classId = bot->getClass();
        ClassTabs ct  = GetClassTabs(classId);

        if (!ct.id[treeIndex])
        {
            handler->PSendSysMessage("|cffff0000No talent tree for index {}.|r", treeIndex);
            return true;
        }

        auto talents = GetTreeTalents(ct.id[treeIndex]);
        uint32 totalLearned = 0;
        uint32 const maxPasses = 100; // safety bound

        for (uint32 pass = 0; pass < maxPasses && bot->GetFreeTalentPoints() > 0; ++pass)
        {
            bool learnedAny = false;
            for (auto& td : talents)
            {
                if (bot->GetFreeTalentPoints() == 0) break;

                uint32 cur = GetCurrentRank(bot, td);
                if (cur >= td.maxRanks) continue;

                uint32 oldPts = bot->GetFreeTalentPoints();
                bot->LearnTalent(td.talentId, cur); // cur = 0-indexed next rank

                if (bot->GetFreeTalentPoints() < oldPts)
                {
                    ++totalLearned;
                    learnedAny = true;
                }
            }
            if (!learnedAny) break;
        }

        info->specIndex = DetectSpecIndex(bot);
        info->role      = DetectBotRole(bot);
        bot->SaveToDB(false, true);

        handler->PSendSysMessage(
            "|cff00ff00Filled {} points into {} for {}. Free: {}|r",
            totalLearned, GetTreeName(classId, treeIndex), name,
            bot->GetFreeTalentPoints());
        return true;
    }
};

void AddBotTalentSystem()
{
    new BotTalentCommands();
}
