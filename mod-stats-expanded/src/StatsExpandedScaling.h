#ifndef STATS_EXPANDED_SCALING_H
#define STATS_EXPANDED_SCALING_H

#include "Player.h"
#include <unordered_map>
#include <string>

// Stat types enum for easy reference
enum class StatType
{
    CRIT_DAMAGE = 0,
    MULTISTRIKE = 1,
    VERSATILITY = 2,
    POTENCY = 3,
    HASTE = 4,
    MASTERY = 5
};

class StatsExpandedScaling
{
public:
    // Initialize stat scaling from database
    static void InitializeScaling();
    
    // Reload stat scaling from database at runtime
    static void ReloadScaling();
    
    // Get level-scaled conversion for a stat
    // Returns: percentage value from rating (scales linearly by level)
    static float GetScaledConversion(Player* player, const std::string& statName, float rawRating);
    
    // Get the base rating requirement for 1% at max level (60)
    static float GetBaseRequirement(const std::string& statName);
    
    // Check if a stat is enabled
    static bool IsStatEnabled(const std::string& statName);
    
private:
    static constexpr float MAX_LEVEL_CAP = 60.0f;
    static std::unordered_map<std::string, float> _statRequirements;
    static std::unordered_map<std::string, bool> _statEnabled;
};

#endif
