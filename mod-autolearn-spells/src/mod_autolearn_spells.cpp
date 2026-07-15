// AzerothCore module: mod-autolearn-spells
// Auto-learn all spells for all classes, with enum-based control for passives/actives

#include "ScriptMgr.h"
#include "Player.h"
#include <unordered_map>
#include <vector>


// Enum for spell types
enum class LearnType
{
    ACTIVE,
    PASSIVE
};

// Structure for spec-based spell learning with level gating
struct SpecSpell {
    uint32 spellId;
    LearnType type;
    uint8 specId;        // Spec ID (0 = all specs, or use Blizzard spec IDs)
    uint8 levelRequired; // Level required to learn
};


// Example: Mastery spells per class/spec (these gate the spell tree for each spec)
// Use real mastery spell IDs for your server, these are placeholders
static std::unordered_map<uint8, std::unordered_map<uint8, uint32>> classSpecMastery = {
    // { class, { {specId, masterySpellId}, ... } }
    { CLASS_WARLOCK, {
        {1, 12345}, // Affliction Mastery
        {2, 12346}, // Demonology Mastery
        {3, 12347}  // Destruction Mastery
    }},
    { CLASS_MAGE, {
        {1, 22345}, // Arcane Mastery
        {2, 22346}, // Fire Mastery
        {3, 22347}  // Frost Mastery
    }}
    // Add more classes/specs as needed
};

// Example: Spells to learn per class/spec/level (expand as needed)
static std::unordered_map<uint8, std::vector<SpecSpell>> classSpecSpells = {
    // { class, { SpecSpell, ... } }
    { CLASS_WARLOCK, {
        // Mastery spells (gates)
        {12345, LearnType::PASSIVE, 1, 10}, // Affliction Mastery
        {12346, LearnType::PASSIVE, 2, 10}, // Demonology Mastery
        {12347, LearnType::PASSIVE, 3, 10}, // Destruction Mastery
        // Spec-specific spells
        {686, LearnType::ACTIVE, 1, 1},    // Shadow Bolt, Affliction, level 1
        {687, LearnType::ACTIVE, 2, 4},    // Demon Skin, Demonology, level 4
        {18822, LearnType::PASSIVE, 3, 10} // Master Demonologist, Destruction, level 10
    }},
    { CLASS_MAGE, {
        // Mastery spells (gates)
        {22345, LearnType::PASSIVE, 1, 10}, // Arcane Mastery
        {22346, LearnType::PASSIVE, 2, 10}, // Fire Mastery
        {22347, LearnType::PASSIVE, 3, 10}, // Frost Mastery
        // Spec-specific spells
        {116, LearnType::ACTIVE, 3, 1},    // Frostbolt, Frost, level 1
        {168, LearnType::ACTIVE, 2, 4},    // Frost Armor, Fire, level 4
        {6117, LearnType::PASSIVE, 1, 10}  // Mage Armor, Arcane, level 10
    }}
    // Add more classes and spells as needed
};

static bool IsSpellOnActionBar(Player* player, uint32 spellId)
{
    for (uint8 button = 0; button < MAX_ACTION_BUTTONS; ++button)
    {
        ActionButton const* actionButton = player->GetActionButton(button);
        if (!actionButton)
            continue;

        if (actionButton->GetType() == ACTION_BUTTON_SPELL && actionButton->GetAction() == spellId)
            return true;
    }

    return false;
}

static void TryPlaceSpellOnActionBar(Player* player, uint32 spellId)
{
    static constexpr uint8 FIRST_BAR_SLOT_COUNT = 12;

    if (IsSpellOnActionBar(player, spellId))
        return;

    for (uint8 button = 0; button < FIRST_BAR_SLOT_COUNT; ++button)
    {
        if (player->GetActionButton(button))
            continue;

        if (player->addActionButton(button, spellId, ACTION_BUTTON_SPELL))
        {
            player->SendActionButtons(1);
        }
        return;
    }
}

class mod_autolearn_spells_PlayerScript : public PlayerScript
{
public:
    mod_autolearn_spells_PlayerScript() : PlayerScript("mod_autolearn_spells_PlayerScript") { }


    void OnPlayerLevelChanged(Player* player, uint8 /*oldLevel*/) override
    {
        auto it = classSpecSpells.find(player->getClass());
        if (it != classSpecSpells.end())
        {
            uint8 playerSpec = 0; // Default spec, replace with actual spec logic if available
            uint8 playerLevel = player->GetLevel();
            // First, check if player has the mastery spell for their spec
            auto masteryIt = classSpecMastery.find(player->getClass());
            if (masteryIt != classSpecMastery.end()) {
                auto specMasteryIt = masteryIt->second.find(playerSpec);
                if (specMasteryIt != masteryIt->second.end()) {
                    uint32 masterySpellId = specMasteryIt->second;
                    if (!player->HasSpell(masterySpellId) && playerLevel >= 10) {
                        player->learnSpell(masterySpellId, false);
                    }
                }
            }

            // Then, learn spells gated by spec and mastery
            for (const auto& specSpell : it->second)
            {
                // Check spec (0 = all specs, or match specId)
                if (specSpell.specId != 0 && specSpell.specId != playerSpec)
                    continue;
                // Check level requirement
                if (playerLevel < specSpell.levelRequired)
                    continue;
                // If this is a mastery spell, skip (already handled above)
                auto masteryIt2 = classSpecMastery.find(player->getClass());
                if (masteryIt2 != classSpecMastery.end() && masteryIt2->second.count(specSpell.specId))
                    continue;
                if (!player->HasSpell(specSpell.spellId))
                {
                    player->learnSpell(specSpell.spellId, false);

                    if (specSpell.type == LearnType::ACTIVE)
                    {
                        TryPlaceSpellOnActionBar(player, specSpell.spellId);
                    }
                }
            }
        }
    }


    void OnPlayerLogin(Player* player) override
    {
        OnPlayerLevelChanged(player, player->GetLevel());
    }
};

void Addmod_autolearn_spellsScripts()
{
    new mod_autolearn_spells_PlayerScript();
}
