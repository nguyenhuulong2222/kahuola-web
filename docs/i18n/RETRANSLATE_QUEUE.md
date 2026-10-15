# Retranslate queue

Locale values removed because the English meaning changed (or the translation
was doubtful). Until a reviewed translation is added back, these keys fall back
to Layer A English via `t()` in `i18n/kahuola-i18n.js`.

| Date | Locale | Key | Why removed | New EN text |
|---|---|---|---|---|
| 2026-10-15 | haw | `map.s_smoke_none` | SAT-0a-2: EN meaning changed — no HMS polygon is not "no smoke" | No smoke outlined |
| 2026-10-15 | tl | `map.s_smoke_none` | SAT-0a-2: EN meaning changed | No smoke outlined |
| 2026-10-15 | ilo | `map.s_smoke_none` | SAT-0a-2: EN meaning changed | No smoke outlined |
| 2026-10-15 | ja | `map.s_smoke_none` | SAT-0a-2: EN meaning changed | No smoke outlined |
| 2026-10-15 | haw | `map.smoke_layer_note` | Possible opposite meaning — needs speaker review | Layer visibility does not mean smoke is detected. |

Also changed in EN by SAT-0a-2, but these keys were already `KEEP_ENGLISH` in
haw / tl / ilo / ja (English shown), so nothing was removed. A future
translation must use the new EN text:

| Key | New EN text |
|---|---|
| `map.s_smoke_none_metric` | None outlined in current file |
| `map.s_smoke_none_note` | NOAA analysts have not outlined smoke near Hawaiʻi in this file. |
| `map.s_smoke_none_sub` | This does not rule out smoke. HMS is updated a few times a day and cannot see through cloud. |
| `map.s_smoke_unavail_sub` | This is different from “No smoke outlined”. |

New keys (EN + VI only; other locales fall back to EN): `map.s_smoke_prev_day`,
`map.popup_hms_date`, `card.snapshot.smoke_none_outlined`.
