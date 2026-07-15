// guardian_manager.cpp — Unified Guardian Management System
// Consolidates ALL guardian management into one place:
//   - Target tracking (shared combat state)
//   - Spell interactions (imp echoes, wrathguard/assassin reactions)
//   - Auto-summoning (wrathguards + assassins via talent gating)
//   - Imp summoning (on Shadow Bolt cast, talent gated)
//   - Spellpower → AP stat sync (all melee guardians)
//   - Unified formation (imps at rear, melee at front-flanks)
//   - Logout cleanup

#include "warlock_expanded.h"

using namespace WarlockExpanded;

namespace
{
    // ── Imp damage calculation (from former imp_warlock AllSpellScript) ──
    constexpr float IMP_MANA_PERCENT_SHADOWBOLT = 4.0f;  // 4% of max mana
    constexpr float IMP_MANA_PERCENT_SOULFIRE   = 10.0f;  // 10% of max mana

    int32 CalculateImpSpellDamage(Player* player, uint32 spellId)
    {
        if (!player) return 0;
        SpellInfo const* spellInfo = sSpellMgr->GetSpellInfo(spellId);
        if (!spellInfo) return 0;

        int32 baseDamage = spellInfo->Effects[EFFECT_0].CalcValue(player);
        int32 spellPower = player->SpellBaseDamageBonusDone(SPELL_SCHOOL_MASK_SHADOW);
        float coefficient = spellInfo->Effects[EFFECT_0].BonusMultiplier;
        if (coefficient == 0.0f)
            coefficient = 0.857f;
        baseDamage += int32(spellPower * coefficient);

        // Imps deal 10% of calculated player damage
        baseDamage = int32(baseDamage * 0.1f);
        return baseDamage;
    }

    constexpr uint32 CHECK_INTERVAL_MS  = 2000;
    constexpr uint32 STAT_SYNC_INTERVAL = 2000;
    constexpr float  GAP_CLOSER_RANGE   = 15.0f;

    float GetMasteryDamageMultiplier(Player* player)
    {
        if (!player)
            return 1.0f;

        float masteryRating = float(player->GetUInt32Value(PLAYER_FIELD_COMBAT_RATING_1 + uint16(CR_PARRY)));
        float masteryPct = masteryRating / 10.0f;
        if (masteryPct <= 0.0f)
            return 1.0f;

        return 1.0f + (masteryPct / 100.0f);
    }
}

class GuardianMasteryDamageUnitScript : public UnitScript
{
public:
    GuardianMasteryDamageUnitScript() : UnitScript("GuardianMasteryDamageUnitScript") { }

    uint32 DealDamage(Unit* attacker, Unit* victim, uint32 damage, DamageEffectType damagetype) override
    {
        (void)victim;
        (void)damagetype;

        if (!attacker || damage == 0)
            return damage;

        Creature* creature = attacker->ToCreature();
        if (!creature)
            return damage;

        if (!creature->IsPet() && !creature->IsGuardian())
            return damage;

        Player* owner = creature->GetOwner() ? creature->GetOwner()->ToPlayer() : nullptr;
        if (!owner || owner->getClass() != CLASS_WARLOCK)
            return damage;

        float masteryMul = GetMasteryDamageMultiplier(owner);
        if (masteryMul <= 1.0f)
            return damage;

        uint32 scaled = uint32(float(damage) * masteryMul);
        return std::max<uint32>(scaled, damage);
    }
};

// ═════════════════════════════════════════════════════════════════════════════
//  UNIFIED AllSpellScript — target tracking + all spell interactions
// ═════════════════════════════════════════════════════════════════════════════
class GuardianSpellScript : public AllSpellScript
{
public:
    GuardianSpellScript() : AllSpellScript("GuardianSpellScript") { }

    void OnSpellCast(Spell* spell, Unit* caster,
                     SpellInfo const* spellInfo, bool /*skipCheck*/) override
    {
        if (!spell || !caster || !spellInfo || !caster->IsPlayer())
            return;

        Player* player = caster->ToPlayer();
        if (!player || player->getClass() != CLASS_WARLOCK)
            return;

        uint64 ownerGuid = player->GetGUID().GetRawValue();
        uint32 spellId = spellInfo->Id;

        // ── 1. Target tracking (shared by ALL guardian AIs) ──────────
        Unit* target = spell->m_targets.GetUnitTarget();
        if (target && target->IsAlive() && player->IsValidAttackTarget(target))
        {
            g_OwnerLastCastTime[ownerGuid] = 0;
            g_OwnerLastTarget[ownerGuid] = target->GetGUID();
        }

        // Only process guardian-driving spells for the rest
        bool shadowBolt = IsShadowBolt(spellId);
        bool soulFire   = IsSoulFire(spellId);
        bool demonicEmp = (spellId == DEMONIC_EMPOWERMENT);

        if (!shadowBolt && !soulFire && !demonicEmp && !IsWarlockCoreSpell(spellId))
            return;

        // ── 2. Imp summoning on Shadow Bolt ──────────────────────────
        if (shadowBolt)
        {
            uint8 maxImps = GetTalentMinionCount(player, IMP_TALENT_RANKS, MAX_TALENT_RANKS, DEFAULT_MAX_IMPS);
            if (maxImps > 0)
            {
                std::list<Creature*> imps;
                GetPlayerImps(player, imps);
                if (imps.size() < maxImps)
                {
                    player->CastSpell(player, SUMMON_IMP_SPELL, true);
                    AssignGuardianFormation(player);
                }
            }
        }

        // ── 3. Soul Fire extra mana cost per living imp ──────────────
        if (soulFire)
        {
            std::list<Creature*> imps;
            GetPlayerImpsAlive(player, imps);
            uint32 livingCount = 0;
            for (Creature* imp : imps)
                if (imp && imp->IsAlive())
                    ++livingCount;

            if (livingCount > 0)
            {
                uint32 maxMana = player->GetMaxPower(POWER_MANA);
                uint32 manaCost = uint32(livingCount * IMP_MANA_PERCENT_SOULFIRE * maxMana / 100.0f);
                player->ModifyPower(POWER_MANA, -int32(manaCost));
            }
        }

        // ── 4. Imp spell echoes (SB/SF filler+heavy) ─────────────────
        if (shadowBolt || soulFire)
        {
            std::list<Creature*> imps;
            GetPlayerImps(player, imps);

            if (!imps.empty() && target)
            {
                // Imps cast their own custom copies for independent balancing
                uint32 impSpellId = shadowBolt ? IMP_SHADOW_BOLT : IMP_SOUL_FIRE;
                // Use the base warlock spell for damage calculation
                uint32 calcSpellId = shadowBolt ? SHADOWBOLT_SPELL : SOULFIRE_SPELL;

                int32 impDamage = CalculateImpSpellDamage(player, calcSpellId);

                float manaPercent = soulFire ? IMP_MANA_PERCENT_SOULFIRE : IMP_MANA_PERCENT_SHADOWBOLT;
                uint32 maxMana = player->GetMaxPower(POWER_MANA);
                uint32 manaReward = uint32(manaPercent * maxMana / 100.0f);

                for (Creature* imp : imps)
                {
                    if (!imp || !imp->IsAlive()) continue;
                    imp->CastCustomSpell(target, impSpellId, &impDamage, nullptr, nullptr,
                                         true);
                    player->ModifyPower(POWER_MANA, int32(manaReward));

                    if (shadowBolt && player->HasSpellCooldown(SOULFIRE_SPELL))
                        player->ModifySpellCooldown(SOULFIRE_SPELL, -500);
                }
            }
        }

        // ── 5. Imp special (Demonic Empowerment → Chaos Bolt) ────────
        if (demonicEmp)
        {
            std::list<Creature*> imps;
            GetPlayerImps(player, imps);
            for (Creature* imp : imps)
            {
                if (!imp || !imp->IsAlive()) continue;
                Unit* impTarget = ResolveOwnerTarget(player);
                if (impTarget && impTarget->IsAlive())
                    imp->CastSpell(impTarget, IMP_CHAOS_BOLT, true);
            }
        }

        // ── 6. Wrathguard reactions ──────────────────────────────────
        //  SB → Cleave (filler)   SF → Whirlwind (heavy)   DE → Bladestorm (special)
        if (shadowBolt || soulFire || demonicEmp)
        {
            std::list<Creature*> guards;
            GetPlayerWrathguards(player, guards);
            for (Creature* guard : guards)
            {
                if (!guard || !guard->IsAlive()) continue;
                if (shadowBolt && target && target->IsAlive())
                    guard->CastSpell(target, SPELL_MORTAL_STRIKE, true);
                else if (soulFire && target && target->IsAlive())
                    guard->CastSpell(target, SPELL_WHIRLWIND, true);
                else if (demonicEmp)
                    guard->CastSpell(guard, SPELL_BLADESTORM, true);
            }
        }

        // ── 7. Assassin reactions ────────────────────────────────────
        //  SB → Ambush (filler)   SF → Envenom (heavy)   DE → Killing Spree (special)
        if (shadowBolt || soulFire || demonicEmp)
        {
            std::list<Creature*> assassins;
            GetPlayerAssassins(player, assassins);
            for (Creature* a : assassins)
            {
                if (!a || !a->IsAlive()) continue;
                if (shadowBolt && target && target->IsAlive())
                    a->CastSpell(target, SPELL_AMBUSH, true);
                else if (soulFire && target && target->IsAlive())
                    a->CastSpell(target, SPELL_ENVENOM, true);
                else if (demonicEmp)
                    a->CastSpell(a, SPELL_FAN_OF_KNIVES, true);
            }
        }
    }
};

// ═════════════════════════════════════════════════════════════════════════════
//  UNIFIED PlayerScript — summon, sync, formation, idle timer, cleanup
// ═════════════════════════════════════════════════════════════════════════════
class GuardianManagerPlayerScript : public PlayerScript
{
public:
    GuardianManagerPlayerScript() : PlayerScript("GuardianManagerPlayerScript") { }

    void OnPlayerUpdate(Player* player, uint32 diff) override
    {
        if (!player || player->getClass() != CLASS_WARLOCK)
            return;
        if (!player->IsInWorld() || !player->IsAlive())
            return;

        uint64 guid = player->GetGUID().GetRawValue();

        // ── Always: increment idle timer (once per tick per player) ──
        g_OwnerLastCastTime[guid] += diff;

        // ── Timer-gated section (every 2s) ───────────────────────────
        static std::unordered_map<uint64, uint32> s_timers;
        uint32& timer = s_timers[guid];
        if (timer > diff)
        {
            timer -= diff;
            return;
        }
        timer = CHECK_INTERVAL_MS;

        // ── Auto-summon wrathguards ──────────────────────────────────
        {
            uint8 maxWrath = GetTalentMinionCount(player, WRATHGUARD_TALENT_RANKS, MAX_TALENT_RANKS, DEFAULT_MAX_WRATHGUARDS);
            if (maxWrath > 0)
            {
                std::list<Creature*> guards;
                GetPlayerWrathguardsAlive(player, guards);
                if (guards.size() < maxWrath)
                    player->CastSpell(player, SUMMON_WRATHGUARD, true);
            }
        }

        // ── Auto-summon assassins ────────────────────────────────────
        {
            uint8 maxAssassin = GetTalentMinionCount(player, ASSASSIN_TALENT_RANKS, MAX_TALENT_RANKS, DEFAULT_MAX_ASSASSINS);
            if (maxAssassin > 0)
            {
                std::list<Creature*> assassins;
                GetPlayerAssassinsAlive(player, assassins);
                if (assassins.size() < maxAssassin)
                    player->CastSpell(player, SUMMON_ASSASSIN, true);
            }
        }

        // ── Trim excess guardians (if talent rank decreased) ─────────
        {
            uint8 maxImps = GetTalentMinionCount(player, IMP_TALENT_RANKS, MAX_TALENT_RANKS, DEFAULT_MAX_IMPS);
            std::list<Creature*> imps;
            GetPlayerImps(player, imps);
            while (imps.size() > maxImps)
            {
                Creature* extra = imps.back();
                imps.pop_back();
                if (extra) Unit::Kill(extra, extra);
            }
        }

        // ── Spellpower → AP + SP sync for ALL guardians ──────────────
        {
            int32 sp = player->SpellBaseDamageBonusDone(SPELL_SCHOOL_MASK_SHADOW);
            if (sp < 0) sp = 0;
            float scaled = float(sp) * GUARDIAN_SP_SCALING;

            // Collect every guardian type
            std::list<Creature*> all;
            GetPlayerMeleeGuardians(player, all);
            std::list<Creature*> imps;
            GetPlayerImpsAlive(player, imps);
            all.insert(all.end(), imps.begin(), imps.end());

            for (Creature* g : all)
            {
                if (!g || !g->IsAlive()) continue;
                // Attack Power
                // Guardians recompute BASE_VALUE from their own STR in core,
                // so owner scaling must be applied to TOTAL_VALUE.
                g->SetStatFlatModifier(UNIT_MOD_ATTACK_POWER, TOTAL_VALUE, scaled);
                g->UpdateAttackPowerAndDamage();
            }
        }

        // ── Unified formation (reposition idle guardians) ────────────
        AssignGuardianFormation(player);
    }

    void OnPlayerLogout(Player* player) override
    {
        if (!player) return;
        uint64 guid = player->GetGUID().GetRawValue();

        // Clear shared state
        g_OwnerLastCastTime.erase(guid);
        g_OwnerLastTarget.erase(guid);

        // Despawn ALL guardian types
        auto despawnList = [](Player* p, std::list<Creature*>& list) {
            for (Creature* c : list)
                if (c) c->DespawnOrUnsummon();
        };

        std::list<Creature*> temp;
        GetPlayerWrathguards(player, temp); despawnList(player, temp); temp.clear();
        GetPlayerAssassins(player, temp);   despawnList(player, temp); temp.clear();
        GetPlayerImps(player, temp);        despawnList(player, temp);
    }

    void OnPlayerAfterGuardianInitStatsForLevel(Player* player, Guardian* guardian) override
    {
        if (!player || !guardian)
            return;
        if (player->getClass() != CLASS_WARLOCK)
            return;

        switch (guardian->GetEntry())
        {
            case WILD_IMP_ENTRY:
                guardian->SetCanDualWield(false);
                guardian->AddAura(SPELL_PET_AVOIDANCE_AURA, guardian);
                guardian->AddAura(SPELL_PET_HIT_EXP_AURA, guardian);
                break;
            case WRATHGUARD_ENTRY:
                guardian->SetCanDualWield(false);
                guardian->SetVirtualItem(1, 0);
                guardian->AddAura(SPELL_PET_AVOIDANCE_AURA, guardian);
                guardian->AddAura(SPELL_PET_HIT_EXP_AURA, guardian);
                break;
            case IMP_ASSASSIN_ENTRY:
                guardian->SetCanDualWield(false);
                guardian->SetVirtualItem(1, 0);
                guardian->AddAura(SPELL_PET_AVOIDANCE_AURA, guardian);
                guardian->AddAura(SPELL_PET_HIT_EXP_AURA, guardian);
                break;
            case INFERNAL_ENTRY:
                guardian->SetCanDualWield(true);
                guardian->AddAura(SPELL_PET_AVOIDANCE_AURA, guardian);
                guardian->AddAura(SPELL_PET_HIT_EXP_AURA, guardian);
                break;
            default:
                break;
        }
    }
};

void AddSC_GuardianManager()
{
    new GuardianSpellScript();
    new GuardianManagerPlayerScript();
    new GuardianMasteryDamageUnitScript();
}
