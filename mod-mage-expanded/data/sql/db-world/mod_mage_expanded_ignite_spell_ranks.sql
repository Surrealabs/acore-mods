-- Fix: the Ignite talent's 5 rank spell IDs (11119/11120/12846/12847/12848)
-- had ZERO rows in `spell_ranks`. Core's spell_mage_ignite::HandleProc
-- (src/server/scripts/Spells/spell_mage.cpp) computes the base Ignite
-- roll-in percentage as `8 * GetSpellInfo()->GetRank()` — and
-- SpellInfo::GetRank() (SpellInfo.cpp) returns 1 whenever ChainEntry is
-- null (i.e. the spell has no spell_ranks row), REGARDLESS of which rank
-- is actually talented. This capped Ignite's base damage roll-in at a flat
-- 8% for EVERY player, even at max rank (should scale up to 40% at rank
-- 5) — explains "20k Pyroblast crit only ticking Ignite for 400": with
-- 4 max ticks, 20000 * 8% / 4 = 400 exactly.
--
-- This also affects the Hot Streak talent chain (44445/44446/44448, also
-- missing spell_ranks rows) though nothing in mod-mage-expanded currently
-- calls GetRank() on it — added for consistency/future-proofing.
DELETE FROM `spell_ranks` WHERE `first_spell_id` IN (11119, 44445);

INSERT INTO `spell_ranks` (`first_spell_id`, `spell_id`, `rank`) VALUES
(11119, 11119, 1),
(11119, 11120, 2),
(11119, 12846, 3),
(11119, 12847, 4),
(11119, 12848, 5),
(44445, 44445, 1),
(44445, 44446, 2),
(44445, 44448, 3);
