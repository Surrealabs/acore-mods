// BotEquipSystem.cpp
// Equipment management for bot alts:
//   .army equip <name>   — Auto-equip best items from bags (by item level)
//   .army gear  <name>   — Show currently equipped gear
//
// Master Loot works natively: bots are real Player objects in the group,
// so the master can assign loot items to them just like normal players.
// After assigning loot, use `.army equip <name>` to auto-equip upgrades.

#include "ScriptMgr.h"
#include "Chat.h"
#include "CommandScript.h"
#include "Player.h"
#include "BotAI.h"
#include "Item.h"
#include "ItemTemplate.h"
#include "Bag.h"
#include <algorithm>
#include <vector>

using namespace Acore::ChatCommands;

namespace
{
    static constexpr uint8 NO_SLOT = 0xFF;

    // ─── InventoryType → equipment slot mapping ───────────────────────────
    // s2 is set for dual-slot types (finger / trinket)
    void InvTypeToSlots(uint32 invType, uint8& s1, uint8& s2)
    {
        s2 = NO_SLOT;
        switch (invType)
        {
            case INVTYPE_HEAD:            s1 = EQUIPMENT_SLOT_HEAD;       break;
            case INVTYPE_NECK:            s1 = EQUIPMENT_SLOT_NECK;       break;
            case INVTYPE_SHOULDERS:       s1 = EQUIPMENT_SLOT_SHOULDERS;  break;
            case INVTYPE_BODY:            s1 = EQUIPMENT_SLOT_BODY;       break;
            case INVTYPE_CHEST:
            case INVTYPE_ROBE:            s1 = EQUIPMENT_SLOT_CHEST;      break;
            case INVTYPE_WAIST:           s1 = EQUIPMENT_SLOT_WAIST;      break;
            case INVTYPE_LEGS:            s1 = EQUIPMENT_SLOT_LEGS;       break;
            case INVTYPE_FEET:            s1 = EQUIPMENT_SLOT_FEET;       break;
            case INVTYPE_WRISTS:          s1 = EQUIPMENT_SLOT_WRISTS;     break;
            case INVTYPE_HANDS:           s1 = EQUIPMENT_SLOT_HANDS;      break;
            case INVTYPE_FINGER:          s1 = EQUIPMENT_SLOT_FINGER1;
                                          s2 = EQUIPMENT_SLOT_FINGER2;    break;
            case INVTYPE_TRINKET:         s1 = EQUIPMENT_SLOT_TRINKET1;
                                          s2 = EQUIPMENT_SLOT_TRINKET2;   break;
            case INVTYPE_CLOAK:           s1 = EQUIPMENT_SLOT_BACK;       break;
            case INVTYPE_WEAPON:
            case INVTYPE_WEAPONMAINHAND:
            case INVTYPE_2HWEAPON:        s1 = EQUIPMENT_SLOT_MAINHAND;   break;
            case INVTYPE_SHIELD:
            case INVTYPE_WEAPONOFFHAND:
            case INVTYPE_HOLDABLE:        s1 = EQUIPMENT_SLOT_OFFHAND;    break;
            case INVTYPE_RANGED:
            case INVTYPE_RANGEDRIGHT:
            case INVTYPE_THROWN:
            case INVTYPE_RELIC:           s1 = EQUIPMENT_SLOT_RANGED;     break;
            case INVTYPE_TABARD:          s1 = EQUIPMENT_SLOT_TABARD;     break;
            default:                      s1 = NO_SLOT;                   break;
        }
    }

    // Item level of whatever is currently in an equipment slot (0 if empty)
    uint32 EquippedILvl(Player* bot, uint8 slot)
    {
        Item* item = bot->GetItemByPos(INVENTORY_SLOT_BAG_0, slot);
        if (!item || !item->GetTemplate()) return 0;
        return item->GetTemplate()->ItemLevel;
    }

    // For dual-slot items: pick the slot with the lower iLvl (or an empty one)
    uint8 BestDualSlot(Player* bot, uint8 s1, uint8 s2, uint32 newILvl)
    {
        uint32 i1 = EquippedILvl(bot, s1);
        uint32 i2 = EquippedILvl(bot, s2);
        if (i1 == 0) return s1;
        if (i2 == 0) return s2;
        uint8 weaker    = (i1 <= i2) ? s1 : s2;
        uint32 weakILvl = std::min(i1, i2);
        return (newILvl > weakILvl) ? weaker : NO_SLOT;
    }

    // ─── Slot display names ───────────────────────────────────────────────
    const char* SlotName(uint8 slot)
    {
        switch (slot)
        {
            case EQUIPMENT_SLOT_HEAD:      return "Head";
            case EQUIPMENT_SLOT_NECK:      return "Neck";
            case EQUIPMENT_SLOT_SHOULDERS: return "Shoulders";
            case EQUIPMENT_SLOT_BODY:      return "Shirt";
            case EQUIPMENT_SLOT_CHEST:     return "Chest";
            case EQUIPMENT_SLOT_WAIST:     return "Waist";
            case EQUIPMENT_SLOT_LEGS:      return "Legs";
            case EQUIPMENT_SLOT_FEET:      return "Feet";
            case EQUIPMENT_SLOT_WRISTS:    return "Wrists";
            case EQUIPMENT_SLOT_HANDS:     return "Hands";
            case EQUIPMENT_SLOT_FINGER1:   return "Ring 1";
            case EQUIPMENT_SLOT_FINGER2:   return "Ring 2";
            case EQUIPMENT_SLOT_TRINKET1:  return "Trinket 1";
            case EQUIPMENT_SLOT_TRINKET2:  return "Trinket 2";
            case EQUIPMENT_SLOT_BACK:      return "Back";
            case EQUIPMENT_SLOT_MAINHAND:  return "Main Hand";
            case EQUIPMENT_SLOT_OFFHAND:   return "Off Hand";
            case EQUIPMENT_SLOT_RANGED:    return "Ranged";
            case EQUIPMENT_SLOT_TABARD:    return "Tabard";
            default:                       return "???";
        }
    }

    // ─── Auto-equip: scan bags, equip any item-level upgrades ─────────────
    // Re-scans after each equip to avoid stale positions.
    uint32 DoAutoEquip(Player* bot, ChatHandler* handler)
    {
        uint32 total = 0;
        bool changed = true;

        while (changed)
        {
            changed = false;

            // Collect every item currently in bags
            struct Candidate { Item* item; uint8 bag; uint8 slot; uint32 ilvl; };
            std::vector<Candidate> cands;

            // Main backpack
            for (uint8 s = INVENTORY_SLOT_ITEM_START; s < INVENTORY_SLOT_ITEM_END; ++s)
            {
                Item* it = bot->GetItemByPos(INVENTORY_SLOT_BAG_0, s);
                if (it && it->GetTemplate())
                    cands.push_back({ it, INVENTORY_SLOT_BAG_0, s, it->GetTemplate()->ItemLevel });
            }
            // Extra bags (slots 19-22)
            for (uint8 b = INVENTORY_SLOT_BAG_START; b < INVENTORY_SLOT_BAG_END; ++b)
            {
                Bag* bag = bot->GetBagByPos(b);
                if (!bag) continue;
                for (uint8 s = 0; s < bag->GetBagSize(); ++s)
                {
                    Item* it = bot->GetItemByPos(b, s);
                    if (it && it->GetTemplate())
                        cands.push_back({ it, b, s, it->GetTemplate()->ItemLevel });
                }
            }

            // Best items first
            std::sort(cands.begin(), cands.end(),
                      [](auto& a, auto& b) { return a.ilvl > b.ilvl; });

            for (auto& c : cands)
            {
                ItemTemplate const* proto = c.item->GetTemplate();
                if (!proto) continue;

                uint8 s1, s2;
                InvTypeToSlots(proto->InventoryType, s1, s2);
                if (s1 == NO_SLOT) continue;

                uint8 target;
                if (s2 != NO_SLOT)
                    target = BestDualSlot(bot, s1, s2, proto->ItemLevel);
                else
                {
                    if (EquippedILvl(bot, s1) >= proto->ItemLevel)
                        continue; // current is same or better
                    target = s1;
                }
                if (target == NO_SLOT) continue;

                // Validate the bot can actually wear this
                uint16 dest;
                if (bot->CanEquipItem(target, dest, c.item, true) != EQUIP_ERR_OK)
                    continue;

                // Swap: bag item → equipment slot, old equipment → bag position
                uint16 src = ((uint16)c.bag  << 8) | c.slot;
                uint16 dst = ((uint16)INVENTORY_SLOT_BAG_0 << 8) | target;
                bot->SwapItem(src, dst);

                handler->PSendSysMessage("  Equipped: {} (iLvl {}) → {}",
                                         proto->Name1, proto->ItemLevel, SlotName(target));
                ++total;
                changed = true;
                break; // re-scan after each equip
            }
        }
        return total;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
class BotEquipCommands : public CommandScript
{
public:
    BotEquipCommands() : CommandScript("BotEquipCommands") {}

    ChatCommandTable GetCommands() const override
    {
        static ChatCommandTable armyTable =
        {
            { "equip", HandleEquipCmd, SEC_GAMEMASTER, Console::No },
            { "gear",  HandleGearCmd,  SEC_GAMEMASTER, Console::No },
        };
        static ChatCommandTable topTable =
        {
            { "army", armyTable },
        };
        return topTable;
    }

    // ─── .army equip <name> ────────────────────────────────────────────────
    static bool HandleEquipCmd(ChatHandler* handler, std::string name)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        Player* bot = info->player;
        handler->PSendSysMessage("|cff00ff00Auto-equipping gear for {}...|r", name);

        uint32 count = DoAutoEquip(bot, handler);
        if (count == 0)
            handler->PSendSysMessage("No upgrades found in bags.");
        else
        {
            bot->SaveToDB(false, true);
            handler->PSendSysMessage("|cff00ff00Equipped {} item(s).|r", count);
        }
        return true;
    }

    // ─── .army gear <name> ─────────────────────────────────────────────────
    static bool HandleGearCmd(ChatHandler* handler, std::string name)
    {
        Player* master = handler->GetSession()->GetPlayer();
        if (!master) return false;

        BotInfo* info = sBotMgr.FindBot(master->GetGUID().GetCounter(), name);
        if (!info || !info->player)
        {
            handler->PSendSysMessage("|cffff0000No bot named '{}' found.|r", name);
            return true;
        }

        Player* bot = info->player;
        handler->PSendSysMessage("|cff00ff00=== Gear for {} ===|r", bot->GetName());

        for (uint8 slot = EQUIPMENT_SLOT_START; slot < EQUIPMENT_SLOT_END; ++slot)
        {
            Item* item = bot->GetItemByPos(INVENTORY_SLOT_BAG_0, slot);
            if (item && item->GetTemplate())
            {
                auto* proto = item->GetTemplate();
                handler->PSendSysMessage("  {}: {} (iLvl {})",
                                         SlotName(slot), proto->Name1, proto->ItemLevel);
            }
            else
                handler->PSendSysMessage("  {}: (empty)", SlotName(slot));
        }
        return true;
    }
};

void AddBotEquipSystem()
{
    new BotEquipCommands();
}
