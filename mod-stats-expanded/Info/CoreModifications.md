# Core Modifications Required by mod-stats-expanded

This document tracks all changes made to the AzerothCore base source that
are required for `mod-stats-expanded` to function correctly.

---

## 1. `ModifyCritDamageBonus` UnitScript Hook

**Purpose:** Allows modules to modify the critical strike damage bonus on
melee auto-attacks, spell crits, and healing crits without patching the
damage pipeline directly.

### Files Changed

#### `src/server/game/Scripting/ScriptDefines/UnitScript.h`
- Added `UNITHOOK_MODIFY_CRIT_DAMAGE_BONUS` to the `UnitHook` enum (before `UNITHOOK_END`).
- Added virtual method to `UnitScript` class:
  ```cpp
  virtual void ModifyCritDamageBonus(Unit const* /*attacker*/, Unit const* /*victim*/,
      uint32& /*crit_bonus*/, SpellInfo const* /*spellInfo*/) { }
  ```

#### `src/server/game/Scripting/ScriptMgr.h`
- Added public declaration in the `/* UnitScript */` section:
  ```cpp
  void ModifyCritDamageBonus(Unit const* attacker, Unit const* victim,
      uint32& crit_bonus, SpellInfo const* spellInfo);
  ```

#### `src/server/game/Scripting/ScriptDefines/UnitScript.cpp`
- Added dispatch implementation:
  ```cpp
  void ScriptMgr::ModifyCritDamageBonus(Unit const* attacker, Unit const* victim,
      uint32& crit_bonus, SpellInfo const* spellInfo)
  {
      CALL_ENABLED_HOOKS(UnitScript, UNITHOOK_MODIFY_CRIT_DAMAGE_BONUS,
          script->ModifyCritDamageBonus(attacker, victim, crit_bonus, spellInfo));
  }
  ```

#### `src/server/game/Entities/Unit/Unit.cpp`
Three injection points — each calls the new hook **after** all vanilla crit
modifiers (auras, talents, spell mods) have been applied:

1. **Melee auto-attack crit** — inside `CalculateMeleeDamage()`, `MELEE_HIT_CRIT` case.
   After the `AddPct(damageInfo->damages[i].damage, mod)` block:
   ```cpp
   sScriptMgr->ModifyCritDamageBonus(this, damageInfo->target,
       damageInfo->damages[i].damage, nullptr);
   ```

2. **Spell crit damage** — at the end of `SpellCriticalDamageBonus()`.
   Before `return crit_bonus`:
   ```cpp
   {
       uint32 critBonusU = uint32(std::max(crit_bonus, int32(0)));
       sScriptMgr->ModifyCritDamageBonus(caster, victim, critBonusU, spellProto);
       crit_bonus = int32(critBonusU);
   }
   ```
   *(int32→uint32 wrapper needed because `crit_bonus` is `int32` internally)*

3. **Healing crit** — at the end of `SpellCriticalHealingBonus()`.
   After `damage += crit_bonus`, before the `SPELL_AURA_MOD_CRITICAL_HEALING_AMOUNT` multiplier:
   ```cpp
   sScriptMgr->ModifyCritDamageBonus(caster, victim, damage, spellProto);
   ```

### How the Module Uses It

`CritDamageBonusUnitScript` in `mod_stats_expanded.cpp` overrides
`ModifyCritDamageBonus` to read the Dodge Rating from CR slot 2 (remapped
to "Crit" per `SwappedStats.md`) and applies an extra crit damage
multiplier:

- **10 Dodge Rating = 1% crit chance + 2% extra crit damage**
- The crit chance part is handled by piping Dodge Rating into native
  crit rating slots (no core mod needed).
- The crit damage bonus part uses this hook.

### Reverting

To remove this core modification:
1. Delete the enum entry, virtual method, ScriptMgr declaration, and
   dispatch function from the 3 scripting files.
2. Remove the 3 `sScriptMgr->ModifyCritDamageBonus(...)` calls from
   `Unit.cpp`.
3. The module's `CritDamageBonusUnitScript` will simply have no effect
   (dead code) — or can be removed.

---

## 2. Zeroed-Out Native Stat Conversions

**Purpose:** The old stats (Defense, Dodge, Parry, Block, Hit) are remapped
to new stats (Haste, Crit, Mastery, Multistrike, Versatility). The native
stat effects of the old ratings must be disabled so they don't stack with
the new behaviours.

### File Changed: `src/server/game/Entities/Unit/StatSystem.cpp`

All changes are comment-outs with `// mod-stats-expanded` markers.

| Old Conversion | Function | What Was Disabled |
|---|---|---|
| AGI → Armor | `UpdateArmor()` | `value += GetStat(STAT_AGILITY) * 2.0f` |
| INT → Mana | `GetManaBonusFromIntellect()` | Returns `0.0f` immediately |
| AGI → Melee/Ranged Crit % | `UpdateAllCritPercentages()` | Crit from AGI set to `0.0f` |
| INT → Spell Crit % | `UpdateAllSpellCritChances()` | `GetSpellCritFromIntellect()` call removed |
| SPI → Mana Regen | `UpdateManaRegen()` | `power_regen` set to `0.0f` |
| AGI → Dodge % | `UpdateDodgePercentage()` | `GetDodgeFromAgility()` call removed |
| Defense Rating → Dodge | `UpdateDodgePercentage()` | `GetRatingBonusValue(CR_DEFENSE_SKILL)` line disabled |
| Dodge Rating → Dodge | `UpdateDodgePercentage()` | `GetRatingBonusValue(CR_DODGE)` line disabled |
| Defense Rating → Parry | `UpdateParryPercentage()` | `GetRatingBonusValue(CR_DEFENSE_SKILL)` line disabled |
| Parry Rating → Parry | `UpdateParryPercentage()` | `GetRatingBonusValue(CR_PARRY)` line disabled |
| Defense Rating → Block | `UpdateBlockPercentage()` | `GetRatingBonusValue(CR_DEFENSE_SKILL)` line disabled |
| Block Rating → Block | `UpdateBlockPercentage()` | `GetRatingBonusValue(CR_BLOCK)` line disabled |
| Hit Melee Rating → Hit % | `UpdateMeleeHitChances()` | `GetRatingBonusValue(CR_HIT_MELEE)` line disabled |
| Hit Ranged Rating → Hit % | `UpdateRangedHitChances()` | `GetRatingBonusValue(CR_HIT_RANGED)` line disabled |
| Hit Spell Rating → Hit % | `UpdateSpellHitChances()` | `GetRatingBonusValue(CR_HIT_SPELL)` line disabled |

### Reverting

Uncomment all lines marked with `// mod-stats-expanded` in `StatSystem.cpp`.

---

## 3. Players (and Their Pets/Guardians) Never Miss

**Purpose:** Since Hit Rating is repurposed as Versatility, players and
their pets/guardians should never miss on any attack type — auto-attacks,
melee abilities, ranged attacks, and spells.

### File Changed: `src/server/game/Entities/Unit/Unit.cpp`

Uses `GetCharmerOrOwnerPlayerOrPlayerItself()` to cover players, hunter
pets, warlock demons, DK ghouls, totems, and any other player-owned unit.

Three miss-calculation points patched:

1. **Auto-attacks** — `RollMeleeOutcomeAgainst(victim, attType)` wrapper:
   ```cpp
   // mod-stats-expanded: Players and their pets/guardians never miss
   if (GetCharmerOrOwnerPlayerOrPlayerItself())
       miss_chance = 0.0f;
   ```

2. **Melee/ranged abilities** — `MeleeSpellHitResult()`:
   ```cpp
   // mod-stats-expanded: Players and their pets/guardians never miss
   if (GetCharmerOrOwnerPlayerOrPlayerItself())
       missChance = 0;
   ```

3. **Magic spells** — `MagicSpellHitResult()`:
   ```cpp
   // mod-stats-expanded: Players and their pets/guardians never miss
   if (GetCharmerOrOwnerPlayerOrPlayerItself())
       return SPELL_MISS_NONE;
   ```

Dodge, parry, and block still function normally.

### Reverting

Remove the three `if (IsPlayer())` blocks marked with `// mod-stats-expanded`
in `Unit.cpp`.
