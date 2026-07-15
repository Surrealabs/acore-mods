# mod-warlock-expanded

AzerothCore module for advanced and modular Warlock class scripting and features.

## Features
- **Demonic Doppelgangar**: Custom guardian logic that mirrors the main pet's spells and auras, with robust respawn and state sync logic. Guardian is positioned at the player's front right, despawns if the pet is missing, and is only summoned by a specific spell (900002).
- **Spell and Aura Duplication**: Guardian duplicates the main pet's spell casts and auras, following the pet's react state (passive/defensive/aggressive).
- **Modular Loader**: All scripts are registered through a single loader for easy expansion and maintenance.
- **No Pet Control**: The script only manages the guardian; the main pet is managed by the server.
- **Auto-Despawn/Resummon**: Guardian despawns if the pet is missing or dead, and only one guardian is allowed at a time.

## Current Scripts
- `demonic_doppelgangar.cpp`: Handles all guardian logic, spell/aura duplication, movement, and respawn.
- `Alpha_warlock_expanded_loader.cpp`: Registers all scripts for the module.

## Usage Notes
- To add or modify warlock features, update or add scripts and register them in the loader.
- The guardian is only summoned by spell 900002 and will not auto-respawn unless the correct pet is present.
- Designed for easy future expansion (e.g., more modular scripts, additional custom warlock features).

## Status
- All logic is consolidated and modular.
- Build is clean and ready for further development.

---
_Last updated: 2026-02-04_
