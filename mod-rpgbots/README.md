# mod-rpgbots

An "Army of Alts" RPG Framework for AzerothCore — **zero core patches required.**

---

## Table of Contents
- [Project Overview](#project-overview)
- [Current Features](#current-features)
- [Commands](#commands)
- [Core Philosophy](#core-philosophy)
- [Technical Architecture](#technical-architecture)
  - [Data Layer (SQL)](#data-layer-sql)
  - [Module Structure](#module-structure)
  - [Integration Strategy](#integration-strategy)
- [The "2K" Stat System](#the-2k-stat-system)
- [Setup](#setup)
- [Project Roadmap](#project-roadmap)

---

## Project Overview
mod-rpgbots transforms player alts from static bots into persistent, psychological entities. Every character on the server—whether played by a human or a bot—carries a unique profile consisting of Affixes, Temperaments, and Psychological Types.

Alt characters can be spawned into the world as fully loaded Player objects, automatically joined to your party, and positioned near you — all without any core engine modifications.

---

## Current Features

### Personality System (Working)
- **Auto-profile creation:** On first login, every character receives a random Temperament and Psychology type, stored persistently in the database.
- **Aura application:** Temperament and Psychology spells are applied as visible auras on login, giving each character a unique identity.
- **XP tracking:** Mechanics XP is tracked and incremented as characters gain experience.
- **Reroll commands:** `.rpg temperament` and `.rpg psych` let you reroll your active personality auras from the trait library.

### Army of Alts (Working)
- **Bot spawning:** `.army spawn <name>` loads a full alt character into the world as a real `Player` object using a socketless `WorldSession`.
- **Party integration:** Spawned bots automatically create or join your party.
- **Positioning:** Bots appear near the master player with a random offset.
- **Full character data:** Bots load with their complete inventory, spells, talents, reputation, achievements — everything a real login loads.
- **Clean dismissal:** `.army dismiss` saves bot state, removes from group/map, and frees all resources.
- **Auto-cleanup:** Bots are automatically dismissed when the master logs out.

---

## Commands

| Command | Access | Description |
|---------|--------|-------------|
| `.rpg temperament` | GM | Reroll your temperament aura (random from trait library) |
| `.rpg psych` | GM | Reroll your psychology aura (random from trait library) |
| `.army list` | GM | Show all alt characters on your account |
| `.army spawn <name>` | GM | Spawn an alt into the world and add to party |
| `.army dismiss` | GM | Dismiss all spawned bot alts |

---

## Core Philosophy
- **Zero Core Patches:** The entire module works through AzerothCore's public APIs — `PlayerScript` hooks, `CommandScript`, `ObjectAccessor`, `Map::AddPlayerToMap`, `Group::Create`/`AddMember`. No engine modifications needed.
- **Consistency over Perfection:** Bots don't just "play perfectly." They have a "2K-style" shot meter for mechanics and rotations.
- **Persistent Growth:** Alts earn XP in specific fields (Mechanics, Rotation, Heroism) to improve their performance over time.
- **Psychological Depth:** Traits are active even when a human logs in, creating a "Character Identity" system that transcends AI.

---

## Technical Architecture

### Data Layer (SQL)
The system uses a dedicated `rpgbots` database with three tables:

| Table | Purpose |
|-------|---------|
| `character_rpg_data` | Per-character RPG profile: mechanics/rotation/heroism scores + XP, active temperament & psychology IDs |
| `rpg_temperaments` | Trait library of temperament archetypes with associated spell auras (IDs 700000–700004) |
| `rpg_psychology` | Psychological type definitions with associated spell auras (IDs 800000–800004) |

### Module Structure

```
mod-rpgbots/
├── sql/
│   ├── character_rpg_data.sql    # Per-character RPG profile table
│   ├── rpg_temperaments.sql      # Temperament trait library + spells
│   └── rpg_psychology.sql        # Psychology type library + spells
└── src/
    ├── mod_rpgbots_loader.cpp    # Module entry point (registers all systems)
    ├── PersonalitySystem.h/cpp   # PlayerScript: login/logout/XP hooks
    ├── RPGbotsCommands.cpp       # .rpg temperament / .rpg psych commands
    ├── ArmyOfAlts.cpp            # .army commands + BotLoginQueryHolder + bot lifecycle
    ├── Temperament.cpp           # Temperament system scaffold
    ├── Psychology.cpp            # Psychology system scaffold
    └── BotSessionSystem.h/cpp    # Bot session management scaffold
```

### Integration Strategy
- **Socketless Sessions:** Bot characters are loaded via `WorldSession` with a `nullptr` socket. All `SendPacket` calls silently no-op, so the full login flow works without a client.
- **BotLoginQueryHolder:** A module-local replica of the core's internal `LoginQueryHolder` (which is a local class in `CharacterHandler.cpp`). This lets us execute the same ~30 prepared queries that a normal login uses, without modifying core code.
- **Async via Master Session:** Bot login queries are dispatched through the master player's `AddQueryHolderCallback`, ensuring they execute on the world update loop without needing to register the bot session with `sWorldSessionMgr` (which would collide with the master's session on the same account).
- **PlayerScript Hooks:** Personality-driven events fire via `OnPlayerLogin`, `OnPlayerLogout`, and `OnPlayerGiveXP` hooks, ensuring profiles are active for both human players and bot characters.

---

## The "2K" Stat System

| Primary Affix | Stat Impact | Failure State |
|--------------|-------------|--------------|
| Mechanics    | % Chance to correctly dodge AOE/Stack. | Bot stands in fire or fails to move. |
| Rotation     | % Chance to cast the optimal spell.    | Bot uses a suboptimal filler or misses a DoT. |
| Heroism      | % Chance to save a dying ally (LoH, Brez). | Bot ignores the crisis to keep DPSing. |

### The Psychological Filter
- **Neurotypical:** 1.0x Multiplier (Reliable).
- **Insane:** 0.5x - 1.5x Multiplier (High peaks of brilliance, deep valleys of failure).
- **Stoic:** Immune to "Salt" (wipes), but gains XP 20% slower.

---

## Setup

1. Clone into your AzerothCore modules directory:
   ```bash
   cd azerothcore-wotlk/modules
   git clone https://github.com/Surrealabs/mod-rpgbots.git
   ```

2. Create the `rpgbots` database and run the SQL files:
   ```bash
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS rpgbots;"
   mysql -u root -p rpgbots < modules/mod-rpgbots/sql/character_rpg_data.sql
   mysql -u root -p rpgbots < modules/mod-rpgbots/sql/rpg_temperaments.sql
   mysql -u root -p rpgbots < modules/mod-rpgbots/sql/rpg_psychology.sql
   ```

3. Rebuild AzerothCore:
   ```bash
   ./acore.sh compiler build
   ```

4. The temperament/psychology spells (700000–700004, 800000–800004) must exist in your `spell_dbc` table. Create them with your preferred spell editor or import the provided definitions.

---

## Project Roadmap

### Phase 1: Foundations ✅
- [x] `character_rpg_data` SQL schema with persistent RPG profiles
- [x] Socketless bot sessions — **no core edit required**
- [x] `.army spawn` / `.army list` / `.army dismiss` commands
- [x] Bot spawning as real Player objects with full character data
- [x] Party creation and auto-join on spawn
- [x] Auto-cleanup on master logout
- [x] Personality aura system (temperaments + psychology)
- [x] `.rpg temperament` / `.rpg psych` reroll commands
- [x] Mechanics XP tracking on experience gain

### Phase 2: The Logic Engine
- [ ] Build the RollSuccess calculator (`Stat * Psych + Temp`)
- [ ] Bot follow behavior (follow master, stop on combat)
- [ ] Integrate "Rotation Misfire" logic into bot combat AI
- [ ] Create the "Heroism Scanner" for emergency cooldown usage
- [ ] Bot combat — auto-attack, basic spell casting based on class

### Phase 3: Personality & Flavour
- [ ] "Loudmouth" chat system (chirping after wipes)
- [ ] "Salt" mechanic (performance degradation after repeated deaths)
- [ ] "Scroll of Personality" gacha roll system (Rarity: Common -> Ancient)
- [ ] Temperament-driven combat behavior modifiers
- [ ] Bot emotes and idle behavior tied to psychology type

---