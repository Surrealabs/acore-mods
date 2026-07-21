#include "ScriptMgr.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "SpellScript.h"
#include "Unit.h"
#include "Player.h"
#include "ObjectAccessor.h"
#include "EventProcessor.h"
#include "Utilities/Timer.h"
#include "StatsExpandedData.h"
#include "StatsExpandedScaling.h"
#include "ElementalistSpells.h"

// Defined in CallOfTheElementsNPCs.cpp - registers the 4 Rock/Fire/Wind/Water
// elemental Guardian AIs that Call of the Elements (spell 66842) summons.
void AddCallOfTheElementsNPCs();

// ════════════════════════════════════════════════════════════════════════
//  mod-shaman-expanded — Custom Shaman mechanics
// ════════════════════════════════════════════════════════════════════════

// Elementalist Ascendant defensive shields (Molten Shell / Lightning Shell /
// Bubble / Bulwark, spells 900060-900063). SPELL_AURA_SCHOOL_ABSORB is never
// auto-scaled by the engine's default AuraEffect::CalculateAmount path
// (unlike periodic damage/heal auras), so we read the direct_bonus
// coefficient from spell_bonus_data ourselves and apply it against the
// caster's spell power - same technique real Power Word: Shield uses
// (spell_pri_power_word_shield_aura), just data-driven via spell_bonus_data
// instead of a hardcoded coefficient so tuning stays in one place.
class spell_sha_expanded_elemental_shield : public AuraScript
{
    PrepareAuraScript(spell_sha_expanded_elemental_shield);

    void CalculateAmount(AuraEffect const* aurEff, int32& amount, bool& /*canBeRecalculated*/)
    {
        Unit* caster = GetCaster();
        if (!caster)
            return;

        SpellBonusEntry const* bonus = sSpellMgr->GetSpellBonusData(GetSpellInfo()->Id);
        if (!bonus || bonus->direct_damage <= 0.0f)
            return;

        float value = bonus->direct_damage * caster->SpellBaseHealingBonusDone(GetSpellInfo()->GetSchoolMask());
        value = caster->ApplyEffectModifiers(GetSpellInfo(), aurEff->GetEffIndex(), value);
        value *= caster->CalculateLevelPenalty(GetSpellInfo());

        amount += int32(value);
    }

    void Register() override
    {
        DoEffectCalcAmount += AuraEffectCalcAmountFn(spell_sha_expanded_elemental_shield::CalculateAmount, EFFECT_0, SPELL_AURA_SCHOOL_ABSORB);
    }
};

// ════════════════════════════════════════════════════════════════════════
//  Elementalist — shared Bolt/Shock buttons, elemental ultimates, and the
//  "empowered" damage bonus window. Spell IDs are all looked up from
//  ElementalistSpells.h - see that file to wire up new/real spell IDs.
// ════════════════════════════════════════════════════════════════════════

namespace
{
    // Custom-data keys (per player) used to track the ultimate's temporary
    // "empowered element" window. Value types are the plain UInt32Data
    // already defined in mod-stats-expanded/StatsExpandedData.h (reused
    // cross-module rather than re-declared here).
    constexpr char const* DATA_EMPOWERED_ELEMENT = "Elementalist_EmpoweredElement";
    constexpr char const* DATA_EMPOWERED_EXPIRY  = "Elementalist_EmpoweredExpiry";
    // Sentinel stored in DATA_EMPOWERED_ELEMENT when nothing is empowered.
    constexpr uint32 NO_ELEMENT = uint32(Elementalist::Element::Count);

    Unit* PickRedirectTarget(SpellScript* spellScript, Player* caster)
    {
        if (Unit* explicitTarget = spellScript->GetExplTargetUnit())
            return explicitTarget;
        if (Unit* victim = caster->GetVictim())
            return victim;
        return caster;
    }

    float GetMasteryPercent(Player* player)
    {
        if (!StatsExpandedScaling::IsStatEnabled("MASTERY_RATING"))
            return 0.0f;

        float raw = 0.0f;
        if (FloatData* data = player->CustomData.Get<FloatData>("Mastery"))
            raw = data->value;

        return StatsExpandedScaling::GetScaledConversion(player, "MASTERY_RATING", raw);
    }

    void SetEmpoweredElement(Player* player, Elementalist::Element element, uint32 durationMs)
    {
        player->CustomData.GetDefault<UInt32Data>(DATA_EMPOWERED_ELEMENT)->value = uint32(element);
        player->CustomData.GetDefault<UInt32Data>(DATA_EMPOWERED_EXPIRY)->value = getMSTime() + durationMs;
    }

    // Returns the currently-empowered element for this player, if any and
    // if the window hasn't expired yet.
    std::optional<Elementalist::Element> GetEmpoweredElement(Player* player)
    {
        UInt32Data* elementData = player->CustomData.Get<UInt32Data>(DATA_EMPOWERED_ELEMENT);
        if (!elementData || elementData->value == NO_ELEMENT)
            return std::nullopt;

        UInt32Data* expiryData = player->CustomData.Get<UInt32Data>(DATA_EMPOWERED_EXPIRY);
        if (!expiryData || getMSTime() >= expiryData->value)
        {
            elementData->value = NO_ELEMENT;
            return std::nullopt;
        }

        return Elementalist::Element(elementData->value);
    }

    std::optional<Elementalist::FormEntry> GetActiveForm(Player* player)
    {
        for (Elementalist::FormEntry const& form : Elementalist::FORMS)
            if (form.auraSpellId != 0 && player->HasAura(form.auraSpellId))
                return form;
        return std::nullopt;
    }
}

// Shared "Bolt"/"Shock" dummy buttons - redirects to whichever real spell
// matches the player's current elemental form. Bind BOTH
// Elementalist::SPELL_BOLT_DUMMY and Elementalist::SPELL_SHOCK_DUMMY to this
// same ScriptName in spell_script_names once those spells exist.
class spell_sha_expanded_bolt_shock : public SpellScript
{
    PrepareSpellScript(spell_sha_expanded_bolt_shock);

    void HandleAfterCast()
    {
        Player* player = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
        if (!player)
            return;

        std::optional<Elementalist::FormEntry> form = GetActiveForm(player);
        if (!form)
            return; // not currently in any elemental form - nothing to redirect to

        Elementalist::ElementAbilities const* abilities = Elementalist::GetAbilities(form->element);
        if (!abilities)
            return;

        bool isShock = GetSpellInfo()->Id == Elementalist::SPELL_SHOCK_DUMMY;
        uint32 realSpellId = isShock ? abilities->shockSpellId : abilities->boltSpellId;
        if (realSpellId == 0)
            return; // not configured yet in ElementalistSpells.h

        Unit* target = PickRedirectTarget(static_cast<SpellScript*>(this), player);
        player->CastSpell(target, realSpellId, true);
    }

    void Register() override
    {
        AfterCast += SpellCastFn(spell_sha_expanded_bolt_shock::HandleAfterCast);
    }
};

// The 8 elemental "power" ultimates - swap the player into that
// element+tier's form and grant a temporary all-of-that-element damage
// bonus. Bind every ID in Elementalist::ULTIMATES to this same ScriptName.
class spell_sha_expanded_elemental_ultimate : public SpellScript
{
    PrepareSpellScript(spell_sha_expanded_elemental_ultimate);

    void HandleAfterCast()
    {
        Player* player = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
        if (!player)
            return;

        std::optional<Elementalist::UltimateEntry> ultimate = Elementalist::FindUltimate(GetSpellInfo()->Id);
        if (!ultimate)
            return; // not configured yet in ElementalistSpells.h

        // Drop whatever form the player is currently in, then apply the new
        // one - forms are mutually exclusive.
        for (Elementalist::FormEntry const& form : Elementalist::FORMS)
            if (form.auraSpellId != 0)
                player->RemoveAurasDueToSpell(form.auraSpellId);

        for (Elementalist::FormEntry const& form : Elementalist::FORMS)
        {
            if (form.element == ultimate->element && form.tier == ultimate->tier && form.auraSpellId != 0)
            {
                player->CastSpell(player, form.auraSpellId, true);
                break;
            }
        }

        int32 duration = GetSpellInfo()->GetDuration();
        uint32 durationMs = duration > 0 ? uint32(duration) : Elementalist::EMPOWERMENT_DEFAULT_DURATION_MS;
        SetEmpoweredElement(player, ultimate->element, durationMs);

        // Some ultimates are themselves a charge/teleport to the target -
        // their "landing" follow-up spell can't be a normal DBC
        // EffectTriggerSpell on this same spell (every effect on a spell,
        // including the charge/teleport itself, resolves in the same
        // instant, so a same-spell trigger fires alongside the movement,
        // not after it - this was the "suck-in happens on cast" bug).
        // Schedule it instead so it actually fires after the caster has
        // arrived.
        if (ultimate->delayedTriggerSpellId != 0)
        {
            uint32 triggerSpellId = ultimate->delayedTriggerSpellId;
            ObjectGuid casterGuid = player->GetGUID();
            player->m_Events.AddEventAtOffset([casterGuid, triggerSpellId]()
            {
                if (Player* caster = ObjectAccessor::FindPlayer(casterGuid))
                    caster->CastSpell(caster, triggerSpellId, true);
            }, Milliseconds(ultimate->delayedTriggerDelayMs));
        }
    }

    void Register() override
    {
        AfterCast += SpellCastFn(spell_sha_expanded_elemental_ultimate::HandleAfterCast);
    }
};

// Applies the ultimate's temporary damage bonus (flat 5% + Mastery%) to all
// of the currently-empowered element's abilities (attack/shield/bolt/shock).
class ElementalistEmpowermentUnitScript : public UnitScript
{
public:
    ElementalistEmpowermentUnitScript() : UnitScript("ElementalistEmpowermentUnitScript") { }

    void ModifySpellDamageTaken(Unit* target, Unit* attacker, int32& damage, SpellInfo const* spellInfo) override
    {
        if (!target || !attacker || !spellInfo || damage <= 0 || spellInfo->IsPositive())
            return;

        Player* player = attacker->ToPlayer();
        if (!player)
            return;

        std::optional<Elementalist::Element> empoweredElement = GetEmpoweredElement(player);
        if (!empoweredElement)
            return;

        if (!Elementalist::IsElementAbilitySpell(spellInfo->Id, *empoweredElement))
            return;

        float bonusPct = Elementalist::EMPOWERMENT_FLAT_BONUS_PCT + GetMasteryPercent(player);
        AddPct(damage, bonusPct);
    }
};

// Call of the Elements (class cooldown, spell 66842): always summons the
// SAME 4 elemental totems (ElementalistSpells::CALL_OF_THE_ELEMENTS_TOTEMS)
// regardless of what's on the player's totem bar - see ElementalistSpells.h
// for why the DBC's own SPELL_EFFECT_CAST_BUTTON effect is a no-op here.
// Bind spell 66842 to this ScriptName in spell_script_names.
class spell_sha_expanded_call_of_the_elements : public SpellScript
{
    PrepareSpellScript(spell_sha_expanded_call_of_the_elements);

    void HandleAfterCast()
    {
        Player* player = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
        if (!player)
            return;

        // Two summons per element: the Totem-type "pole" (ground model +
        // player-frame duration timer) and the Guardian-type mobile
        // elemental (the one that actually fights, see CallOfTheElementsNPCs.cpp).
        for (uint32 poleSpellId : Elementalist::CALL_OF_THE_ELEMENTS_POLES)
            if (poleSpellId != 0)
                player->CastSpell(player, poleSpellId, true);

        for (uint32 totemSpellId : Elementalist::CALL_OF_THE_ELEMENTS_TOTEMS)
            if (totemSpellId != 0)
                player->CastSpell(player, totemSpellId, true);
    }

    void Register() override
    {
        AfterCast += SpellCastFn(spell_sha_expanded_call_of_the_elements::HandleAfterCast);
    }
};

void Addmod_shaman_expandedScripts()
{
    RegisterSpellScript(spell_sha_expanded_elemental_shield);
    RegisterSpellScript(spell_sha_expanded_bolt_shock);
    RegisterSpellScript(spell_sha_expanded_elemental_ultimate);
    RegisterSpellScript(spell_sha_expanded_call_of_the_elements);
    new ElementalistEmpowermentUnitScript();
    AddCallOfTheElementsNPCs();
}
