#include "ScriptMgr.h"
#include "Player.h"
#include "DatabaseEnv.h"
#include <cstdint>
#include <unordered_map>

namespace
{
constexpr char CUSTOM_TALENT_TABLE[] = "surreal_talents.talent_ranks";
constexpr uint8 CUSTOM_MIN_TALENT_LEVEL = 10;
constexpr uint32 CUSTOM_MAX_TALENT_POINTS = 71;

using TalentRankMap = std::unordered_map<uint32, uint8>;

TalentRankMap LoadSavedTalentRanks(uint32 guid)
{
    TalentRankMap ranks;
    QueryResult result = CharacterDatabase.Query(
        "SELECT talent_id, `rank` FROM {} WHERE guid = {}",
        CUSTOM_TALENT_TABLE, guid);

    if (!result)
        return ranks;

    do
    {
        Field* fields = result->Fetch();
        uint32 talentId = fields[0].Get<uint32>();
        uint8 rank = fields[1].Get<uint8>();
        if (!talentId || !rank)
            continue;

        ranks[talentId] = rank;
    } while (result->NextRow());

    return ranks;
}

uint32 GetMaxTalentPointsForLevel(uint8 level)
{
    if (level < CUSTOM_MIN_TALENT_LEVEL)
        return 0;

    uint32 points = uint32(level - CUSTOM_MIN_TALENT_LEVEL + 1);
    return points > CUSTOM_MAX_TALENT_POINTS ? CUSTOM_MAX_TALENT_POINTS : points;
}

uint32 CountSpentTalentPoints(TalentRankMap const& savedRanks)
{
    if (savedRanks.empty())
        return 0;

    uint32 spent = 0;
    for (auto const& [talentId, rank] : savedRanks)
    {
        (void)talentId;
        spent += uint32(rank);
    }

    return spent;
}

void SyncCustomTalentPoints(Player* player, TalentRankMap const& savedRanks)
{
    if (!player)
        return;

    uint32 maxPoints = GetMaxTalentPointsForLevel(player->GetLevel());
    uint32 spentPoints = CountSpentTalentPoints(savedRanks);
    uint32 unspentPoints = maxPoints > spentPoints ? (maxPoints - spentPoints) : 0;

    player->SetFreeTalentPoints(unspentPoints);
}

void ClearSavedTalentRanks(uint32 guid)
{
    CharacterDatabase.Execute("DELETE FROM {} WHERE guid = {}", CUSTOM_TALENT_TABLE, guid);
}

void RecalculateCustomTalentPoints(Player* player)
{
    if (!player)
        return;

    TalentRankMap savedRanks = LoadSavedTalentRanks(player->GetGUID().GetCounter());
    SyncCustomTalentPoints(player, savedRanks);
}
}

class TalentsExpandedPlayerScript : public PlayerScript
{
public:
    TalentsExpandedPlayerScript() : PlayerScript("TalentsExpandedPlayerScript") { }

    void OnPlayerLogin(Player* player) override
    {
        RecalculateCustomTalentPoints(player);
    }

    void OnPlayerLevelChanged(Player* player, uint8 /*oldLevel*/) override
    {
        RecalculateCustomTalentPoints(player);
    }

    void OnPlayerTalentsReset(Player* player, bool /*noCost*/) override
    {
        if (!player)
            return;

        uint32 guid = player->GetGUID().GetCounter();
        ClearSavedTalentRanks(guid);
        RecalculateCustomTalentPoints(player);
    }

    void OnPlayerLearnTalents(Player* player, uint32 talentId, uint32 talentRank, uint32 /*spellId*/) override
    {
        (void)player;
        (void)talentId;
        (void)talentRank;
    }
};

void Addmod_talents_expandedScripts()
{
    new TalentsExpandedPlayerScript();
}
