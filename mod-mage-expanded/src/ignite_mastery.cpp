// ignite_mastery.cpp — Mastery scaling + full rolling-DoT pool for Ignite
// (mod-mage-expanded)
//
// Core's spell_mage_ignite (src/server/scripts/Spells/spell_mage.cpp, bound
// to -11119) is now a no-op (just PreventDefaultAction()) — ALL of
// Ignite's damage application (the base 8%/rank roll-in AND the
// Mastery-scaled bonus) is consolidated here into spell_mage_ignite_full,
// implementing a proper non-decaying rolling-DoT pool:
//
//   Unit::CastDelayedSpellWithPeriodicAmount (the shared core helper both
//   this spell and core's old implementation used) merges a new
//   contribution with only a DECAYING fraction of whatever's left
//   (oldPerTick * ticksRemaining/totalTicks) — correct for OTHER spells
//   that intentionally replicate that classic partial-decay behavior
//   (Deep Wounds, Electrified, etc.), so it's not touched globally. But it
//   made rapid Hot Streak-driven Ignite refreshes (multiple crits within
//   a couple seconds, well before Ignite's 2 ticks could land) lose most
//   of their damage instead of stacking it. spell_mage_ignite_full instead
//   reads the CURRENT remaining total directly (GetAmount() * ticksLeft,
//   no decay) and adds the full new contribution on top, then recasts
//   with the combined total redistributed across the current tick count.
//
// Reads live from mod-stats-expanded's StatsExpandedScaling (in-memory
// cache reloaded from the `custom_character_stats` DB table), so changing
// the "MASTERY_RATING" row's rating_per_percent takes effect immediately
// without needing a rebuild — no per-proc DB query involved.
//
// Ignite also grants flat crit RATING equal to 4x the player's raw
// Mastery rating, applied to CR_DODGE (the custom "Crit" swap-stat) so it
// scales both crit chance AND crit damage together, consistent with every
// other source of Crit rating on this server. Kept in sync via a
// PlayerScript (see UpdateIgniteMasteryCrit / mage_ignite_mastery_crit_playerscript below).

#include "ScriptMgr.h"
#include "Player.h"
#include "SpellInfo.h"
#include "SpellMgr.h"
#include "SpellAuras.h"
#include "SpellAuraEffects.h"
#include "SpellScript.h"
#include "SpellScriptLoader.h"
#include "StatsExpandedScaling.h"
#include "StatsExpandedData.h"

namespace
{
    constexpr uint32 SPELL_MAGE_IGNITE = 12654;

    // The Ignite talent's own passive (dummy aura) spell chain, ranks 1-5.
    // This is a SEPARATE spell from SPELL_MAGE_IGNITE above (which is just
    // the periodic damage effect Ignite rolls crit damage into).
    constexpr uint32 SPELL_MAGE_IGNITE_TALENT_RANKS[] = { 11119, 11120, 12846, 12847, 12848 };

    // Each 1% Mastery adds this many % of the crit's damage into Ignite's
    // roll-in amount. Tune here.
    constexpr float IGNITE_PCT_PER_MASTERY_PCT = 4.5f;

    // Ignite also grants flat crit RATING equal to this many multiples of
    // the player's raw Mastery rating. This is applied to CR_DODGE (the
    // custom "Crit" swap-stat — see mod-stats-expanded's SwappedStats.md,
    // CR_DODGE -> Crit: 10 rating = 1% crit chance + 2% crit damage bonus
    // together), NOT the native CR_CRIT_SPELL directly — that way Ignite's
    // bonus scales crit DAMAGE proportionally too, exactly like every
    // other source of Crit rating on this server, instead of only being
    // pure chance with no matching damage increase. This does mean it also
    // nudges melee/ranged crit chance (mod-stats-expanded's own recalc
    // pipes CR_DODGE into all three crit slots uniformly) — that's the
    // accepted tradeoff for consistent chance+damage scaling.
    constexpr float IGNITE_CRIT_RATING_PER_MASTERY_RATING = 0.75f;

    bool HasIgniteTalent(Player* player)
    {
        if (!player || player->getClass() != CLASS_MAGE)
            return false;

        for (uint32 spellId : SPELL_MAGE_IGNITE_TALENT_RANKS)
            if (player->HasSpell(spellId))
                return true;

        return false;
    }

    // mod-stats-expanded's UpdateDerivedStats() reads the raw gear-based
    // CR_PARRY rating once, caches it into CustomData["Mastery"], and then
    // ZEROES the live CR_PARRY field back out (it's just a transport slot
    // from gear, not a real stat) — so the live combat rating field can
    // NOT be read directly here, it's always 0 by the time this runs.
    int32 GetMasteryRating(Player* player)
    {
        if (!player || !StatsExpandedScaling::IsStatEnabled("MASTERY_RATING"))
            return 0;

        FloatData* mastery = player->CustomData.Get<FloatData>("Mastery");
        return mastery ? int32(mastery->value) : 0;
    }

    // Recalculates the flat crit RATING bonus Ignite grants from Mastery.
    // Idempotent: tracks the last-applied rating via CustomData so it can
    // be cleanly removed/replaced whenever Mastery or the talent changes.
    void UpdateIgniteMasteryCrit(Player* player)
    {
        if (!player)
            return;

        int32 oldRating = 0;
        if (FloatData* applied = player->CustomData.Get<FloatData>("IgniteMasteryCrit_Rating"))
            oldRating = int32(applied->value);

        int32 newRating = 0;
        if (HasIgniteTalent(player))
        {
            int32 masteryRating = GetMasteryRating(player);
            if (masteryRating > 0)
                newRating = int32(float(masteryRating) * IGNITE_CRIT_RATING_PER_MASTERY_RATING);
        }

        if (newRating == oldRating)
            return;

        if (oldRating != 0)
            player->ApplyRatingMod(CR_DODGE, oldRating, false);
        if (newRating != 0)
            player->ApplyRatingMod(CR_DODGE, newRating, true);

        player->CustomData.Set("IgniteMasteryCrit_Rating", new FloatData(float(newRating)));
    }
}

class spell_mage_ignite_full : public AuraScript
{
    PrepareAuraScript(spell_mage_ignite_full);

    bool Validate(SpellInfo const* /*spellInfo*/) override
    {
        return ValidateSpellInfo({ SPELL_MAGE_IGNITE });
    }

    bool CheckProc(ProcEventInfo& eventInfo)
    {
        if (!eventInfo.GetActor() || !eventInfo.GetProcTarget())
            return false;

        DamageInfo* damageInfo = eventInfo.GetDamageInfo();
        if (!damageInfo || !damageInfo->GetSpellInfo())
            return false;

        // Molten Armor — matches core's original exclusion.
        if (SpellInfo const* spellInfo = eventInfo.GetSpellInfo())
            if (spellInfo->SpellFamilyFlags[1] & 0x8)
                return false;

        return true;
    }

    void HandleProc(AuraEffect const* /*aurEff*/, ProcEventInfo& eventInfo)
    {
        Player* player = eventInfo.GetActor() ? eventInfo.GetActor()->ToPlayer() : nullptr;
        Unit* target = eventInfo.GetProcTarget();
        if (!player || !target)
            return;

        SpellInfo const* igniteDot = sSpellMgr->AssertSpellInfo(SPELL_MAGE_IGNITE);
        int32 maxTicks = igniteDot->GetMaxTicks();
        if (maxTicks <= 0)
            return;

        // Base contribution: 8% per Ignite talent rank (same formula core
        // used, now correctly rank-aware since spell_ranks was fixed).
        int32 totalPct = 8 * GetSpellInfo()->GetRank();

        // Mastery-scaled bonus contribution, on top of the base.
        float ratingPerPercent = StatsExpandedScaling::GetBaseRequirement("MASTERY_RATING");
        if (StatsExpandedScaling::IsStatEnabled("MASTERY_RATING") && ratingPerPercent > 0.0f)
        {
            float masteryPct = float(GetMasteryRating(player)) / ratingPerPercent;
            if (masteryPct > 0.0f)
                totalPct += int32(masteryPct * IGNITE_PCT_PER_MASTERY_PCT);
        }

        if (totalPct <= 0)
            return;

        int32 critDamage = eventInfo.GetDamageInfo()->GetDamage();
        int32 newContributionTotal = CalculatePct(critDamage, totalPct);
        if (newContributionTotal <= 0)
            return;

        // Roll in whatever's left of the CURRENT Ignite DoT — a true
        // rolling pool, no decay: remaining total = current per-tick
        // amount * ticks left. Combine with the new contribution and
        // redistribute across a fresh tick count.
        int32 remainingTotal = 0;
        if (Aura* existing = target->GetAura(SPELL_MAGE_IGNITE, player->GetGUID()))
        {
            if (AuraEffect* eff = existing->GetEffect(EFFECT_0))
            {
                int32 ticksLeft = std::max<int32>(eff->GetTotalTicks() - int32(eff->GetTickNumber()), 0);
                remainingTotal = eff->GetAmount() * ticksLeft;
            }
        }

        int32 newPerTick = (remainingTotal + newContributionTotal) / maxTicks;
        if (newPerTick <= 0)
            return;

        player->CastCustomSpell(SPELL_MAGE_IGNITE, SPELLVALUE_BASE_POINT0, newPerTick, target, TRIGGERED_FULL_MASK, nullptr, nullptr, player->GetGUID());
    }

    void Register() override
    {
        DoCheckProc += AuraCheckProcFn(spell_mage_ignite_full::CheckProc);
        OnEffectProc += AuraEffectProcFn(spell_mage_ignite_full::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }
};

// Keeps the Ignite Mastery crit% bonus in sync whenever something that
// could change it happens: talent learned/reset (login catches this after
// a relog; equip/unequip and level-ups cover Mastery rating changes from
// gear/level scaling).
class mage_ignite_mastery_crit_playerscript : public PlayerScript
{
public:
    mage_ignite_mastery_crit_playerscript() : PlayerScript("mage_ignite_mastery_crit_playerscript") { }

    void OnPlayerLogin(Player* player) override
    {
        UpdateIgniteMasteryCrit(player);
    }

    void OnPlayerLevelChanged(Player* player, uint8 /*oldLevel*/) override
    {
        UpdateIgniteMasteryCrit(player);
    }

    void OnPlayerEquip(Player* player, Item* /*it*/, uint8 /*bag*/, uint8 /*slot*/, bool /*update*/) override
    {
        UpdateIgniteMasteryCrit(player);
    }

    void OnPlayerUnequip(Player* player, Item* /*it*/) override
    {
        UpdateIgniteMasteryCrit(player);
    }
};

void AddIgniteMasteryScripts()
{
    RegisterSpellScript(spell_mage_ignite_full);
    new mage_ignite_mastery_crit_playerscript();
}
