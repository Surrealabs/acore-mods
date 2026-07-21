#include "ScriptMgr.h"
#include "Player.h"
#include "SpellScript.h"
#include "SpellInfo.h"
#include "SpellMgr.h"
#include "GameTime.h"
#include "Random.h"
#include "Utilities/DataMap.h"

#include <algorithm>
#include <deque>
#include <vector>

// ════════════════════════════════════════════════════════════════════════
//  mod-paladin-expanded — Custom Paladin mechanics
// ════════════════════════════════════════════════════════════════════════

namespace
{
	constexpr uint32 SPELL_PALADIN_BEACON_OF_LIGHT = 53563;
	constexpr uint32 SPELL_PALADIN_DIVINE_STORM = 53385;
	constexpr uint32 SPELL_PALADIN_DIVINE_STORM_HEAL = 54172;

	constexpr float BEACON_EFFECT_RANGE = 60.0f;
	constexpr uint8 DAMAGE_FUNNEL_TARGETS = 2;
	constexpr uint8 DIRECT_HEAL_DUPLICATE_TARGETS = 5;
	constexpr uint8 DIVINE_STORM_HEAL_TARGETS = 3;
	constexpr uint32 HEAL_WINDOW_MS = 10000;

	class BoolData : public DataMap::Base
	{
	public:
		explicit BoolData(bool initial = false) : value(initial) { }
		bool value;
	};

	struct HealSample
	{
		uint32 timestampMs;
		uint32 amount;
	};

	class HealWindowData : public DataMap::Base
	{
	public:
		std::deque<HealSample> samples;
		uint64 rollingTotal = 0;
	};

	bool IsBeaconPaladin(Player* player)
	{
		if (!player || player->getClass() != CLASS_PALADIN)
			return false;

		return player->HasSpell(SPELL_PALADIN_BEACON_OF_LIGHT) || player->HasAura(SPELL_PALADIN_BEACON_OF_LIGHT);
	}

	bool IsDirectHealSpell(SpellInfo const* spellInfo)
	{
		if (!spellInfo || !spellInfo->IsPositive())
			return false;

		for (uint8 i = 0; i < MAX_SPELL_EFFECTS; ++i)
		{
			if (!spellInfo->Effects[i].IsEffect())
				continue;

			uint16 effect = spellInfo->Effects[i].Effect;
			if (effect == SPELL_EFFECT_HEAL || effect == SPELL_EFFECT_HEAL_MAX_HEALTH || effect == SPELL_EFFECT_HEAL_PCT)
				return true;
		}

		return false;
	}

	bool IsEligibleRaidMember(Player* caster, Player* candidate)
	{
		if (!caster || !candidate)
			return false;

		if (!candidate->IsAlive() || !candidate->IsInWorld())
			return false;

		if (!caster->IsInRaidWith(candidate))
			return false;

		if (!caster->IsWithinDistInMap(candidate, BEACON_EFFECT_RANGE))
			return false;

		return true;
	}

	std::vector<Player*> GetLowestHealthRaidMembers(Player* caster, uint8 maxTargets, Player* exclude = nullptr)
	{
		std::vector<Player*> candidates;

		if (!caster || !caster->GetMap() || maxTargets == 0)
			return candidates;

		Map::PlayerList const& players = caster->GetMap()->GetPlayers();
		for (Map::PlayerList::const_iterator itr = players.begin(); itr != players.end(); ++itr)
		{
			Player* candidate = itr->GetSource();
			if (!IsEligibleRaidMember(caster, candidate))
				continue;

			if (exclude && candidate == exclude)
				continue;

			candidates.push_back(candidate);
		}

		std::sort(candidates.begin(), candidates.end(), [](Player* left, Player* right)
		{
			return left->GetHealthPct() < right->GetHealthPct();
		});

		if (candidates.size() > maxTargets)
			candidates.resize(maxTargets);

		return candidates;
	}

	void ApplyTriggeredHeal(Player* healer, Unit* target, uint32 amount, SpellInfo const* sourceSpell, bool allowCrit = false)
	{
		if (!healer || !target || amount == 0)
			return;

		// Optionally roll a crit using the healer's normal spell crit chance for this school,
		// same as a real heal cast would, and scale the amount if it crits.
		bool crit = false;
		if (allowCrit && sourceSpell)
		{
			float critChance = healer->SpellDoneCritChance(target, sourceSpell, sourceSpell->GetSchoolMask(), BASE_ATTACK, true);
			if (critChance > 0.0f && roll_chance_f(critChance))
			{
				crit = true;
				amount = Unit::SpellCriticalHealingBonus(healer, sourceSpell, amount, target);
			}
		}

		SpellSchoolMask schoolMask = sourceSpell ? sourceSpell->GetSchoolMask() : SPELL_SCHOOL_MASK_HOLY;
		HealInfo healInfo(healer, target, amount, sourceSpell, schoolMask);
		int32 gain = healer->HealBySpell(healInfo, crit);

		// HealBySpell() only applies the heal - it does not raise the usual proc events a real
		// spell cast would (Spell::EffectHeal does that separately). Without this, heal-triggered
		// procs like Divine Aegis never see these synthetic heals (Beacon replication, damage
		// funnel, Divine Storm burst heal).
		uint32 procAttacker;
		uint32 procVictim;
		if (sourceSpell && sourceSpell->DmgClass == SPELL_DAMAGE_CLASS_MAGIC)
		{
			procAttacker = PROC_FLAG_DONE_SPELL_MAGIC_DMG_CLASS_POS;
			procVictim = PROC_FLAG_TAKEN_SPELL_MAGIC_DMG_CLASS_POS;
		}
		else
		{
			procAttacker = PROC_FLAG_DONE_SPELL_NONE_DMG_CLASS_POS;
			procVictim = PROC_FLAG_TAKEN_SPELL_NONE_DMG_CLASS_POS;
		}

		uint32 procEx = crit ? PROC_EX_CRITICAL_HIT : PROC_EX_NORMAL_HIT;
		if (gain > 0)
			procEx |= PROC_EX_NO_OVERHEAL;

		Unit::ProcDamageAndSpell(healer, target, procAttacker, procVictim, procEx, amount, BASE_ATTACK, sourceSpell, nullptr, -1, nullptr, nullptr, &healInfo);
	}

	bool IsReplicationInProgress(Player* caster)
	{
		if (!caster)
			return false;

		if (BoolData* flag = caster->CustomData.Get<BoolData>("PaladinExpandedBeaconReplication"))
			return flag->value;

		return false;
	}

	void SetReplicationState(Player* caster, bool active)
	{
		if (!caster)
			return;

		if (BoolData* flag = caster->CustomData.Get<BoolData>("PaladinExpandedBeaconReplication"))
		{
			flag->value = active;
			return;
		}

		caster->CustomData.Set("PaladinExpandedBeaconReplication", new BoolData(active));
	}

	void PruneHealWindow(HealWindowData* data, uint32 nowMs)
	{
		if (!data)
			return;

		while (!data->samples.empty())
		{
			HealSample const& sample = data->samples.front();
			if ((nowMs - sample.timestampMs) <= HEAL_WINDOW_MS)
				break;

			if (data->rollingTotal >= sample.amount)
				data->rollingTotal -= sample.amount;
			else
				data->rollingTotal = 0;

			data->samples.pop_front();
		}
	}

	void RecordHealingSample(Player* healer, uint32 amount)
	{
		if (!healer || amount == 0)
			return;

		HealWindowData* data = healer->CustomData.Get<HealWindowData>("PaladinExpandedDivineStormHealWindow");
		if (!data)
		{
			healer->CustomData.Set("PaladinExpandedDivineStormHealWindow", new HealWindowData());
			data = healer->CustomData.Get<HealWindowData>("PaladinExpandedDivineStormHealWindow");
			if (!data)
				return;
		}

		uint32 nowMs = uint32(GameTime::GetGameTimeMS().count());
		PruneHealWindow(data, nowMs);

		data->samples.push_back({ nowMs, amount });
		data->rollingTotal += amount;
	}

	uint64 GetHealingDoneLast10Seconds(Player* healer)
	{
		if (!healer)
			return 0;

		HealWindowData* data = healer->CustomData.Get<HealWindowData>("PaladinExpandedDivineStormHealWindow");
		if (!data)
			return 0;

		uint32 nowMs = uint32(GameTime::GetGameTimeMS().count());
		PruneHealWindow(data, nowMs);
		return data->rollingTotal;
	}

	float GetMasteryScalar(Player* player)
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

class PaladinExpandedHealTrackerScript : public UnitScript
{
public:
	PaladinExpandedHealTrackerScript() : UnitScript("PaladinExpandedHealTrackerScript") { }

	void OnHeal(Unit* healer, Unit* receiver, uint32& gain) override
	{
		(void)receiver;

		if (!healer || gain == 0)
			return;

		Player* player = healer->ToPlayer();
		if (!player || player->getClass() != CLASS_PALADIN)
			return;

		RecordHealingSample(player, gain);
	}
};

class PaladinExpandedBeaconUnitScript : public UnitScript
{
	public:
	PaladinExpandedBeaconUnitScript() : UnitScript("PaladinExpandedBeaconUnitScript") { }

	uint32 DealDamage(Unit* attacker, Unit* victim, uint32 damage, DamageEffectType damagetype) override
	{
		(void)victim;
		(void)damagetype;

		if (!attacker || damage == 0)
			return damage;

		Player* caster = attacker->ToPlayer();
		if (!caster || !IsBeaconPaladin(caster))
			return damage;

		if (IsReplicationInProgress(caster))
			return damage;

		uint32 funnelHealPerTarget = damage / 2;
		funnelHealPerTarget = uint32(float(funnelHealPerTarget) * GetMasteryScalar(caster));
		if (funnelHealPerTarget == 0)
			return damage;

		std::vector<Player*> targets = GetLowestHealthRaidMembers(caster, DAMAGE_FUNNEL_TARGETS);
		if (targets.empty())
			return damage;

		SpellInfo const* beaconSpell = sSpellMgr->GetSpellInfo(SPELL_PALADIN_BEACON_OF_LIGHT);
		SetReplicationState(caster, true);
		for (Player* target : targets)
		{
			if (!target)
				continue;

			ApplyTriggeredHeal(caster, target, funnelHealPerTarget, beaconSpell, true);
		}
		SetReplicationState(caster, false);

		return damage;
	}

	void ModifyHealReceived(Unit* target, Unit* healer, uint32& heal, SpellInfo const* spellInfo) override
	{
		if (!target || !healer || heal == 0 || !spellInfo)
			return;

		Player* caster = healer->ToPlayer();
		if (!caster || !IsBeaconPaladin(caster))
			return;

		if (IsReplicationInProgress(caster))
			return;

		Player* healedPlayer = target->ToPlayer();
		if (!healedPlayer)
			return;

		if (!caster->IsInRaidWith(healedPlayer))
			return;

		if (!IsDirectHealSpell(spellInfo))
			return;

		std::vector<Player*> duplicateTargets = GetLowestHealthRaidMembers(caster, DIRECT_HEAL_DUPLICATE_TARGETS, healedPlayer);
		if (duplicateTargets.empty())
			return;

		uint32 duplicatedHeal = uint32(float(heal) * GetMasteryScalar(caster));
		if (duplicatedHeal == 0)
			return;

		SetReplicationState(caster, true);
		for (Player* duplicateTarget : duplicateTargets)
		{
			if (!duplicateTarget)
				continue;

			ApplyTriggeredHeal(caster, duplicateTarget, duplicatedHeal, spellInfo, true);
		}
		SetReplicationState(caster, false);
	}
};

class spell_paladin_expanded_divine_storm : public SpellScript
{
	PrepareSpellScript(spell_paladin_expanded_divine_storm);

	bool Validate(SpellInfo const* /*spellInfo*/) override
	{
		return ValidateSpellInfo({ SPELL_PALADIN_DIVINE_STORM_HEAL });
	}

	void HandleAfterCast()
	{
		Player* caster = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
		if (!caster || caster->getClass() != CLASS_PALADIN)
			return;

		uint64 rollingHealing = GetHealingDoneLast10Seconds(caster);
		if (rollingHealing == 0)
			return;

		uint32 burstHealTotal = uint32(rollingHealing / 10);
		if (burstHealTotal == 0)
			return;

		std::vector<Player*> targets = GetLowestHealthRaidMembers(caster, DIVINE_STORM_HEAL_TARGETS);
		if (targets.empty())
			return;

		SpellInfo const* healSpell = sSpellMgr->GetSpellInfo(SPELL_PALADIN_DIVINE_STORM_HEAL);

		for (Player* target : targets)
		{
			if (!target)
				continue;

			ApplyTriggeredHeal(caster, target, burstHealTotal, healSpell);
		}
	}

	void Register() override
	{
		AfterCast += SpellCastFn(spell_paladin_expanded_divine_storm::HandleAfterCast);
	}
};

void Addmod_paladin_expandedScripts()
{
	new PaladinExpandedHealTrackerScript();
	new PaladinExpandedBeaconUnitScript();
	RegisterSpellScript(spell_paladin_expanded_divine_storm);
}
