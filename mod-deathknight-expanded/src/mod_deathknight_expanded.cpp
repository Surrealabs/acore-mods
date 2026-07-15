#include "ScriptMgr.h"
#include "Player.h"
#include "SpellScript.h"
#include "SpellAuraEffects.h"
#include "SpellMgr.h"
#include "GameTime.h"
#include "Utilities/DataMap.h"
#include <unordered_map>
#include <vector>
#include <algorithm>
#include <deque>

namespace
{
	constexpr uint32 SPELL_DK_DANCING_RUNE_WEAPON        = 49028;
	constexpr uint32 SPELL_DK_SUMMON_RUNE_WEAPON         = 900034;
	constexpr uint32 SPELL_DK_DEATH_STRIKE               = 49998;
	constexpr uint32 SPELL_DK_DEATH_STRIKE_HEAL          = 45470;
	constexpr uint32 SPELL_DKX_BLOOD_SHIELD_SPELL        = 900038;
	constexpr uint32 DK_DAMAGE_WINDOW_MS                 = 5000;
	constexpr uint32 SPELL_DK_LEGACY_VISUAL_AURA         = 53160;
	constexpr uint32 SPELL_DK_MIRROR_BLOOD_STRIKE        = 45902;
	constexpr uint32 SPELL_DK_MIRROR_DEATH_STRIKE        = 49998;
	constexpr uint32 SPELL_DK_MIRROR_HEART_STRIKE        = 55050;
	constexpr uint32 SPELL_DK_MIRROR_DEATH_COIL          = 47541;
	constexpr uint32 SPELL_DK_MIRROR_RUNE_STRIKE         = 56815;
	constexpr uint32 SPELL_DK_MIRROR_HYSTERIA            = 49016;
	constexpr uint32 SPELL_DK_MIRROR_PESTILENCE          = 50463;
	constexpr uint32 SPELL_DK_MIRROR_BLOOD_BOIL          = 48721;
	constexpr uint32 SPELL_DK_BLOOD_BOIL_TRIGGERED       = 65658;
	constexpr uint32 SPELL_PET_AVOIDANCE_AURA            = 32233;
	constexpr uint32 SPELL_PET_HIT_EXP_AURA              = 61017;
	constexpr int32  DK_RUNIC_POWER_SPENDER_DELTA        = 50; // 5 RP cost
	constexpr int32  DK_RUNIC_POWER_BUILDER_DELTA        = 25; // 2.5 RP gain

	constexpr uint32 ENTRY_DANCING_RUNE_WEAPON_BASE      = 27893;
	constexpr uint32 DISPLAYID_WEAPON_ONLY               = 11686;
	constexpr uint8  MAX_RUNE_WEAPONS                    = 2;

	constexpr float  RUNE_WEAPON_SEARCH_RANGE            = 120.0f;
	constexpr uint32 RUNE_WEAPON_CHECK_INTERVAL_MS       = 2000;
	constexpr float  MELEE_FOLLOW_DIST                   = 0.7f;
	constexpr float  MELEE_BASE_ANGLE                    = 2.356194f;
	constexpr float  MELEE_ANGLE_STEP                    = 0.261799f;

	inline std::unordered_map<uint64, uint32>     g_OwnerLastCastTime;
	inline std::unordered_map<uint64, ObjectGuid> g_OwnerLastTarget;
	inline std::unordered_map<uint64, uint32>     g_RuneWeaponCheckTimers;

	struct DamageSample
	{
		uint32 timestampMs;
		uint32 amount;
	};

	class DamageWindowData : public DataMap::Base
	{
	public:
		std::deque<DamageSample> samples;
		uint64 rollingTotal = 0;
	};

	bool IsDeathKnight(Player* player)
	{
		return player && player->getClass() == CLASS_DEATH_KNIGHT;
	}

	void PruneDamageWindow(DamageWindowData* data, uint32 nowMs)
	{
		if (!data)
			return;

		while (!data->samples.empty())
		{
			DamageSample const& sample = data->samples.front();
			if ((nowMs - sample.timestampMs) <= DK_DAMAGE_WINDOW_MS)
				break;

			if (data->rollingTotal >= sample.amount)
				data->rollingTotal -= sample.amount;
			else
				data->rollingTotal = 0;

			data->samples.pop_front();
		}
	}

	void RecordDamageTaken(Player* player, uint32 damage)
	{
		if (!player || damage == 0)
			return;

		DamageWindowData* data = player->CustomData.Get<DamageWindowData>("DKX_DeathStrikeDamageWindow");
		if (!data)
		{
			player->CustomData.Set("DKX_DeathStrikeDamageWindow", new DamageWindowData());
			data = player->CustomData.Get<DamageWindowData>("DKX_DeathStrikeDamageWindow");
			if (!data)
				return;
		}

		uint32 nowMs = uint32(GameTime::GetGameTimeMS().count());
		PruneDamageWindow(data, nowMs);

		data->samples.push_back({ nowMs, damage });
		data->rollingTotal += damage;
	}

	uint64 GetDamageTakenLast5Seconds(Player* player)
	{
		if (!player)
			return 0;

		DamageWindowData* data = player->CustomData.Get<DamageWindowData>("DKX_DeathStrikeDamageWindow");
		if (!data)
			return 0;

		uint32 nowMs = uint32(GameTime::GetGameTimeMS().count());
		PruneDamageWindow(data, nowMs);
		return data->rollingTotal;
	}




class deathknight_expanded_unit_script : public UnitScript
{
public:
	deathknight_expanded_unit_script() : UnitScript("deathknight_expanded_unit_script") { }

	void OnDamage(Unit* attacker, Unit* receiver, uint32& damage) override
	{
		(void)attacker;

		if (!receiver || damage == 0)
			return;

		Player* player = receiver->ToPlayer();
		if (!IsDeathKnight(player))
			return;

		RecordDamageTaken(player, damage);
	}
};
	bool IsRuneWeaponEntry(uint32 entry)
	{
		return entry == ENTRY_DANCING_RUNE_WEAPON_BASE;
	}

	uint32 GetOwnerWeaponEntry(Player* owner, uint8 slot)
	{
		if (!owner)
			return 0;

		if (Item* item = owner->GetItemByPos(INVENTORY_SLOT_BAG_0, slot))
			return item->GetEntry();

		return 0;
	}

	void SyncRuneWeaponAppearance(Player* owner, Creature* runeWeapon)
	{
		if (!owner || !runeWeapon)
			return;

		runeWeapon->SetOwnerGUID(owner->GetGUID());
		runeWeapon->SetCreatorGUID(owner->GetGUID());
		runeWeapon->SetDisplayId(DISPLAYID_WEAPON_ONLY);
		runeWeapon->SetUInt32Value(UNIT_VIRTUAL_ITEM_SLOT_ID + 0, GetOwnerWeaponEntry(owner, EQUIPMENT_SLOT_MAINHAND));
		runeWeapon->SetUInt32Value(UNIT_VIRTUAL_ITEM_SLOT_ID + 1, GetOwnerWeaponEntry(owner, EQUIPMENT_SLOT_OFFHAND));
		runeWeapon->SetUInt32Value(UNIT_VIRTUAL_ITEM_SLOT_ID + 2, 0);
		runeWeapon->RemoveAurasDueToSpell(SPELL_DK_LEGACY_VISUAL_AURA);
		runeWeapon->SetReactState(REACT_PASSIVE);
	}

	bool IsMirroredRuneWeaponSpell(uint32 spellId)
	{
		uint32 firstSpell = sSpellMgr->GetFirstSpellInChain(spellId);
		switch (spellId)
		{
			case SPELL_DK_MIRROR_BLOOD_STRIKE:
			case SPELL_DK_MIRROR_DEATH_STRIKE:
			case SPELL_DK_MIRROR_HEART_STRIKE:
			case SPELL_DK_MIRROR_DEATH_COIL:
			case SPELL_DK_MIRROR_RUNE_STRIKE:
			case SPELL_DK_MIRROR_HYSTERIA:
			case SPELL_DK_MIRROR_PESTILENCE:
			case SPELL_DK_MIRROR_BLOOD_BOIL:
				return true;
			default:
				return firstSpell == SPELL_DK_MIRROR_BLOOD_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_DEATH_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_HEART_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_DEATH_COIL
					|| firstSpell == SPELL_DK_MIRROR_RUNE_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_HYSTERIA
					|| firstSpell == SPELL_DK_MIRROR_PESTILENCE
					|| firstSpell == SPELL_DK_MIRROR_BLOOD_BOIL;
		}
	}

	bool IsRunicPowerSpenderSpell(uint32 spellId)
	{
		return spellId == SPELL_DK_MIRROR_DEATH_COIL || spellId == SPELL_DK_MIRROR_RUNE_STRIKE;
	}

	bool IsRunicPowerBuilderSpell(uint32 spellId)
	{
		uint32 firstSpell = sSpellMgr->GetFirstSpellInChain(spellId);
		switch (spellId)
		{
			case SPELL_DK_MIRROR_BLOOD_STRIKE:
			case SPELL_DK_MIRROR_DEATH_STRIKE:
			case SPELL_DK_MIRROR_HEART_STRIKE:
			case SPELL_DK_MIRROR_PESTILENCE:
				return true;
			default:
				return firstSpell == SPELL_DK_MIRROR_BLOOD_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_DEATH_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_HEART_STRIKE
					|| firstSpell == SPELL_DK_MIRROR_PESTILENCE;
		}
	}

	void GetOwnedRuneWeapons(Player* owner, std::list<Creature*>& out)
	{
		if (!owner || !owner->IsInWorld())
			return;

		std::list<Creature*> base;
		owner->GetCreatureListWithEntryInGrid(base, ENTRY_DANCING_RUNE_WEAPON_BASE, RUNE_WEAPON_SEARCH_RANGE);
		for (Creature* c : base)
			if (c && c->GetOwnerGUID() == owner->GetGUID())
				out.push_back(c);
	}

	void EnsureTwoRuneWeapons(Player* owner)
	{
		if (!owner || !owner->IsInWorld())
			return;

		std::list<Creature*> runeWeapons;
		GetOwnedRuneWeapons(owner, runeWeapons);
		runeWeapons.remove_if([](Creature* c) { return !c || !c->IsAlive(); });

		bool summonedAny = false;
		uint8 safety = 0;
		while (runeWeapons.size() < MAX_RUNE_WEAPONS && safety < MAX_RUNE_WEAPONS)
		{
			size_t beforeCount = runeWeapons.size();
			if (sSpellMgr->GetSpellInfo(SPELL_DK_SUMMON_RUNE_WEAPON))
				owner->CastSpell(owner, SPELL_DK_SUMMON_RUNE_WEAPON, true);

			runeWeapons.clear();
			GetOwnedRuneWeapons(owner, runeWeapons);
			runeWeapons.remove_if([](Creature* c) { return !c || !c->IsAlive(); });

			summonedAny = (runeWeapons.size() > beforeCount) || summonedAny;

			if (runeWeapons.size() <= beforeCount)
				break;

			++safety;
		}

		(void)summonedAny;

		while (runeWeapons.size() > MAX_RUNE_WEAPONS)
		{
			Creature* extra = runeWeapons.back();
			runeWeapons.pop_back();
			if (extra)
				extra->DespawnOrUnsummon();
		}

		if (!runeWeapons.empty())
			owner->setRuneWeaponGUID(runeWeapons.front()->GetGUID());

		for (Creature* runeWeapon : runeWeapons)
		{
			if (!runeWeapon)
				continue;
			SyncRuneWeaponAppearance(owner, runeWeapon);
		}
	}

	void AssignRuneWeaponFormation(Player* owner)
	{
		if (!owner || !owner->IsInWorld() || !owner->IsAlive())
			return;

		std::list<Creature*> owned;
		GetOwnedRuneWeapons(owner, owned);
		owned.remove_if([](Creature* c) { return !c || !c->IsAlive(); });

		std::vector<Creature*> sorted(owned.begin(), owned.end());
		std::sort(sorted.begin(), sorted.end(), [](Creature* left, Creature* right)
		{
			return left->GetGUID() < right->GetGUID();
		});

		for (size_t index = 0; index < sorted.size(); ++index)
		{
			Creature* runeWeapon = sorted[index];
			if (!runeWeapon || runeWeapon->GetVictim())
				continue;

			bool leftSide = (index % 2) == 0;
			size_t sideIndex = index / 2;
			float angle = MELEE_BASE_ANGLE + float(sideIndex) * MELEE_ANGLE_STEP;
			if (!leftSide)
				angle = -angle;

			SyncRuneWeaponAppearance(owner, runeWeapon);
			runeWeapon->GetMotionMaster()->MoveFollow(owner, MELEE_FOLLOW_DIST, angle);
		}
	}

	void DespawnOwnedRuneWeapons(Player* owner)
	{
		if (!owner)
			return;

		std::list<Creature*> owned;
		GetOwnedRuneWeapons(owner, owned);
		for (Creature* runeWeapon : owned)
			if (runeWeapon)
				runeWeapon->DespawnOrUnsummon();
	}
}

class deathknight_expanded_player_script : public PlayerScript
{
public:
	deathknight_expanded_player_script() : PlayerScript("deathknight_expanded_player_script") { }

	void OnPlayerUpdate(Player* player, uint32 diff) override
	{
		if (!player || !player->IsInWorld() || !player->IsAlive())
			return;
		if (player->getClass() != CLASS_DEATH_KNIGHT)
			return;

		uint64 guid = player->GetGUID().GetRawValue();

		if (!player->HasSpell(SPELL_DK_DANCING_RUNE_WEAPON))
			return;

		g_OwnerLastCastTime[guid] += diff;

		uint32& timer = g_RuneWeaponCheckTimers[guid];
		if (timer > diff)
		{
			timer -= diff;
			return;
		}
		timer = RUNE_WEAPON_CHECK_INTERVAL_MS;

		EnsureTwoRuneWeapons(player);
		AssignRuneWeaponFormation(player);

		std::list<Creature*> runeWeapons;
		GetOwnedRuneWeapons(player, runeWeapons);
		runeWeapons.remove_if([](Creature* c) { return !c || !c->IsAlive(); });
		for (Creature* runeWeapon : runeWeapons)
		{
			if (!runeWeapon)
				continue;

			SyncRuneWeaponAppearance(player, runeWeapon);
			runeWeapon->AttackStop();
			runeWeapon->CombatStop(true);
			runeWeapon->SetTarget(ObjectGuid::Empty);
		}
	}

	void OnPlayerLogout(Player* player) override
	{
		if (!player)
			return;

		uint64 guid = player->GetGUID().GetRawValue();
		g_OwnerLastCastTime.erase(guid);
		g_OwnerLastTarget.erase(guid);
		g_RuneWeaponCheckTimers.erase(guid);

		DespawnOwnedRuneWeapons(player);
	}

	void OnPlayerAfterGuardianInitStatsForLevel(Player* player, Guardian* guardian) override
	{
		if (!player || !guardian)
			return;
		if (player->getClass() != CLASS_DEATH_KNIGHT)
			return;
		if (!IsRuneWeaponEntry(guardian->GetEntry()))
			return;

		guardian->SetCanDualWield(false);
		if (!guardian->HasAura(SPELL_PET_AVOIDANCE_AURA))
			guardian->AddAura(SPELL_PET_AVOIDANCE_AURA, guardian);
		if (!guardian->HasAura(SPELL_PET_HIT_EXP_AURA))
			guardian->AddAura(SPELL_PET_HIT_EXP_AURA, guardian);

		SyncRuneWeaponAppearance(player, guardian->ToCreature());
	}
};

class deathknight_expanded_spell_mirror : public AllSpellScript
{
public:
	deathknight_expanded_spell_mirror() : AllSpellScript("deathknight_expanded_spell_mirror") { }

	void OnSpellCast(Spell* spell, Unit* caster, SpellInfo const* spellInfo, bool /*skipCheck*/) override
	{
		if (!spell || !caster || !spellInfo)
			return;

		if (caster->IsCreature())
		{
			Creature* runeWeapon = caster->ToCreature();
			if (!runeWeapon || !IsRuneWeaponEntry(runeWeapon->GetEntry()))
				return;

			int32 runicPowerDelta = 0;
			if (IsRunicPowerSpenderSpell(spellInfo->Id))
				runicPowerDelta = -DK_RUNIC_POWER_SPENDER_DELTA;
			else if (IsRunicPowerBuilderSpell(spellInfo->Id))
				runicPowerDelta = DK_RUNIC_POWER_BUILDER_DELTA;

			if (Player* owner = runeWeapon->GetCharmerOrOwnerPlayerOrPlayerItself())
				if (runicPowerDelta != 0)
					owner->ModifyPower(POWER_RUNIC_POWER, runicPowerDelta);

			return;
		}

		if (!caster->IsPlayer())
			return;

		Player* player = caster->ToPlayer();
		if (!player || player->getClass() != CLASS_DEATH_KNIGHT)
			return;
		if (!player->HasSpell(SPELL_DK_DANCING_RUNE_WEAPON))
			return;

		if (spellInfo->Id == SPELL_DK_SUMMON_RUNE_WEAPON)
			return;
		if (spellInfo->Id == SPELL_DK_DANCING_RUNE_WEAPON)
			return;
		if (!IsMirroredRuneWeaponSpell(spellInfo->Id))
			return;

		uint32 firstSpell = sSpellMgr->GetFirstSpellInChain(spellInfo->Id);
		bool isBloodBoil = firstSpell == SPELL_DK_MIRROR_BLOOD_BOIL;

		Unit* target = spell->m_targets.GetUnitTarget();
		if (!target && !spellInfo->IsPositive())
			target = player->GetVictim();
		if (!target)
			return;

		if (!spellInfo->IsPositive())
		{
			if (!target->IsAlive() || !player->IsValidAttackTarget(target))
				return;
		}

		uint64 guid = player->GetGUID().GetRawValue();
		g_OwnerLastCastTime[guid] = 0;
		g_OwnerLastTarget[guid] = target->GetGUID();

		std::list<Creature*> runeWeapons;
		GetOwnedRuneWeapons(player, runeWeapons);
		runeWeapons.remove_if([](Creature* c) { return !c || !c->IsAlive(); });

		for (Creature* runeWeapon : runeWeapons)
		{
			Unit* runeTarget = target;
			if (spellInfo->IsPositive() && (!runeTarget || runeTarget == player))
				runeTarget = runeWeapon;

			if (!runeTarget)
				continue;

			if (isBloodBoil)
			{
				runeWeapon->CastSpell(runeTarget, SPELL_DK_MIRROR_PESTILENCE, true, nullptr, nullptr, runeWeapon->GetGUID());
				runeWeapon->CastSpell(runeTarget, SPELL_DK_BLOOD_BOIL_TRIGGERED, true, nullptr, nullptr, runeWeapon->GetGUID());
				continue;
			}

			runeWeapon->CastSpell(runeTarget, spellInfo->Id, true, nullptr, nullptr, runeWeapon->GetGUID());
		}
	}
};

class spell_dkx_dancing_rune_weapon : public AuraScript
{
	PrepareAuraScript(spell_dkx_dancing_rune_weapon);

	void HandleEffectApply(AuraEffect const* /*aurEff*/, AuraEffectHandleModes /*mode*/)
	{
		Player* owner = GetUnitOwner() ? GetUnitOwner()->ToPlayer() : nullptr;
		if (!owner || owner->getClass() != CLASS_DEATH_KNIGHT)
			return;

		EnsureTwoRuneWeapons(owner);
	}

	void Register() override
	{
		OnEffectApply += AuraEffectApplyFn(spell_dkx_dancing_rune_weapon::HandleEffectApply, EFFECT_0, SPELL_AURA_DUMMY, AURA_EFFECT_HANDLE_REAL);
	}
};

class spell_dkx_death_strike_retail : public SpellScript
{
	PrepareSpellScript(spell_dkx_death_strike_retail);

	bool Validate(SpellInfo const* /*spellInfo*/) override
	{
		return ValidateSpellInfo({ SPELL_DK_DEATH_STRIKE, SPELL_DK_DEATH_STRIKE_HEAL, SPELL_DKX_BLOOD_SHIELD_SPELL });
	}

	void HandleAfterCast()
	{
		Player* caster = GetCaster() ? GetCaster()->ToPlayer() : nullptr;
		if (!caster || !IsDeathKnight(caster))
			return;

		uint64 recentDamageTaken = GetDamageTakenLast5Seconds(caster);
		int32 healAmount = int32(recentDamageTaken / 2);
		if (healAmount <= 0)
			return;

		caster->CastCustomSpell(caster, SPELL_DK_DEATH_STRIKE_HEAL, &healAmount, nullptr, nullptr, false);

		int32 absorbGain = healAmount;
		if (AuraEffect* shieldEff = caster->GetAuraEffect(SPELL_DKX_BLOOD_SHIELD_SPELL, EFFECT_0))
		{
			int64 mergedAbsorb = int64(shieldEff->GetAmount()) + absorbGain;
			shieldEff->SetAmount(int32(mergedAbsorb));
			shieldEff->GetBase()->RefreshDuration();
			return;
		}

		caster->CastCustomSpell(caster, SPELL_DKX_BLOOD_SHIELD_SPELL, &absorbGain, nullptr, nullptr, true);
	}

	void Register() override
	{
		AfterCast += SpellCastFn(spell_dkx_death_strike_retail::HandleAfterCast);
	}
};

void Addmod_deathknight_expandedScripts()
{
	new deathknight_expanded_player_script();
	new deathknight_expanded_unit_script();
	new deathknight_expanded_spell_mirror();
	RegisterSpellScript(spell_dkx_dancing_rune_weapon);
	RegisterSpellScript(spell_dkx_death_strike_retail);
}
