-- Table: character_rpg_data
-- Stores the RPG stats and psychological profile for each character

CREATE TABLE IF NOT EXISTS `character_rpg_data` (
    `guid` INT UNSIGNED NOT NULL,
    `mechanics` TINYINT UNSIGNED NOT NULL DEFAULT 0,         -- Current % chance to succeed (0-100)
    `mechanics_xp` INT UNSIGNED NOT NULL DEFAULT 0,          -- Progress toward next rank
    `rotation` TINYINT UNSIGNED NOT NULL DEFAULT 0,          -- Current % chance for optimal DPS (0-100)
    `rotation_xp` INT UNSIGNED NOT NULL DEFAULT 0,           -- Progress toward next rank
    `heroism` TINYINT UNSIGNED NOT NULL DEFAULT 0,           -- Current % chance to save a group member
    `heroism_xp` INT UNSIGNED NOT NULL DEFAULT 0,            -- Progress toward next rank
    `temperament_id` INT UNSIGNED NOT NULL,                  -- Foreign Key → rpg_temperaments
    `psych_id` INT UNSIGNED NOT NULL,                        -- Foreign Key → rpg_psychology
    PRIMARY KEY (`guid`),
    KEY `idx_temperament_id` (`temperament_id`),
    KEY `idx_psych_id` (`psych_id`)
    -- Add FOREIGN KEY constraints if referenced tables exist
    -- FOREIGN KEY (`temperament_id`) REFERENCES `rpg_temperaments`(`id`),
    -- FOREIGN KEY (`psych_id`) REFERENCES `rpg_psychology`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RPG stats and psychological profile for each character';
