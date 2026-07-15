#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    constexpr float BASE_DRAIN_PERCENT = 1.0f;  // Base % of max mana per second
    constexpr float DRAIN_INCREASE_PERCENT = 0.70f;     // Additional % per second
    constexpr uint32 UPDATE_INTERVAL = 200; // Smooth drain interval (ms)
    constexpr float META_MIN_MANA_PERCENT = 79.0f; // Must have 80% mana to enter meta

    // Spell replacements when in metamorphosis
    constexpr uint32 SHADOWBOLT_NORMAL = SHADOWBOLT_SPELL;
    constexpr uint32 SOULFIRE_NORMAL   = SOULFIRE_SPELL;
    constexpr uint32 SHADOWFLAME_NORMAL = SHADOWFLAME_SPELL;
    constexpr uint32 HELLFIRE_NORMAL   = HELLFIRE_SPELL;
    constexpr uint32 SOUL_SIPHON_SPELL_ID = SOULFIRE_META; // Soul Siphon pauses drain

    std::unordered_map<uint64, uint32> s_MetamorphosisDuration; // Smooth drain timer
    std::unordered_map<uint64, uint32> s_MetamorphosisSecondTimer; // Tracks 1s ticks
    std::unordered_map<uint64, uint32> s_MetamorphosisTicks; // Tracks number of seconds
    std::unordered_map<uint64, bool> s_InMetamorphosis; // Track if player is in meta
    std::unordered_map<uint64, bool> s_DrainPaused; // Track if drain is paused
    std::unordered_map<uint64, uint32> s_ManaRemainder; // Remainder for smooth drain (millimana)

    constexpr uint32 MAX_CAST_SPEED_STACKS = 99;

    // Add exactly 1 stack of the cast speed buff without triggering procs/cascades
    void AddCastSpeedStack(Player* player)
    {
        if (!player)
            return;
        Aura* aura = player->GetAura(CAST_SPEED_BUFF);
        if (!aura)
        {
            player->AddAura(CAST_SPEED_BUFF, player);
            return; // AddAura already sets stack to 1
        }
        if (aura->GetStackAmount() < MAX_CAST_SPEED_STACKS)
            aura->ModStackAmount(1);
    }

    void ReplaceSpellsForMeta(Player* player, bool enterMeta)
    {
        if (!player)
            return;

        uint64 guid = player->GetGUID().GetRawValue();
        s_InMetamorphosis[guid] = enterMeta;
    }
}

class MetamorphosisManagerPlayerScript : public PlayerScript
{
public:
    MetamorphosisManagerPlayerScript() : PlayerScript("MetamorphosisManagerPlayerScript") { }

    void OnPlayerUpdate(Player* player, uint32 diff)
    {
        if (!player || !player->IsInWorld())
            return;

        // Check if player has metamorphosis aura
        if (!player->HasAura(METAMORPHOSIS_AURA))
        {
            // Clear tracking when aura is removed
            uint64 guid = player->GetGUID().GetRawValue();
            auto durIt = s_MetamorphosisDuration.find(guid);
            if (durIt != s_MetamorphosisDuration.end())
            {
                // Leaving metamorphosis - restore spells and remove buff
                ReplaceSpellsForMeta(player, false);
                player->RemoveAura(CAST_SPEED_BUFF);
                player->SetPower(POWER_MANA, 0);
                s_MetamorphosisDuration.erase(guid);
                s_MetamorphosisSecondTimer.erase(guid);
                s_MetamorphosisTicks.erase(guid);
                s_DrainPaused.erase(guid);
                s_ManaRemainder.erase(guid);
            }
            return;
        }

        uint64 guid = player->GetGUID().GetRawValue();
        
        // Initialize tracking for new metamorphosis
        if (s_MetamorphosisDuration.find(guid) == s_MetamorphosisDuration.end())
        {
            s_MetamorphosisDuration[guid] = 0;
            s_MetamorphosisSecondTimer[guid] = 0;
            s_MetamorphosisTicks[guid] = 0;
            s_DrainPaused[guid] = false;
            s_ManaRemainder[guid] = 0;
            // Entering metamorphosis - replace spells
            ReplaceSpellsForMeta(player, true);
        }

        // Check if player is casting Soul Siphon
        bool isCastingSoulSiphon = false;
        if (player->HasUnitState(UNIT_STATE_CASTING))
        {
            Spell* currentSpell = player->GetCurrentSpell(CURRENT_GENERIC_SPELL);
            if (!currentSpell)
                currentSpell = player->GetCurrentSpell(CURRENT_CHANNELED_SPELL);
            
            if (currentSpell && currentSpell->m_spellInfo && currentSpell->m_spellInfo->Id == SOUL_SIPHON_SPELL_ID)
                isCastingSoulSiphon = true;
        }

        // Check if drain is paused (by Soul Siphon DOT damage)
        bool isDrainPaused = s_DrainPaused[guid];

        // Increment elapsed time (paused during Soul Siphon or when manually paused)
        if (!isCastingSoulSiphon && !isDrainPaused)
        {
            s_MetamorphosisDuration[guid] += diff;
            s_MetamorphosisSecondTimer[guid] += diff;
        }
        else if (isDrainPaused)
            s_DrainPaused[guid] = false; // Unpause after one update cycle

        // Update per-second tick counter and apply cast speed buff exactly once per second
        while (s_MetamorphosisSecondTimer[guid] >= 1000)
        {
            s_MetamorphosisSecondTimer[guid] -= 1000;
            s_MetamorphosisTicks[guid]++;
            // Apply one stack of cast speed buff per second tick
            AddCastSpeedStack(player);
        }

        // Process smooth drain every interval
        if (s_MetamorphosisDuration[guid] >= UPDATE_INTERVAL)
        {
            uint32 currentTick = s_MetamorphosisTicks[guid];
            uint32 maxMana = player->GetMaxPower(POWER_MANA);
            uint32 currentMana = player->GetPower(POWER_MANA);
            
            // Calculate drain as percentage of max mana per this interval
            float drainPercentThisInterval = (BASE_DRAIN_PERCENT + (currentTick * DRAIN_INCREASE_PERCENT)) * UPDATE_INTERVAL / 1000.0f;
            uint32 drainAmount = uint32(drainPercentThisInterval * maxMana / 100.0f);

            // Only drain mana if NOT casting Soul Siphon
            if (!isCastingSoulSiphon && drainAmount > 0)
            {
                // Check if we have enough mana for this drain
                if (currentMana > drainAmount)
                {
                    // Drain the mana
                    player->ModifyPower(POWER_MANA, -int32(drainAmount));
                }
                else
                {
                    // Not enough mana - end metamorphosis
                    player->RemoveAura(METAMORPHOSIS_AURA);
                    ReplaceSpellsForMeta(player, false);
                    player->RemoveAura(CAST_SPEED_BUFF);
                    player->SetPower(POWER_MANA, 0);
                    s_MetamorphosisDuration.erase(guid);
                    s_MetamorphosisSecondTimer.erase(guid);
                    s_MetamorphosisTicks.erase(guid);
                    s_DrainPaused.erase(guid);
                    s_ManaRemainder.erase(guid);
                    return;
                }
            }
            
            // Reset the timer (keep remainder for next tick)
            s_MetamorphosisDuration[guid] %= UPDATE_INTERVAL;
        }
    }

    void OnPlayerLogout(Player* player)
    {
        if (!player)
            return;

        uint64 guid = player->GetGUID().GetRawValue();
        
        // Restore spells if they were in meta
        if (s_MetamorphosisDuration.find(guid) != s_MetamorphosisDuration.end())
        {
            ReplaceSpellsForMeta(player, false);
            player->RemoveAura(CAST_SPEED_BUFF);
        }
        
        s_MetamorphosisDuration.erase(guid);
        s_MetamorphosisSecondTimer.erase(guid);
        s_MetamorphosisTicks.erase(guid);
        s_InMetamorphosis.erase(guid);
        s_DrainPaused.erase(guid);
        s_ManaRemainder.erase(guid);
    }

    void OnPlayerSpellCast(Player* player, Spell* spell, bool skipCheck)
    {
        if (!player || !spell || !spell->m_spellInfo)
            return;

        uint64 guid = player->GetGUID().GetRawValue();
        uint32 spellId = spell->m_spellInfo->Id;
        
        // Handle Shadow Bolt cooldown reduction for Soul Fire
        if (spellId == SHADOWBOLT_NORMAL || spellId == SHADOWBOLT_META)
        {
            // Reduce Soul Fire cooldown by 500ms
            if (player->HasSpellCooldown(SOULFIRE_NORMAL))
            {
                player->ModifySpellCooldown(SOULFIRE_NORMAL, -500);
            }
        }
        
        if (s_InMetamorphosis.find(guid) == s_InMetamorphosis.end() || !s_InMetamorphosis[guid])
            return;

        uint32 empoweredSpell = 0;

        // Check if we need to also cast an empowered version
        if (spellId == SHADOWBOLT_NORMAL)
            empoweredSpell = SHADOWBOLT_META;
        else if (spellId == SOULFIRE_NORMAL)
            empoweredSpell = SOULFIRE_META;
        else if (spellId == SHADOWFLAME_NORMAL)
            empoweredSpell = SHADOWFLAME_META;
        else if (spellId == HELLFIRE_NORMAL)
            empoweredSpell = HELLFIRE_META;

        if (empoweredSpell != 0)
        {
            // Cast the empowered version alongside the normal spell
            player->CastSpell(spell->m_targets.GetUnitTarget(), empoweredSpell, true);
        }
    }
};

// AuraScript for Soul Siphon periodic damage (more efficient than AllSpellScript)
class spell_soul_siphon_periodic : public AuraScript
{
    PrepareAuraScript(spell_soul_siphon_periodic);

    void OnPeriodic(AuraEffect const* /*aurEff*/)
    {
        Unit* caster = GetCaster();
        if (!caster)
            return;

        Player* player = caster->ToPlayer();
        if (!player)
            return;

        uint64 guid = player->GetGUID().GetRawValue();
        
        // Pause the drain timer
        s_DrainPaused[guid] = true;
    }

    void Register() override
    {
        OnEffectPeriodic += AuraEffectPeriodicFn(spell_soul_siphon_periodic::OnPeriodic, EFFECT_0, SPELL_AURA_PERIODIC_DAMAGE);
    }
};

// SpellScript that blocks Metamorphosis cast when mana < 80%
class spell_metamorphosis_mana_gate : public SpellScript
{
    PrepareSpellScript(spell_metamorphosis_mana_gate);

    SpellCastResult CheckCast()
    {
        Unit* caster = GetCaster();
        if (!caster)
            return SPELL_FAILED_DONT_REPORT;

        uint32 curMana = caster->GetPower(POWER_MANA);
        uint32 maxMana = caster->GetMaxPower(POWER_MANA);
        float manaPct = maxMana > 0 ? (curMana * 100.0f / maxMana) : 0.0f;

        if (manaPct < META_MIN_MANA_PERCENT)
            return SPELL_FAILED_FIZZLE;

        return SPELL_CAST_OK;
    }

    void Register() override
    {
        OnCheckCast += SpellCheckCastFn(spell_metamorphosis_mana_gate::CheckCast);
    }
};

void AddSC_MetamorphosisManager()
{
    new MetamorphosisManagerPlayerScript();
    RegisterSpellScript(spell_soul_siphon_periodic);
    RegisterSpellScript(spell_metamorphosis_mana_gate);
}
