# Core Modifications Required by mod-talents-expanded

This document tracks all changes made to the AzerothCore base source
that relate to the expanded talent system.

---

## 1. Talent Row Requirement Removed (Player Talents)

**Purpose:** Allow players to learn talents from any tier without needing
5 × (tier − 1) points spent in the tree first.  This removes the vanilla
"5 points per row" gate so all talent tiers are immediately accessible.

### File Changed

#### `src/server/game/Entities/Player/Player.cpp`

**Function:** `Player::LearnTalent(uint32 talentId, uint32 talentRank, bool command)`

**What was changed:**
The block that counts `spentPoints` in the active talent tab and compares
against `talentInfo->Row * MAX_TALENT_RANK` (i.e. 5 per row) has been
commented out.  The `DependsOn` prerequisite check (specific talent
dependencies / arrows) was **kept intact**.

**Original code (commented out):**
```cpp
if (!command)
{
    uint32 spentPoints = 0;
    if (talentInfo->Row > 0)
    {
        const PlayerTalentMap& talentMap = GetTalentMap();
        for (auto itr = talentMap.begin(); itr != talentMap.end(); ++itr)
            if (TalentSpellPos const* talentPos = GetTalentSpellPos(itr->first))
                if (TalentEntry const* itrTalentInfo = sTalentStore.LookupEntry(talentPos->talent_id))
                    if (itrTalentInfo->TalentTab == talentInfo->TalentTab)
                        if (itr->second->State != PLAYERSPELL_REMOVED &&
                            itr->second->IsInSpec(GetActiveSpec()))
                            spentPoints += talentPos->rank + 1;
    }
    if (spentPoints < (talentInfo->Row * MAX_TALENT_RANK))
        return;
}
```

**Replacement:** Block is fully commented out with a `[SURREAL]` tag explaining
the change.

---

## 2. Talent Row Requirement Removed (Pet Talents)

**Purpose:** Same as above but for hunter pet talents.  The per-row gate
(`talentInfo->Row * MAX_PET_TALENT_RANK`) is removed so pets can learn any
talent tier freely.

### File Changed

#### `src/server/game/Entities/Player/Player.cpp`

**Function:** `Player::LearnPetTalent(ObjectGuid petGuid, uint32 talentId, uint32 talentRank)`

**What was changed:**
The block that iterates all talents in the pet's tab, sums `spentPoints`,
and compares against `talentInfo->Row * MAX_PET_TALENT_RANK` has been
commented out.  The `DependsOn` prerequisite check was **kept intact**.

**Replacement:** Block is fully commented out with a `[SURREAL]` tag.

---

## What Was NOT Changed

| Mechanic | Status |
|---|---|
| Talent `DependsOn` / arrows (prerequisite talents) | ✅ Kept — server still enforces |
| Talent point spending / refunding | ✅ Kept — unchanged |
| Dual specialisation | ✅ Kept — unchanged |
| `OnPlayerLearnTalents` script hook | ✅ Kept — fires normally |
| Talent reset at trainer | ✅ Kept — unchanged |

---

## Related Files

| Component | Location |
|---|---|
| C++ module (skeleton) | `modules/mod-talents-expanded/src/mod_talents_expanded.cpp` |
| AIO UI reskin | `lua_scripts/SurrealTalentFrame_AIO.lua` |
| This document | `modules/mod-talents-expanded/Info/CoreModifications.md` |
