
CREATE TABLE IF NOT EXISTS `rpg_temperaments` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,                -- Name of the temperament (e.g., Giga-Pumper)
    `rarity` VARCHAR(16) NOT NULL,              -- Rarity (Common, Uncommon, Rare, Epic, Legendary, Ancient)
    `aura_id` INT UNSIGNED NOT NULL,           -- Aura number (spell ID) for temperament
    `comment` TEXT DEFAULT NULL,                -- Description or notes
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Temperament archetypes for RPG bots';
