// pet_auto_summon.cpp — Auto-summon default warlock pet for all warlocks
// If the warlock has no active pet, cast spell 688 to summon one.
// This is a passive quality-of-life feature — no spell interactions.

#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    constexpr uint32 CHECK_INTERVAL_MS  = 3000;
}

class PetAutoSummonPlayerScript : public PlayerScript
{
public:
    PetAutoSummonPlayerScript() : PlayerScript("PetAutoSummonPlayerScript") { }

    void OnPlayerUpdate(Player* player, uint32 diff) override
    {
        static std::unordered_map<uint64, uint32> timers;
        uint64 guid = player->GetGUID().GetRawValue();
        uint32& timer = timers[guid];
        if (timer > diff)
        {
            timer -= diff;
            return;
        }
        timer = CHECK_INTERVAL_MS;

        if (!player || !player->IsInWorld() || !player->IsAlive())
            return;

        if (player->getClass() != CLASS_WARLOCK)
            return;

        if (player->GetPet())
            return;

        if (player->IsInCombat())
            return;
        if (player->HasUnitState(UNIT_STATE_CASTING))
            return;
        if (player->isDead() || player->HasFlag(PLAYER_FLAGS, PLAYER_FLAGS_GHOST))
            return;
        if (player->IsMounted() || player->GetVehicle())
            return;

        player->CastSpell(player, SUMMON_PET_SPELL, true);
    }

    void OnPlayerLogout(Player* /*player*/) override { }
};

void AddSC_PetAutoSummon()
{
    new PetAutoSummonPlayerScript();
}
