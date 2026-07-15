#include "StatsExpandedScaling.h"
#include "CharacterDatabase.h"

namespace
{
float GetDefaultRequirementForStat(const std::string& statName)
{
    if (statName == "CRIT_DAMAGE_RATING") return 5.0f;
    if (statName == "MULTISTRIKE_RATING") return 10.0f;
    if (statName == "VERSATILITY_RATING") return 10.0f;
    if (statName == "HASTE_RATING") return 10.0f;
    if (statName == "CRIT_RATING") return 10.0f;
    return 100.0f;
}
}

// Static member definitions
std::unordered_map<std::string, float> StatsExpandedScaling::_statRequirements;
std::unordered_map<std::string, bool> StatsExpandedScaling::_statEnabled;

void StatsExpandedScaling::InitializeScaling()
{
    ReloadScaling();
}

void StatsExpandedScaling::ReloadScaling()
{
    _statRequirements.clear();
    _statEnabled.clear();
    
    QueryResult result = CharacterDatabase.Query("SELECT stat_name, rating_per_percent, enabled FROM custom_character_stats");
    
    if (!result)
    {
        LOG_ERROR("module", "StatsExpandedScaling: Failed to load stat scaling from database. Table may not exist.");
        // Load defaults if table doesn't exist
        _statRequirements["CRIT_DAMAGE_RATING"] = 5.0f;    // 10 dodge = 2% crit dmg (5 per 1%)
        _statRequirements["MULTISTRIKE_RATING"] = 10.0f;   // 10 block  = 1% multistrike
        _statRequirements["VERSATILITY_RATING"] = 10.0f;   // 10 hit    = 1% versatility
        _statRequirements["POTENCY_RATING"] = 120.0f;      // unchanged (not in SwappedStats)
        _statRequirements["HASTE_RATING"] = 10.0f;         // 10 defense = 1% haste
        _statRequirements["MASTERY_RATING"] = 10.0f;       // 10 parry  = 1% mastery
        
        _statEnabled["CRIT_DAMAGE_RATING"] = true;
        _statEnabled["MULTISTRIKE_RATING"] = true;
        _statEnabled["VERSATILITY_RATING"] = true;
        _statEnabled["POTENCY_RATING"] = true;
        _statEnabled["HASTE_RATING"] = true;
        _statEnabled["MASTERY_RATING"] = true;
        return;
    }
    
    do
    {
        Field* fields = result->Fetch();
        std::string statName = fields[0].Get<std::string>();
        float baseRequirement = fields[1].Get<float>();
        bool enabled = fields[2].Get<bool>();
        
        _statRequirements[statName] = baseRequirement;
        _statEnabled[statName] = enabled;
        
        LOG_INFO("module", "StatsExpandedScaling: Loaded {} - Requirement: {:.1f}, Enabled: {}", 
                 statName, baseRequirement, enabled ? "Yes" : "No");
    } while (result->NextRow());
}

float StatsExpandedScaling::GetScaledConversion(Player* player, const std::string& statName, float rawRating)
{
    if (!player || rawRating <= 0.0f)
        return 0.0f;

    if (_statRequirements.empty() && _statEnabled.empty())
        ReloadScaling();
    
    if (!IsStatEnabled(statName))
        return 0.0f;
    
    float ratingPerPercent = GetBaseRequirement(statName);
    
    if (ratingPerPercent <= 0.0f)
        return 0.0f;
    
    // Simple conversion: percentage = rawRating / rating_per_percent
    // Example: 105 resilience with rating_per_percent=105 = 1%
    return (rawRating / ratingPerPercent);
}

float StatsExpandedScaling::GetBaseRequirement(const std::string& statName)
{
    if (_statRequirements.empty() && _statEnabled.empty())
        ReloadScaling();

    auto it = _statRequirements.find(statName);
    if (it != _statRequirements.end())
        return it->second;
    
    return GetDefaultRequirementForStat(statName);
}

bool StatsExpandedScaling::IsStatEnabled(const std::string& statName)
{
    if (_statRequirements.empty() && _statEnabled.empty())
        ReloadScaling();

    auto it = _statEnabled.find(statName);
    if (it != _statEnabled.end())
        return it->second;
    
    return true; // Default to enabled
}
