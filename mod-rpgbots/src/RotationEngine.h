// RotationEngine.h
// Flat rotation system: one SQL row per spec, 12 spell-ID columns.
//
// Table: rpgbots.bot_rotations
//   filler            — instant "weave" spell castable WITHOUT interrupting
//                        the bot's current cast (e.g. Fire Blast while
//                        casting Fireball). Checked every tick regardless
//                        of casting state, before the normal waterfall, and
//                        again as the final fallback if nothing else fired.
//   rotation_1..5     — the 5 real rotational abilities. Role decides how
//                        they're used:
//                          healer roles  → treated as heals, cast on the
//                                          lowest-HP ally if the aura (for
//                                          HoT-style heals) isn't already up
//                          dot roles     → treated as DoTs, cast on the
//                                          enemy if the aura isn't already up
//                          tank/dps      → plain top-to-bottom priority cast;
//                                          self-buffs (IsPositive() spells)
//                                          auto-target self and skip if
//                                          already up, everything else
//                                          targets the enemy
//   interrupt         — cast on the enemy ONLY while it's actively casting
//                        a generic/channeled spell; idle otherwise (never
//                        used as filler).
//   mobility          — gap closer, cast on self when out of preferred range.
//   defensive_1..2    — emergency, cast on self when HP < 35%.
//   damage_cooldown   — offensive CD (Recklessness/Combustion-style), self-cast
//                        as soon as it's off cooldown while fighting an enemy.
//   party_buff        — timed buff-on-cast ability (Heroism/Power Infusion-
//                        style, NOT a passive stat aura), self-cast as soon
//                        as it's off cooldown while fighting an enemy.
//   rotation_sequence — OPTIONAL explicit press order for tank/dps roles,
//                        e.g. "1-4-5-f-2-4-5-f-3-4-5-f" (digits 1-5 = that
//                        rotation_N slot, 'f' = filler). Overrides the
//                        default plain top-to-bottom scan so abilities that
//                        share a category cooldown (must wait between each
//                        other) can be deliberately interleaved with
//                        always-up filler/secondary presses instead of the
//                        first-available slot always winning every tick.
//                        Resumes from wherever the last successful pick
//                        left off (persisted per-bot in BotInfo), not from
//                        the start of the string, so it behaves like a
//                        repeating loop. Empty string (default) = legacy
//                        top-to-bottom behavior, unchanged for every spec
//                        that doesn't set one. Healer/DoT roles ignore this
//                        column entirely (unaffected).
//
// The AI is role-aware - see the per-bucket notes above and BotAI.cpp's
// RunRotation for the exact per-role targeting/gating logic.

#pragma once

#include "BotBehavior.h"
#include "Player.h"
#include <cstdint>
#include <string>
#include <array>
#include <unordered_map>
#include <vector>

// ─── Flat Spec Row ─────────────────────────────────────────────────────────────
// Mirrors the SQL table exactly. 12 spell-ID columns total:
//   1 filler + 5 rotation + 1 interrupt + 1 mobility + 2 defensive
//   + 1 damage cooldown + 1 party buff = 12

static constexpr uint8 ROTATION_SLOTS   = 5;
static constexpr uint8 DEFENSIVE_SLOTS  = 2;

// Sentinel step value in SpecRotation::sequenceSteps meaning "cast filler"
// instead of one of the 5 rotation slots (which are indices 0-4).
static constexpr uint8 SEQUENCE_FILLER_STEP = ROTATION_SLOTS;

// Parses a "1-4-5-f-2-4-5-f-3-4-5-f" style string into step indices
// (0-4 = rotation slot, SEQUENCE_FILLER_STEP = filler). Unrecognized
// tokens are skipped. Returns an empty vector for an empty/invalid string,
// which callers treat as "no sequence configured" (legacy behavior).
std::vector<uint8_t> ParseRotationSequence(std::string const& s);

struct SpecRotation
{
    uint8       classId    = 0;
    uint8       specIndex  = 0;
    std::string specName;
    BotRole     role       = BotRole::ROLE_MELEE_DPS;
    float       preferredRange = 0.0f;

    uint32                               filler         = 0;  // 1
    std::array<uint32, ROTATION_SLOTS>   rotation       = {}; // 5
    uint32                               interrupt      = 0;  // 1
    uint32                               mobility       = 0;  // 1
    std::array<uint32, DEFENSIVE_SLOTS>  defensives     = {}; // 2
    uint32                               damageCooldown = 0;  // 1
    uint32                               partyBuff      = 0;  // 1

    // Optional explicit press-order override (see rotation_sequence doc
    // above). Empty = legacy top-to-bottom scan of `rotation`.
    std::vector<uint8_t>                sequenceSteps  = {};
};

// Key: (classId << 8) | specIndex
using SpecKey = uint16;
inline SpecKey MakeSpecKey(uint8 classId, uint8 specIndex)
{
    return (uint16(classId) << 8) | specIndex;
}

// ─── Rotation Engine Singleton ─────────────────────────────────────────────────
class RotationEngine
{
public:
    static RotationEngine& Instance()
    {
        static RotationEngine instance;
        return instance;
    }

    // Load / reload all data from rpgbots.bot_rotations
    uint32 LoadFromDB();

    // Lookup by class + spec
    const SpecRotation* GetRotation(uint8 classId, uint8 specIndex) const
    {
        auto it = _rotations.find(MakeSpecKey(classId, specIndex));
        if (it != _rotations.end())
            return &it->second;
        return nullptr;
    }

    bool   HasRotations() const { return !_rotations.empty(); }
    uint32 GetSpecCount() const { return uint32(_rotations.size()); }

    // Returns all loaded rotations for a class.
    std::vector<SpecRotation const*> GetClassRotations(uint8 classId) const;

    // Picks the best rotation spec index by matching the bot's known spells.
    uint8 DetectBestSpecIndex(Player* bot, uint8 fallbackSpecIndex) const;

private:
    RotationEngine() = default;
    std::unordered_map<SpecKey, SpecRotation> _rotations;
};

#define sRotationEngine RotationEngine::Instance()

// Registration
void AddRotationEngine();
