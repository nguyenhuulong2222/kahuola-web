# Kahu Ola — Multilingual Implementation V1
**Version:** 1.1  
**Status:** Production  
**Phase coverage:** Phase 1 (en, vi) — full dynamic coverage; Phase 2 (haw); Phase 3 (tl, ilo, ja)  
**Last updated:** 2026-04-07  
**Doctrine reference:** `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`  
**Glossary reference:** `docs/doctrine/TRANSLATION_GLOSSARY_SEED.md`

---

## Architecture Summary

The multilingual system is a single self-contained JavaScript file with no external dependencies.

```
i18n/
  kahuola-i18n.js        — complete engine + all locale data (single file)

docs/
  doctrine/
    MULTILINGUAL_TRANSLATION_DOCTRINE.md
    TRANSLATION_GLOSSARY_SEED.md
  implementation/
    MULTILINGUAL_IMPLEMENTATION_V1.md   (this file)
```

**No bundler required.** The file loads via `<script src="/i18n/kahuola-i18n.js">` on any page.

---

## How It Works

### Loading order

Both `index.html` and `live-map.html` include:

```html
<script src="/i18n/kahuola-i18n.js"></script>
```

This must appear **before** any inline JS that uses `window.KAHUOLA_I18N`. It is placed:
- `index.html`: immediately before the main inline script block
- `live-map.html`: immediately before the main inline script block

### Global API

After loading, `window.KAHUOLA_I18N` is available:

```javascript
KAHUOLA_I18N.t(key)                 // translate a Class A key
KAHUOLA_I18N.tmpl(key, { n: 5 })   // translate a Class B template with variables
KAHUOLA_I18N.setLang("vi")         // switch language + re-apply DOM
KAHUOLA_I18N.getLang()             // get current language code
KAHUOLA_I18N.applyAll()            // re-apply all data-i18n elements
KAHUOLA_I18N.getSupportedLanguages() // [{ code, label, phase }]
KAHUOLA_I18N.SUPPORTED             // ["en","vi","haw","tl","ilo","ja"]
```

### DOM integration

Static HTML elements use `data-i18n` attribute:

```html
<span data-i18n="legend.monitoring">Monitoring</span>
<a data-i18n="nav.live_map">Live Map</a>
```

On language change, `applyAll()` finds all `[data-i18n]` elements and sets `textContent` to the translated value. The English default text in HTML is always the safe fallback — if `applyAll()` never runs, the page shows English.

### Language persistence

Language preference is stored in `localStorage` under `kahuola_lang`. The engine reads it on `init()` and applies it before `DOMContentLoaded`.

### Language change event

When a user changes language, the engine fires:

```javascript
window.dispatchEvent(new CustomEvent("kahuola:langchange", { detail: { lang } }));
```

Pages listen for this to re-run any JS-driven text updates:

```javascript
window.addEventListener("kahuola:langchange", () => {
  KAHUOLA_I18N.applyAll();
  applyFireScope(); // live-map.html specific
});
```

---

## Locale File Structure

All locales are defined inside `i18n/kahuola-i18n.js` in the `LOCALES` object:

```javascript
var LOCALES = {
  en:  { "nav.live_map": "Live Map", ... },
  vi:  { "nav.live_map": "Bản đồ trực tiếp", ... },
  haw: { "nav.live_map": "__KEEP_ENGLISH__", ... },
  tl:  { "nav.live_map": "Live na Mapa", ... },
  ilo: { "nav.live_map": "Live nga Mapa", ... },
  ja:  { "nav.live_map": "ライブマップ", ... }
};
```

---

## Key Naming Convention

Keys use `namespace.key` format:

| Namespace | Purpose |
|-----------|---------|
| `nav.*` | Navigation labels |
| `brand.*` | Brand and header copy |
| `signal.*` | Signal labels and default copy |
| `status.*` | Status badge labels |
| `freshness.*` | Time/freshness labels (Class B templates) |
| `legend.*` | Map legend items |
| `cta.*` | Call-to-action buttons |
| `context.*` | Context metric labels |
| `civic.*` | Civic guidance phrases |
| `links.*` | Official links section |
| `map.*` | Live-map.html specific UI |
| `source.*` | Source/agency labels |
| `ai.*` | AI/disclosure labels |
| `lang.*` | Language selector UI |

---

## Fallback Rules

1. **Missing key in current locale** → falls back to English (`LOCALES.en[key]`)
2. **Key is `KEEP_ENGLISH` sentinel** → falls back to English (glossary-locked rule)
3. **Key not in English either** → returns the key string itself (safe, visible for debugging)
4. **`KAHUOLA_I18N` not loaded** → HTML default text remains unchanged (blank-screen proof)
5. **`localStorage` unavailable** → silently defaults to English

**Principle:** A missing translation is acceptable. A misleading translation is not.

---

## Glossary-Lock Behavior

The `KEEP_ENGLISH` sentinel (`"__KEEP_ENGLISH__"`) is used for any term where:
- No approved translation exists in the glossary
- The term is hazard-adjacent and requires native review
- The translation has not passed Layer C safety checks

Example from `haw` locale:
```javascript
haw: {
  "status.warning": "__KEEP_ENGLISH__",   // KEEP ENGLISH — critical safety term
  "map.footer":     "Kahu Ola · Kaiaulu", // safe non-hazard copy
}
```

When `t("status.warning")` is called in Hawaiian mode, it returns `"WARNING"` (English).

---

## Phase Coverage

### Phase 1 — English + Vietnamese (fully usable)

**Translated:**
- All navigation labels
- Brand copy
- Signal labels (using glossary-locked terms)
- Status labels (using glossary-locked terms)
- Freshness templates (using glossary-locked terms)
- Legend items
- CTAs
- Context labels
- All civic phrases (using glossary-locked terms)
- Official links section
- Live-map panel head, scope hint, scope control
- All map page buttons
- Source labels (agency acronyms preserved exactly)
- AI/disclosure labels
- Language selector

**Integration surfaces:**
- `index.html`: all static labels, `timeAgo()`, `buildNarrative`, `buildDelta`, `renderSignalStrip`, `renderContextMetrics`, `applyHero`, `renderFireCard`, `renderFloodCard`, `renderKupunaNote`, `setDegradedUi`; full re-render on `kahuola:langchange`
- `live-map.html`: panel head, scope hint, scope control, footer, `applyFreshness`, `syncSmokeButtons`, `syncPerimeterButtons`, `syncFlashFloodLayerVisibility`, `syncWindRiskLayerVisibility`; full button re-sync on `kahuola:langchange`

### Phase 2 — Hawaiian (glossary-locked, conservative)

**Translated:**
- Language selector label (`ʻŌlelo`)
- Navigation: `Pilikino` (Privacy), `Kōkua` (Support), `Ka Hale` (Home)
- Brand guardian: `Kahu Ola` (already the brand name)
- Footer: `Kahu Ola · Kaiaulu`
- Loading indicator: `E kali ana…`
- Language selector aria: `E wālau i ka ʻolelo`

**All hazard terms: KEEP ENGLISH**

Doctrine: "use glossary-locked terms first; where translation is not approved, KEEP ENGLISH"

### Phase 3 — Tagalog, Ilocano, Japanese (framework-ready)

**Each language provides:**
- Language selector label
- Safe navigation labels (Live Map, Home, Privacy, Support)
- Brand guardian phrase
- Safe CTAs (View Live Map)
- Non-hazard UI copy (no account, no ads, map details)
- Loading indicator
- Footer text

**All hazard terms: KEEP ENGLISH**

---

## Adding New Terms

1. Add the English base key to `LOCALES.en` in `i18n/kahuola-i18n.js`
2. Add to `TRANSLATION_GLOSSARY_SEED.md` with LOCKED/RESTRICTED/PROHIBITED status
3. Add translations to each language, using `KEEP_ENGLISH` where not approved
4. Add `data-i18n="your.key"` to the HTML element
5. Test by switching language in the selector

---

## Adding a New Language

1. Add a new locale object in `LOCALES` inside `i18n/kahuola-i18n.js`
2. Add the language code to `SUPPORTED` array
3. Set a phase in `PHASES`
4. Add an `<option>` to both language selectors (index.html, live-map.html)
5. Document in `TRANSLATION_GLOSSARY_SEED.md`

---

## Testing Language Switching

### Manual test procedure

1. Open `index.html` or `live-map.html`
2. Select a language from the selector (bottom-right on map, top-right on homepage)
3. Verify:
   - Navigation labels update
   - Legend items update (index.html)
   - Brand copy updates (Phase 1 languages)
   - Panel head updates (live-map.html, Phase 1)
   - Scope hint updates (live-map.html, Phase 1)
   - Hazard terms remain English (Hawaiian, Phase 3 languages)
   - Agency names (NWS, NOAA, NASA FIRMS) are never changed
   - No blank screen or layout break
4. Refresh page — language preference should persist

### Programmatic test

```javascript
// In browser console:
KAHUOLA_I18N.setLang("vi");
KAHUOLA_I18N.t("nav.live_map")          // → "Bản đồ trực tiếp"
KAHUOLA_I18N.t("source.nasa_firms")     // → "NASA FIRMS" (agency preserved)
KAHUOLA_I18N.tmpl("freshness.updated_min", { n: 5 }) // → "Cập nhật 5 phút trước"

KAHUOLA_I18N.setLang("haw");
KAHUOLA_I18N.t("status.warning")        // → "WARNING" (KEEP ENGLISH)
KAHUOLA_I18N.t("nav.support")           // → "Kōkua"

KAHUOLA_I18N.setLang("en");             // restore
```

---

## Known Risks and Follow-up Items

1. **Dynamic JS strings**: `buildNarrative`, `renderSignalStrip`, `renderContextMetrics`, `renderFireCard`, `renderFloodCard`, `renderKupunaNote`, `setDegradedUi`, `buildDelta`, `applyHero`, `syncSmokeButtons`, `syncPerimeterButtons`, `syncFlashFloodLayerVisibility`, `syncWindRiskLayerVisibility`, and `applyFreshness` are all wired with `_t()` / `_tmpl()`. The langchange handler in both pages re-renders all JS-driven surfaces without polling delay. Remaining hardcoded English strings in HTML are safe initial-render fallbacks only.

2. **Hawaiian terms need native review**: All Hawaiian UI copy was written conservatively. Before broader public rollout, all Hawaiian text should be reviewed by a native speaker or Hawaiian language resource.

3. **Tagalog / Ilocano / Japanese partial coverage**: Phase 3 languages provide UI chrome only. Hazard content remains English. Native QA needed before Phase 3 is considered production-ready for hazard context.

4. **Class C (AI dynamic content) not implemented**: The stub interface is defined in `i18n/kahuola-i18n.js`. Implementation requires Gemma 4 integration with Layer C safety checks. See `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`.

5. **`applyFreshness()` in live-map.html**: Now wired to `_t("map.fresh.*")` keys for all four freshness states. Last fire source time is stored at `window._lastFireSourceTime` so the langchange handler can re-render chips without a new network fetch.

6. **Right-to-left (RTL) languages**: Not in scope. If Arabic or Hebrew are added later, CSS `direction: rtl` handling will be needed.

7. **Back-translation QA**: Vietnamese translations should undergo back-translation spot checks before official public promotion.

---

## Invariant Compliance

| Invariant | How honored |
|-----------|------------|
| I: Client never calls upstream directly | Translation consumes canonical output only; no new upstream calls |
| II: UI renders under all failure conditions | KAHUOLA_I18N failure leaves English default text intact |
| III: Parse fail means drop | Translation never invents missing structure |
| IV: Zero PII | Translation layer adds no personal location or identity data |
| V: Estimated/contextual ≠ official | Civic posture preserved exactly in all translations |

---

*Kahu Ola — Guardian of Life · kahuola.org*  
*Translation improves access. It must never change truth.*
