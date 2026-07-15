
# SurrealWoW — Stat Conversion Tracker
|---------------------------------------------------------------------------------------------------------------------------------------|

## Tank Passive (Stance/Form Gated)

- Crit rating grants additional parry rating.
- Multistrike rating grants additional dodge rating.
- This passive is active only for these classes while in tank state:
	- Death Knight: Frost Presence
	- Warrior: Defensive Stance
	- Paladin: Righteous Fury active
	- Druid: Bear Form or Dire Bear Form
| Original Stat Name        | Item Mod ID | CR Slot | → | New Stat Name | Intended Effect | Notes                                       |
|---------------------------|-------------|---------|---|---------------|-----------------|---------------------------------------------|
| Agility                   | 3           | —       |   | Agility       | 1 AGI = 2 AP    |  Attack Power                               |
| Strength                  | 4           | —       |   | Strength      | 1 STR = 2 AP    |  Attack Power                               |
| Intellect                 | 5           | —       |   | Intellect     | 1 INT = 2  SD   |  Spell Damage                               |
| Spirit                    | 6           | —       |   | Spirit        | 1 SPI = 2  SH   |  Spell Healing                              |
| Stamina                   | 7           | —       |   | Stamina       | 1 STA = 10 HP   |  Health                                     |
| Defense Rating            | 12          | 1       |   | Haste         | 10 = 1% @LvlMax |  Attack Speed/Cast Speed/Periodic Rate By 1%|
| Dodge Rating              | 13          | 2       |   | Crit          | 10 = 1% @LvlMax |  Crit Rate By 1% All Crit Damage By 2%      |
| Parry Rating              | 14          | 3       |   | Mastery       | 10 = %          |  Depends on class implementation            |
| Block Rating              | 15          | 4       |   | Multistrike   | 10 = 1% @LvlMax |  Chance to Recast at 33% Effectiveness      |
| Hit Rating (Melee)        | 16          | 5       |   | Versatility   | 10 = 1% @LvlMax |  Damage taken -0.5% Damage/Healing +1%      |
| Hit Rating (Ranged)       | 17          | 6       |   |               |                 |                                             |
| Hit Rating (Spell)        | 18          | 7       |   |               |                 |                                             |
| Crit Rating (Melee)       | 19          | 8       |   |               |                 |                                             |
| Crit Rating (Ranged)      | 20          | 9       |   |               |                 |                                             |
| Crit Rating (Spell)       | 21          | 10      |   |               |                 |                                             |
| Hit Avoidance (Melee)     | 22          | 11      |   |               |                 |                                             |
| Hit Avoidance (Ranged)    | 23          | 12      |   |               |                 |                                             |
| Hit Avoidance (Spell)     | 24          | 13      |   |               |                 |                                             |
| Crit Avoidance (Melee)    | 25          | 14      |   |               |                 |                                             |
| Crit Avoidance (Ranged)   | 26          | 15      |   |               |                 |                                             |
| Crit Avoidance (Spell)    | 27          | 16      |   |               |                 |                                             |
| Haste Rating (Melee)      | 28          | 17      |   |               |                 |                                             |
| Haste Rating (Ranged)     | 29          | 18      |   |               |                 |                                             |
| Haste Rating (Spell)      | 30          | 19      |   |               |                 |                                             |
| Resilience Rating         | 35          | 14-16   |   |               |                 |                                             |
| Expertise Rating          | 37          | 23      |   |               |                 |                                             |
| Attack Power              | 38          | —       |   |               |                 |                                             |
| Ranged Attack Power       | 39          | —       |   |               |                 |                                             |
| Mana Regeneration         | 43          | —       |   |               |                 |                                             |
| Armor Penetration Rating  | 44          | 24      |   |               |                 |                                             |
| Spell Power               | 45          | —       |   |               |                 |                                             |
| Health Regeneration       | 46          | —       |   |               |                 |                                             |
| Spell Penetration         | 47          | —       |   |               |                 |                                             |
| Block Value               | 48          | —       |   |               |                 |                                             |
|---------------------------------------------------------------------------------------------------------------------------------------|