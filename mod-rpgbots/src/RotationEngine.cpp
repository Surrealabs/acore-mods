// RotationEngine.cpp
// Loads the flat rpgbots.bot_rotations table at startup and on `.rpg reload`.

#include "RotationEngine.h"
#include "ScriptMgr.h"
#include "DatabaseEnv.h"
#include "Log.h"

namespace
{
uint32 CountKnownSpellsForRotation(Player* bot, SpecRotation const& rot)
{
    if (!bot)
        return 0;

    uint32 score = 0;
    auto countOne = [&](uint32 spellId)
    {
        if (spellId && bot->HasSpell(spellId))
            ++score;
    };
    auto countBucket = [&](auto const& bucket)
    {
        for (uint32 spellId : bucket)
            countOne(spellId);
    };

    countOne(rot.filler);
    countBucket(rot.rotation);
    countOne(rot.interrupt);
    countOne(rot.mobility);
    countBucket(rot.defensives);
    countOne(rot.damageCooldown);
    countOne(rot.partyBuff);
    return score;
}
}

// ─── String → Enum ─────────────────────────────────────────────────────────────

static BotRole RoleFromString(std::string_view s)
{
    if (s == "tank")       return BotRole::ROLE_TANK;
    if (s == "healer")     return BotRole::ROLE_HEALER;
    if (s == "melee_dps")  return BotRole::ROLE_MELEE_DPS;
    if (s == "ranged_dps") return BotRole::ROLE_RANGED_DPS;
    if (s == "melee_healer") return BotRole::ROLE_MELEE_HEALER;
    if (s == "ranged_healer") return BotRole::ROLE_RANGED_HEALER;
    if (s == "ranged_dot") return BotRole::ROLE_RANGED_DOT;
    if (s == "melee_dot")  return BotRole::ROLE_MELEE_DOT;
    return BotRole::ROLE_MELEE_DPS;
}

// "1-4-5-f-2-4-5-f-3-4-5-f" -> {0,3,4,5,1,3,4,5,2,3,4,5}
std::vector<uint8_t> ParseRotationSequence(std::string const& s)
{
    std::vector<uint8_t> steps;
    std::string token;
    auto flush = [&]()
    {
        if (token.empty())
            return;
        if (token == "f" || token == "F")
            steps.push_back(SEQUENCE_FILLER_STEP);
        else if (token.size() == 1 && token[0] >= '1' && token[0] <= ('0' + ROTATION_SLOTS))
            steps.push_back(uint8_t(token[0] - '1'));
        // else: unrecognized token, silently skipped
        token.clear();
    };

    for (char c : s)
    {
        if (c == '-')
            flush();
        else
            token += c;
    }
    flush();

    return steps;
}

// ─── Load From DB ──────────────────────────────────────────────────────────────

uint32 RotationEngine::LoadFromDB()
{
    _rotations.clear();

    //  SELECT mirrors the column order in the CREATE TABLE
    QueryResult result = CharacterDatabase.Query(
        "SELECT class_id, spec_index, spec_name, role, preferred_range, "
        "       filler, "
        "       rotation_1, rotation_2, rotation_3, rotation_4, rotation_5, "
        "       interrupt, mobility, "
        "       defensive_1, defensive_2, "
        "       damage_cooldown, party_buff, rotation_sequence "
        "FROM rpgbots.bot_rotations");

    if (!result)
    {
        LOG_WARN("module", "RPGBots RotationEngine: rpgbots.bot_rotations is empty — "
                           "bots will auto-attack only.");
        return 0;
    }

    do {
        Field* f = result->Fetch();
        SpecRotation rot;
        rot.classId        = f[0].Get<uint8>();
        rot.specIndex      = f[1].Get<uint8>();
        rot.specName       = f[2].Get<std::string>();
        rot.role           = RoleFromString(f[3].Get<std::string>());
        rot.preferredRange = f[4].Get<float>();

        rot.filler = f[5].Get<uint32>();

        // 5 rotation slots (columns 6-10)
        for (uint8 i = 0; i < ROTATION_SLOTS; ++i)
            rot.rotation[i] = f[6 + i].Get<uint32>();

        rot.interrupt = f[11].Get<uint32>();
        rot.mobility  = f[12].Get<uint32>();

        // 2 defensive slots (columns 13-14)
        for (uint8 i = 0; i < DEFENSIVE_SLOTS; ++i)
            rot.defensives[i] = f[13 + i].Get<uint32>();

        rot.damageCooldown = f[15].Get<uint32>();
        rot.partyBuff      = f[16].Get<uint32>();
        rot.sequenceSteps  = ParseRotationSequence(f[17].Get<std::string>());

        SpecKey key = MakeSpecKey(rot.classId, rot.specIndex);
        _rotations[key] = std::move(rot);

    } while (result->NextRow());

    LOG_INFO("module", "RPGBots RotationEngine: Loaded {} specs from bot_rotations",
             _rotations.size());

    return uint32(_rotations.size());
}

std::vector<SpecRotation const*> RotationEngine::GetClassRotations(uint8 classId) const
{
    std::vector<SpecRotation const*> out;
    for (auto const& [key, rot] : _rotations)
    {
        (void)key;
        if (rot.classId == classId)
            out.push_back(&rot);
    }
    return out;
}

uint8 RotationEngine::DetectBestSpecIndex(Player* bot, uint8 fallbackSpecIndex) const
{
    if (!bot)
        return fallbackSpecIndex;

    auto classRots = GetClassRotations(bot->getClass());
    if (classRots.empty())
        return fallbackSpecIndex;

    uint8 bestSpec = fallbackSpecIndex;
    uint32 bestScore = 0;

    for (SpecRotation const* rot : classRots)
    {
        if (!rot)
            continue;

        uint32 score = CountKnownSpellsForRotation(bot, *rot);
        if (score > bestScore)
        {
            bestScore = score;
            bestSpec = rot->specIndex;
        }
    }

    if (bestScore == 0)
    {
        // Prefer first available class rotation if no spell evidence yet.
        return classRots.front()->specIndex;
    }

    return bestSpec;
}

// ─── World Script: load at startup ─────────────────────────────────────────────
class RotationEngineWorldScript : public WorldScript
{
public:
    RotationEngineWorldScript() : WorldScript("RotationEngineWorldScript") {}

    void OnStartup() override
    {
        uint32 count = sRotationEngine.LoadFromDB();
        if (count == 0)
            LOG_WARN("module", "RPGBots RotationEngine: No specs loaded — "
                               "bots will auto-attack only.");
    }
};

void AddRotationEngine()
{
    new RotationEngineWorldScript();
}
