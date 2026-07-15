// dot_extension.cpp
// When a warlock casts Shadow Bolt or Soul Fire, each living imp extends
// all of the warlock's DoTs on the target:
//   Shadow Bolt: +0.25 s per imp
//   Soul Fire:   +0.50 s per imp

#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    constexpr int32  SB_DOT_EXTEND_MS    = 250;   // +0.25 s per imp
    constexpr int32  SF_DOT_EXTEND_MS    = 250;   // +0.50 s per imp

    void ExtendDotsOnTarget(Player* warlock, Unit* target, int32 totalExtendMs)
    {
        if (!target || totalExtendMs <= 0) return;

        auto const& auras = target->GetAppliedAuras();
        for (auto itr = auras.begin(); itr != auras.end(); ++itr)
        {
            Aura* aura = itr->second->GetBase();
            if (!aura) continue;

            // Only extend auras cast by THIS warlock
            if (aura->GetCasterGUID() != warlock->GetGUID()) continue;

            // Only extend periodic-damage (DoT) auras
            SpellInfo const* info = aura->GetSpellInfo();
            if (!info) continue;

            bool hasPeriodic = false;
            for (uint8 i = 0; i < MAX_SPELL_EFFECTS; ++i)
            {
                if (info->Effects[i].ApplyAuraName == SPELL_AURA_PERIODIC_DAMAGE ||
                    info->Effects[i].ApplyAuraName == SPELL_AURA_PERIODIC_LEECH)
                {
                    hasPeriodic = true;
                    break;
                }
            }
            if (!hasPeriodic) continue;

            int32 newMax = aura->GetMaxDuration() + totalExtendMs;
            int32 newDur = aura->GetDuration()    + totalExtendMs;
            aura->SetMaxDuration(newMax);
            aura->SetDuration(newDur);
        }
    }
}

class ImpDotExtensionSpellScript : public AllSpellScript
{
public:
    ImpDotExtensionSpellScript() : AllSpellScript("ImpDotExtensionSpellScript") { }

    void OnSpellCast(Spell* spell, Unit* caster,
                     SpellInfo const* spellInfo, bool /*skipCheck*/) override
    {
        if (!spell || !caster || !spellInfo)
            return;

        if (!caster->IsPlayer())
            return;

        Player* player = caster->ToPlayer();
        if (!player || player->getClass() != CLASS_WARLOCK)
            return;

        uint32 spellId = spellInfo->Id;

        // Determine per-imp extension based on the spell
        int32 extendPerImp = 0;
        if (spellId == SHADOWBOLT_SPELL || spellId == SHADOWBOLT_META)
            extendPerImp = SB_DOT_EXTEND_MS;
        else if (spellId == SOULFIRE_SPELL || spellId == SOULFIRE_META)
            extendPerImp = SF_DOT_EXTEND_MS;
        else
            return;

        Unit* target = spell->m_targets.GetUnitTarget();
        if (!target)
            return;

        // Count living imps
        std::list<Creature*> imps;
        GetPlayerImpsAlive(player, imps);
        int32 impCount = static_cast<int32>(imps.size());
        if (impCount == 0)
            return;

        ExtendDotsOnTarget(player, target, extendPerImp * impCount);
    }
};

void AddSC_DotExtension()
{
    new ImpDotExtensionSpellScript();
}
