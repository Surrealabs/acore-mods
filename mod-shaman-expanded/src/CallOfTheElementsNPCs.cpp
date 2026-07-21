/*
 * Call of the Elements (mod-shaman-expanded) — the 4 elemental combat
 * summons (Rock/Fire/Wind/Water) that Call of the Elements (spell 66842,
 * see spell_sha_expanded_call_of_the_elements in mod_shaman_expanded.cpp)
 * always brings out together.
 *
 * These mirror the REAL, already-working `npc_pet_shaman_earth_elemental`/
 * `npc_pet_shaman_fire_elemental` pattern in
 * src/server/scripts/Pet/pet_shaman.cpp almost verbatim (per-user request -
 * "the earth elemental totem is the best working totem, use it as
 * baseline"): plain ScriptedAI, a `_initAttack` one-shot that engages
 * whatever the owner is currently targeting on the very first tick (a
 * fresh Guardian summon has no threat/victim of its own yet), then normal
 * UpdateVictim()+EventMap()+DoMeleeAttackIfReady() from then on. Guardian-
 * type TempSummons like these are NOT affected by the CreatureAISelector
 * PetAI-forcing bug documented elsewhere in this module (that only
 * triggers for creature->IsPet()==true, i.e. real Pet-system summons) -
 * confirmed by the fact the real Greater Earth/Fire Elemental use this
 * exact ScriptedAI pattern successfully already.
 *
 * Water is the one exception - a healer shouldn't wait for ITS OWN combat
 * to start before doing its job, so its heal timer runs independent of
 * UpdateVictim()/JustEngagedWith, and picks the lowest-HP% ally in the
 * owner's group (same "lowest HP ally" pattern BotAI.cpp/mod-priest-
 * expanded's Lightwell use).
 *
 * Spell IDs marked `= 0` below are TODO placeholders (same convention as
 * ElementalistSpells.h) - the AI simply skips that cast until a real spell
 * ID is filled in; melee/engagement still works either way.
 */

#include "CreatureScript.h"
#include "ScriptedCreature.h"
#include "Player.h"
#include "Group.h"
#include "MotionMaster.h"
#include <cmath>

namespace
{
    enum CallOfElementsSpells
    {
        // Rock (Earth) - reuses the REAL Shaman Earth Elemental's own
        // ability (Angered Earth), same as core's npc_pet_shaman_earth_elemental.
        SPELL_ROCK_ANGERED_EARTH = 36213,

        // Fire - reuses the REAL Shaman Fire Elemental's own abilities,
        // same as core's npc_pet_shaman_fire_elemental.
        SPELL_FIRE_NOVA   = 12470,
        SPELL_FIRE_BLAST  = 57984,
        SPELL_FIRE_SHIELD = 13377,

        // Wind - TODO: real Nature-school damage spell for this element.
        SPELL_WIND_NATURE_BOLT = 0,

        // Water - TODO: real heal spell for this element.
        SPELL_WATER_HEAL = 0,
    };

    enum CallOfElementsEvents
    {
        EVENT_ROCK_ANGERED_EARTH = 1,

        EVENT_FIRE_NOVA  = 1,
        EVENT_FIRE_BLAST = 2,

        EVENT_WIND_NATURE_BOLT = 1,

        EVENT_WATER_HEAL = 1,
    };

    // Returns the lowest-HP% member of the owner's group (or the owner
    // itself if solo/no one's hurt more) - same pattern as BotAI.cpp's
    // FindLowestHP / mod-priest-expanded's Lightwell.
    Unit* FindLowestHPAlly(Creature* me)
    {
        Player* owner = me->GetCharmerOrOwnerPlayerOrPlayerItself();
        if (!owner)
            return nullptr;

        Unit* lowest = owner->IsAlive() ? owner : nullptr;
        float lowestPct = owner->IsAlive() ? owner->GetHealthPct() : 101.0f;

        if (Group* group = owner->GetGroup())
        {
            for (GroupReference* ref = group->GetFirstMember(); ref; ref = ref->next())
            {
                Player* member = ref->GetSource();
                if (!member || !member->IsAlive() || !member->IsInWorld())
                    continue;
                if (member->GetMapId() != me->GetMapId())
                    continue;

                float pct = member->GetHealthPct();
                if (pct < lowestPct)
                {
                    lowestPct = pct;
                    lowest = member;
                }
            }
        }

        return lowest;
    }

    // ── Diamond formation around the owner (out-of-combat / following) ────
    //   Rock  - directly in front  (angle 0)
    //   Water - directly behind   (angle PI)
    //   Fire  - left side         (angle PI/2)
    //   Wind  - right side        (angle -PI/2)
    // MoveFollow's angle is relative to the OWNER's facing (PI = directly
    // behind) - same convention BotAI.cpp's ArrangeArrowFormation uses.
    // Re-issued only once (guarded by `isFollowing`) rather than every tick -
    // restarting MoveFollow constantly makes movement look jittery/non-
    // following (same lesson as BotAI.cpp). `isFollowing` gets reset to
    // false whenever the elemental enters combat, so formation is correctly
    // re-applied the next time it settles back down.
    constexpr float FORMATION_DISTANCE = 3.0f;
    constexpr float FORMATION_ANGLE_FRONT = 0.0f;
    constexpr float FORMATION_ANGLE_BEHIND = float(M_PI);
    constexpr float FORMATION_ANGLE_LEFT = float(M_PI) / 2.0f;
    constexpr float FORMATION_ANGLE_RIGHT = -float(M_PI) / 2.0f;

    void MaintainFormation(Creature* me, float relativeAngle, bool& isFollowing)
    {
        Player* owner = me->GetCharmerOrOwnerPlayerOrPlayerItself();
        if (!owner || isFollowing)
            return;

        isFollowing = true;
        me->GetMotionMaster()->Clear();
        me->GetMotionMaster()->MoveFollow(owner, FORMATION_DISTANCE, relativeAngle);
    }
}

// ── Rock (Earth) Elemental — melee attacker ────────────────────────────────
struct npc_call_rock_elemental : public ScriptedAI
{
    npc_call_rock_elemental(Creature* creature) : ScriptedAI(creature), _initAttack(true) { }

    void InitializeAI() override { }

    void JustEngagedWith(Unit*) override
    {
        _events.Reset();
        _events.ScheduleEvent(EVENT_ROCK_ANGERED_EARTH, 0ms);
    }

    void UpdateAI(uint32 diff) override
    {
        if (!me->IsInCombat())
            MaintainFormation(me, FORMATION_ANGLE_FRONT, _isFollowing);
        else
            _isFollowing = false;

        if (_initAttack)
        {
            if (!me->IsInCombat())
                if (Player* owner = me->GetCharmerOrOwnerPlayerOrPlayerItself())
                    if (Unit* target = owner->GetSelectedUnit())
                        if (me->CanCreatureAttack(target))
                            AttackStart(target);
            _initAttack = false;
        }

        if (!UpdateVictim())
            return;

        _events.Update(diff);

        if (_events.ExecuteEvent() == EVENT_ROCK_ANGERED_EARTH)
        {
            DoCastVictim(SPELL_ROCK_ANGERED_EARTH);
            _events.ScheduleEvent(EVENT_ROCK_ANGERED_EARTH, 5s, 20s);
        }

        DoMeleeAttackIfReady();
    }

private:
    EventMap _events;
    bool _initAttack;
    bool _isFollowing = false;
};

// ── Fire Elemental — casts fire spells ──────────────────────────────────────
struct npc_call_fire_elemental : public ScriptedAI
{
    npc_call_fire_elemental(Creature* creature) : ScriptedAI(creature), _initAttack(true) { }

    void InitializeAI() override { }

    void JustEngagedWith(Unit*) override
    {
        _events.Reset();
        _events.ScheduleEvent(EVENT_FIRE_NOVA, 5s, 20s);
        _events.ScheduleEvent(EVENT_FIRE_BLAST, 5s, 20s);

        me->RemoveAurasDueToSpell(SPELL_FIRE_SHIELD);
        me->CastSpell(me, SPELL_FIRE_SHIELD, true);
    }

    void UpdateAI(uint32 diff) override
    {
        if (!me->IsInCombat())
            MaintainFormation(me, FORMATION_ANGLE_LEFT, _isFollowing);
        else
            _isFollowing = false;

        if (_initAttack)
        {
            if (!me->IsInCombat())
                if (Player* owner = me->GetCharmerOrOwnerPlayerOrPlayerItself())
                    if (Unit* target = owner->GetSelectedUnit())
                        if (me->CanCreatureAttack(target))
                            AttackStart(target);
            _initAttack = false;
        }

        if (!UpdateVictim())
            return;

        _events.Update(diff);
        while (uint32 eventId = _events.ExecuteEvent())
        {
            switch (eventId)
            {
                case EVENT_FIRE_NOVA:
                    me->CastSpell(me, SPELL_FIRE_NOVA, false);
                    _events.ScheduleEvent(EVENT_FIRE_NOVA, 8s, 15s);
                    break;
                case EVENT_FIRE_BLAST:
                    me->CastSpell(me->GetVictim(), SPELL_FIRE_BLAST, false);
                    _events.ScheduleEvent(EVENT_FIRE_BLAST, 4s, 8s);
                    break;
                default:
                    break;
            }
        }

        DoMeleeAttackIfReady();
    }

private:
    EventMap _events;
    bool _initAttack;
    bool _isFollowing = false;
};

// ── Wind Elemental — casts nature spells ────────────────────────────────────
struct npc_call_wind_elemental : public ScriptedAI
{
    npc_call_wind_elemental(Creature* creature) : ScriptedAI(creature), _initAttack(true) { }

    void InitializeAI() override { }

    void JustEngagedWith(Unit*) override
    {
        _events.Reset();
        _events.ScheduleEvent(EVENT_WIND_NATURE_BOLT, 2s, 4s);
    }

    void UpdateAI(uint32 diff) override
    {
        if (!me->IsInCombat())
            MaintainFormation(me, FORMATION_ANGLE_RIGHT, _isFollowing);
        else
            _isFollowing = false;

        if (_initAttack)
        {
            if (!me->IsInCombat())
                if (Player* owner = me->GetCharmerOrOwnerPlayerOrPlayerItself())
                    if (Unit* target = owner->GetSelectedUnit())
                        if (me->CanCreatureAttack(target))
                            AttackStart(target);
            _initAttack = false;
        }

        if (!UpdateVictim())
            return;

        _events.Update(diff);

        if (_events.ExecuteEvent() == EVENT_WIND_NATURE_BOLT)
        {
            if (SPELL_WIND_NATURE_BOLT != 0)
                me->CastSpell(me->GetVictim(), SPELL_WIND_NATURE_BOLT, false);
            _events.ScheduleEvent(EVENT_WIND_NATURE_BOLT, 2s, 4s);
        }

        DoMeleeAttackIfReady();
    }

private:
    EventMap _events;
    bool _initAttack;
    bool _isFollowing = false;
};

// ── Water Elemental — heals ─────────────────────────────────────────────────
// Deliberately does NOT gate on UpdateVictim()/JustEngagedWith - a healer
// shouldn't wait for its own combat to start before doing its job. Runs its
// heal timer unconditionally for as long as it exists (same "just keeps
// healing indefinitely" design as mod-priest-expanded's Lightwell).
struct npc_call_water_elemental : public ScriptedAI
{
    npc_call_water_elemental(Creature* creature) : ScriptedAI(creature) { }

    void InitializeAI() override
    {
        _events.Reset();
        _events.ScheduleEvent(EVENT_WATER_HEAL, 3s);
    }

    void UpdateAI(uint32 diff) override
    {
        if (!me->IsInCombat())
            MaintainFormation(me, FORMATION_ANGLE_BEHIND, _isFollowing);
        else
            _isFollowing = false;

        _events.Update(diff);

        if (_events.ExecuteEvent() == EVENT_WATER_HEAL)
        {
            if (SPELL_WATER_HEAL != 0)
                if (Unit* target = FindLowestHPAlly(me))
                    me->CastSpell(target, SPELL_WATER_HEAL, true);
            _events.ScheduleEvent(EVENT_WATER_HEAL, 3s);
        }
    }

private:
    EventMap _events;
    bool _isFollowing = false;
};

void AddCallOfTheElementsNPCs()
{
    RegisterCreatureAI(npc_call_rock_elemental);
    RegisterCreatureAI(npc_call_fire_elemental);
    RegisterCreatureAI(npc_call_wind_elemental);
    RegisterCreatureAI(npc_call_water_elemental);
}
