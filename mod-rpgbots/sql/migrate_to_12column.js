#!/usr/bin/env node
// One-time data migration: flattens the old 6-bucket/30-slot bot_rotations
// data into the new 12-column layout (run AFTER
// bot_rotations_12column_migration.sql has added the new columns, BEFORE
// bot_rotations_12column_drop_old.sql removes the old ones).
//
// Mapping (best-effort, see rpgbots redesign discussion):
//   filler          = filler_1 (first of the old 5 filler slots)
//   rotation_1..5   = the first 5 non-zero spell IDs found by scanning
//                     ability_1..5, then dot_1..5, then hot_1..5 in that
//                     priority order (dedup'd) - old "abilities" is usually
//                     already the real rotation; specs that instead relied
//                     on dedicated DoT/HoT buckets (e.g. Affliction,
//                     Restoration) get those folded in here instead.
//   interrupt       = 0 (no old equivalent - fill in manually)
//   mobility        = mobility_1 (first of the old 5 mobility slots)
//   defensive_1/2   = untouched, already correct (kept as-is by the schema
//                     migration, not touched by this script)
//   damage_cooldown = 0 (no reliable old equivalent - fill in manually)
//   party_buff      = 0 (no reliable old equivalent - fill in manually)
//
// Usage: node migrate_to_12column.js

import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const mysql = require('/root/azerothcore-wotlk/modules/mod-sdbeditor/web/node_modules/mysql2/promise.js');

function resolveDbConfig() {
    const content = fs.readFileSync('/root/azerothcore-wotlk/env/dist/etc/worldserver.conf', 'utf8');
    const match = content.match(/WorldDatabaseInfo\s*=\s*"([^"]+)"/);
    const [host, port, user, password] = match[1].split(';');
    return { host: host || '127.0.0.1', port: Number(port || 3306), user, password, database: 'rpgbots' };
}

const connection = await mysql.createConnection(resolveDbConfig());
try {
    const [rows] = await connection.query(
        'SELECT class_id, spec_index, filler_1, ' +
        'ability_1, ability_2, ability_3, ability_4, ability_5, ' +
        'dot_1, dot_2, dot_3, dot_4, dot_5, ' +
        'hot_1, hot_2, hot_3, hot_4, hot_5, ' +
        'mobility_1 FROM bot_rotations'
    );

    let updated = 0;
    for (const row of rows) {
        const candidates = [
            row.ability_1, row.ability_2, row.ability_3, row.ability_4, row.ability_5,
            row.dot_1, row.dot_2, row.dot_3, row.dot_4, row.dot_5,
            row.hot_1, row.hot_2, row.hot_3, row.hot_4, row.hot_5,
        ].filter(id => id && id !== 0);

        const seen = new Set();
        const rotation = [];
        for (const id of candidates) {
            if (seen.has(id)) continue;
            seen.add(id);
            rotation.push(id);
            if (rotation.length === 5) break;
        }
        while (rotation.length < 5) rotation.push(0);

        await connection.query(
            'UPDATE bot_rotations SET filler = ?, rotation_1 = ?, rotation_2 = ?, rotation_3 = ?, rotation_4 = ?, rotation_5 = ?, mobility = ? WHERE class_id = ? AND spec_index = ?',
            [row.filler_1, ...rotation, row.mobility_1, row.class_id, row.spec_index]
        );
        updated++;
    }

    console.log(`Migrated ${updated} spec row(s) into the new 12-column layout.`);
    console.log('interrupt / damage_cooldown / party_buff were left at 0 for all specs - fill those in manually per spec.');
} finally {
    await connection.end();
}
