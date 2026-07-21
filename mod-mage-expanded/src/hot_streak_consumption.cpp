// hot_streak_consumption.cpp — Hot Streak proc buff (48108) lifecycle
// fixes (mod-mage-expanded)
//
// Flow: Hot Streak ranks 1-3 (talent dummy auras 44445/44446/44448) watch
// Fire spell crits; once the internal counter threshold is reached, core
// casts the actual "Hot Streak!" proc buff (spell 48108), which reduces
// Pyroblast/Flamestrike's cast time by -101 (i.e. instant) via a
// SPELL_AURA_ADD_PCT_MODIFIER effect.
//
// DESIGN: this buff now uses AzerothCore's native ProcCharges system (the
// spell needs `ProcCharges = 3` and `StackAmount = 1` set in the spell
// editor) instead of aura stacks. ProcCharges is the engine's built-in
// mechanism for exactly this "N uses, then gone" behavior:
// Player::RemoveSpellMods()/DropModCharge() automatically decrements
// exactly ONE charge every time the buff's cast-time-reduction actually
// gets applied to a matching cast (Pyroblast/Flamestrike), and
// Aura::ModCharges only fully removes the aura once charges hit 0 — no
// manual stack bookkeeping needed on our end at all. (Earlier attempts
// used aura StackAmount + a manual AfterCast decrement instead — abandoned
// because it fought with duration/refresh timing; ProcCharges is the
// correct native tool for this exact case, since it was 0 before, which is
// why it wasn't engaging.)
//
// The one thing that STILL needs a scripted fix regardless of
// stacks-vs-charges: the buff's DBC duration is too short to survive the
// time it takes to build up multiple charges via consecutive Fire crits,
// so it can expire naturally (AURA_REMOVE_BY_EXPIRE) before being fully
// used — spell_mage_hot_streak_proc_duration below forces a generous fixed
// duration on every apply/refresh to prevent that.

#include "ScriptMgr.h"
#include "Player.h"
#include "ScriptDefines/UnitScript.h"
#include "Unit.h"
#include "SpellAuras.h"
#include "SpellAuraEffects.h"
#include "SpellScript.h"
#include "SpellScriptLoader.h"
#include "Log.h"

namespace
{
    // "Hot Streak!" — the free/instant Pyroblast+Flamestrike proc buff
    // (NOT the talent, which is a separate spell chain — see
    // combustion_mechanics.cpp for that one).
    constexpr uint32 SPELL_MAGE_HOT_STREAK_PROC = 48108;

    // Generous window so multiple charges have time to actually get used
    // before the buff naturally expires. Tune here.
    constexpr int32 HOT_STREAK_PROC_DURATION_MS = 15000;
}

// 48108 - Hot Streak!
// Forces the buff's duration to a fixed, generous value every time it's
// applied or refreshed, regardless of whatever short duration is set on
// the spell in the DBC.
class spell_mage_hot_streak_proc_duration : public AuraScript
{
    PrepareAuraScript(spell_mage_hot_streak_proc_duration);

    void HandleApply(AuraEffect const* /*aurEff*/, AuraEffectHandleModes /*mode*/)
    {
        if (Aura* aura = GetAura())
        {
            aura->SetMaxDuration(HOT_STREAK_PROC_DURATION_MS);
            aura->SetDuration(HOT_STREAK_PROC_DURATION_MS);
            LOG_INFO("module", "HotStreakDiag: applied/refreshed — charges={}, duration set to {}ms.",
                aura->GetCharges(), aura->GetDuration());
        }
    }

    void Register() override
    {
        AfterEffectApply += AuraEffectApplyFn(spell_mage_hot_streak_proc_duration::HandleApply,
            EFFECT_0, SPELL_AURA_ADD_PCT_MODIFIER, AURA_EFFECT_HANDLE_REAL_OR_REAPPLY_MASK);
    }
};

// TEMP DIAGNOSTIC: logs every removal of the Hot Streak buff itself, with
// removeMode + remaining charges at the time.
class hot_streak_proc_diagnostic : public UnitScript
{
public:
    hot_streak_proc_diagnostic() : UnitScript("hot_streak_proc_diagnostic") { }

    void OnAuraRemove(Unit* unit, AuraApplication* aurApp, AuraRemoveMode mode) override
    {
        if (!unit || !aurApp)
            return;

        Aura* aura = aurApp->GetBase();
        if (!aura || aura->GetId() != SPELL_MAGE_HOT_STREAK_PROC)
            return;

        Player* player = unit->ToPlayer();
        LOG_INFO("module", "HotStreakDiag: Hot Streak REMOVED from {} — charges were {}, duration was {}ms, removeMode={}.",
            player ? player->GetName() : "?", aura->GetCharges(), aura->GetDuration(), uint32(mode));
    }
};

void AddHotStreakConsumptionScripts()
{
    RegisterSpellScript(spell_mage_hot_streak_proc_duration);
    new hot_streak_proc_diagnostic();
}

