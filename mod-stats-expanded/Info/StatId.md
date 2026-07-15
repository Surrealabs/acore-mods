# WoTLK 3.3.5a — Complete Stat ID Reference

All stat IDs from the AzerothCore source, organized by system.

---

## Base Stats (Stats enum — SharedDefines.h)

| ID | Enum | Stat |
|----|-------|------|
| 0 | STAT_STRENGTH | Strength |
| 1 | STAT_AGILITY | Agility |
| 2 | STAT_STAMINA | Stamina |
| 3 | STAT_INTELLECT | Intellect |
| 4 | STAT_SPIRIT | Spirit |

MAX_STATS = 5

---

## Combat Ratings (CombatRating enum — Unit.h)

These are the internal rating slots the server uses. Items feed into these via ITEM_MOD mappings.
Stored on the player at `PLAYER_FIELD_COMBAT_RATING_1 + CR_*`.

| ID | Enum | Rating | Status |
|----|-------|--------|--------|
| 0 | CR_WEAPON_SKILL | Weapon Skill | Obsolete in 3.3.5 |
| 1 | CR_DEFENSE_SKILL | Defense Skill | **→ Versatility (mod-stats-expanded)** |
| 2 | CR_DODGE | Dodge | Active (tanks) |
| 3 | CR_PARRY | Parry | Active (tanks) |
| 4 | CR_BLOCK | Block | Active (shield tanks) |
| 5 | CR_HIT_MELEE | Hit (Melee) | Active |
| 6 | CR_HIT_RANGED | Hit (Ranged) | Active |
| 7 | CR_HIT_SPELL | Hit (Spell) | Active |
| 8 | CR_CRIT_MELEE | Crit (Melee) | Active |
| 9 | CR_CRIT_RANGED | Crit (Ranged) | Active |
| 10 | CR_CRIT_SPELL | Crit (Spell) | Active |
| 11 | CR_HIT_TAKEN_MELEE | Hit Avoidance (Melee) | Unused by items |
| 12 | CR_HIT_TAKEN_RANGED | Hit Avoidance (Ranged) | Unused by items |
| 13 | CR_HIT_TAKEN_SPELL | Hit Avoidance (Spell) | Unused by items |
| 14 | CR_CRIT_TAKEN_MELEE | Crit Avoidance (Melee) | Unused by items |
| 15 | CR_CRIT_TAKEN_RANGED | Crit Avoidance (Ranged) | Unused by items |
| 16 | CR_CRIT_TAKEN_SPELL | Crit Avoidance (Spell) | Unused by items |
| 17 | CR_HASTE_MELEE | Haste (Melee) | Active |
| 18 | CR_HASTE_RANGED | Haste (Ranged) | Active |
| 19 | CR_HASTE_SPELL | Haste (Spell) | Active |
| 20 | CR_WEAPON_SKILL_MAINHAND | Weapon Skill (MH) | Obsolete |
| 21 | CR_WEAPON_SKILL_OFFHAND | Weapon Skill (OH) | Obsolete |
| 22 | CR_WEAPON_SKILL_RANGED | Weapon Skill (Ranged) | Obsolete |
| 23 | CR_EXPERTISE | Expertise | **→ Mastery (mod-stats-expanded)** |
| 24 | CR_ARMOR_PENETRATION | Armor Penetration | **→ Potency (mod-stats-expanded)** |

MAX_COMBAT_RATING = 25

---

## Item Stat Types (ItemModType enum — ItemTemplate.h)

These are the stat type IDs used on items in `item_template.stat_type1..stat_type10`.
Each maps to a combat rating or base stat internally.

| ID | Enum | Item Stat | Maps To |
|----|-------|-----------|---------|
| 0 | ITEM_MOD_MANA | +Mana | Flat mana |
| 1 | ITEM_MOD_HEALTH | +Health | Flat health |
| 3 | ITEM_MOD_AGILITY | +Agility | STAT_AGILITY |
| 4 | ITEM_MOD_STRENGTH | +Strength | STAT_STRENGTH |
| 5 | ITEM_MOD_INTELLECT | +Intellect | STAT_INTELLECT |
| 6 | ITEM_MOD_SPIRIT | +Spirit | STAT_SPIRIT |
| 7 | ITEM_MOD_STAMINA | +Stamina | STAT_STAMINA |
| 12 | ITEM_MOD_DEFENSE_SKILL_RATING | Defense Rating | CR_DEFENSE_SKILL (1) |
| 13 | ITEM_MOD_DODGE_RATING | Dodge Rating | CR_DODGE (2) |
| 14 | ITEM_MOD_PARRY_RATING | Parry Rating | CR_PARRY (3) |
| 15 | ITEM_MOD_BLOCK_RATING | Block Rating | CR_BLOCK (4) |
| 16 | ITEM_MOD_HIT_MELEE_RATING | Hit Rating (Melee) | CR_HIT_MELEE (5) |
| 17 | ITEM_MOD_HIT_RANGED_RATING | Hit Rating (Ranged) | CR_HIT_RANGED (6) |
| 18 | ITEM_MOD_HIT_SPELL_RATING | Hit Rating (Spell) | CR_HIT_SPELL (7) |
| 19 | ITEM_MOD_CRIT_MELEE_RATING | Crit Rating (Melee) | CR_CRIT_MELEE (8) |
| 20 | ITEM_MOD_CRIT_RANGED_RATING | Crit Rating (Ranged) | CR_CRIT_RANGED (9) |
| 21 | ITEM_MOD_CRIT_SPELL_RATING | Crit Rating (Spell) | CR_CRIT_SPELL (10) |
| 22 | ITEM_MOD_HIT_TAKEN_MELEE_RATING | Hit Avoidance (Melee) | CR_HIT_TAKEN_MELEE (11) |
| 23 | ITEM_MOD_HIT_TAKEN_RANGED_RATING | Hit Avoidance (Ranged) | CR_HIT_TAKEN_RANGED (12) |
| 24 | ITEM_MOD_HIT_TAKEN_SPELL_RATING | Hit Avoidance (Spell) | CR_HIT_TAKEN_SPELL (13) |
| 25 | ITEM_MOD_CRIT_TAKEN_MELEE_RATING | Crit Avoidance (Melee) | CR_CRIT_TAKEN_MELEE (14) |
| 26 | ITEM_MOD_CRIT_TAKEN_RANGED_RATING | Crit Avoidance (Ranged) | CR_CRIT_TAKEN_RANGED (15) |
| 27 | ITEM_MOD_CRIT_TAKEN_SPELL_RATING | Crit Avoidance (Spell) | CR_CRIT_TAKEN_SPELL (16) |
| 28 | ITEM_MOD_HASTE_MELEE_RATING | Haste (Melee) | CR_HASTE_MELEE (17) |
| 29 | ITEM_MOD_HASTE_RANGED_RATING | Haste (Ranged) | CR_HASTE_RANGED (18) |
| 30 | ITEM_MOD_HASTE_SPELL_RATING | Haste (Spell) | CR_HASTE_SPELL (19) |
| 31 | ITEM_MOD_HIT_RATING | Hit Rating (all) | CR_HIT_MELEE + RANGED + SPELL |
| 32 | ITEM_MOD_CRIT_RATING | Crit Rating (all) | CR_CRIT_MELEE + RANGED + SPELL |
| 33 | ITEM_MOD_HIT_TAKEN_RATING | Hit Avoidance (all) | CR_HIT_TAKEN_* (all) |
| 34 | ITEM_MOD_CRIT_TAKEN_RATING | Crit Avoidance (all) | CR_CRIT_TAKEN_* (all) |
| 35 | ITEM_MOD_RESILIENCE_RATING | Resilience | **→ Multistrike (mod-stats-expanded)** |
| 36 | ITEM_MOD_HASTE_RATING | Haste (all) | CR_HASTE_MELEE + RANGED + SPELL |
| 37 | ITEM_MOD_EXPERTISE_RATING | Expertise Rating | CR_EXPERTISE (23) |
| 38 | ITEM_MOD_ATTACK_POWER | Attack Power | Flat AP |
| 39 | ITEM_MOD_RANGED_ATTACK_POWER | Ranged Attack Power | Flat Ranged AP |
| 41 | ITEM_MOD_SPELL_HEALING_DONE | +Healing (deprecated) | Spell healing |
| 42 | ITEM_MOD_SPELL_DAMAGE_DONE | +Spell Damage (deprecated) | Spell damage |
| 43 | ITEM_MOD_MANA_REGENERATION | Mana Regen (per 5s) | MP5 |
| 44 | ITEM_MOD_ARMOR_PENETRATION_RATING | Armor Pen Rating | CR_ARMOR_PENETRATION (24) |
| 45 | ITEM_MOD_SPELL_POWER | Spell Power | Spell power (all schools) |
| 46 | ITEM_MOD_HEALTH_REGEN | Health Regen (per 5s) | HP5 |
| 47 | ITEM_MOD_SPELL_PENETRATION | Spell Penetration | Flat spell pen |
| 48 | ITEM_MOD_BLOCK_VALUE | Block Value | Shield block amount |

MAX_ITEM_MOD = 49

**Note:** IDs 2, 8, 9, 10, 11, 40 are gaps — not assigned.

---

## Repurposable Slots Summary

Ratings that are unused, obsolete, or safe to repurpose for custom stats:

| CR Slot | Item Mod ID | Original Purpose | Notes |
|---------|-------------|------------------|-------|
| CR_WEAPON_SKILL (0) | — | Weapon skill | Obsolete in 3.3.5 |
| CR_DEFENSE_SKILL (1) | 12 | Defense rating | **Already → Versatility** |
| CR_HIT_TAKEN_MELEE (11) | 22 | Hit avoidance (melee) | No items use this |
| CR_HIT_TAKEN_RANGED (12) | 23 | Hit avoidance (ranged) | No items use this |
| CR_HIT_TAKEN_SPELL (13) | 24 | Hit avoidance (spell) | No items use this |
| CR_CRIT_TAKEN_MELEE (14) | 25 | Crit avoidance (melee) | No items use this |
| CR_CRIT_TAKEN_RANGED (15) | 26 | Crit avoidance (ranged) | No items use this |
| CR_CRIT_TAKEN_SPELL (16) | 27 | Crit avoidance (spell) | No items use this |
| CR_WEAPON_SKILL_MAINHAND (20) | — | Weapon skill MH | Obsolete |
| CR_WEAPON_SKILL_OFFHAND (21) | — | Weapon skill OH | Obsolete |
| CR_WEAPON_SKILL_RANGED (22) | — | Weapon skill ranged | Obsolete |
| CR_EXPERTISE (23) | 37 | Expertise | **Already → Mastery** |
| CR_ARMOR_PENETRATION (24) | 44 | Armor pen | **Already → Potency** |

Additionally repurposed by mod-stats-expanded:
- ITEM_MOD_RESILIENCE_RATING (35) → **Multistrike** (uses CR_PARRY internally in module)

---

## Source Files

- `src/server/shared/SharedDefines.h` — Stats enum (base stats)
- `src/server/game/Entities/Unit/Unit.h` — CombatRating enum (CR_* slots)
- `src/server/game/Entities/Item/ItemTemplate.h` — ItemModType enum (item stat types)
- `src/server/game/Entities/Player/StatSystem.cpp` — Rating conversion logic
