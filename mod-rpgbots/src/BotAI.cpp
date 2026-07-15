// BotAI.cpp
// Dead-simple priority-queue AI.  One SQL row per spec, 30 spells, 6 buckets.
//
// The waterfall every tick (combat only):
//   0. META        — fire on-use trinkets + offensive racial cooldowns
//   1. BUFFS       — cast on self if aura missing
//   2. DEFENSIVES  — cast on self if HP < 35%
//   3. DOTS        — cast on enemy if aura missing on target
//   4. HOTS        — cast on lowest-HP ally if aura missing
//   5. ABILITIES   — role decides the target
//   6. MOBILITY    — cast on self if out of preferred range
//
// Out of combat: arrow formation behind master.
// One cast per tick.  First valid spell wins.  No branching spaghetti.

#include "BotAI.h"
#include "BotBehavior.h"
#include "RotationEngine.h"
#include "ScriptMgr.h"
#include "Player.h"
#include "ObjectAccessor.h"
#include "MotionMaster.h"
#include "Group.h"
#include "Log.h"
#include "Chat.h"
#include "SpellAuras.h"
#include "Spell.h"
#include "SpellInfo.h"
#include "SpellMgr.h"
#include "Item.h"
#include "ItemTemplate.h"
#include <cmath>
#include <algorithm>

// ─── Constants ─────────────────────────────────────────────────────────────────
static constexpr uint32 AI_UPDATE_INTERVAL_MS = 1000;
static constexpr float  MAX_FOLLOW_DISTANCE   = 40.0f;
static constexpr float  COMBAT_CHASE_MELEE    = 0.5f;
static constexpr float  COMBAT_CHASE_RANGED   = 25.0f;
static constexpr float  HEAL_THRESHOLD_PCT    = 90.0f;
static constexpr float  RANGED_HEALER_HEAL_THRESHOLD_PCT = 80.0f;
static constexpr float  MELEE_HEALER_HEAL_THRESHOLD_PCT  = 80.0f;
static constexpr float  MELEE_HEALER_MIN_MANA_PCT        = 20.0f;
static constexpr float  DEFENSIVE_HP_PCT      = 35.0f;
static constexpr uint32 HUNTER_AUTO_SHOT      = 75;

// Warlock spell IDs
static constexpr uint32 WARLOCK_SOULBURN      = 17877;  // Shadowburn (Destro talent, costs shard)
static constexpr uint32 SOUL_SHARD_ITEM       = 6265;   // Soul Shard item ID

// Offensive racial cooldowns (WoTLK)
static constexpr uint32 OFFENSIVE_RACIALS[] = {
    20572,  // Blood Fury  (Orc – Attack Power)
    33702,  // Blood Fury  (Orc – Spell Power + AP)
    26297,  // Berserking  (Troll – Haste)
    28730,  // Arcane Torrent (Blood Elf – Mana + Silence)
    25046,  // Arcane Torrent (Blood Elf – Energy + Silence)
    50613,  // Arcane Torrent (Blood Elf – Runic Power + Silence)
    20549,  // War Stomp   (Tauren – AoE Stun)
};

// ─── Role Auto-Detection ───────────────────────────────────────────────────────

BotRole DetectBotRole(Player* bot)
{
    if (!bot) return BotRole::ROLE_MELEE_DPS;

    uint8 specIdx = DetectSpecIndex(bot);
    const SpecRotation* rot = sRotationEngine.GetRotation(bot->getClass(), specIdx);
    if (rot) return rot->role;

    if (bot->HasTankSpec())   return BotRole::ROLE_TANK;
    if (bot->HasHealSpec())   return BotRole::ROLE_RANGED_HEALER;
    if (bot->HasCasterSpec()) return BotRole::ROLE_RANGED_DPS;
    if (bot->HasMeleeSpec())  return BotRole::ROLE_MELEE_DPS;

    switch (bot->getClass())
    {
        case CLASS_WARLOCK: case CLASS_MAGE: case CLASS_PRIEST:
            return BotRole::ROLE_RANGED_DPS;
        default:
            return BotRole::ROLE_MELEE_DPS;
    }
}

static bool IsMeleeRole(BotRole role)
{
    return role == BotRole::ROLE_MELEE_DPS ||
           role == BotRole::ROLE_TANK ||
           role == BotRole::ROLE_MELEE_HEALER;
}

static float GetManaPct(Player* bot)
{
    if (!bot)
        return 0.0f;

    uint32 maxMana = bot->GetMaxPower(POWER_MANA);
    if (maxMana == 0)
        return 100.0f;

    return (float(bot->GetPower(POWER_MANA)) * 100.0f) / float(maxMana);
}

uint8 DetectSpecIndex(Player* bot)
{
    if (!bot)
        return 0;

    uint8 fallback = bot->GetMostPointsTalentTree();
    return sRotationEngine.DetectBestSpecIndex(bot, fallback);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

static float Dist2D(Unit* a, Unit* b)
{
    if (!a || !b || a->GetMapId() != b->GetMapId()) return 99999.f;
    float dx = a->GetPositionX() - b->GetPositionX();
    float dy = a->GetPositionY() - b->GetPositionY();
    return std::sqrt(dx * dx + dy * dy);
}

static void TeleportToMaster(Player* bot, Player* master)
{
    float ang = frand(0.f, 2.f * float(M_PI));
    float d   = frand(2.f, 4.f);
    float x = master->GetPositionX() + d * std::cos(ang);
    float y = master->GetPositionY() + d * std::sin(ang);
    float z = master->GetPositionZ();
    if (bot->GetMapId() != master->GetMapId())
        bot->TeleportTo(master->GetMapId(), x, y, z, master->GetOrientation());
    else
        bot->NearTeleportTo(x, y, z, master->GetOrientation());
}

// Find party member with lowest HP% (same map, alive)
static Player* FindLowestHP(Player* bot, Player* master)
{
    Group* grp = master->GetGroup();
    if (!grp) return nullptr;

    Player* lowest   = nullptr;
    float   lowPct   = 100.f;
    for (GroupReference* ref = grp->GetFirstMember(); ref; ref = ref->next())
    {
        Player* m = ref->GetSource();
        if (!m || !m->IsAlive() || !m->IsInWorld()) continue;
        if (m->GetMapId() != bot->GetMapId()) continue;
        float pct = m->GetHealthPct();
        if (pct < lowPct) { lowPct = pct; lowest = m; }
    }
    return lowest;
}

// ─── Spell eligibility check (no cast — dry run) ──────────────────────────────
// Returns true if the spell COULD be cast right now (has spell, not on CD, etc.)

static bool CanCast(Player* bot, Unit* target, uint32 spellId)
{
    if (spellId == 0)          return false;
    if (!target)               return false;
    if (!bot->HasSpell(spellId))       return false;
    if (bot->HasSpellCooldown(spellId)) return false;

    // Warlock Soulburn (Shadowburn): require soul shard (spec can be custom)
    if (spellId == WARLOCK_SOULBURN)
    {
        if (bot->GetItemCount(SOUL_SHARD_ITEM) == 0)
            return false;
    }

    if (Spell* channeled = bot->GetCurrentSpell(CURRENT_CHANNELED_SPELL))
    {
        if (channeled->m_spellInfo && channeled->m_spellInfo->Id == spellId)
            return false;
    }

    return true;
}

// ─── Try to cast one spell ─────────────────────────────────────────────────────
// Returns true if the spell was successfully cast.

static bool TryCast(Player* bot, Unit* target, uint32 spellId)
{
    if (!CanCast(bot, target, spellId))
        return false;

    return bot->CastSpell(target, spellId, false) == SPELL_CAST_OK;
}

static void EnsureRangedFacing(Player* bot, Unit* enemy, BotRole role)
{
    if (!bot || !enemy)
        return;

    bool isMelee = IsMeleeRole(role);
    if (isMelee)
        return;

    if (!bot->HasInArc(float(M_PI), enemy))
        bot->SetInFront(enemy);
}

static bool TryMaintainHunterAutoShot(Player* bot, Unit* enemy)
{
    if (!bot || !enemy)
        return false;

    if (bot->getClass() != CLASS_HUNTER)
        return false;

    if (!bot->HasSpell(HUNTER_AUTO_SHOT))
        return false;

    EnsureRangedFacing(bot, enemy, BotRole::ROLE_RANGED_DPS);

    if (Spell* autoRepeat = bot->GetCurrentSpell(CURRENT_AUTOREPEAT_SPELL))
    {
        if (autoRepeat->m_spellInfo && autoRepeat->m_spellInfo->Id == HUNTER_AUTO_SHOT)
            return false;
    }

    return TryCast(bot, enemy, HUNTER_AUTO_SHOT);
}

// ─── Bucket Runners ────────────────────────────────────────────────────────────
// Each bucket scans its 5 slots. First valid cast wins → return true.

// Warlock Metamorphosis spell ID (Demonology buff_1)
static constexpr uint32 WARLOCK_METAMORPHOSIS = 47241;
static constexpr float  META_MANA_THRESHOLD   = 81.0f;

static bool IsWarlockMetamorphosisActive(Player* bot)
{
    if (!bot)
        return false;

    return bot->GetShapeshiftForm() == FORM_METAMORPHOSIS || bot->HasAura(WARLOCK_METAMORPHOSIS);
}

// Buffs: cast on SELF if the aura is missing — ONLY during combat
static bool RunBuffs(Player* bot, const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (bot->HasAura(id))  continue;                 // already have it

        // Warlock Metamorphosis: only pop Meta when mana >= 81%
        if (id == WARLOCK_METAMORPHOSIS)
        {
            if (IsWarlockMetamorphosisActive(bot))
                continue;

            if (bot->GetPower(POWER_MANA) * 100 / std::max(bot->GetMaxPower(POWER_MANA), 1u) < META_MANA_THRESHOLD)
                continue;
        }

        if (TryCast(bot, bot, id)) return true;
    }
    return false;
}

// Defensives: cast on SELF only when HP < threshold
static bool RunDefensives(Player* bot, const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (bot->GetHealthPct() >= DEFENSIVE_HP_PCT)
        return false; // not in danger, skip entire bucket

    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (TryCast(bot, bot, id)) return true;
    }
    return false;
}

// Abilities: target depends on role
//   healer  → lowest-HP party member below HEAL_THRESHOLD_PCT
//   others  → enemy (master's target)
static bool RunAbilities(Player* bot, Player* master, Unit* enemy,
                         BotRole role,
                         const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (role == BotRole::ROLE_MELEE_HEALER)
    {
        (void)master;

        if (!enemy) return false;
        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCast(bot, enemy, id)) return true;
        }
        return false;
    }

    if (role == BotRole::ROLE_RANGED_HEALER)
    {
        Player* healTarget = FindLowestHP(bot, master);
        if (healTarget && healTarget->GetHealthPct() <= RANGED_HEALER_HEAL_THRESHOLD_PCT)
        {
            for (uint32 id : spells)
            {
                if (id == 0) continue;
                if (TryCast(bot, healTarget, id)) return true;
            }
            return false;
        }

        if (!enemy) return false;
        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCast(bot, enemy, id)) return true;
        }
        return false;
    }

    if (role == BotRole::ROLE_HEALER)
    {
        Player* healTarget = FindLowestHP(bot, master);
        if (!healTarget || healTarget->GetHealthPct() >= HEAL_THRESHOLD_PCT)
            return false; // nobody needs healing

        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCast(bot, healTarget, id)) return true;
        }
        return false;
    }

    // DPS / Tank: cast on enemy
    if (!enemy) return false;
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (TryCast(bot, enemy, id)) return true;
    }
    return false;
}

// DoTs: cast on ENEMY if the aura is missing on the target
static bool RunDots(Player* bot, Unit* enemy,
                    const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (!enemy) return false;
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (enemy->HasAura(id))  continue;               // already ticking
        if (TryCast(bot, enemy, id)) return true;
    }
    return false;
}

// HoTs: cast on lowest-HP ally if the aura is missing
static bool RunHots(Player* bot, Player* master,
                    BotRole role,
                    const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    Player* target = FindLowestHP(bot, master);
    if (!target) return false;

    if (role == BotRole::ROLE_MELEE_HEALER)
    {
        bool needHeal = target->GetHealthPct() <= MELEE_HEALER_HEAL_THRESHOLD_PCT;
        bool hasHealMana = GetManaPct(bot) >= MELEE_HEALER_MIN_MANA_PCT;
        if (!needHeal || !hasHealMana)
            return false;

        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCast(bot, target, id)) return true;
        }
        return false;
    }

    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (target->HasAura(id))  continue;              // already ticking
        if (TryCast(bot, target, id)) return true;
    }
    return false;
}

// Mobility: cast on SELF if we're out of preferred range of the enemy
static bool RunMobility(Player* bot, Unit* enemy, float preferredRange,
                        const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (!enemy) return false;
    // Only trigger if we're significantly farther than preferred range
    float dist = Dist2D(bot, enemy);
    if (dist <= preferredRange + 5.f) return false; // close enough

    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (TryCast(bot, bot, id)) return true;
    }
    return false;
}

// ─── Meta: Trinkets + Racials ──────────────────────────────────────────────────
// Fires on-use trinkets and offensive racial cooldowns.
// Runs BEFORE the rotation waterfall — these are "free" throughput boosts.
static bool RunMeta(Player* bot, Unit* enemy)
{
    // ── On-Use Trinkets ────────────────────────────────────────────────────
    for (uint8 slot : { EQUIPMENT_SLOT_TRINKET1, EQUIPMENT_SLOT_TRINKET2 })
    {
        Item* trinket = bot->GetItemByPos(INVENTORY_SLOT_BAG_0, slot);
        if (!trinket) continue;

        ItemTemplate const* proto = trinket->GetTemplate();
        for (uint8 i = 0; i < MAX_ITEM_PROTO_SPELLS; ++i)
        {
            if (proto->Spells[i].SpellId <= 0) continue;
            if (proto->Spells[i].SpellTrigger != ITEM_SPELLTRIGGER_ON_USE) continue;

            uint32 spellId = proto->Spells[i].SpellId;
            if (bot->HasSpellCooldown(spellId)) continue;

            SpellInfo const* info = sSpellMgr->GetSpellInfo(spellId);
            if (!info) continue;

            // Skip CC-break trinkets (PvP trinket, etc.) — they're useless if not CC'd
            bool isCCBreak = false;
            for (uint8 e = 0; e < MAX_SPELL_EFFECTS; ++e)
            {
                if (info->Effects[e].Effect == SPELL_EFFECT_DISPEL_MECHANIC ||
                    info->Effects[e].ApplyAuraName == SPELL_AURA_MECHANIC_IMMUNITY)
                {
                    isCCBreak = true;
                    break;
                }
            }
            if (isCCBreak) continue;

            // Positive = self-buff, negative = damage → target enemy
            Unit* target = info->IsPositive() ? bot : (enemy ? enemy : bot);
            if (bot->CastSpell(target, spellId, false) == SPELL_CAST_OK)
                return true;
        }
    }

    // ── Offensive Racials ──────────────────────────────────────────────────
    for (uint32 racialId : OFFENSIVE_RACIALS)
    {
        if (!bot->HasSpell(racialId)) continue;
        if (bot->HasSpellCooldown(racialId)) continue;

        SpellInfo const* info = sSpellMgr->GetSpellInfo(racialId);
        if (!info) continue;

        Unit* target = info->IsPositive() ? bot : (enemy ? enemy : bot);
        if (bot->CastSpell(target, racialId, false) == SPELL_CAST_OK)
            return true;
    }

    return false;
}

// ─── Spell Queue Scanner ───────────────────────────────────────────────────────
// Scans the waterfall WITHOUT casting.  Returns the first eligible (spell, target)
// pair that would fire if the bot were free to cast right now.

static bool ScanWaterfall(Player* bot, Player* master, Unit* enemy,
                          const SpecRotation* rot,
                          uint32& outSpellId, ObjectGuid& outTargetGuid)
{
    // 1. Buffs
    for (uint32 id : rot->buffs)
    {
        if (id == 0) continue;
        if (bot->HasAura(id)) continue;
        if (id == WARLOCK_METAMORPHOSIS)
        {
            if (IsWarlockMetamorphosisActive(bot))
                continue;

            if (bot->GetPower(POWER_MANA) * 100 / std::max(bot->GetMaxPower(POWER_MANA), 1u) < META_MANA_THRESHOLD)
                continue;
        }
        if (CanCast(bot, bot, id))
        {
            outSpellId = id;
            outTargetGuid = bot->GetGUID();
            return true;
        }
    }

    // 2. Defensives
    if (bot->GetHealthPct() < DEFENSIVE_HP_PCT)
    {
        for (uint32 id : rot->defensives)
        {
            if (id == 0) continue;
            if (CanCast(bot, bot, id))
            {
                outSpellId = id;
                outTargetGuid = bot->GetGUID();
                return true;
            }
        }
    }

    // 3. DoTs
    if (enemy)
    {
        for (uint32 id : rot->dots)
        {
            if (id == 0) continue;
            if (enemy->HasAura(id)) continue;
            if (CanCast(bot, enemy, id))
            {
                outSpellId = id;
                outTargetGuid = enemy->GetGUID();
                return true;
            }
        }
    }

    // 4. HoTs
    {
        Player* hotTarget = FindLowestHP(bot, master);
        if (hotTarget)
        {
            for (uint32 id : rot->hots)
            {
                if (id == 0) continue;
                if (rot->role == BotRole::ROLE_MELEE_HEALER)
                {
                    bool needHeal = hotTarget->GetHealthPct() <= MELEE_HEALER_HEAL_THRESHOLD_PCT;
                    bool hasHealMana = GetManaPct(bot) >= MELEE_HEALER_MIN_MANA_PCT;
                    if (!needHeal || !hasHealMana)
                        continue;
                }
                else if (hotTarget->HasAura(id))
                    continue;

                if (CanCast(bot, hotTarget, id))
                {
                    outSpellId = id;
                    outTargetGuid = hotTarget->GetGUID();
                    return true;
                }
            }
        }
    }

    // 5. Abilities
    if (rot->role == BotRole::ROLE_HEALER)
    {
        Player* healTarget = FindLowestHP(bot, master);
        if (healTarget && healTarget->GetHealthPct() < HEAL_THRESHOLD_PCT)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCast(bot, healTarget, id))
                {
                    outSpellId = id;
                    outTargetGuid = healTarget->GetGUID();
                    return true;
                }
            }
        }
    }
    else if (rot->role == BotRole::ROLE_RANGED_HEALER)
    {
        Player* healTarget = FindLowestHP(bot, master);
        if (healTarget && healTarget->GetHealthPct() <= RANGED_HEALER_HEAL_THRESHOLD_PCT)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCast(bot, healTarget, id))
                {
                    outSpellId = id;
                    outTargetGuid = healTarget->GetGUID();
                    return true;
                }
            }
            return false;
        }

        if (enemy)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCast(bot, enemy, id))
                {
                    outSpellId = id;
                    outTargetGuid = enemy->GetGUID();
                    return true;
                }
            }
        }
    }
    else if (rot->role == BotRole::ROLE_MELEE_HEALER)
    {
        if (enemy)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCast(bot, enemy, id))
                {
                    outSpellId = id;
                    outTargetGuid = enemy->GetGUID();
                    return true;
                }
            }
        }
    }
    else if (enemy)
    {
        for (uint32 id : rot->abilities)
        {
            if (id == 0) continue;
            if (CanCast(bot, enemy, id))
            {
                outSpellId = id;
                outTargetGuid = enemy->GetGUID();
                return true;
            }
        }
    }

    // 6. Mobility
    if (enemy)
    {
        float dist = Dist2D(bot, enemy);
        if (dist > rot->preferredRange + 5.f)
        {
            for (uint32 id : rot->mobility)
            {
                if (id == 0) continue;
                if (CanCast(bot, bot, id))
                {
                    outSpellId = id;
                    outTargetGuid = bot->GetGUID();
                    return true;
                }
            }
        }
    }

    return false;
}

// ─── The Waterfall ─────────────────────────────────────────────────────────────
// One cast per tick.  Never interrupts a cast or channel.
// While casting: scans the waterfall dry and queues the next spell.
// When free: consumes the queue first, then falls through to normal waterfall.

static void RunWaterfall(Player* bot, Player* master, Unit* enemy,
                         const SpecRotation* rot, BotInfo& info)
{
    EnsureRangedFacing(bot, enemy, rot->role);

    if (TryMaintainHunterAutoShot(bot, enemy))
        return;

    // ── Currently casting or channeling — queue next spell, don't interrupt ──
    if (bot->HasUnitState(UNIT_STATE_CASTING))
    {
        // Only queue if nothing is queued yet — avoid overwriting mid-cast
        if (info.queuedSpellId == 0)
        {
            uint32 qSpell = 0;
            ObjectGuid qTarget;
            if (ScanWaterfall(bot, master, enemy, rot, qSpell, qTarget))
            {
                info.queuedSpellId    = qSpell;
                info.queuedTargetGuid = qTarget;
            }
        }
        return;
    }

    // ── Free to cast — try queued spell first ──────────────────────────────
    if (info.queuedSpellId != 0)
    {
        uint32 qSpell = info.queuedSpellId;
        ObjectGuid qTarget = info.queuedTargetGuid;
        info.queuedSpellId = 0;
        info.queuedTargetGuid = ObjectGuid::Empty;

        Unit* target = ObjectAccessor::GetUnit(*bot, qTarget);
        if (target && target->IsAlive() && target->IsInWorld())
        {
            if (TryCast(bot, target, qSpell))
                return;
        }
        // Queue expired or invalid — fall through to normal waterfall
    }

    // ── Normal waterfall ───────────────────────────────────────────────────

    // 0. Meta — "Pop trinkets & racials"
    if (RunMeta(bot, enemy))
        return;

    // 1. Buffs — "Is my tax paid?"
    if (RunBuffs(bot, rot->buffs))
        return;

    // 2. Defensives — "Am I dying?"
    if (RunDefensives(bot, rot->defensives))
        return;

    // 3. DoTs — "Are my DoTs ticking?"
    if (RunDots(bot, enemy, rot->dots))
        return;

    // 4. HoTs — "Are my HoTs rolling?"
    if (RunHots(bot, master, rot->role, rot->hots))
        return;

    // 5. Abilities — "What do I press?"
    if (RunAbilities(bot, master, enemy, rot->role, rot->abilities))
        return;

    // 6. Mobility — "Can I get in range?"
    RunMobility(bot, enemy, rot->preferredRange, rot->mobility);
}

// ─── Arrow Formation ───────────────────────────────────────────────────────────
// Out-of-combat formation: an arrowhead behind the master.
//   Row 0 (tip): Tank(s) — directly behind master
//   Row 1 (middle): Master/Player position (implicit, not placed)
//   Row 2 (wings): Ranged DPS / Healers spread on left and right wings
// Melee DPS sit between the tank tip and the ranged wings.
//
// Positions are relative to the master's orientation (facing direction).
// "Behind" = opposite of where the master faces.

static void ArrangeArrowFormation(Player* master, std::vector<BotInfo>& bots)
{
    if (bots.empty()) return;

    float masterX = master->GetPositionX();
    float masterY = master->GetPositionY();
    float masterZ = master->GetPositionZ();
    float facing  = master->GetOrientation();

    // "Behind" direction = facing + PI
    float behind = facing + float(M_PI);

    // Sort bots into role buckets
    std::vector<BotInfo*> tanks, melee, ranged, healers;
    for (auto& info : bots)
    {
        if (!info.player || !info.player->IsAlive() || !info.player->IsInWorld())
            continue;
        if (info.player->GetMapId() != master->GetMapId())
            continue;

        switch (info.role)
        {
            case BotRole::ROLE_TANK:       tanks.push_back(&info);   break;
            case BotRole::ROLE_MELEE_DPS:  melee.push_back(&info);   break;
            case BotRole::ROLE_RANGED_DPS: ranged.push_back(&info);  break;
            case BotRole::ROLE_HEALER:     healers.push_back(&info);  break;
            case BotRole::ROLE_MELEE_HEALER: melee.push_back(&info); break;
            case BotRole::ROLE_RANGED_HEALER: healers.push_back(&info); break;
        }
    }

    // Combine ranged + healers for the back wings
    std::vector<BotInfo*> wings;
    wings.insert(wings.end(), ranged.begin(), ranged.end());
    wings.insert(wings.end(), healers.begin(), healers.end());

    // Row distances behind master
    float tankDist  = 3.0f;   // tanks close behind master (tip of arrow)
    float meleeDist = 5.0f;   // melee behind tanks
    float wingDist  = 7.0f;   // ranged/healers at the back wings
    float spread    = 0.35f;  // radians between bots in same row (~20 degrees)

    auto placeRow = [&](std::vector<BotInfo*>& row, float dist)
    {
        int n = (int)row.size();
        if (n == 0) return;
        float startAngle = behind - (float(n - 1) * spread * 0.5f);
        for (int i = 0; i < n; ++i)
        {
            float angle = startAngle + float(i) * spread;
            float x = masterX + dist * std::cos(angle);
            float y = masterY + dist * std::sin(angle);

            Player* bot = row[i]->player;

            // Only reposition if significantly out of place (> 3 yards from slot)
            float dx = bot->GetPositionX() - x;
            float dy = bot->GetPositionY() - y;
            float slotDist = std::sqrt(dx * dx + dy * dy);
            if (slotDist > 3.0f)
            {
                row[i]->isFollowing = false;
                bot->GetMotionMaster()->Clear();
                bot->GetMotionMaster()->MovePoint(0, x, y, masterZ);
            }
        }
    };

    placeRow(tanks, tankDist);
    placeRow(melee, meleeDist);
    placeRow(wings, wingDist);
}

// ─── Per-Bot Update ────────────────────────────────────────────────────────────

static void UpdateBotAI(BotInfo& info, Player* master)
{
    Player* bot = info.player;
    if (!bot || !bot->IsInWorld() || !bot->IsAlive()) return;
    if (!master || !master->IsInWorld()) return;

    const SpecRotation* rot = sRotationEngine.GetRotation(
        bot->getClass(), info.specIndex);

    // ── Resolve enemy target ───────────────────────────────────────────────
    Unit* enemy = master->GetVictim();
    if (!enemy) enemy = master->GetSelectedUnit();

    bool masterInCombat = master->IsInCombat();

    // ── Combat ─────────────────────────────────────────────────────────────
    if (masterInCombat && enemy && enemy->IsAlive() &&
        enemy->IsInWorld() && !enemy->IsPlayer())
    {
        if (!info.isInCombat || bot->GetVictim() != enemy)
        {
            info.isInCombat  = true;
            info.isFollowing = false;

            bool isMelee = IsMeleeRole(info.role);
            bot->Attack(enemy, isMelee);

            // Melee: chase into melee range; Ranged: stay at 25 yards
            float chase;
            if (isMelee)
                chase = COMBAT_CHASE_MELEE;
            else
                chase = COMBAT_CHASE_RANGED;

            // Override with rotation's preferred range if set
            if (rot && rot->preferredRange > 0)
                chase = rot->preferredRange;

            bot->GetMotionMaster()->Clear();
            bot->GetMotionMaster()->MoveChase(enemy, chase);
        }

        // Run the waterfall
        if (rot)
            RunWaterfall(bot, master, enemy, rot, info);

        return;
    }

    // ── Out of combat ──────────────────────────────────────────────────────
    // Don't cast buffs out of combat — saves cooldowns for actual fights

    // ── Leave-combat transition ────────────────────────────────────────────
    if (info.isInCombat)
    {
        info.isInCombat = false;
        bot->AttackStop();
        bot->GetMotionMaster()->Clear();
    }

    // ── Teleport if too far ────────────────────────────────────────────────
    float dist = Dist2D(bot, master);

    if (dist > MAX_FOLLOW_DISTANCE || bot->GetMapId() != master->GetMapId())
    {
        TeleportToMaster(bot, master);
        info.isFollowing = false;
    }

    // Formation positioning is handled per-group in the world script tick
}

// ─── World Script: tick loop ───────────────────────────────────────────────────
class BotAIWorldScript : public WorldScript
{
public:
    BotAIWorldScript() : WorldScript("BotAIWorldScript") {}

    void OnUpdate(uint32 diff) override
    {
        _timer += diff;
        if (_timer < AI_UPDATE_INTERVAL_MS) return;
        _timer = 0;

        auto& all = sBotMgr.GetAll();
        if (all.empty()) return;

        for (auto& [masterLow, bots] : all)
        {
            ObjectGuid mg = ObjectGuid::Create<HighGuid::Player>(masterLow);
            Player* master = ObjectAccessor::FindPlayer(mg);
            if (!master || !master->IsInWorld()) continue;

            // Per-bot AI updates (combat rotation, targeting)
            for (auto& info : bots)
                UpdateBotAI(info, master);

            // Out-of-combat: arrange arrow formation
            if (!master->IsInCombat())
                ArrangeArrowFormation(master, bots);
        }
    }

private:
    uint32 _timer = 0;
};

void AddBotAI()
{
    new BotAIWorldScript();
}
