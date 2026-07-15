// SelfBotSystem.cpp
// "Selfbot" / autoplay mode: the player's own character is controlled by the
// bot AI waterfall.  Toggle with `.rpg selfbot`.
//
// When active the system:
//   1. Detects the player's spec and loads the matching rotation
//   2. Auto-acquires a nearby hostile target if the player has none
//   3. Runs the same bucket waterfall (buffs → defensives → dots → hots → abilities → mobility)
//   4. Auto-chases melee/ranged targets at the rotation's preferred range
//   5. Stops immediately when toggled off or the player moves/casts manually
//
// Manual override: any player-initiated movement or spell cast disables selfbot
// temporarily for 3 seconds, then resumes.

#include "ScriptMgr.h"
#include "Player.h"
#include "BotAI.h"
#include "RotationEngine.h"
#include "RPGBotsConfig.h"
#include "SelfBotSystem.h"
#include "SpellAuras.h"
#include "Spell.h"
#include "SpellInfo.h"
#include "SpellMgr.h"
#include "Item.h"
#include "ItemTemplate.h"
#include "ObjectAccessor.h"
#include "Log.h"
#include "Group.h"
#include <unordered_map>
#include <unordered_set>

// ─── Warlock Constants ─────────────────────────────────────────────────────────
static constexpr uint32 WARLOCK_SOULBURN        = 17877;  // Shadowburn (costs shard)
static constexpr uint32 SOUL_SHARD_ITEM         = 6265;
static constexpr uint32 WARLOCK_METAMORPHOSIS   = 47241;
static constexpr uint32 HUNTER_AUTO_SHOT        = 75;
static constexpr float  META_MANA_THRESHOLD     = 81.0f;
static constexpr float  RANGED_HEALER_HEAL_THRESHOLD_PCT = 80.0f;
static constexpr float  MELEE_HEALER_HEAL_THRESHOLD_PCT  = 80.0f;
static constexpr float  MELEE_HEALER_MIN_MANA_PCT        = 20.0f;
// ─── Offensive racial cooldowns (WoTLK) ────────────────────────────────────────
static constexpr uint32 OFFENSIVE_RACIALS[] = {
    20572,  // Blood Fury  (Orc – Attack Power)
    33702,  // Blood Fury  (Orc – Spell Power + AP)
    26297,  // Berserking  (Troll – Haste)
    28730,  // Arcane Torrent (Blood Elf – Mana + Silence)
    25046,  // Arcane Torrent (Blood Elf – Energy + Silence)
    50613,  // Arcane Torrent (Blood Elf – Runic Power + Silence)
    20549,  // War Stomp   (Tauren – AoE Stun)
};

// ─── Selfbot state per player ──────────────────────────────────────────────────
struct SelfBotState
{
    BotRole  role          = BotRole::ROLE_MELEE_DPS;
    uint8    specIndex     = 0;
    uint32   queuedSpellId = 0;
    ObjectGuid queuedTargetGuid;
    bool     isInCombat    = false;
};

static std::unordered_map<ObjectGuid::LowType, SelfBotState> sSelfBotPlayers;

static bool IsWarlockMetamorphosisActive(Player* bot)
{
    if (!bot)
        return false;

    return bot->GetShapeshiftForm() == FORM_METAMORPHOSIS || bot->HasAura(WARLOCK_METAMORPHOSIS);
}

// ─── Public toggle helpers ─────────────────────────────────────────────────────
bool IsSelfBotActive(Player* player)
{
    return sSelfBotPlayers.count(player->GetGUID().GetCounter()) > 0;
}

void EnableSelfBot(Player* player)
{
    auto& state = sSelfBotPlayers[player->GetGUID().GetCounter()];
    state.specIndex = DetectSpecIndex(player);
    state.role      = DetectBotRole(player);
    state.isInCombat = false;
    state.queuedSpellId = 0;
    state.queuedTargetGuid = ObjectGuid::Empty;
}

void DisableSelfBot(Player* player)
{
    sSelfBotPlayers.erase(player->GetGUID().GetCounter());
}

// ─── Nearest hostile target finder ─────────────────────────────────────────────
static Unit* FindNearestHostile(Player* player, float /*range*/)
{
    // Use the threat manager: if anything is threatening us, pick it
    Unit* attacker = player->getAttackerForHelper();
    if (attacker && attacker->IsAlive() && !attacker->IsPlayer())
        return attacker;
    return nullptr;
}

// ─── Helpers (same as BotAI.cpp — duplicated to keep selfbot self-contained) ──
static bool CanCastSelf(Player* bot, Unit* target, uint32 spellId)
{
    if (spellId == 0 || !target)             return false;
    if (!bot->HasSpell(spellId))             return false;
    if (bot->HasSpellCooldown(spellId))      return false;

    // Warlock Shadowburn: require soul shard (spec can be custom)
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

static bool TryCastSelf(Player* bot, Unit* target, uint32 spellId)
{
    if (!CanCastSelf(bot, target, spellId))
        return false;
    return bot->CastSpell(target, spellId, false) == SPELL_CAST_OK;
}

static bool IsMeleeRoleSelf(BotRole role)
{
    return role == BotRole::ROLE_MELEE_DPS ||
           role == BotRole::ROLE_TANK ||
           role == BotRole::ROLE_MELEE_HEALER;
}

static void EnsureSelfRangedFacing(Player* bot, Unit* enemy, BotRole role)
{
    if (!bot || !enemy)
        return;

    if (IsMeleeRoleSelf(role))
        return;

    if (!bot->HasInArc(float(M_PI), enemy))
        bot->SetInFront(enemy);
}

static bool TryMaintainHunterAutoShotSelf(Player* bot, Unit* enemy, BotRole role)
{
    if (!bot || !enemy)
        return false;

    if (bot->getClass() != CLASS_HUNTER)
        return false;

    if (!bot->HasSpell(HUNTER_AUTO_SHOT))
        return false;

    EnsureSelfRangedFacing(bot, enemy, role);

    if (Spell* autoRepeat = bot->GetCurrentSpell(CURRENT_AUTOREPEAT_SPELL))
    {
        if (autoRepeat->m_spellInfo && autoRepeat->m_spellInfo->Id == HUNTER_AUTO_SHOT)
            return false;
    }

    return TryCastSelf(bot, enemy, HUNTER_AUTO_SHOT);
}

static float GetSelfManaPct(Player* bot)
{
    if (!bot)
        return 0.0f;

    uint32 maxMana = bot->GetMaxPower(POWER_MANA);
    if (maxMana == 0)
        return 100.0f;

    return (float(bot->GetPower(POWER_MANA)) * 100.0f) / float(maxMana);
}

// ─── Bucket runners (mirrors from BotAI.cpp) ──────────────────────────────────
static bool SelfRunBuffs(Player* bot, const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (bot->HasAura(id)) continue;

        // Warlock Metamorphosis: only pop Meta when mana >= 81%
        if (id == WARLOCK_METAMORPHOSIS)
        {
            if (IsWarlockMetamorphosisActive(bot))
                continue;

            if (bot->GetPower(POWER_MANA) * 100 / std::max(bot->GetMaxPower(POWER_MANA), 1u) < META_MANA_THRESHOLD)
                continue;
        }

        if (TryCastSelf(bot, bot, id)) return true;
    }
    return false;
}

static bool SelfRunDefensives(Player* bot, const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (bot->GetHealthPct() >= 35.0f)
        return false;
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (TryCastSelf(bot, bot, id)) return true;
    }
    return false;
}

static bool SelfRunDots(Player* bot, Unit* enemy, const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (!enemy) return false;
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (enemy->HasAura(id)) continue;
        if (TryCastSelf(bot, enemy, id)) return true;
    }
    return false;
}

static Player* FindLowestHPSelf(Player* player)
{
    Group* grp = player->GetGroup();
    if (!grp) return nullptr;

    Player* lowest = nullptr;
    float lowPct = 100.f;
    for (GroupReference* ref = grp->GetFirstMember(); ref; ref = ref->next())
    {
        Player* m = ref->GetSource();
        if (!m || !m->IsAlive() || !m->IsInWorld()) continue;
        if (m->GetMapId() != player->GetMapId()) continue;
        float pct = m->GetHealthPct();
        if (pct < lowPct) { lowPct = pct; lowest = m; }
    }
    return lowest;
}

static bool SelfRunHots(Player* bot, BotRole role, const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    Player* target = FindLowestHPSelf(bot);
    if (!target) return false;

    if (role == BotRole::ROLE_MELEE_HEALER)
    {
        bool needHeal = target->GetHealthPct() <= MELEE_HEALER_HEAL_THRESHOLD_PCT;
        bool hasHealMana = GetSelfManaPct(bot) >= MELEE_HEALER_MIN_MANA_PCT;
        if (!needHeal || !hasHealMana)
            return false;

        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCastSelf(bot, target, id)) return true;
        }
        return false;
    }

    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (target->HasAura(id)) continue;
        if (TryCastSelf(bot, target, id)) return true;
    }
    return false;
}

static bool SelfRunAbilities(Player* bot, Unit* enemy, BotRole role,
                             const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (role == BotRole::ROLE_MELEE_HEALER)
    {
        if (!enemy) return false;
        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCastSelf(bot, enemy, id)) return true;
        }
        return false;
    }

    if (role == BotRole::ROLE_RANGED_HEALER)
    {
        Player* healTarget = FindLowestHPSelf(bot);
        if (healTarget && healTarget->GetHealthPct() <= RANGED_HEALER_HEAL_THRESHOLD_PCT)
        {
            for (uint32 id : spells)
            {
                if (id == 0) continue;
                if (TryCastSelf(bot, healTarget, id)) return true;
            }
            return false;
        }

        if (!enemy) return false;
        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCastSelf(bot, enemy, id)) return true;
        }
        return false;
    }

    if (role == BotRole::ROLE_HEALER)
    {
        Player* healTarget = FindLowestHPSelf(bot);
        if (!healTarget || healTarget->GetHealthPct() >= 90.0f)
            return false;
        for (uint32 id : spells)
        {
            if (id == 0) continue;
            if (TryCastSelf(bot, healTarget, id)) return true;
        }
        return false;
    }

    if (!enemy) return false;
    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (TryCastSelf(bot, enemy, id)) return true;
    }
    return false;
}

// ─── Mobility: cast on self if out of preferred range ──────────────────────────
static bool SelfRunMobility(Player* bot, Unit* enemy, float preferredRange,
                            const std::array<uint32, SPELLS_PER_BUCKET>& spells)
{
    if (!enemy) return false;
    float dx = bot->GetPositionX() - enemy->GetPositionX();
    float dy = bot->GetPositionY() - enemy->GetPositionY();
    float dist = std::sqrt(dx * dx + dy * dy);
    if (dist <= preferredRange + 5.f) return false;

    for (uint32 id : spells)
    {
        if (id == 0) continue;
        if (TryCastSelf(bot, bot, id)) return true;
    }
    return false;
}

// ─── Meta: Trinkets + Racials ──────────────────────────────────────────────────
// Fires on-use trinkets and offensive racial cooldowns at the start of combat.
// Runs BEFORE the rotation waterfall — these are "free" throughput boosts.
static bool SelfRunMeta(Player* bot, Unit* enemy)
{
    auto IsAvoidanceOrDefensiveSpell = [](SpellInfo const* info) -> bool
    {
        if (!info)
            return true;

        for (uint8 e = 0; e < MAX_SPELL_EFFECTS; ++e)
        {
            if (!info->Effects[e].IsEffect())
                continue;

            switch (info->Effects[e].ApplyAuraName)
            {
                case SPELL_AURA_MOD_DODGE_PERCENT:
                case SPELL_AURA_MOD_PARRY_PERCENT:
                case SPELL_AURA_MOD_BLOCK_PERCENT:
                case SPELL_AURA_MOD_BLOCK_CRIT_CHANCE:
                case SPELL_AURA_DEFLECT_SPELLS:
                case SPELL_AURA_MOD_RESISTANCE_PCT:
                case SPELL_AURA_MOD_DAMAGE_PERCENT_TAKEN:
                case SPELL_AURA_MOD_TOTAL_THREAT:
                case SPELL_AURA_MOD_SCALE:
                case SPELL_AURA_DAMAGE_SHIELD:
                case SPELL_AURA_MOD_SHIELD_BLOCKVALUE:
                case SPELL_AURA_MOD_SHIELD_BLOCKVALUE_PCT:
                case SPELL_AURA_MOD_INCREASE_HEALTH_PERCENT:
                case SPELL_AURA_MOD_HEALING_PCT:
                    return true;
                case SPELL_AURA_MOD_RATING:
                {
                    int32 ratingType = info->Effects[e].MiscValue;
                    if (ratingType == CR_DODGE || ratingType == CR_PARRY ||
                        ratingType == CR_BLOCK || ratingType == CR_DEFENSE_SKILL)
                        return true;
                    break;
                }
                default:
                    break;
            }

            if (info->Effects[e].Effect == SPELL_EFFECT_APPLY_AURA)
            {
                if (!info->IsPositive())
                    continue;

                int32 base = info->Effects[e].CalcValue();
                if (base > 0 && (info->Effects[e].ApplyAuraName == SPELL_AURA_SCHOOL_ABSORB ||
                                 info->Effects[e].ApplyAuraName == SPELL_AURA_MANA_SHIELD))
                    return true;
            }
        }

        return false;
    };

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

            if (IsAvoidanceOrDefensiveSpell(info))
                continue;

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

// ─── Scan waterfall (dry-run for queuing) ──────────────────────────────────────
static bool SelfScanWaterfall(Player* bot, Unit* enemy, const SpecRotation* rot,
                              BotRole role,
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
        if (CanCastSelf(bot, bot, id))
        {
            outSpellId = id; outTargetGuid = bot->GetGUID(); return true;
        }
    }

    // 2. Defensives
    if (bot->GetHealthPct() < 35.0f)
    {
        for (uint32 id : rot->defensives)
        {
            if (id == 0) continue;
            if (CanCastSelf(bot, bot, id))
            {
                outSpellId = id; outTargetGuid = bot->GetGUID(); return true;
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
            if (CanCastSelf(bot, enemy, id))
            {
                outSpellId = id; outTargetGuid = enemy->GetGUID(); return true;
            }
        }
    }

    // 4. HoTs
    {
        Player* hotTarget = FindLowestHPSelf(bot);
        if (hotTarget)
        {
            for (uint32 id : rot->hots)
            {
                if (id == 0) continue;
                if (role == BotRole::ROLE_MELEE_HEALER)
                {
                    bool needHeal = hotTarget->GetHealthPct() <= MELEE_HEALER_HEAL_THRESHOLD_PCT;
                    bool hasHealMana = GetSelfManaPct(bot) >= MELEE_HEALER_MIN_MANA_PCT;
                    if (!needHeal || !hasHealMana)
                        continue;
                }
                else if (hotTarget->HasAura(id))
                    continue;

                if (CanCastSelf(bot, hotTarget, id))
                {
                    outSpellId = id; outTargetGuid = hotTarget->GetGUID(); return true;
                }
            }
        }
    }

    // 5. Abilities
    if (role == BotRole::ROLE_HEALER)
    {
        Player* healTarget = FindLowestHPSelf(bot);
        if (healTarget && healTarget->GetHealthPct() < 90.0f)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCastSelf(bot, healTarget, id))
                {
                    outSpellId = id; outTargetGuid = healTarget->GetGUID(); return true;
                }
            }
        }
    }
    else if (role == BotRole::ROLE_RANGED_HEALER)
    {
        Player* healTarget = FindLowestHPSelf(bot);
        if (healTarget && healTarget->GetHealthPct() <= RANGED_HEALER_HEAL_THRESHOLD_PCT)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCastSelf(bot, healTarget, id))
                {
                    outSpellId = id; outTargetGuid = healTarget->GetGUID(); return true;
                }
            }
            return false;
        }

        if (enemy)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCastSelf(bot, enemy, id))
                {
                    outSpellId = id; outTargetGuid = enemy->GetGUID(); return true;
                }
            }
        }
    }
    else if (role == BotRole::ROLE_MELEE_HEALER)
    {
        if (enemy)
        {
            for (uint32 id : rot->abilities)
            {
                if (id == 0) continue;
                if (CanCastSelf(bot, enemy, id))
                {
                    outSpellId = id; outTargetGuid = enemy->GetGUID(); return true;
                }
            }
        }
    }
    else if (enemy)
    {
        for (uint32 id : rot->abilities)
        {
            if (id == 0) continue;
            if (CanCastSelf(bot, enemy, id))
            {
                outSpellId = id; outTargetGuid = enemy->GetGUID(); return true;
            }
        }
    }

    // 6. Mobility
    if (enemy)
    {
        float dx = bot->GetPositionX() - enemy->GetPositionX();
        float dy = bot->GetPositionY() - enemy->GetPositionY();
        float dist = std::sqrt(dx * dx + dy * dy);
        if (dist > rot->preferredRange + 5.f)
        {
            for (uint32 id : rot->mobility)
            {
                if (id == 0) continue;
                if (CanCastSelf(bot, bot, id))
                {
                    outSpellId = id; outTargetGuid = bot->GetGUID(); return true;
                }
            }
        }
    }

    return false;
}

// ─── Main selfbot waterfall ────────────────────────────────────────────────────
static void RunSelfBotWaterfall(Player* bot, Unit* enemy,
                                const SpecRotation* rot, SelfBotState& state)
{
    EnsureSelfRangedFacing(bot, enemy, state.role);

    if (TryMaintainHunterAutoShotSelf(bot, enemy, state.role))
        return;

    // While casting: queue next spell (once)
    if (bot->HasUnitState(UNIT_STATE_CASTING))
    {
        if (state.queuedSpellId == 0)
        {
            uint32 qSpell = 0;
            ObjectGuid qTarget;
            if (SelfScanWaterfall(bot, enemy, rot, state.role, qSpell, qTarget))
            {
                state.queuedSpellId    = qSpell;
                state.queuedTargetGuid = qTarget;
            }
        }
        return;
    }

    // Consume queued spell
    if (state.queuedSpellId != 0)
    {
        uint32 qSpell = state.queuedSpellId;
        ObjectGuid qTarget = state.queuedTargetGuid;
        state.queuedSpellId = 0;
        state.queuedTargetGuid = ObjectGuid::Empty;

        Unit* target = ObjectAccessor::GetUnit(*bot, qTarget);
        if (target && target->IsAlive() && target->IsInWorld())
        {
            if (TryCastSelf(bot, target, qSpell))
                return;
        }
    }

    // Normal waterfall
    if (SelfRunMeta(bot, enemy)) return;                                       // trinkets + racials
    if (SelfRunBuffs(bot, rot->buffs)) return;
    if (SelfRunDefensives(bot, rot->defensives)) return;
    if (SelfRunDots(bot, enemy, rot->dots)) return;
    if (SelfRunHots(bot, state.role, rot->hots)) return;
    if (SelfRunAbilities(bot, enemy, state.role, rot->abilities)) return;
    SelfRunMobility(bot, enemy, rot->preferredRange, rot->mobility);            // gap closers
}

// ─── World Script: tick selfbot players ────────────────────────────────────────
class SelfBotWorldScript : public WorldScript
{
public:
    SelfBotWorldScript() : WorldScript("SelfBotWorldScript") {}

    void OnUpdate(uint32 diff) override
    {
        _timer += diff;
        if (_timer < 1000) return;  // 1 second tick
        _timer = 0;

        if (sSelfBotPlayers.empty()) return;

        // Iterate a copy of keys in case we need to remove
        std::vector<ObjectGuid::LowType> toRemove;

        for (auto& [guidLow, state] : sSelfBotPlayers)
        {
            ObjectGuid guid = ObjectGuid::Create<HighGuid::Player>(guidLow);
            Player* player = ObjectAccessor::FindPlayer(guid);
            if (!player || !player->IsInWorld() || !player->IsAlive())
            {
                if (!player)
                    toRemove.push_back(guidLow);
                continue;
            }

            const SpecRotation* rot = sRotationEngine.GetRotation(
                player->getClass(), state.specIndex);
            if (!rot) continue;

            // ── Resolve target ─────────────────────────────────────────────
            Unit* enemy = player->GetVictim();
            if (!enemy || !enemy->IsAlive())
                enemy = player->GetSelectedUnit();
            if (enemy && (!enemy->IsAlive() || enemy->IsPlayer()))
                enemy = nullptr;

            // Auto-acquire nearest hostile if in combat with no target
            if (!enemy && player->IsInCombat())
                enemy = FindNearestHostile(player, 30.f);

            // Also auto-pull if idle and a hostile is very close (aggro simulation)
            if (!enemy)
                enemy = FindNearestHostile(player, 8.f);

            // ── Combat ─────────────────────────────────────────────────────
            if (enemy && enemy->IsAlive() && enemy->IsInWorld())
            {
                if (!state.isInCombat)
                {
                    state.isInCombat = true;
                    bool isMelee = (state.role == BotRole::ROLE_MELEE_DPS ||
                                    state.role == BotRole::ROLE_TANK ||
                                    state.role == BotRole::ROLE_MELEE_HEALER);
                    player->Attack(enemy, isMelee);

                    float chase = isMelee
                        ? 0.5f
                        : ((rot->preferredRange > 0) ? rot->preferredRange : 25.0f);

                    player->GetMotionMaster()->Clear();
                    player->GetMotionMaster()->MoveChase(enemy, chase);
                }
                else if (player->GetVictim() != enemy)
                {
                    // Retarget if enemy changed
                    bool isMelee = (state.role == BotRole::ROLE_MELEE_DPS ||
                                    state.role == BotRole::ROLE_TANK ||
                                    state.role == BotRole::ROLE_MELEE_HEALER);
                    player->Attack(enemy, isMelee);

                    float chase = isMelee
                        ? 0.5f
                        : ((rot->preferredRange > 0) ? rot->preferredRange : 25.0f);

                    player->GetMotionMaster()->Clear();
                    player->GetMotionMaster()->MoveChase(enemy, chase);
                }

                RunSelfBotWaterfall(player, enemy, rot, state);
            }
            else
            {
                // Out of combat
                if (state.isInCombat)
                {
                    state.isInCombat = false;
                    state.queuedSpellId = 0;
                    state.queuedTargetGuid = ObjectGuid::Empty;
                    player->AttackStop();
                    player->GetMotionMaster()->Clear();
                }
            }
        }

        for (auto g : toRemove)
            sSelfBotPlayers.erase(g);
    }

private:
    uint32 _timer = 0;
};

// ─── Player logout cleanup ─────────────────────────────────────────────────────
class SelfBotPlayerScript : public PlayerScript
{
public:
    SelfBotPlayerScript() : PlayerScript("SelfBotPlayerScript") {}

    void OnPlayerLogout(Player* player) override
    {
        if (player)
            sSelfBotPlayers.erase(player->GetGUID().GetCounter());
    }
};

void AddSelfBotSystem()
{
    new SelfBotWorldScript();
    new SelfBotPlayerScript();
}
