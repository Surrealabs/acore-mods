# mod-autolearn-spells

AzerothCore module to auto-learn all spells for all classes, with enum-based control for passives and actives.

## Features
- Automatically teaches specified spells to players on login and level up.
- Uses enums to distinguish between active and passive spells for each class.
- Easily configurable: add or remove spells per class in the `classSpells` map in `mod_autolearn_spells.cpp`.

## Usage
- Add the module to your AzerothCore `modules` directory.
- Add your desired spells to the `classSpells` map in the source file.
- Build and enable the module.

## Example
```cpp
static std::unordered_map<uint8, std::vector<std::pair<uint32, LearnType>>> classSpells = {
    { CLASS_WARLOCK, {
        {686, LearnType::ACTIVE},   // Shadow Bolt
        {687, LearnType::ACTIVE},   // Demon Skin
        {18822, LearnType::PASSIVE} // Master Demonologist
    }},
    { CLASS_MAGE, {
        {116, LearnType::ACTIVE},   // Frostbolt
        {168, LearnType::ACTIVE},   // Frost Armor
        {6117, LearnType::PASSIVE}  // Mage Armor
    }}
};
```

## Extending
- Add more classes and spells as needed.
- You can further expand the logic to support spec-based learning or more advanced rules if desired.
