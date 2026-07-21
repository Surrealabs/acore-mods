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
#include "Creature.h"
#include "ObjectAccessor.h"
#include "MotionMaster.h"
#include "Map.h"
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
// Kept well below the real global cooldown (1.5s) so a bot casts on the
// very next tick after its GCD actually clears, instead of waiting for an
// extra ~1s polling slot. At 1000ms, a bot whose GCD ends at t=1.5s only
// gets checked again at t=2.0s, i.e. its true cast cadence was ~2s, not the
// ~1s the rest of the cooldown/category math assumes - this is what made a
// 4-second shared category cooldown look more like ~6-8s in practice ("2
// flip-flopping abilities" bug report).
static constexpr uint32 AI_UPDATE_INTERVAL_MS = 250;
static constexpr float  MAX_FOLLOW_DISTANCE   = 40.0f;
static constexpr float  COMBAT_CHASE_MELEE    = 0.5f;
static constexpr float  COMBAT_CHASE_RANGED   = 25.0f;
static constexpr float  HEAL_THRESHOLD_PCT    = 90.0f;
static constexpr float  RANGED_HEALER_HEAL_THRESHOLD_PCT = 80.0f;
static constexpr float  MELEE_HEALER_HEAL_THRESHOLD_PCT  = 80.0f;
static constexpr float  MELEE_HEALER_MIN_MANA_PCT        = 20.0f;
static constexpr float  DEFENSIVE_HP_PCT      = 35.0f;
static constexpr uint32 HUNTER_AUTO_SHOT      = 75;

// Bots have no mount and would otherwise creep further and further behind
// the master on every step; pets get an implicit speed match, so give bots
// the same treatment with a flat +45% run/walk/swim speed bonus.
static constexpr float  BOT_SPEED_RATE        = 1.45f;

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
           role == BotRole::ROLE_MELEE_HEALER ||
           role == BotRole::ROLE_MELEE_DOT;
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

// Keep the bot's movement speed matched to the master (like a pet) so it
// never gradually falls behind on foot. Cheap to call every tick: Unit::SetSpeed
// no-ops when the rate hasn't changed.
static void ApplyBotSpeedBonus(Player* bot)
{
    if (!bot) return;
    bot->SetSpeed(MOVE_RUN,  BOT_SPEED_RATE);
    bot->SetSpeed(MOVE_WALK, BOT_SPEED_RATE);
    bot->SetSpeed(MOVE_SWIM, BOT_SPEED_RATE);
}

static void TeleportToMaster(Player* bot, Player* master)
{
    float ang = frand(0.f, 2.f * float(M_PI));
    float d   = frand(2.f, 4.f);
    float x = master->GetPositionX() + d * std::cos(ang);
    float y = master->GetPositionY() + d * std::sin(ang);
    float z = master->GetPositionZ();
    float o = master->GetOrientation();

    if (bot->GetMapId() == master->GetMapId())
    {
        bot->NearTeleportTo(x, y, z, o);
        return;
    }

    // Cross-map (e.g. the master used a Mage portal/teleport spell): a normal
    // Player::TeleportTo() defers the actual map switch until the client
    // sends back MSG_MOVE_WORLDPORT_ACK. Bots are socketless and can never
    // send that ack, so the bot would just be removed from the old map and
    // never placed on the new one — it vanishes instead of catching up.
    // Move it manually instead, the same way ArmyOfAlts places a
    // freshly-spawned bot onto the master's map.
    Map* destMap = master->GetMap();
    if (!destMap)
        return;

    if (bot->IsInWorld())
        bot->RemoveFromWorld();
    if (Map* oldMap = bot->FindMap())
        oldMap->RemovePlayerFromMap(bot, false);

    bot->Relocate(x, y, z, o);
    bot->SetMapId(master->GetMapId());
    bot->ResetMap();
    bot->SetMap(destMap);
    bot->UpdatePositionData();

    bot->SendInitialPacketsBeforeAddToMap();
    if (!destMap->AddPlayerToMap(bot))
    {
        LOG_ERROR("module", "RPGBots: Failed to relocate bot {} to master's map", bot->GetName());
        return;
    }
    bot->SendInitialPacketsAfterAddToMap();
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

// ─── Category-cooldown check ──────────────────────────────────────────────────
// Player::GetSpellCooldownMap() is NOT reliable for this: core's own
// Player::AddSpellAndCategoryCooldowns() stamps the CAST spell's own map
// entry with category=0 (hardcoded), and only back-fills a proper
// `category` field on OTHER spells in `sSpellsByCategoryStore` that share
// the exact same SpellFamilyName as the cast spell. Custom/cross-family
// rotational spells (the norm for these mod-*-expanded modules) never get
// that sibling entry populated, so scanning the core cooldown map for a
// matching `category` silently found nothing and every "locked out" spell
// kept getting cast anyway. Track category lockouts ourselves instead,
// independent of core's family-gated bookkeeping: TryCast() below records
// an expiry per (bot, category) on every successful cast; this just reads
// it back.
static std::unordered_map<ObjectGuid, std::unordered_map<uint32, uint32>> g_categoryCooldowns;

static bool HasCategoryCooldown(Player* bot, uint32 spellId)
{
    SpellInfo const* info = sSpellMgr->GetSpellInfo(spellId);
    if (!info || info->GetCategory() == 0)
        return false;

    auto botIt = g_categoryCooldowns.find(bot->GetGUID());
    if (botIt == g_categoryCooldowns.end())
        return false;

    auto catIt = botIt->second.find(info->GetCategory());
    if (catIt == botIt->second.end())
        return false;

    return catIt->second > getMSTime();
}

// Records the category-cooldown expiry for a spell that was just cast, so
// later HasCategoryCooldown() checks correctly lock out every OTHER spell
// sharing that category, regardless of SpellFamilyName.
static void RecordCategoryCooldown(Player* bot, SpellInfo const* info)
{
    if (!info || info->GetCategory() == 0 || info->CategoryRecoveryTime == 0)
        return;

    g_categoryCooldowns[bot->GetGUID()][info->GetCategory()] = getMSTime() + info->CategoryRecoveryTime;
}

// ─── Spell eligibility check (no cast — dry run) ──────────────────────────────
// Returns true if the spell COULD be cast right now (has spell, not on CD, etc.)

// TEMPORARY diagnostic: logs exactly why 900064/900065/900066 (the
// Elementalist's 3 shared-category nukes) fail CanCast/CastSpell, since the
// bot keeps skipping them no matter how rotation_sequence is tuned. Remove
// once root-caused.
static bool IsDiagSpell(uint32 spellId)
{
    return spellId == 900064 || spellId == 900065 || spellId == 900066;
}

static bool CanCast(Player* bot, Unit* target, uint32 spellId)
{
    if (spellId == 0)          return false;
    if (!target)               return false;
    if (!bot->HasSpell(spellId))
    {
        if (IsDiagSpell(spellId))
            LOG_ERROR("module", "RPGBOTS-DIAG bot {} CanCast({}) fail: bot doesn't know the spell", bot->GetName(), spellId);
        return false;
    }
    if (bot->HasSpellCooldown(spellId))
    {
        if (IsDiagSpell(spellId))
            LOG_ERROR("module", "RPGBOTS-DIAG bot {} CanCast({}) fail: HasSpellCooldown", bot->GetName(), spellId);
        return false;
    }
    if (HasCategoryCooldown(bot, spellId))
    {
        if (IsDiagSpell(spellId))
            LOG_ERROR("module", "RPGBOTS-DIAG bot {} CanCast({}) fail: HasCategoryCooldown", bot->GetName(), spellId);
        return false;
    }

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

    SpellCastResult result = bot->CastSpell(target, spellId, false);
    if (result != SPELL_CAST_OK)
    {
        if (IsDiagSpell(spellId))
            LOG_ERROR("module", "RPGBOTS-DIAG bot {} CastSpell({}) on target {} failed: result={}",
                      bot->GetName(), spellId, target ? target->GetName() : "null", uint32(result));
        return false;
    }

    if (IsDiagSpell(spellId))
        LOG_ERROR("module", "RPGBOTS-DIAG bot {} CastSpell({}) on target {} SUCCEEDED",
                  bot->GetName(), spellId, target ? target->GetName() : "null");

    RecordCategoryCooldown(bot, sSpellMgr->GetSpellInfo(spellId));
    return true;
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
// Defensives: cast on SELF only when HP < threshold
static bool RunDefensives(Player* bot, const std::array<uint32, DEFENSIVE_SLOTS>& spells)
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

// Mage Pyroblast (all ranks) should only be hard-cast when BOTH Hot Streak
// (48108, mod-mage-expanded) AND Combustion (11129) are up — otherwise
// it's a slow, expensive cast bots have no business spamming; skip it and
// fall through to the next ability in the list (e.g. Fireball) until both
// conditions are met.
static constexpr uint32 MAGE_PYROBLAST_BASE   = 11366;
static constexpr uint32 MAGE_HOT_STREAK_BUFF  = 48108;
static constexpr uint32 MAGE_COMBUSTION_BUFF  = 11129;

static bool ShouldSkipAbility(Player* bot, uint32 id)
{
    if (!bot || bot->getClass() != CLASS_MAGE)
        return false;

    if (sSpellMgr->GetFirstSpellInChain(id) != MAGE_PYROBLAST_BASE)
        return false;

    return !bot->HasAura(MAGE_HOT_STREAK_BUFF) || !bot->HasAura(MAGE_COMBUSTION_BUFF);
}

// Filler: a single instant "weave" spell that can be cast WITHOUT
// interrupting the bot's current cast (e.g. Fire Blast while casting
// Fireball). Checked every tick regardless of casting state, and again as
// the final fallback if nothing else in the waterfall fired — see
// RunWaterfall below.
static bool RunFiller(Player* bot, Unit* enemy, uint32 spellId)
{
    if (spellId == 0 || !enemy)
        return false;

    return TryCast(bot, enemy, spellId);
}

// Interrupt: only ever cast on the enemy WHILE it's actively casting a
// generic or channeled spell. Deliberately does not attempt to reason
// about which spells are actually interruptible (uninterruptible casts,
// silence immunity, etc.) - SPELL_EFFECT_INTERRUPT_CAST already no-ops
// safely server-side if the target can't be interrupted, so this stays
// simple and just avoids wasting the attempt entirely idle.
static bool RunInterrupt(Player* bot, Unit* enemy, uint32 spellId)
{
    if (spellId == 0 || !enemy)
        return false;

    bool isCasting = enemy->GetCurrentSpell(CURRENT_GENERIC_SPELL) != nullptr ||
                     enemy->GetCurrentSpell(CURRENT_CHANNELED_SPELL) != nullptr;
    if (!isCasting)
        return false;

    return TryCast(bot, enemy, spellId);
}

// Damage cooldown / party buff: both are self-cast, timed cast-then-active
// cooldowns (Recklessness/Combustion-style, or Heroism/Power Infusion-style)
// - not passive stat auras (those need no bot involvement at all) - so both
// just fire as soon as they're off cooldown while the bot is fighting.
static bool RunDamageCooldown(Player* bot, Unit* enemy, uint32 spellId)
{
    if (spellId == 0 || !enemy)
        return false;
    return TryCast(bot, bot, spellId);
}

static bool RunPartyBuff(Player* bot, Unit* enemy, uint32 spellId)
{
    if (spellId == 0 || !enemy)
        return false;
    return TryCast(bot, bot, spellId);
}

// ─── Tank/DPS slot targeting rule ──────────────────────────────────────────────
// Self-buffs (WARLOCK_METAMORPHOSIS special-cased, otherwise plain
// SpellInfo::IsPositive() spells) auto-target self and skip once already
// up; everything else targets the enemy. `doCast(target, id)` performs the
// actual action (a real TryCast for RunRotation, a CanCast dry-run + queue
// write for ScanWaterfall) and reports whether the slot was used, so this
// same eligibility/targeting logic can drive both the real cast path and
// the dry-run scan path without duplicating it.
template <typename CastFn>
static bool TryTankDpsSlot(Player* bot, Unit* enemy, uint32 id, CastFn&& doCast)
{
    if (id == 0 || ShouldSkipAbility(bot, id))
        return false;

    bool isSelfTargeted = (id == WARLOCK_METAMORPHOSIS);
    SpellInfo const* info = sSpellMgr->GetSpellInfo(id);
    if (info && info->IsPositive())
        isSelfTargeted = true;

    // Caster-centered AoE effects (e.g. a nova/explosion that damages
    // everyone around the caster, like 900065 "Pneumatic Rupture") are
    // still NEGATIVE (IsPositive() correctly false - they deal damage), but
    // their primary effect's implicit target is the caster, not an
    // explicit enemy Unit. Passing `enemy` as the explicit CastSpell target
    // for one of these gets rejected (bad target) every time since the
    // spell never asked for an explicit unit target at all - route these
    // to self exactly like a self-buff instead.
    if (info && !isSelfTargeted)
    {
        Targets primaryTarget = info->Effects[EFFECT_0].TargetA.GetTarget();
        if (primaryTarget == TARGET_UNIT_CASTER || primaryTarget == TARGET_DEST_CASTER)
            isSelfTargeted = true;
    }

    if (IsDiagSpell(id))
        LOG_ERROR("module", "RPGBOTS-DIAG bot {} slot {} known={} isSelfTargeted={} isPositive={} enemy={}",
                  bot->GetName(), id, bot->HasSpell(id), isSelfTargeted, info && info->IsPositive(), enemy ? enemy->GetName() : "null");

    if (isSelfTargeted)
    {
        if (id == WARLOCK_METAMORPHOSIS)
        {
            if (IsWarlockMetamorphosisActive(bot)) return false;
            if (bot->GetPower(POWER_MANA) * 100 / std::max(bot->GetMaxPower(POWER_MANA), 1u) < META_MANA_THRESHOLD)
                return false;
        }
        else if (bot->HasAura(id))
            return false;

        return doCast(bot, id);
    }

    if (!enemy) return false;
    return doCast(enemy, id);
}

// Selects which tank/dps ability to use this tick via `doCast`. If the spec
// has a `rotation_sequence` configured (rot->sequenceSteps non-empty), ONLY
// the current step (info.sequenceIndex) is attempted - no scanning ahead to
// other steps. If that step isn't castable right now, this simply returns
// false and lets RunWaterfall's normal Filler fallback (5b) pick up the
// slack that tick; the cursor does NOT advance, so the same step is retried
// next tick until it's actually available. This is deliberately "dumb":
// scanning ahead (trying every step in the sequence for a same-tick match)
// let cheap/always-up steps (e.g. a real Frost Shock) repeatedly jump the
// queue ahead of a same-category nuke waiting its turn, which defeated the
// whole point of an explicit sequence - see the bug report where 900065
// never got a turn despite being in the string, because 900064/900066/
// filler kept "winning" the scan every tick instead of the sequence just
// stalling on 900065 and falling back to filler like it should have.
// Falls back to a plain top-to-bottom scan of `rot->rotation` when no
// sequence is configured (unchanged legacy behavior for every other spec).
template <typename CastFn>
static bool RunTankDpsSlots(const SpecRotation* rot, BotInfo& info, CastFn&& doCast)
{
    if (!rot->sequenceSteps.empty())
    {
        uint8 count = uint8(rot->sequenceSteps.size());
        uint8 idx   = info.sequenceIndex % count;
        uint8 step  = rot->sequenceSteps[idx];
        uint32 id   = (step == SEQUENCE_FILLER_STEP) ? rot->filler : rot->rotation[step];

        if (doCast(id))
        {
            info.sequenceIndex = uint8((idx + 1) % count);
            return true;
        }
        return false;
    }

    for (uint32 id : rot->rotation)
        if (doCast(id))
            return true;
    return false;
}

// Rotation: the 5 real rotational abilities. Role decides how they behave:
//   healer roles (HEALER/RANGED_HEALER/MELEE_HEALER) — target the lowest-HP
//     ally (once below that role's own heal threshold); skip a slot if the
//     ally already has that aura (harmless no-op for plain instant heals,
//     correctly avoids re-stacking/overwriting HoTs).
//   dot roles (RANGED_DOT/MELEE_DOT) — target the enemy; skip a slot if the
//     enemy already has that aura (DoT refresh semantics).
//   tank/dps roles — priority list on the enemy (top-to-bottom, or the
//     spec's rotation_sequence order if configured — see RunTankDpsSlots),
//     EXCEPT any slot that's actually a self-buff (SpellInfo::IsPositive())
//     auto-targets self instead and is skipped once already up - this is
//     how self-buffs (e.g. Warlock Metamorphosis) fold into the same 5
//     slots instead of needing a dedicated bucket.
static bool RunRotation(Player* bot, Player* master, Unit* enemy,
                        const SpecRotation* rot, BotInfo& info)
{
    BotRole role = rot->role;
    const std::array<uint32, ROTATION_SLOTS>& spells = rot->rotation;

    if (role == BotRole::ROLE_HEALER || role == BotRole::ROLE_RANGED_HEALER || role == BotRole::ROLE_MELEE_HEALER)
    {
        Player* healTarget = FindLowestHP(bot, master);
        if (!healTarget)
            return false;

        float threshold = HEAL_THRESHOLD_PCT;
        if (role == BotRole::ROLE_RANGED_HEALER) threshold = RANGED_HEALER_HEAL_THRESHOLD_PCT;
        if (role == BotRole::ROLE_MELEE_HEALER)  threshold = MELEE_HEALER_HEAL_THRESHOLD_PCT;

        if (healTarget->GetHealthPct() >= threshold)
            return false; // nobody needs healing

        if (role == BotRole::ROLE_MELEE_HEALER && GetManaPct(bot) < MELEE_HEALER_MIN_MANA_PCT)
            return false;

        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (ShouldSkipAbility(bot, id)) continue;
            if (healTarget->HasAura(id)) continue; // already ticking/applied
            if (TryCast(bot, healTarget, id)) return true;
        }
        return false;
    }

    if (role == BotRole::ROLE_RANGED_DOT || role == BotRole::ROLE_MELEE_DOT)
    {
        if (!enemy) return false;
        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (enemy->HasAura(id)) continue; // already ticking
            if (TryCast(bot, enemy, id)) return true;
        }
        return false;
    }

    // Tank / melee DPS / ranged DPS.
    return RunTankDpsSlots(rot, info, [bot, enemy](uint32 id)
    {
        return TryTankDpsSlot(bot, enemy, id, [bot](Unit* target, uint32 spellId)
        {
            return TryCast(bot, target, spellId);
        });
    });
}

// Mobility: cast on SELF if we're out of preferred range of the enemy
static bool RunMobility(Player* bot, Unit* enemy, float preferredRange, uint32 spellId)
{
    if (spellId == 0 || !enemy)
        return false;
    // Only trigger if we're significantly farther than preferred range
    float dist = Dist2D(bot, enemy);
    if (dist <= preferredRange + 5.f) return false; // close enough

    return TryCast(bot, bot, spellId);
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
// pair that would fire if the bot were free to cast right now. Mirrors the
// exact bucket order in RunWaterfall below.

static bool ScanWaterfall(Player* bot, Player* master, Unit* enemy,
                          const SpecRotation* rot, BotInfo& info,
                          uint32& outSpellId, ObjectGuid& outTargetGuid)
{
    // 1. Interrupt
    if (enemy && rot->interrupt != 0)
    {
        bool isCasting = enemy->GetCurrentSpell(CURRENT_GENERIC_SPELL) != nullptr ||
                         enemy->GetCurrentSpell(CURRENT_CHANNELED_SPELL) != nullptr;
        if (isCasting && CanCast(bot, enemy, rot->interrupt))
        {
            outSpellId = rot->interrupt;
            outTargetGuid = enemy->GetGUID();
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

    // 3. Damage cooldown
    if (enemy && CanCast(bot, bot, rot->damageCooldown))
    {
        outSpellId = rot->damageCooldown;
        outTargetGuid = bot->GetGUID();
        return true;
    }

    // 4. Party buff
    if (enemy && CanCast(bot, bot, rot->partyBuff))
    {
        outSpellId = rot->partyBuff;
        outTargetGuid = bot->GetGUID();
        return true;
    }

    // 5. Rotation (role-aware)
    if (rot->role == BotRole::ROLE_HEALER || rot->role == BotRole::ROLE_RANGED_HEALER || rot->role == BotRole::ROLE_MELEE_HEALER)
    {
        Player* healTarget = FindLowestHP(bot, master);
        if (healTarget)
        {
            float threshold = HEAL_THRESHOLD_PCT;
            if (rot->role == BotRole::ROLE_RANGED_HEALER) threshold = RANGED_HEALER_HEAL_THRESHOLD_PCT;
            if (rot->role == BotRole::ROLE_MELEE_HEALER)  threshold = MELEE_HEALER_HEAL_THRESHOLD_PCT;

            bool needHeal = healTarget->GetHealthPct() < threshold;
            bool hasHealMana = rot->role != BotRole::ROLE_MELEE_HEALER || GetManaPct(bot) >= MELEE_HEALER_MIN_MANA_PCT;

            if (needHeal && hasHealMana)
            {
                for (uint32 id : rot->rotation)
                {
                    if (id == 0) continue;
                    if (ShouldSkipAbility(bot, id)) continue;
                    if (healTarget->HasAura(id)) continue;
                    if (CanCast(bot, healTarget, id))
                    {
                        outSpellId = id;
                        outTargetGuid = healTarget->GetGUID();
                        return true;
                    }
                }
            }
        }
    }
    else if (rot->role == BotRole::ROLE_RANGED_DOT || rot->role == BotRole::ROLE_MELEE_DOT)
    {
        if (enemy)
        {
            for (uint32 id : rot->rotation)
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
    }
    else
    {
        if (RunTankDpsSlots(rot, info, [bot, enemy, &outSpellId, &outTargetGuid](uint32 id)
        {
            return TryTankDpsSlot(bot, enemy, id, [bot, &outSpellId, &outTargetGuid](Unit* target, uint32 spellId)
            {
                if (!CanCast(bot, target, spellId))
                    return false;
                outSpellId = spellId;
                outTargetGuid = target->GetGUID();
                return true;
            });
        }))
        {
            return true;
        }
    }

    // 6. Mobility
    if (enemy && rot->mobility != 0)
    {
        float dist = Dist2D(bot, enemy);
        if (dist > rot->preferredRange + 5.f && CanCast(bot, bot, rot->mobility))
        {
            outSpellId = rot->mobility;
            outTargetGuid = bot->GetGUID();
            return true;
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

    // ── Currently casting or channeling — try a filler weave, else queue ───
    if (bot->HasUnitState(UNIT_STATE_CASTING))
    {
        // Instant spells like Fire Blast can be woven in without
        // interrupting the current cast — try that first every tick.
        if (RunFiller(bot, enemy, rot->filler))
            return;

        // Only queue if nothing is queued yet — avoid overwriting mid-cast
        if (info.queuedSpellId == 0)
        {
            uint32 qSpell = 0;
            ObjectGuid qTarget;
            if (ScanWaterfall(bot, master, enemy, rot, info, qSpell, qTarget))
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

    // 1. Interrupt — "Can I stop that cast?"
    if (RunInterrupt(bot, enemy, rot->interrupt))
        return;

    // 2. Defensives — "Am I dying?"
    if (RunDefensives(bot, rot->defensives))
        return;

    // 3. Damage cooldown — "Is my big offensive CD up?"
    if (RunDamageCooldown(bot, enemy, rot->damageCooldown))
        return;

    // 4. Party buff — "Is my raid CD up?"
    if (RunPartyBuff(bot, enemy, rot->partyBuff))
        return;

    // 5. Rotation — "What do I press?"
    if (RunRotation(bot, master, enemy, rot, info))
        return;

    // 5b. Filler — nothing better to do, try a weave spell anyway
    if (RunFiller(bot, enemy, rot->filler))
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
            case BotRole::ROLE_RANGED_DOT: ranged.push_back(&info); break;
            case BotRole::ROLE_MELEE_DOT:  melee.push_back(&info);  break;
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

    // Slots use MotionMaster::MoveFollow (the same continuous, pathing-aware
    // generator pets use), with the angle relative to the master's facing
    // (PI = directly behind). This tracks the master every tick on its own,
    // so we only need to (re)issue it when a bot's assigned slot actually
    // changes — not recompute+restart the movement generator every second,
    // which is what made bots look jittery/non-following at close range.
    auto placeRow = [&](std::vector<BotInfo*>& row, float dist)
    {
        int n = (int)row.size();
        if (n == 0) return;
        float startOffset = -(float(n - 1) * spread * 0.5f);
        for (int i = 0; i < n; ++i)
        {
            BotInfo* slot = row[i];
            Player* bot = slot->player;
            float relAngle = float(M_PI) + startOffset + float(i) * spread;

            bool slotChanged = !slot->isFollowing ||
                                std::fabs(slot->followDist - dist) > 0.01f ||
                                std::fabs(slot->followAngle - relAngle) > 0.01f;

            if (slotChanged)
            {
                slot->isFollowing = true;
                slot->followDist  = dist;
                slot->followAngle = relAngle;
                bot->GetMotionMaster()->Clear();
                bot->GetMotionMaster()->MoveFollow(master, dist, relAngle);
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

    // Re-applied every tick: aura recalculation (buffs/debuffs, mounting,
    // etc.) recomputes speed from scratch and would otherwise silently wipe
    // this out.
    ApplyBotSpeedBonus(bot);

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

            // ── Tap fix ─────────────────────────────────────────────────────
            // Bots are real Player objects, so whichever one lands the first
            // hit becomes the creature's loot recipient (see Unit::DealDamage).
            // That bot is virtually always on the master's map, so the normal
            // "pick a group member in range" fallback in Unit::Kill never
            // triggers — the tapper's identity sticks, and quest-conditional
            // loot / reputation get evaluated against the bot instead of the
            // master. Force the master to be the tapper up front (before any
            // bot's attack can land) so loot always resolves against the
            // master and is shared with the whole party via MASTER_LOOT.
            if (Creature* enemyCreature = enemy->ToCreature())
                if (!enemyCreature->hasLootRecipient())
                    enemyCreature->SetLootRecipient(master);

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
        info.isFollowing = false; // motion master was just wiped — force ArrangeArrowFormation to reissue MoveFollow
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

// ─── Post-Combat Resurrection ──────────────────────────────────────────────────
// Bots are socketless Player objects: they never see the "Release Spirit" /
// spirit-healer UI, so a bot that dies mid-fight would otherwise stay a
// corpse forever with no way to recover. Once the master has been alive and
// out of combat for POST_COMBAT_REVIVE_DELAY_MS (a "ready up" grace period —
// avoids reviving mid-encounter during a brief lull between waves), bring
// every fallen bot up at full health/mana and resume following, the same
// way a GM `.revive` command would.
static constexpr uint32 POST_COMBAT_REVIVE_DELAY_MS = 3000;

static void ResurrectFallenBots(Player* master, std::vector<BotInfo>& bots)
{
    if (!master || !master->IsAlive()) return;

    for (auto& info : bots)
    {
        Player* bot = info.player;
        if (!bot || !bot->IsInWorld() || bot->IsAlive()) continue;

        bot->RemoveAurasDueToSpell(27827); // Spirit of Redemption
        bot->ResurrectPlayer(1.0f);
        bot->SpawnCorpseBones();
        bot->SaveToDB(false, false);
        ApplyBotSpeedBonus(bot);

        info.isInCombat  = false;
        info.isFollowing = false;
        bot->GetMotionMaster()->Clear();
        bot->GetMotionMaster()->MoveFollow(master, 4.0f, float(M_PI));
    }
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
        uint32 elapsed = _timer;
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

            if (master->IsInCombat())
            {
                // Still fighting — reset the post-combat grace timer so a
                // fallen bot can't be revived mid-encounter.
                _outOfCombatTimers[masterLow] = 0;
                continue;
            }

            // Post-combat "ready up": only revive the fallen once the master
            // has stayed out of combat for the full grace period.
            uint32& outOfCombatFor = _outOfCombatTimers[masterLow];
            outOfCombatFor += elapsed;
            if (outOfCombatFor >= POST_COMBAT_REVIVE_DELAY_MS)
                ResurrectFallenBots(master, bots);

            ArrangeArrowFormation(master, bots);
        }
    }

private:
    uint32 _timer = 0;
    std::unordered_map<ObjectGuid::LowType, uint32> _outOfCombatTimers;
};

void AddBotAI()
{
    new BotAIWorldScript();
}
