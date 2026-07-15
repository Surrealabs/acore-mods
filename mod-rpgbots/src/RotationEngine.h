// RotationEngine.h
// Flat rotation system: one SQL row per spec, 30 spell-ID columns.
//
// Table: rpgbots.bot_rotations
//   ability_1..5   — core rotation spells
//   buff_1..5      — self-buffs (cast if aura missing)
//   defensive_1..5 — emergency (cast when HP < 35%)
//   dot_1..5       — DoTs (cast on enemy if aura missing on target)
//   hot_1..5       — HoTs (cast on lowest-HP ally if aura missing)
//   mobility_1..5  — gap closers (cast when out of range)
//
// The AI is role-aware:
//   healer  → abilities target lowest-HP ally under 90%
//   dps     → abilities target master's enemy
//   tank    → abilities target master's enemy
//   buffs   → always self
//   defens. → always self, only when low HP
//   dots    → enemy, if aura missing on target
//   hots    → lowest-HP ally, if aura missing
//   mobil.  → always self, only when out of range

#pragma once

#include "BotBehavior.h"
#include "Player.h"
#include <string>
#include <array>
#include <unordered_map>
#include <vector>

// ─── Flat Spec Row ─────────────────────────────────────────────────────────────
// Mirrors the SQL table exactly.  5 spells per bucket, 6 buckets = 30 spells.

static constexpr uint8 SPELLS_PER_BUCKET = 5;

struct SpecRotation
{
    uint8       classId    = 0;
    uint8       specIndex  = 0;
    std::string specName;
    BotRole     role       = BotRole::ROLE_MELEE_DPS;
    float       preferredRange = 0.0f;

    std::array<uint32, SPELLS_PER_BUCKET> abilities  = {};  // core rotation
    std::array<uint32, SPELLS_PER_BUCKET> buffs      = {};  // self-buffs
    std::array<uint32, SPELLS_PER_BUCKET> defensives = {};  // emergency
    std::array<uint32, SPELLS_PER_BUCKET> dots       = {};  // DoTs on enemy
    std::array<uint32, SPELLS_PER_BUCKET> hots       = {};  // HoTs on ally
    std::array<uint32, SPELLS_PER_BUCKET> mobility   = {};  // gap closers
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
