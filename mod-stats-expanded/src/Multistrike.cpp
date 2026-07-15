#include "Multistrike.h"
#include "StatsExpandedScaling.h"
#include "StatsExpandedData.h"
#include "SharedDefines.h"
#include "Unit.h"
#include "SpellInfo.h"
#include "Spell.h"
#include <random>

float Multistrike::GetMultistrikeChance(Player* player)
{
    if (!player)
        return 0.0f;

    float blockRating = 0.0f;

    if (DataMap::Base* rawData = player->CustomData.GetDefault<DataMap::Base>("Multistrike"))
    {
        if (FloatData* value = dynamic_cast<FloatData*>(rawData))
            blockRating = value->value;
    }

    if (blockRating <= 0.0f)
    {
        // Fallback: read CR_BLOCK directly
        blockRating = (float)player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_BLOCK));
    }
    
    return StatsExpandedScaling::GetScaledConversion(player, "MULTISTRIKE_RATING", blockRating);
}

bool Multistrike::RollMultistrike(Player* player)
{
    float chance = GetMultistrikeChance(player);
    if (chance <= 0.0f)
        return false;
    
    return roll_chance_f(chance);
}

void Multistrike::ProcessMultistrike(Player* player, Unit* victim, SpellInfo const* spellInfo, uint32 originalDamage)
{
    if (!player || !victim || !spellInfo)
        return;
    
    // Calculate 33% effectiveness damage per SwappedStats.md
    int32 multiDamage = int32(originalDamage * MULTISTRIKE_EFFECTIVENESS);
    
    // Cast duplicate spell at reduced effectiveness (can crit normally)
    player->CastCustomSpell(victim, spellInfo->Id, &multiDamage, nullptr, nullptr, true);
}
