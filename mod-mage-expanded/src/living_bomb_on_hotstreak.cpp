// living_bomb_on_hotstreak.cpp — Passive: getting a Hot Streak proc also
// detonates Living Bomb's explosion effect on the target you procced it
// against (mod-mage-expanded)
//
// Piggybacks on the SAME Hot Streak talent proc (spells 44445/44446/44448,
// EFFECT_0/SPELL_AURA_DUMMY) that combustion_mechanics.cpp already hooks
// for Combustion stacking — see the module's SQL, multiple ScriptName rows
// per spell_id are supported and already used this way.
//
// Detecting "this crit is the one that grants Hot Streak" without touching
// core: registered AuraScripts run BEFORE core's own hardcoded switch
// (Unit::HandleDummyAuraProc) for the same effect (see
// Unit::ProcDamageAndSpell — it calls script OnEffectProc handlers first,
// only skipping the old hardcoded logic if a script calls
// PreventDefaultAction(), which we intentionally never do here). So when
// THIS handler runs, core's "counter" aura effect (EFFECT_1 on the same
// talent aura) still holds its PRE-this-crit value — core doubles it
// afterward and grants the "Hot Streak!" buff (48108) once it reaches 100.
// That means: if the counter is already >= 50 and this hit is a crit,
// core is about to double it to >= 100 and grant Hot Streak right after we
// return — so that's exactly the proc to act on here.
//
// Casts the Living Bomb EXPLOSION spell (55361) directly — NOT the DoT —
// so the target takes an instant burst instead of a ticking debuff.
// Gated on the player actually knowing Living Bomb (any rank) — a passive
// synergy for Fire mages who have both talents, no new spell ID needed.
// Also has a 1-second internal cooldown (tracked via the explosion spell's
// own spell-cooldown map, never sent to the client) so the explosion's own
// damage — which can itself crit and satisfy the Hot Streak counter — can't
// re-trigger this same passive recursively.

#include "ScriptMgr.h"
#include "Player.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "SpellScript.h"
#include "SpellScriptLoader.h"

namespace
{
    // Living Bomb DoT ranks (SPELLFAMILY_MAGE) — used only to check the
    // player actually has the talent, gating the synergy.
    constexpr uint32 SPELL_MAGE_LIVING_BOMB_RANKS[] = { 55360, 55359, 44457 };

    // Living Bomb's explosion effect — cast directly instead of the DoT.
    constexpr uint32 SPELL_MAGE_LIVING_BOMB_EXPLOSION = 55361;

    constexpr uint32 LIVING_BOMB_EXPLOSION_ICD_MS = 1000;

    bool KnowsLivingBomb(Player* player)
    {
        if (!player)
            return false;

        for (uint32 spellId : SPELL_MAGE_LIVING_BOMB_RANKS)
            if (player->HasSpell(spellId))
                return true;

        return false;
    }
}

// Piggybacks on Hot Streak's talent proc (44445/44446/44448) — see header
// comment above for how "this crit grants Hot Streak" is detected.
class spell_mage_living_bomb_on_hotstreak : public AuraScript
{
    PrepareAuraScript(spell_mage_living_bomb_on_hotstreak);

    void HandleProc(AuraEffect const* /*aurEff*/, ProcEventInfo& eventInfo)
    {
        if (!(eventInfo.GetHitMask() & PROC_EX_CRITICAL_HIT))
            return;

        Player* player = GetTarget() ? GetTarget()->ToPlayer() : nullptr;
        if (!player)
            return;

        Aura* talentAura = GetAura();
        AuraEffect* counter = talentAura ? talentAura->GetEffect(EFFECT_1) : nullptr;
        if (!counter || counter->GetAmount() < 50)
            return; // this crit won't be enough to grant Hot Streak

        if (!KnowsLivingBomb(player))
            return; // player doesn't know Living Bomb — no synergy

        if (player->HasSpellCooldown(SPELL_MAGE_LIVING_BOMB_EXPLOSION))
            return; // explosion's own crit damage can't re-trigger this

        Unit* target = eventInfo.GetProcTarget();
        if (!target)
            return;

        player->AddSpellCooldown(SPELL_MAGE_LIVING_BOMB_EXPLOSION, 0, LIVING_BOMB_EXPLOSION_ICD_MS);
        player->CastSpell(target, SPELL_MAGE_LIVING_BOMB_EXPLOSION, true);
    }

    void Register() override
    {
        OnEffectProc += AuraEffectProcFn(spell_mage_living_bomb_on_hotstreak::HandleProc, EFFECT_0, SPELL_AURA_DUMMY);
    }
};

void AddLivingBombOnHotStreakScripts()
{
    RegisterSpellScript(spell_mage_living_bomb_on_hotstreak);
}
