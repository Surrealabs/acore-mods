-- Table: rpg_psychology
-- Defines global psychological multipliers and their effects

CREATE TABLE IF NOT EXISTS `rpg_psychology` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,                -- Name of the psychological type (e.g., Insane, Stoic)
    `rarity` VARCHAR(16) NOT NULL,              -- Rarity (Common, Uncommon, Rare, Epic, Legendary, Ancient)
    `aura_id` INT UNSIGNED NOT NULL,            -- Aura number (spell ID) for psychology
    `comment` TEXT DEFAULT NULL,                -- Description or notes
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Psychological types and multipliers for RPG bots';
