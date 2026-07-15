# mod-talents-expanded

AzerothCore module for expanded talent system functionality.

## Features
- Removes the row-requirement gate so players can pick talents freely
  (actual row-check removal is a core change — see `Info/CoreModifications.md`)
- Provides server-side hooks and helpers for future custom talent behaviours

## Core Changes Required
See [Info/CoreModifications.md](Info/CoreModifications.md) for the two
surgical changes in `Player.cpp`.

## UI
The client-side talent frame reskin is handled by `SurrealTalentFrame_AIO.lua`
(pushed to the client via mod-aio). The AIO script contains a per-class /
per-spec layout table that the admin can edit to reposition talents freely.
