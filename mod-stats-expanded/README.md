# mod-stats-expanded

AzerothCore module to add and manage custom stats with **database-driven scaling** for runtime configuration.

## Features

✅ **Database-driven configuration** - Change stat scaling without recompiling  
✅ **Runtime reload** - Update stats while server is running  
✅ **Per-stat enable/disable** - Control which stats are active  
✅ **Level-linear scaling** - Balanced across all player levels  
✅ **Easy to customize** - Simply adjust `base_requirement` values in database  

## Custom Stats Included

| Stat | Rating Source | Effect | Rating Per 1% |
|------|---------------|--------|---|
| CRIT_DAMAGE_RATING | Crit Rating | Increases crit multiplier bonus | 100 |
| MULTISTRIKE_RATING | Resilience Rating | Spell duplication chance (50% effectiveness) | 105 |
| VERSATILITY_RATING | Defense Rating | Damage dealt & taken modifier | 110 |
| POTENCY_RATING | Armor Pen | Direct damage percentage increase | 120 |
| HASTE_RATING | Haste Rating | Cast speed & GCD reduction (750ms minimum) | 130 |
| MASTERY_RATING | Expertise Rating | Mastery effect | 140 |

## Database Setup

### SQL Table Creation

Run this on your `acore_characters` database:

```sql
DROP TABLE IF EXISTS `custom_character_stats`;
CREATE TABLE `custom_character_stats` (
  `stat_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `base_requirement` FLOAT NOT NULL DEFAULT 100,
  `description` VARCHAR(256) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `last_updated` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  COMMENT='Custom stat scaling configuration for Stats Expanded module'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `custom_character_stats` (`stat_name`, `base_requirement`, `description`, `enabled`) VALUES
('CRIT_DAMAGE_RATING', 100, 'Crit Rating = Crit Damage Multiplier Bonus (50% conversion: 100 crit rating = 50% bonus multiplier)', 1),
('MULTISTRIKE_RATING', 105, 'Resilience Rating = Multistrike Chance (1% chance per 105 resilience rating)', 1),
('VERSATILITY_RATING', 110, 'Defense Rating = Versatility (10% of defense rating becomes versatility percentage)', 1),
('POTENCY_RATING', 120, 'Armor Pen Rating = Damage Increase (1 armor pen rating = 0.01% damage increase)', 1),
('HASTE_RATING', 130, 'Haste Rating = Haste % and GCD Reduction (100 haste rating = 1% haste, GCD reduced to min 750ms)', 1),
('MASTERY_RATING', 140, 'Expertise Rating = Mastery Effect (100 expertise rating = 1% mastery)', 1);
```

The SQL file is included at: `modules/mod-stats-expanded/sql/custom_character_stats.sql`

### Runtime Configuration

Adjust stat scaling without recompiling:

```sql
-- View current stat scaling
SELECT * FROM custom_character_stats;

-- Make a stat cheaper (less rating needed for same benefit)
UPDATE custom_character_stats SET base_requirement = 100 WHERE stat_name = 'MULTISTRIKE_RATING';

-- Disable a stat temporarily
UPDATE custom_character_stats SET enabled = 0 WHERE stat_name = 'VERSATILITY_RATING';

-- Re-enable a stat
UPDATE custom_character_stats SET enabled = 1 WHERE stat_name = 'VERSATILITY_RATING';
```

## Linear Level Scaling Formula

All stats scale linearly by player level:

```
percentage = (rawRating * 60) / (playerLevel * baseRequirement)
```

**Examples** (with MULTISTRIKE_RATING = 105):
- **Level 60** with 105 resilience = `(105 * 60) / (60 * 105)` = **1% multistrike**
- **Level 30** with 105 resilience = `(105 * 60) / (30 * 105)` = **0.5% multistrike**
- **Level 1** with 105 resilience = `(105 * 60) / (1 * 105)` = **30% multistrike** (but player level 1, so minimal effect)

## Installation for Server Admins

1. **Enable the module** in your AzerothCore build
2. **Run the SQL** on your `acore_characters` database
3. **Rebuild/Restart** the server

The module will automatically load stat scaling from the database on startup.

## For Module Developers

The scaling system is designed to be easily extended:

```cpp
// Load from database at startup
StatsExpandedScaling::InitializeScaling();

// Get scaled conversion for any stat
float percentage = StatsExpandedScaling::GetScaledConversion(player, "STAT_NAME", rawRating);

// Check if stat is enabled
if (StatsExpandedScaling::IsStatEnabled("STAT_NAME"))
    // Apply stat effects
```

---
_Last updated: 2026-02-04_



/*
=====================================
        WoW 3.3.5a Default Stat Reference
=====================================

Main (Base) Stats:
    - Strength (STR)
    - Agility (AGI)
    - Stamina (STA)
    - Intellect (INT)
    - Spirit (SPI)

Secondary Stats:
    - Armor
    - Attack Power
    - Spell Power
    - Hit Rating (melee, ranged, spell)
    - Crit Rating (melee, ranged, spell)
    - Haste Rating (melee, ranged, spell)
    - Defense Rating
    - Dodge Rating
    - Parry Rating
    - Block Rating
    - Resilience
    - Expertise Rating
    - Armor Penetration
    - Spell Penetration
    - Mana Regeneration
    - Health Regeneration

-------------------------------------
 Baseline Stat Relationships (3.3.5a)
-------------------------------------
    - Strength: Increases melee attack power, block value, parry (for some classes)
    - Agility: Increases ranged attack power, crit chance, dodge (for some classes)
    - Stamina: Increases health
    - Intellect: Increases mana, crit chance (for spells)
    - Spirit: Increases mana/health regeneration
    - Armor: Reduces physical damage taken
    - Attack Power: Increases melee/ranged damage
    - Spell Power: Increases spell damage/healing
    - Hit Rating: Reduces chance to miss
    - Crit Rating: Increases chance to crit
    - Haste Rating: Increases attack/cast speed
    - Defense/Dodge/Parry/Block: Increases avoidance
    - Resilience: Reduces damage from players
    - Expertise: Reduces chance to be dodged/parried
    - Armor/Spell Penetration: Reduces target's armor/resistances
    - Mana/Health Regeneration: Restores mana/health over time
*/