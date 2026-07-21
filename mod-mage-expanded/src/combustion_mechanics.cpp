// combustion_mechanics.cpp — Combustion rework (mod-mage-expanded)
//
// Replaces the old hardcoded Combustion behavior (core's
// Unit::HandleDummyAuraProc case 11129, plus spell_mage_combustion_proc in
// spell_mage.cpp — both disabled, see comments there) with a scripted
// design layered on top of a custom spell edit (done in the spell editor,
// not here):
//
//   Combustion (11129) effect layout (set via the spell editor):
//     Effect 1 (EFFECT_0): existing crit damage bonus — stacks with the
//                           aura's StackAmount.
//     Effect 2 (EFFECT_1): SPELL_AURA_MOD_SPELL_CRIT_CHANCE, base points
//                           100 — flat 100% crit chance while active.
//     ProcCharges should be 0 — this buff is duration/stack driven, not
//     charge driven (charges are consumed by the core's generic proc/charge
//     system independently of any script, which is why leaving them >0
//     makes the buff vanish early).
//
//   Rather than adding a dummy effect to Combustion itself, the stacking
//   and cooldown-reduction triggers piggyback on Hot Streak (talent spells
//   44445/44446/44448 — core already has robust "Fire spell hit / crit"
//   proc detection for these, see Unit::HandleDummyAuraProc's
//   `dummySpell->SpellIconID == 2999` branch). spell_mage_hot_streak_combustion
//   below is registered (via spell_script_names, see the module's SQL) as
//   an ADDITIONAL script on those same spells — it never calls
//   PreventDefaultAction(), so the core's own Hot Streak logic keeps
//   running unaffected; this just piggybacks extra side effects on the
//   same proc:
//     - Every proc (i.e. every qualifying Fire spell hit) while Combustion
//       is active: adds a stack (native aura stacking recalculates the
//       crit damage bonus off EFFECT_0's per-stack value). Duration is
//       NOT touched here anymore (see below) — ModStackAmount() refreshes
//       duration to max as an internal side effect, so we explicitly
//       restore it to what it was right after, leaving duration entirely
//       cast-driven. No cooldown reduction happens here anymore either —
//       see below for what actually drives Combustion's cooldown now.
//
//   Duration extension is HARDCODED to specific casts instead of the Hot
//   Streak proc — the proc also fires from periodic DoT ticks (Ignite,
//   Living Bomb), which made Combustion's duration extend essentially
//   forever while any DoT was ticking. Fixed fixed-amount SpellScripts
//   below (spell_mage_{pyroblast,flamestrike,fireball}_combustion_extend)
//   bound directly to those spells' AfterCast hook instead: +1s per
//   Pyroblast/Flamestrike cast, +0.75s per Fireball cast, only while
//   Combustion is actually active.
//
//   Cooldown reduction is ALSO hardcoded to specific triggers, not crits:
//   -1s per Ignite tick (CombustionCooldownUnitScript, unchanged) and -1s
//   per Pyroblast or Fireball cast specifically (Flamestrike does NOT
//   reduce cooldown) — added directly in those spells' same AfterCast
//   handlers that already extend duration.

#include "ScriptMgr.h"
#include "Player.h"
#include "ScriptDefines/UnitScript.h"
#include "Unit.h"
#include "SpellInfo.h"
#include "SpellMgr.h"
#include "SpellAuras.h"
#include "SpellAuraEffects.h"
#include "SpellScript.h"
#include "SpellScriptLoader.h"
#include "Log.h"

namespace
{
    constexpr uint32 SPELL_COMBUSTION = 11129; // visible Combustion buff
    constexpr uint32 SPELL_IGNITE     = 12654;

    // Pyroblast (11366), Flamestrike (2120), Fireball (133) base rank IDs
    // are bound in SQL (spell_script_names, negative id = whole chain) to
    // the SpellScripts below — not referenced directly in code here.

    // ── Tunables ────────────────────────────────────────────────────────
    constexpr int32 PYRO_FLAMESTRIKE_COMBUSTION_EXTENSION_MS = 1500; // +0.75s per Pyroblast/Flamestrike cast
    constexpr int32 FIREBALL_COMBUSTION_EXTENSION_MS         = 500;  // +0.5s per Fireball cast
    constexpr int32 COOLDOWN_REDUCTION_ON_IGNITE_TICK_MS     = -1000; // -1s per Ignite tick
    constexpr int32 COOLDOWN_REDUCTION_ON_PYRO_FIREBALL_CAST_MS = -1000; // -1s per Pyroblast/Fireball cast

    bool HasCombustionKnown(Player* player)
    {
        return player && player->getClass() == CLASS_MAGE && player->HasSpell(SPELL_COMBUSTION);
    }

    // Extends the caster's active Combustion buff (if any) by a fixed
    // amount. Called only from actual spell casts (see the SpellScripts
    // below) — never from the Hot Streak proc, so DoT ticks (Ignite,
    // Living Bomb) can no longer keep Combustion alive indefinitely.
    void ExtendCombustionDuration(Player* player, int32 extensionMs)
    {
        if (!HasCombustionKnown(player))
            return;

        Aura* combustion = player->GetAura(SPELL_COMBUSTION);
        if (!combustion)
            return;

        int32 newDuration = combustion->GetDuration() + extensionMs;
        if (newDuration > combustion->GetMaxDuration())
            combustion->SetMaxDuration(newDuration);
        combustion->SetDuration(newDuration);
        combustion->SetNeedClientUpdateForTargets();
    }

    // Reduces the caster's Combustion cooldown by a fixed amount. Called
    // only from Pyroblast/Fireball's AfterCast hook (NOT Flamestrike, and
    // NOT on crit — those no longer reduce Combustion's cooldown at all).
    void ReduceCombustionCooldown(Player* player, int32 cooldownDeltaMs)
    {
        if (!HasCombustionKnown(player))
            return;

        player->ModifySpellCooldown(SPELL_COMBUSTION, cooldownDeltaMs);
    }
}

// ── AuraScript: piggybacks on Hot Streak's existing "Fire spell hit / crit"
// proc (spells 44445/44446/44448 — bound via spell_script_names, see the
// module's SQL). Stacks + extends Combustion on every qualifying hit, and
// additionally reduces its cooldown when that hit was a crit. ───────────
class spell_mage_hot_streak_combustion : public AuraScript
{
    PrepareAuraScript(spell_mage_hot_streak_combustion);

    void HandleProc(AuraEffect const* /*aurEff*/, ProcEventInfo& eventInfo)
    {
        Player* player = GetTarget() ? GetTarget()->ToPlayer() : nullptr;
        if (!HasCombustionKnown(player))
            return;

        if (Aura* combustion = player->GetAura(SPELL_COMBUSTION))
        {
            // Native stacking — per-stack value comes from EFFECT_0 as set
            // in the spell editor, the engine recalculates the total.
            // ModStackAmount() internally refreshes the duration back to
            // max as a side effect of adding a stack (Aura::RefreshTimers);
            // duration is now driven ONLY by actual spell casts (see the
            // cast-based SpellScripts below), so undo that auto-refresh by
            // restoring the exact duration that was active beforehand.
            int32 durationBeforeStack = combustion->GetDuration();
            combustion->ModStackAmount(1, AURA_REMOVE_BY_DEFAULT, false);
            combustion->SetDuration(durationBeforeStack);
            combustion->SetNeedClientUpdateForTargets();
        }

        // Intentionally NOT calling PreventDefaultAction() — the core's own
        // Hot Streak counter/proc logic (SpellIconID 2999) must keep running.
    }

    void Register() override
    {
        OnEffectProc += AuraEffectProcFn(spell_mage_hot_streak_combustion::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }
};

// -11366 - Pyroblast: casting it extends Combustion's remaining duration by
// a fixed +1s (hardcoded — no longer tied to the Hot Streak proc, which
// also fired on DoT ticks and let Combustion's duration extend forever) AND
// reduces its cooldown by 1s.
class spell_mage_pyroblast_combustion_extend : public SpellScript
{
    PrepareSpellScript(spell_mage_pyroblast_combustion_extend);

    void HandleAfterCast()
    {
        Player* player = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
        ExtendCombustionDuration(player, PYRO_FLAMESTRIKE_COMBUSTION_EXTENSION_MS);
        ReduceCombustionCooldown(player, COOLDOWN_REDUCTION_ON_PYRO_FIREBALL_CAST_MS);
    }

    void Register() override
    {
        AfterCast += SpellCastFn(spell_mage_pyroblast_combustion_extend::HandleAfterCast);
    }
};

// -2120 - Flamestrike: same fixed +1s extension as Pyroblast.
class spell_mage_flamestrike_combustion_extend : public SpellScript
{
    PrepareSpellScript(spell_mage_flamestrike_combustion_extend);

    void HandleAfterCast()
    {
        ExtendCombustionDuration(GetCaster() ? GetCaster()->ToPlayer() : nullptr, PYRO_FLAMESTRIKE_COMBUSTION_EXTENSION_MS);
    }

    void Register() override
    {
        AfterCast += SpellCastFn(spell_mage_flamestrike_combustion_extend::HandleAfterCast);
    }
};

// -133 - Fireball: smaller fixed +0.75s extension, AND reduces Combustion's
// cooldown by 1s (same as Pyroblast — Flamestrike does NOT do this).
class spell_mage_fireball_combustion_extend : public SpellScript
{
    PrepareSpellScript(spell_mage_fireball_combustion_extend);

    void HandleAfterCast()
    {
        Player* player = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
        ExtendCombustionDuration(player, FIREBALL_COMBUSTION_EXTENSION_MS);
        ReduceCombustionCooldown(player, COOLDOWN_REDUCTION_ON_PYRO_FIREBALL_CAST_MS);
    }

    void Register() override
    {
        AfterCast += SpellCastFn(spell_mage_fireball_combustion_extend::HandleAfterCast);
    }
};

// ── UnitScript: Ignite ticks reduce Combustion's cooldown. ───────────────
class CombustionCooldownUnitScript : public UnitScript
{
public:
    CombustionCooldownUnitScript() : UnitScript("CombustionCooldownUnitScript") { }

    void ModifyPeriodicDamageAurasTick(Unit* /*target*/, Unit* attacker, uint32& /*damage*/, SpellInfo const* spellInfo) override
    {
        if (!spellInfo || spellInfo->Id != SPELL_IGNITE)
            return;

        Player* player = attacker ? attacker->ToPlayer() : nullptr;
        if (!HasCombustionKnown(player))
            return;

        player->ModifySpellCooldown(SPELL_COMBUSTION, COOLDOWN_REDUCTION_ON_IGNITE_TICK_MS);
    }
};

void AddCombustionScripts()
{
    RegisterSpellScript(spell_mage_hot_streak_combustion);
    RegisterSpellScript(spell_mage_pyroblast_combustion_extend);
    RegisterSpellScript(spell_mage_flamestrike_combustion_extend);
    RegisterSpellScript(spell_mage_fireball_combustion_extend);
    new CombustionCooldownUnitScript();
}

