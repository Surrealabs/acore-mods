// warlock_expanded.h — Shared constants, helpers, and includes for mod-warlock-expanded
#pragma once

#include "ScriptMgr.h"
#include "Player.h"
#include "Creature.h"
#include "CreatureAI.h"
#include "Pet.h"
#include "Spell.h"
#include "SpellMgr.h"
#include "SpellInfo.h"
#include "SpellAuras.h"
#include "SpellAuraEffects.h"
#include "SpellScript.h"
#include "MotionMaster.h"
#include <unordered_map>
#include <list>
#include <algorithm>
#include <vector>

namespace WarlockExpanded
{
    // ════════════════════════════════════════════════════════════════════
    //  WARLOCK BASE SPELLS
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 SHADOWBOLT_SPELL      = 686;
    constexpr uint32 SOULFIRE_SPELL        = 6353;
    constexpr uint32 SHADOWFLAME_SPELL     = 47897;
    constexpr uint32 HELLFIRE_SPELL        = 1949;
    constexpr uint32 DRAIN_SOUL_SPELL      = 1120;
    constexpr uint32 HAUNT_SPELL           = 48181;
    constexpr uint32 SEARING_PAIN_SPELL    = 5676;
    constexpr uint32 CHAOS_BOLT_SPELL      = 50796;
    constexpr uint32 CONFLAGRATE_SPELL     = 17962;
    constexpr uint32 IMMOLATE_SPELL        = 348;
    constexpr uint32 CURSE_OF_AGONY_SPELL  = 980;
    constexpr uint32 CORRUPTION_SPELL      = 172;
    constexpr uint32 CURSE_OF_DOOM_SPELL   = 603;
    constexpr uint32 DEMONIC_EMPOWERMENT   = 47193;

    // ════════════════════════════════════════════════════════════════════
    //  AURAS
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 DEMON_ARMOR_AURA      = 687;
    constexpr uint32 METAMORPHOSIS_AURA    = 47241;
    constexpr uint32 DECIMATION_AURA       = 63167;
    constexpr uint32 EVERLASTING_AFFLICTION = 30108;

        // ════════════════════════════════════════════════════════════════════
        //  CORE PET/GUARDIAN SCALING AURAS
        // ════════════════════════════════════════════════════════════════════
        constexpr uint32 SPELL_PET_AVOIDANCE_AURA = 32233;
        constexpr uint32 SPELL_PET_HIT_EXP_AURA   = 61017; // Hit / Expertise scaling
    // ════════════════════════════════════════════════════════════════════
    //  CUSTOM SPELLS (900xxx range)
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 SUMMON_IMP_SPELL      = 900000;
    constexpr uint32 SUMMON_WRATHGUARD     = 900001;
    constexpr uint32 SUMMON_INFERNAL       = 900002;
    constexpr uint32 SHADOWBOLT_META       = 900003;
    constexpr uint32 SUMMON_ASSASSIN       = 900005;
    constexpr uint32 SOULFIRE_META         = 900006;
    constexpr uint32 SHADOWFLAME_META      = 900007;
    constexpr uint32 HELLFIRE_META         = 900008;
    constexpr uint32 CAST_SPEED_BUFF       = 900009;
    constexpr uint32 INSTANT_AGONY_SPELL   = 900011;
    constexpr uint32 SUMMON_PET_SPELL      = 688;
    constexpr uint32 IMMOLATION_AURA_SPELL = 900008;  // same as HELLFIRE_META (stacking on infernals)

    // ════════════════════════════════════════════════════════════════════
    //  CREATURE ENTRIES
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 WILD_IMP_ENTRY        = 900416;
    constexpr uint32 WRATHGUARD_ENTRY      = 917252;
    constexpr uint32 INFERNAL_ENTRY        = 917253;
    constexpr uint32 IMP_ASSASSIN_ENTRY    = 900418;

    // ════════════════════════════════════════════════════════════════════
    //  IMP WARLOCK SPELLS (custom copies — independent balancing)
    //   Filler(SB echo): Shadow Bolt  Heavy(SF echo): Soul Fire
    //   Special(DE): Chaos Bolt
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 IMP_SHADOW_BOLT       = 900017;  // filler (on owner SB)
    constexpr uint32 IMP_SOUL_FIRE         = 900018;  // heavy (on owner SF)
    constexpr uint32 IMP_CHAOS_BOLT        = 900019;  // special (on DE)

    // ════════════════════════════════════════════════════════════════════
    //  WRATHGUARD SPELLS (custom copies — independent balancing)
    //   Filler(SB): Mortal Strike  Heavy(SF): Whirlwind  Special(DE): Bladestorm
    //   DoTs: Rend + Hemorrhage
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 SPELL_MORTAL_STRIKE   = 900020;  // filler
    constexpr uint32 SPELL_REND            = 900021;  // dot
    constexpr uint32 SPELL_HEMORRHAGE      = 900022;  // dot
    constexpr uint32 SPELL_WHIRLWIND       = 900023;  // heavy
    constexpr uint32 SPELL_BLADESTORM      = 900024;  // special
    constexpr uint32 SPELL_CHARGE          = 100;     // gap closer (vanilla)

    // ════════════════════════════════════════════════════════════════════
    //  IMP ASSASSIN SPELLS (custom copies — independent balancing)
    //   Filler(SB): Ambush  Heavy(SF): Envenom  Special(DE): Fan of Knives
    //   DoTs: Deadly Poison + Rupture
    // ════════════════════════════════════════════════════════════════════
    constexpr uint32 SPELL_AMBUSH          = 900025;  // filler
    constexpr uint32 SPELL_FAN_OF_KNIVES   = 900026;  // special
    constexpr uint32 SPELL_ENVENOM         = 900027;  // heavy
    constexpr uint32 SPELL_DEADLY_POISON   = 900028;  // dot (stacking)
    constexpr uint32 SPELL_RUPTURE         = 900029;  // dot
    constexpr uint32 SPELL_SHADOWSTEP      = 900030;  // gap closer

    // ════════════════════════════════════════════════════════════════════
    //  CONFIG KNOBS — Minion counts, scaling, and talent gating
    // ════════════════════════════════════════════════════════════════════

    // Default max minion counts (used when talent gating is disabled)
    constexpr uint8  DEFAULT_MAX_IMPS         = 2;
    constexpr uint8  DEFAULT_MAX_WRATHGUARDS  = 2;
    constexpr uint8  DEFAULT_MAX_ASSASSINS    = 2;

    // Guardian stat scaling: each guardian gets this fraction of the
    // warlock's shadow spellpower as both Attack Power AND Spell Power.
    // One knob, one source — applies to ALL guardians (imps, wrathguards,
    // assassins) every 2 seconds.
    constexpr float  GUARDIAN_SP_SCALING       = 0.5f;  // 50% of caster SP

    // ── Talent-based gating ──────────────────────────────────────────
    // Each array lists the spell IDs for rank 1, rank 2 of the talent.
    // Highest rank learned = max minion count for that type.
    // Set first element to 0 to disable talent gating and use DEFAULT_MAX_*.
    constexpr uint32 WRATHGUARD_TALENT_RANKS[] = { 47230, 47231 };  // Fel Synergy
    constexpr uint32 ASSASSIN_TALENT_RANKS[]   = { 18767, 18768 };  // Master Conjuror
    constexpr uint32 IMP_TALENT_RANKS[]        = { 18692, 18693 };  // Improved Healthstone
    constexpr uint8  MAX_TALENT_RANKS          = 2;

    // ── Guardian formation distances & angles ────────────────────────
    constexpr float  MELEE_FOLLOW_DIST     = 3.5f;            // wrathguards + assassins
    constexpr float  IMP_FOLLOW_DIST       = 1.5f;            // imps (close to caster)
    constexpr float  MELEE_BASE_ANGLE      = 2.356194f;       // 3π/4 ≈ 135° front-flank
    constexpr float  MELEE_ANGLE_STEP      = 0.261799f;       // π/12 ≈ 15° spread per extra
    constexpr float  IMP_BASE_ANGLE        = 0.523599f;       // π/6 ≈ 30° rear-flank
    constexpr float  IMP_ANGLE_STEP        = 0.349066f;       // π/9 ≈ 20° spread per extra
    constexpr float  LEASH_RANGE           = 60.0f;
    constexpr uint32 OWNER_IDLE_TIMEOUT_MS = 5000;

    // ════════════════════════════════════════════════════════════════════
    //  SHARED COMBAT STATE (inline globals — one set for all guardians)
    // ════════════════════════════════════════════════════════════════════
    // These are written by the unified AllSpellScript in guardian_manager.cpp
    // and read by all guardian AIs. The idle timer is incremented by the
    // unified PlayerScript (once per server tick per player).
    inline std::unordered_map<uint64, uint32>     g_OwnerLastCastTime;
    inline std::unordered_map<uint64, ObjectGuid> g_OwnerLastTarget;

    // ════════════════════════════════════════════════════════════════════
    //  UTILITY FUNCTIONS
    // ════════════════════════════════════════════════════════════════════

    // ── Talent-based minion count resolver ───────────────────────────
    // WoTLK only stores the HIGHEST learned rank in m_talents (lower
    // ranks are removed when a higher rank is learned). So we scan
    // from highest rank DOWN — the first hit tells us the point count.
    inline uint8 GetTalentMinionCount(Player* player, const uint32* rankSpells, uint8 numRanks, uint8 defaultMax)
    {
        if (!player || !rankSpells || rankSpells[0] == 0)
            return defaultMax;
        uint8 activeSpec = player->GetActiveSpec();
        for (int r = numRanks - 1; r >= 0; --r)
        {
            uint32 spellId = rankSpells[r];
            if (player->HasTalent(spellId, activeSpec) ||
                player->HasSpell(spellId) ||
                player->HasAura(spellId))
                return r + 1;  // r+1 points spent
        }
        return 0;  // no ranks found = talent not taken
    }

    // ── Creature collection helpers ─────────────────────────────────
    inline void GetPlayerCreatures(Player* player, uint32 entry, float range, std::list<Creature*>& out)
    {
        if (!player || !player->IsInWorld())
            return;
        player->GetCreatureListWithEntryInGrid(out, entry, range);
        out.remove_if([player](Creature* c) {
            return !c || c->GetOwnerGUID() != player->GetGUID();
        });
    }

    inline void GetPlayerCreaturesAlive(Player* player, uint32 entry, float range, std::list<Creature*>& out)
    {
        GetPlayerCreatures(player, entry, range, out);
        out.remove_if([](Creature* c) { return !c || !c->IsAlive(); });
    }

    inline void GetPlayerImps(Player* player, std::list<Creature*>& out)
    { GetPlayerCreatures(player, WILD_IMP_ENTRY, 100.0f, out); }

    inline void GetPlayerImpsAlive(Player* player, std::list<Creature*>& out)
    { GetPlayerCreaturesAlive(player, WILD_IMP_ENTRY, 100.0f, out); }

    inline void GetPlayerWrathguards(Player* player, std::list<Creature*>& out)
    { GetPlayerCreatures(player, WRATHGUARD_ENTRY, 100.0f, out); }

    inline void GetPlayerWrathguardsAlive(Player* player, std::list<Creature*>& out)
    { GetPlayerCreaturesAlive(player, WRATHGUARD_ENTRY, 100.0f, out); }

    inline void GetPlayerInfernals(Player* player, std::list<Creature*>& out)
    { GetPlayerCreaturesAlive(player, INFERNAL_ENTRY, 80.0f, out); }

    inline void GetPlayerAssassins(Player* player, std::list<Creature*>& out)
    { GetPlayerCreatures(player, IMP_ASSASSIN_ENTRY, 100.0f, out); }

    inline void GetPlayerAssassinsAlive(Player* player, std::list<Creature*>& out)
    { GetPlayerCreaturesAlive(player, IMP_ASSASSIN_ENTRY, 100.0f, out); }

    // Collect ALL melee guardians (wrathguards + assassins) alive
    inline void GetPlayerMeleeGuardians(Player* player, std::list<Creature*>& out)
    {
        GetPlayerWrathguardsAlive(player, out);
        std::list<Creature*> assassins;
        GetPlayerAssassinsAlive(player, assassins);
        out.insert(out.end(), assassins.begin(), assassins.end());
    }

    // ── Spell classification ────────────────────────────────────────
    // Core spells that drive the minion system (target tracking, imp echoes, etc.)
    inline bool IsWarlockCoreSpell(uint32 spellId)
    {
        return spellId == SHADOWBOLT_SPELL || spellId == SOULFIRE_SPELL ||
               spellId == SHADOWBOLT_META  || spellId == SOULFIRE_META  ||
               spellId == CORRUPTION_SPELL || spellId == CURSE_OF_DOOM_SPELL;
    }

    inline bool IsShadowBolt(uint32 id) { return id == SHADOWBOLT_SPELL || id == SHADOWBOLT_META; }
    inline bool IsSoulFire(uint32 id)   { return id == SOULFIRE_SPELL   || id == SOULFIRE_META; }

    // ── Aura helpers ────────────────────────────────────────────────
    inline void RefreshAura(Unit* caster, Unit* target, uint32 auraId)
    {
        if (!caster || !target) return;
        Aura* aura = target->GetAura(auraId, caster->GetGUID());
        if (aura)
        {
            aura->SetDuration(aura->GetMaxDuration());
            aura->RefreshDuration();
        }
    }

    // ── Owner / caster helpers ──────────────────────────────────────
    inline Player* GetOwnerPlayer(Creature* creature)
    {
        if (!creature) return nullptr;
        if (Unit* owner = creature->GetOwner())
            return owner->ToPlayer();
        return nullptr;
    }

    inline Player* GetWarlockCaster(Unit* caster)
    {
        if (!caster || !caster->IsPlayer()) return nullptr;
        Player* player = caster->ToPlayer();
        if (!player || player->getClass() != CLASS_WARLOCK) return nullptr;
        return player;
    }

    // ── Unified guardian formation ──────────────────────────────────
    // Returns the follow angle for a specific guardian based on its type
    // and its index among all same-role siblings. Sorts by GUID to keep
    // deterministic left/right assignment.
    //
    // Melee (wrathguards + assassins): front-flank ±135°, 15° spread
    // Ranged (imps):                   rear-flank ±30°, 20° spread
    inline float GetGuardianFollowAngle(Creature* guardian, Player* owner)
    {
        uint32 entry = guardian->GetEntry();
        bool isMelee = (entry == WRATHGUARD_ENTRY || entry == IMP_ASSASSIN_ENTRY);

        std::list<Creature*> peers;
        if (isMelee)
            GetPlayerMeleeGuardians(owner, peers);
        else
            GetPlayerImpsAlive(owner, peers);

        // Sort by GUID for deterministic ordering
        peers.sort([](Creature* a, Creature* b) { return a->GetGUID() < b->GetGUID(); });

        // Find our index among peers
        uint32 idx = 0;
        for (Creature* p : peers)
        {
            if (p->GetGUID() == guardian->GetGUID()) break;
            idx++;
        }

        // Even index → left side, odd → right side
        bool leftSide = (idx % 2 == 0);
        uint32 sideIdx = idx / 2;

        float baseAngle = isMelee ? MELEE_BASE_ANGLE : IMP_BASE_ANGLE;
        float step      = isMelee ? MELEE_ANGLE_STEP : IMP_ANGLE_STEP;
        float angle = baseAngle + sideIdx * step;
        return leftSide ? angle : -angle;
    }

    inline float GetGuardianFollowDist(Creature* guardian)
    {
        uint32 entry = guardian->GetEntry();
        if (entry == WRATHGUARD_ENTRY || entry == IMP_ASSASSIN_ENTRY)
            return MELEE_FOLLOW_DIST;
        return IMP_FOLLOW_DIST;
    }

    // Assign follow positions for ALL idle guardians around the warlock.
    // Only repositions guardians NOT currently in combat.
    inline void AssignGuardianFormation(Player* player)
    {
        if (!player || !player->IsInWorld() || !player->IsAlive())
            return;

        // Melee guardians — only reposition idle ones
        {
            std::list<Creature*> melee;
            GetPlayerMeleeGuardians(player, melee);
            for (Creature* g : melee)
            {
                if (!g || g->GetVictim()) continue; // skip in-combat
                float angle = GetGuardianFollowAngle(g, player);
                g->GetMotionMaster()->MoveFollow(player, MELEE_FOLLOW_DIST, angle);
            }
        }
        // Imps — always reposition (they don't melee)
        {
            std::list<Creature*> imps;
            GetPlayerImpsAlive(player, imps);
            for (Creature* g : imps)
            {
                if (!g) continue;
                float angle = GetGuardianFollowAngle(g, player);
                g->GetMotionMaster()->MoveFollow(player, IMP_FOLLOW_DIST, angle);
            }
        }
    }

    // ── Combat state helpers for guardian AIs ────────────────────────
    // Resolve the owner's last spell target into a living, valid Unit*
    inline Unit* ResolveOwnerTarget(Player* owner)
    {
        uint64 guid = owner->GetGUID().GetRawValue();
        auto it = g_OwnerLastTarget.find(guid);
        if (it == g_OwnerLastTarget.end() || it->second.IsEmpty())
            return nullptr;
        Unit* target = ObjectAccessor::GetUnit(*owner, it->second);
        if (target && target->IsAlive())
            return target;
        return nullptr;
    }

    inline bool IsOwnerIdle(Player* owner)
    {
        uint64 guid = owner->GetGUID().GetRawValue();
        auto it = g_OwnerLastCastTime.find(guid);
        if (it == g_OwnerLastCastTime.end())
            return true;
        return it->second >= OWNER_IDLE_TIMEOUT_MS;
    }

} // namespace WarlockExpanded
