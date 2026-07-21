#ifndef MOD_SHAMAN_EXPANDED_ELEMENTALIST_SPELLS_H
#define MOD_SHAMAN_EXPANDED_ELEMENTALIST_SPELLS_H

#include "Define.h"
#include <array>
#include <optional>

// ════════════════════════════════════════════════════════════════════════
//  Elementalist (custom Shaman spec) — spell ID registry
//
//  This file is the ONLY place spell IDs should live for this feature.
//  Edit the `= 0` placeholders below as you create each spell in the DBC
//  editor — the redirect/ultimate/damage-bonus logic in
//  ElementalistLogic.h/mod_shaman_expanded.cpp reads everything from here,
//  so you never have to touch the C++ logic to wire up a new spell ID.
//  A ` = 0` value means "not configured yet" and is always safely ignored
//  (treated as "no spell") by every helper in this file.
// ════════════════════════════════════════════════════════════════════════

namespace Elementalist
{
    enum class Element : uint8
    {
        Fire  = 0,
        Water = 1, // aka "Frost" in some existing spell names
        Wind  = 2, // aka "Lightning"
        Earth = 3,

        Count
    };

    enum class Tier : uint8
    {
        Augmentation = 0, // tank/fighter hero tree (the "Revenant" forms)
        Ascension    = 1, // caster/fighter hero tree (the "Ascendant" forms)

        Count
    };

    // ── Mastery passive ────────────────────────────────────────────────
    constexpr uint32 SPELL_MASTERY_ELEMENTALIST = 900045;

    // ── Call of the Elements (class cooldown) ──────────────────────────
    // Real WotLK spell 66842 ("Simultaneously places up to 4 totems
    // specified in the Totem Bar") - its DBC effect (SPELL_EFFECT_CAST_BUTTON,
    // 97) reads whatever's on the player's client-side totem bar, which
    // this codebase never implemented server-side (no
    // Spell::EffectCastButton handler exists at all - it's a pure no-op
    // here). Elementalist always wants the SAME 4 elemental totems
    // regardless of totem bar contents, so
    // spell_sha_expanded_call_of_the_elements (mod_shaman_expanded.cpp)
    // ignores the DBC effect entirely and just self-casts all 4 fixed
    // totem summon spells below on AfterCast.
    constexpr uint32 SPELL_CALL_OF_THE_ELEMENTS = 66842;

    // One summon spell per element, always cast together by Call of the
    // Elements. Real SpellName per the DBC (verified, NOT guessed - order
    // does not match a naive "Fire/Rock/Water/Wind by ID" assumption):
    // 900077 = "Fire Elemental Totem", 900078 = "Water Elemental Totem",
    // 900079 = "Wind Elemental Totem", 900080 = "Earth Elemental Totem".
    // Each summons its matching new creature_template entry (same ID as
    // the spell, see CallOfTheElementsNPCs.cpp) with the corresponding
    // ScriptName: npc_call_fire_elemental / npc_call_water_elemental /
    // npc_call_wind_elemental / npc_call_rock_elemental.
    enum CallOfTheElementsTotemSpells : uint32
    {
        SPELL_CALL_FIRE_TOTEM  = 900077,
        SPELL_CALL_WATER_TOTEM = 900078,
        SPELL_CALL_WIND_TOTEM  = 900079,
        SPELL_CALL_ROCK_TOTEM  = 900080, // "Earth Elemental Totem" in the DBC
    };

    constexpr std::array<uint32, 4> CALL_OF_THE_ELEMENTS_TOTEMS = { {
        SPELL_CALL_FIRE_TOTEM,
        SPELL_CALL_WATER_TOTEM,
        SPELL_CALL_WIND_TOTEM,
        SPELL_CALL_ROCK_TOTEM,
    } };

    // Companion "totem pole" spells - one per element, cast ALONGSIDE the
    // Guardian summon above (both are self-cast together in
    // spell_sha_expanded_call_of_the_elements::HandleAfterCast). Each is a
    // SUMMON_TYPE_TOTEM summon (real vanilla mechanism, see Totem::InitStats
    // in Totem.cpp) of a plain, non-scripted pole-only creature
    // (900081-900084, CallOfTheElementsNPCs.cpp/2026_07_20_02.sql) - this is
    // ONLY here to give the ground totem model + the player-frame duration
    // timer (SMSG totem-created packet requires an actual Totem-class
    // summon with a valid slot); it has no AI/ScriptName and does nothing on
    // its own. The REAL fighting creature is still the Guardian summon
    // above. Real WotLK precedent for this "totem pole triggers a second,
    // separate Guardian summon" pattern: Fire/Earth Elemental Totem
    // (creature_template_spell on 15439/15430 auto-casts 32982/33663, which
    // in turn SUMMON the real Greater Fire/Earth Elemental) - we replicate
    // the same two-summon shape ourselves instead of relying on that
    // creature-side auto-cast, so we control which creature/AI actually
    // fights (our own npc_call_* instead of the vanilla pet_shaman ones)
    // and can give it our own diamond-formation/heal/cast behavior.
    constexpr std::array<uint32, 4> CALL_OF_THE_ELEMENTS_POLES = { {
        900081, // Fire pole
        900082, // Rock/Earth pole
        900083, // Water pole
        900084, // Wind pole
    } };


    // ── The 2 shared "dummy" ability buttons ───────────────────────────
    // Whatever element/tier form the player is currently in, casting these
    // redirects to that form's real Bolt/Shock spell (see ELEMENT_ABILITIES
    // below). TODO: set these once the dummy spells exist.
    constexpr uint32 SPELL_BOLT_DUMMY  = 403;
    constexpr uint32 SPELL_SHOCK_DUMMY = 8056;

    // ── The 8 form transform auras (already live, do not change) ──────
    struct FormEntry
    {
        uint32 auraSpellId;
        Element element;
        Tier tier;
    };

    constexpr std::array<FormEntry, 8> FORMS = { {
        // Augmentation (Revenant) forms
        { 900046, Element::Fire,  Tier::Augmentation }, // Flame Revenant
        { 900047, Element::Wind,  Tier::Augmentation }, // Wind Revenant
        { 900048, Element::Water, Tier::Augmentation }, // Frost/Water Revenant
        { 900049, Element::Earth, Tier::Augmentation }, // Earth Revenant
        // Ascension (Ascendant) forms
        { 900051, Element::Fire,  Tier::Ascension },    // Flame Ascendant
        { 900052, Element::Wind,  Tier::Ascension },    // Wind Ascendant
        { 900053, Element::Water, Tier::Ascension },    // Frost/Water Ascendant
        { 900054, Element::Earth, Tier::Ascension },    // Earth Ascendant
    } };

    // ── Per-element ability spells ──────────────────────────────────────
    // `attackSpellId`/`shieldSpellId` are the existing periodic-trigger
    // attack/shield spells each form already casts on its own (fixed, live
    // IDs - do not change). `boltSpellId`/`shockSpellId` are what
    // SPELL_BOLT_DUMMY/SPELL_SHOCK_DUMMY redirect to for that element -
    // TODO: fill these in as you create Water Bolt / Lava Lash / Lightning
    // Bolt / Earth Bolt and Earth Shock / Flame Shock / Thunder Shock /
    // Frost Shock. All 4 fields here get the ultimate's damage-empowerment
    // bonus while it's active.
    struct ElementAbilities
    {
        Element element;
        uint32 attackSpellId; // existing Revenant/Ascendant auto-attack
        uint32 shieldSpellId; // existing Revenant/Ascendant absorb shield
        uint32 boltSpellId;   // TODO
        uint32 shockSpellId;  // TODO
    };

    constexpr std::array<ElementAbilities, 4> ELEMENT_ABILITIES = { {
        { Element::Fire,  900056, 900060, 900068, 900072 }, // Eternal Flame / Molten Shell / Lava Lash / Flame Shock
        { Element::Water, 900058, 900062, 900069, 900073 }, // Frost Bolt Volley / Bubble / Water Bolt / Frost Shock
        { Element::Wind,  900057, 900061, 900070, 900074 }, // Chain Lightning / Lightning Shell / Lightning Bolt / Thunder Shock
        { Element::Earth, 900059, 900063, 900071, 900075 }, // Tremmor / Bulwark / Earth Bolt / Earth Shock
    } };

    // ── The elemental "power" ultimates ─────────────────────────────────
    // One per element per tier (currently 8; add more rows here if you add
    // more - nothing else needs to change). Casting one of these:
    //   1. Swaps the player into that element+tier's form (FORMS above).
    //   2. Grants a temporary "empowered" window (duration taken from the
    //      ultimate spell's own DBC duration field) during which ALL of
    //      that element's abilities (attack/shield/bolt/shock) deal flat
    //      +5% + Mastery% more damage.
    // TODO: fill in the real spell IDs as you create each ultimate.
    //
    // delayedTriggerSpellId/delayedTriggerDelayMs: optional - for ultimates
    // that are themselves a charge/teleport/leap ("do X, then trigger Y
    // once you arrive"), the arrival spell can't just be a normal DBC
    // EffectTriggerSpell on the same spell - ALL of a spell's effects
    // (charge/teleport included) resolve in the same instant server-side,
    // so an EffectTriggerSpell fires immediately alongside the movement,
    // not after it. Instead, set delayedTriggerSpellId to the follow-up
    // spell and delayedTriggerDelayMs to how long after cast it should
    // fire (tuned to feel like "arrival"), and leave the follow-up spell
    // OUT of this ultimate's own DBC effects entirely - the script below
    // schedules it via Unit::m_Events instead. Leave both at 0 if this
    // ultimate doesn't need it.
    struct UltimateEntry
    {
        uint32 spellId;
        Element element;
        Tier tier;
        uint32 delayedTriggerSpellId = 0;
        uint32 delayedTriggerDelayMs = 0;
    };

    constexpr std::array<UltimateEntry, 8> ULTIMATES = { {
        { 900064, Element::Fire,  Tier::Augmentation }, // TODO: Fire Power (Augmentation)
        { 900066, Element::Water, Tier::Augmentation }, // TODO: Water Power (Augmentation)
        { 900065, Element::Wind,  Tier::Augmentation, 900076, 400 }, // Wind Power: charge/teleport, then explosion 400ms after "arrival"
        { 900067, Element::Earth, Tier::Augmentation }, // TODO: Earth Power (Augmentation)
        { 0, Element::Fire,  Tier::Ascension },    // TODO: Fire Power (Ascension)
        { 0, Element::Water, Tier::Ascension },    // TODO: Water Power (Ascension)
        { 0, Element::Wind,  Tier::Ascension },    // TODO: Wind Power (Ascension)
        { 0, Element::Earth, Tier::Ascension },    // TODO: Earth Power (Ascension)
    } };

    constexpr float EMPOWERMENT_FLAT_BONUS_PCT = 5.0f;
    // Fallback duration (ms) used only if the ultimate's own spell duration
    // isn't set/is infinite - safe default, tune per-spell via DBC instead.
    constexpr uint32 EMPOWERMENT_DEFAULT_DURATION_MS = 15000;

    // ── Lookup helpers (all safe against unconfigured/zero IDs) ────────

    inline std::optional<FormEntry> FindActiveForm(uint32 auraSpellId)
    {
        for (FormEntry const& form : FORMS)
            if (form.auraSpellId == auraSpellId)
                return form;
        return std::nullopt;
    }

    inline ElementAbilities const* GetAbilities(Element element)
    {
        for (ElementAbilities const& abilities : ELEMENT_ABILITIES)
            if (abilities.element == element)
                return &abilities;
        return nullptr;
    }

    inline std::optional<UltimateEntry> FindUltimate(uint32 spellId)
    {
        if (spellId == 0)
            return std::nullopt;

        for (UltimateEntry const& ultimate : ULTIMATES)
            if (ultimate.spellId == spellId)
                return ultimate;
        return std::nullopt;
    }

    // True if spellId is one of `element`'s attack/shield/bolt/shock spells
    // (used to decide whether the empowerment damage bonus applies).
    inline bool IsElementAbilitySpell(uint32 spellId, Element element)
    {
        if (spellId == 0)
            return false;

        ElementAbilities const* abilities = GetAbilities(element);
        if (!abilities)
            return false;

        return spellId == abilities->attackSpellId
            || spellId == abilities->shieldSpellId
            || spellId == abilities->boltSpellId
            || spellId == abilities->shockSpellId;
    }
}

#endif
