/**
 * Kahu Ola — Multilingual Translation Engine
 * Version: 1.0
 * Phase coverage: en (1), vi (1), haw (2), tl (3), ilo (3), ja (3)
 *
 * Architecture: single self-contained file, no dependencies, no bundler.
 * Global: window.KAHUOLA_I18N
 *
 * Doctrine compliance:
 *   - Layer A (canonical English) is the fallback for all missing keys
 *   - KEEP_ENGLISH sentinel preserves English for unapproved hazard terms
 *   - PROHIBITED terms are never surfaced from locale data
 *   - Class A (fixed labels) and Class B (civic templates) only
 *   - Class C (AI dynamic content) is stubbed — see bottom of file
 *
 * See: docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md
 * See: docs/doctrine/TRANSLATION_GLOSSARY_SEED.md
 */
(function () {
  "use strict";

  // ── Constants ────────────────────────────────────────────────
  var STORAGE_KEY = "kahuola_lang";
  var DEFAULT_LANG = "en";
  var KEEP_ENGLISH = "__KEEP_ENGLISH__";
  var SUPPORTED = ["en", "vi", "haw", "tl", "ilo", "ja"];

  // ── Phase metadata ────────────────────────────────────────────
  // Phase 1: en, vi — fully usable
  // Phase 2: haw — glossary-locked, conservative
  // Phase 3: tl, ilo, ja — framework-ready, partial coverage
  var PHASES = { en: 1, vi: 1, haw: 2, tl: 3, ilo: 3, ja: 3 };

  // ═══════════════════════════════════════════════════════════════
  // LOCALE DATA
  // Each locale uses the key format: "namespace.key"
  // Missing key → falls through to English automatically.
  // Value of KEEP_ENGLISH → English is used (glossary-locked rule).
  // PROHIBITED terms are not present in any locale.
  // ═══════════════════════════════════════════════════════════════

  var LOCALES = {

    // ── ENGLISH (Phase 1 — canonical base) ────────────────────
    en: {
      "meta.label": "English",
      "meta.lang_html": "en",

      // Navigation
      "nav.live_map": "Live Map",
      "nav.official_alerts": "Official Alerts",
      "nav.how_it_works": "How It Works",
      "nav.mission": "Mission",
      "nav.privacy": "Privacy",
      "nav.support": "Support",
      "nav.home": "Home",
      "nav.data_sources": "Data Sources",

      // Brand
      "brand.kicker": "Kahu Ola \xb7 Guardian of Life",
      "brand.title": "Hawai\u02bfi Hazard Signals",
      "brand.sub": "Clear civic hazard signals for wildfire, flood, storm, and air quality across the Hawaiian Islands.",
      "brand.guardian": "Guardian of Life",

      // Signal labels (Class A — glossary-locked)
      "signal.fire_label": "Fire \xb7 NASA FIRMS",
      "signal.flood_label": "Flood \xb7 NWS Official",
      "signal.fire_no_detections": "No fire detections",
      "signal.flood_no_watches": "No flood watches",
      "signal.fire_monitoring": "\ud83d\udd25 Fire Signal \u2014 Monitoring",
      "signal.flood_monitoring": "\ud83c\udf0a Flood Signal \u2014 Monitoring",
      "signal.fire_copy_clear": "No satellite wildfire detections in the current statewide snapshot.",
      "signal.flood_copy_clear": "No active NWS flash flood watches or warnings statewide.",
      "signal.conditions_unchanged": "Conditions unchanged since your last visit",
      "signal.check_neighborhood": "\ud83d\udccd Check My Neighborhood",
      "signal.detail_label": "Signal detail",

      // Status badges (Class A — glossary-locked)
      "status.clear": "CLEAR",
      "status.active": "ACTIVE",
      "status.monitoring": "MONITORING",
      "status.normal": "NORMAL",
      "status.watch": "WATCH",
      "status.warning": "WARNING",
      "status.alert": "ALERT",
      "status.unavailable": "Unavailable",
      "status.no_active_signal": "No active signal",

      // Freshness labels (Class B — templates, glossary-locked)
      "freshness.updated_recently": "Updated recently",
      "freshness.updated_just_now": "Updated just now",
      "freshness.updated_min": "Updated {n} min ago",
      "freshness.updated_hr": "Updated {n} hr ago",
      "freshness.updated_day": "Updated {n} day ago",
      "freshness.loading": "Loading\u2026",
      "freshness.data_may_be_stale": "Data may be stale",
      "freshness.delayed": "Delayed",

      // Legend
      "legend.signal": "Signal",
      "legend.monitoring": "Monitoring",
      "legend.fire_active": "Fire Active",
      "legend.flood_alert": "Flood Alert",

      // CTAs
      "cta.view_live_map": "View Live Map",
      "cta.open_live_map": "Open Live Map \u2192",
      "cta.official_alerts": "Official Alerts",
      "cta.view_official_guidance": "View official guidance",
      "cta.check_neighborhood": "\ud83d\udccd Check My Neighborhood",

      // Context labels
      "context.fire_weather": "Fire Weather",
      "context.rainfall": "Rainfall",
      "context.flood_risk": "Flood Risk",

      // Civic phrases (Class B — glossary-locked)
      "civic.not_official_alert": "Not an official alert",
      "civic.follow_official_guidance": "Follow official guidance",
      "civic.monitor_conditions": "Monitor conditions",
      "civic.view_official_guidance": "View official guidance",
      "civic.review_local_updates": "Review local updates",
      "civic.no_account_required": "No accounts required",
      "civic.on_device_proximity": "On-device proximity",
      "civic.no_ads": "No data selling \xb7 No ads",
      "civic.guardian_note": "Kahu Ola is an independent civic technology platform that aggregates publicly available government data sources. It does not represent or replace official emergency services, evacuation orders, or governmental directives. Always follow official county, state, and federal guidance.",
      "civic.source_disclosure": "Kahu Ola provides situational awareness and does not replace official emergency directives.",
      "civic.not_official_hazard_signal": "Not an official hazard signal",

      // Official links section
      "links.official_resources": "Official Emergency Resources",
      "links.official_copy": "Kahu Ola does not issue emergency orders. Follow official authorities for urgent decisions.",

      // Map page (live-map.html) — Class A + B
      "map.panel_head_hawaii": "Fire Signals \xb7 Hawai\u02bfi",
      "map.panel_head_usa": "Fire Signals \xb7 USA",
      "map.scope_hint_hawaii": "Showing satellite fire detections for Hawai\u02bfi only.",
      "map.scope_hint_usa": "Showing satellite fire detections across the USA.",
      "map.scope_label": "Fire Scope",
      "map.scope_hawaii": "Hawai\u02bfi",
      "map.scope_usa": "USA",
      "map.refresh": "\u21bb REFRESH",
      "map.use_location": "Use My Location",
      "map.locating": "Locating...",
      "map.satellite": "Satellite",
      "map.smoke_on": "Smoke Layer: On",
      "map.smoke_off": "Smoke Layer: Off",
      "map.perimeters_on": "Perimeters: On",
      "map.perimeters_off": "Perimeters: Off",
      "map.flood_on": "Flood Layers: On",
      "map.flood_off": "Flood Layers: Off",
      "map.weather_on": "Fire Weather: On",
      "map.weather_off": "Fire Weather: Off",
      "map.map_details": "Map Details",
      "map.hide_details": "Hide Details",
      "map.footer": "Kahu Ola civic technology",
      "map.low_bandwidth": "Low-Bandwidth Mode",
      "map.static_preview": "Static preview \u2014 loads instantly during network outages.",
      "map.open_full_map": "Open Full Map \u2197",
      "map.mini_map_title": "Mini Hawai\u02bfi Map",
      "map.mini_map_desc": "Visual confirmation of statewide hazard context. Tap anywhere on the map to open interactive mode.",

      // Source labels (agency acronyms always preserved — Class A locked)
      "source.label": "Source",
      "source.sources": "Sources",
      "source.nasa_firms": "NASA FIRMS",
      "source.nws": "NWS",
      "source.noaa": "NOAA",
      "source.epa": "EPA",
      "source.usgs": "USGS",
      "source.hiema": "HIEMA",

      // AI/disclosure labels (Class A — glossary-locked)
      "ai.ai_generated_context": "AI-generated context",
      "ai.not_official_hazard_signal": "Not an official hazard signal",
      "ai.community_submitted": "Community-submitted",
      "ai.unverified": "Unverified",

      // ── Hero kickers (Class A — state badge labels) ───────────
      "hero.kicker.system_normal": "SYSTEM NORMAL",
      "hero.kicker.fire_active": "FIRE SIGNAL ACTIVE",
      "hero.kicker.red_flag": "RED FLAG WARNING",
      "hero.kicker.flood_warning": "FLOOD WARNING ACTIVE",
      "hero.kicker.flood_watch": "FLOOD WATCH",
      "hero.kicker.fire_watch": "FIRE WEATHER WATCH",
      "hero.kicker.degraded": "DATA DELAYED",

      // ── Hero titles (innerHTML — developer-controlled static HTML only) ──
      // These contain <span class="hero-title-key"> for visual emphasis.
      // Use ONLY as innerHTML on a trusted, developer-controlled element.
      "hero.title_html.monitoring": "Hawai\u02bfi is <span class=\"hero-title-key\">calm</span> right now.",
      "hero.title_html.fire_active": "<span class=\"hero-title-key\">Wildfire</span> detected in Hawai\u02bfi.",
      "hero.title_html.flood_warning": "Flash flood <span class=\"hero-title-key\">warning</span> in effect.",
      "hero.title_html.flood_watch": "Flood <span class=\"hero-title-key\">watch</span> conditions developing.",
      "hero.title_html.degraded": "Latest data temporarily <span class=\"hero-title-key\">delayed</span>.",

      // ── Hero narratives (Class B — civic explanations) ────────
      "hero.narrative.system_normal": "No active watches, warnings, or satellite fire detections across the state.",
      "hero.narrative.fire_active": "NASA FIRMS satellite has detected active fire heat signatures. Open the live map to see location and distance from you.",
      "hero.narrative.red_flag": "NWS has issued a Red Flag Warning. Low humidity, high winds, and dry fuel increase wildfire risk significantly.",
      "hero.narrative.flood_warning": "NWS has issued an active flash flood warning. Move away from streams, avoid low-lying roads, and follow official instructions.",
      "hero.narrative.flood_watch": "NWS is monitoring conditions that could produce flash flooding. Prepare, stay informed, and avoid flood-prone areas.",
      "hero.narrative.fire_watch": "NWS is monitoring fire weather conditions in parts of Hawai\u02bfi. Stay informed, avoid outdoor burning, and watch for official updates.",
      "hero.narrative.degraded": "Some data sources are delayed. Showing last known state. Always follow official emergency instructions.",

      // ── Banner titles (Class B templates, {n} = count, {s} = plural suffix) ──
      "hero.banner.system_normal": "\u2705 No Active Hazards Detected",
      "hero.banner.fire_active": "\ud83d\udd25 {n} Active Wildfire Signal{s}",
      "hero.banner.red_flag": "\ud83d\udea9 NWS Red Flag Warning Active",
      "hero.banner.flood_warning": "\ud83c\udf0a Flash Flood Warning \u2014 NWS Official",
      "hero.banner.flood_watch": "\ud83d\udc41 NWS Flash Flood Watch Active",
      "hero.banner.fire_watch": "\u26a0\ufe0f NWS Fire Weather Watch Active",
      "hero.banner.degraded": "\u26a0\ufe0f Degraded snapshot active",

      // ── Banner source copies (Class A — agency names LOCKED) ──
      "hero.banner_copy.nasa_nws": "NASA FIRMS \xb7 NWS \xb7 NEXRAD \xb7 verified this snapshot",
      "hero.banner_copy.nasa_firms": "Source: NASA FIRMS VIIRS/MODIS \xb7 verified this snapshot",
      "hero.banner_copy.nws_official": "Source: National Weather Service \xb7 official alert",
      "hero.banner_copy.nws_watch": "Source: National Weather Service \xb7 watch in effect",
      "hero.banner_copy.nws_red_flag": "Source: National Weather Service \xb7 official",
      "hero.banner_copy.degraded": "Fallback data \u2014 not current",

      // ── Signal strip labels (Class A) ─────────────────────────
      "signal.strip.fire_clear": "No fire detections",
      "signal.strip.fire_count": "{n} detection{s} detected",
      "signal.strip.flood_clear": "No flood watches or warnings",
      "signal.strip.flood_warning_active": "Flash flood warning active",
      "signal.strip.flood_watch_active": "Flash flood watch active",
      "signal.strip.wx_clear": "No active fire weather warnings",
      "signal.strip.wx_redflag": "Red Flag Warning active",
      "signal.strip.wx_watch": "Fire Weather Watch \u2014 NWS Official",

      // ── Status labels (additional) ────────────────────────────
      "status.elevated": "ELEVATED",
      "status.red_flag": "RED FLAG",

      // ── Signal card titles (Class B templates) ────────────────
      "signal.fire_title_active": "\ud83d\udd25 Fire Signal \u2014 {n} Active",
      "signal.flood_title_active": "\ud83c\udf27 Flood Signal \u2014 {n} Elevated",

      // ── Signal card long copies (Class B) ─────────────────────
      "signal.fire_copy_monitoring_long": "Kahu Ola is constantly scanning satellite data to protect our communities. While statewide signals are clear, wildland conditions change rapidly. Use the Live Map to verify your exact neighborhood.",
      "signal.fire_copy_active_tmpl": "{n} wildfire signal{s} detected in the current statewide Worker snapshot. Open the live map for island-level detail.",
      "signal.flood_copy_monitoring_long": "Our system is monitoring watershed conditions to keep residents safe. No broad flood watches are active, but mountain streams can flash-flood without warning. Check your local area to be sure.",
      "signal.flood_copy_active_tmpl": "{n} flood context feature{s} detected in the current statewide snapshot. Heavy rain may cause streams and low-lying roads to change quickly.",

      // ── Context metric values (Class A) ───────────────────────
      "context.wind_red_flag": "Red Flag",
      "context.wind_watch": "Watch",
      "context.wind_high": "High",
      "context.wind_normal": "Normal",
      "context.rain_heavy": "Heavy Rain",
      "context.rain_moderate": "Moderate Rain",
      "context.rain_light": "Light Rain",
      "context.none": "None",
      "context.flood_warning_active": "Warning Active",
      "context.flood_watch_active": "Watch Active",
      "context.flood_none_active": "None Active",
      "context.nws_official": "NWS Official",
      "context.nexrad_mrms": "NEXRAD / MRMS",

      // ── System notes (Class B — civic guidance) ───────────────
      "system.note_default": "Kahu Ola provides public hazard situational awareness using trusted scientific and government data sources.",
      "system.note_degraded": "Some data sources are delayed. Kahu Ola is showing the safest available fallback. Always follow official emergency instructions.",
      "system.note_flood_warning": "Flash flood warning active. Avoid flooded roads and stream crossings. Follow NWS and county instructions.",
      "system.degraded_chip": "System Degraded",
      "system.snapshot_delayed": "Snapshot temporarily delayed",

      // ── Signal detail toggle labels (Class B) ─────────────────
      "signal.detail_fire_count": "{n} fire signal{s} \u2014 see detail",
      "signal.detail_flood": "Flood detail",
      "signal.detail_all_clear": "Signal detail \u2014 all clear",

      // ── Kupuna & Keiki notes (Class B — civic safety) ─────────
      "kupuna.title.fire": "K\u016bpuna & Keiki Fire Safety",
      "kupuna.title.flood_warning": "K\u016bpuna & Keiki Flood Safety",
      "kupuna.title.flood_watch": "K\u016bpuna & Keiki Flood Awareness",
      "kupuna.title.elevated": "K\u016bpuna & Keiki Safety",
      "kupuna.title.calm": "K\u016bpuna & Keiki Safety",
      "kupuna.body.fire": "Active wildfire signals detected. K\u016bpuna, keiki, and those with respiratory conditions should stay indoors with windows closed. Monitor official evacuation orders and keep go-bags ready. E m\u0101lama pono.",
      "kupuna.body.flood_warning": "Flash flood warning is active. K\u016bpuna, keiki, and residents near streams or low-lying roads should move to higher ground immediately. Do not attempt to cross flooded roadways. Follow official NWS and county emergency instructions. E m\u0101lama pono.",
      "kupuna.body.flood_watch": "A flood watch is in effect. K\u016bpuna, keiki, and those in low-lying or flood-prone areas should prepare for possible rapid water rises. Have an emergency plan ready and monitor official alerts. E m\u0101lama pono.",
      "kupuna.body.elevated": "Fire weather conditions are elevated across parts of Hawai\u02bfi. K\u016bpuna, keiki, and those with breathing concerns should stay informed and limit strenuous outdoor activity during dry, windy periods. E m\u0101lama pono.",
      "kupuna.body.calm": "Statewide conditions are calm. K\u016bpuna, keiki, and those in low-lying areas should remain informed through official alerts. E m\u0101lama pono \u2014 care for one another.",

      // ── Delta / what-changed labels (Class B — time templates) ─
      "delta.first_check": "First check \u2014 baseline established",
      "delta.improved": "Conditions improved since {age}",
      "delta.status_changed": "Status changed since {age}",
      "delta.new_fires": "{n} new fire detection{s} since {age}",
      "delta.fires_down": "Fire detections down from {last} since {age}",
      "delta.no_change": "No change since {age}",
      "delta.checked": "Conditions checked",
      "delta.age_min": "{n}m ago",
      "delta.age_hr": "{n}h ago",

      // ── Map freshness chip labels (Class A) ───────────────────
      "map.fresh.unknown": "\u25cf UNKNOWN",
      "map.fresh.fresh": "\u2713 FRESH",
      "map.fresh.stale": "\u26a0 MAY BE STALE",
      "map.fresh.outdated": "\u2717 OUTDATED",

      // ── Map footer mode labels (Class A) ──────────────────────
      "map.footer_live": "Kahu Ola civic technology \xb7 live",
      "map.footer_local": "Kahu Ola civic technology \xb7 local",

      // ── Homepage lower sections ───────────────────────────────

      // System Transparency card
      "transparency.title": "System Transparency",
      "transparency.copy": "Kahu Ola integrates public data from trusted scientific and government sources.",
      "transparency.disclaimer": "Kahu Ola provides public hazard situational awareness. It is not an official emergency service. If a data source is degraded or stale, it will be clearly labeled.",

      // Official links — individual card descriptions (agency names stay English)
      "links.hiema_desc": "State emergency information and preparedness guidance",
      "links.maui_ema_desc": "County emergency instructions, alerts, and local safety information",
      "links.nws_hfo_desc": "Official watches, warnings, and weather statements for Hawai\u02bfi",

      // How It Works
      "how.label": "How It Works",
      "how.title_l1": "Satellite data to plain language",
      "how.title_l2": "\u2014 in under 15 minutes",
      "how.lead": "Kahu Ola connects six government data systems and normalizes them into three human-readable signal types. No jargon. No raw feeds. Just clear, honest hazard status.",
      "how.step1_title": "Government sensors detect",
      "how.step1_body": "NASA FIRMS satellites orbit every 90 minutes. NOAA radar scans continuously. NWS meteorologists issue watches and warnings. These systems never stop.",
      "how.step2_title": "Aggregator normalizes",
      "how.step2_body": "The Kahu Ola Aggregator ingests, validates, and caches every signal server-side. Raw government data becomes clean, versioned FireSignal \xb7 SmokeSignal \xb7 Perimeter. Keys never reach the client.",
      "how.step3_title": "You see plain language",
      "how.step3_body": "The app displays honest, timestamped signals with clear freshness labels. Stale data is always marked. Estimated perimeters are never labeled official. Your location never leaves your device.",

      // Mission
      "mission.label": "Our Mission",
      "mission.title_l1": "Built after Lahaina.",
      "mission.title_l2": "Built for everyone.",
      "mission.lead": "The 2023 Lahaina wildfire revealed a devastating gap: advanced satellites were tracking the fire in real-time while residents had no clear, accessible signal. Life-saving data existed \u2014 it just wasn\u2019t reaching people in plain language.",
      "mission.body": "Kahu Ola was built to close that gap. Not to replace official emergency services \u2014 but to give every resident of Hawai\u02bfi access to the same data that emergency managers use, translated into calm, understandable language before, during, and after a hazard.",
      "mission.chip_fire": "\uD83D\uDD25 Wildfire-First",
      "mission.chip_privacy": "\uD83D\uDD12 Privacy-First",
      "mission.chip_resilience": "\u26A1 Failure-Tolerant",
      "mission.chip_grant": "\uD83C\uDFDB Grant-Ready",
      "mission.val1_title": "Engineered for resilience",
      "mission.val1_body": "Cache-first architecture with validated data snapshots. The app renders under 8 distinct failure conditions \u2014 including full network loss. A degraded signal is infinitely safer than a blank screen.",
      "mission.val2_title": "Privacy as a design principle",
      "mission.val2_body": "Safety should not require surveillance. Proximity awareness is computed on-device. No location history is built, stored, or transmitted \u2014 ever. No accounts. No ads. No data selling.",
      "mission.val3_title": "Honest about uncertainty",
      "mission.val3_body": "Every signal shows its source and age. Estimated fire perimeters are never labeled official. Stale data is always marked. Kahu Ola never fabricates or inflates hazard severity.",
      "mission.val4_title": "Community-driven \xb7 Free public service",
      "mission.val4_body": "An independent civic technology initiative \u2014 not a government agency, not a commercial product. Built to remain freely accessible to every resident of Hawai\u02bfi.",

      // Privacy-First Architecture
      "privarch.label": "Privacy-First Architecture",
      "privarch.title": "Zero PII. Zero tracking.",
      "privarch.lead": "We do not need to know who you are to help you stay safe. Kahu Ola is designed around a single rule: your data stays on your device.",
      "privarch.card1_title": "No accounts required",
      "privarch.card1_body": "Core safety views are accessible without sign-in. No email. No phone number. No profile.",
      "privarch.card2_title": "On-device proximity",
      "privarch.card2_body": "Hazard distance checks compute locally on your device. Your GPS coordinates never cross the device boundary.",
      "privarch.card3_title": "No data selling \xb7 No ads",
      "privarch.card3_body": "No advertising profiles. No behavioral tracking. No brokered personal data. The platform is ad-free by design.",
      "privarch.footnote_prefix": "Full detail for reviewers and auditors:",
      "privarch.footnote_link": "Privacy Policy",

      // Data Infrastructure
      "infra.label": "Data Infrastructure",
      "infra.title_l1": "16 open government sources.",
      "infra.title_l2": "One civic layer.",
      "infra.lead": "Every data source is public, open, and verifiable. Kahu Ola never creates its own hazard data \u2014 it normalizes, timestamps, and presents what government agencies already publish.",
      "infra.note": "All upstream calls are proxied server-side through the Kahu Ola Cloudflare Worker. The browser never contacts government APIs directly \u2014 a core architectural invariant that protects API keys and ensures rate-limit safety.",

      // Get Started
      "gs.label": "Get Started",
      "gs.title_l1": "Available now on web.",
      "gs.title_l2": "Mobile app coming soon.",
      "gs.lead": "Open Kahu Ola on any browser \u2014 no download, no account, no setup. The live hazard map loads instantly and works offline after first visit.",
      "gs.web_badge": "Web \xb7 Available Now",
      "gs.web_title": "Kahu Ola Live Map",
      "gs.web_desc": "Real-time wildfire detections, flash flood alerts, tsunami status, hurricane tracks, and rain radar \u2014 all in one civic dashboard. Works on any device, any browser.",
      "gs.web_li1": "NASA FIRMS fire hotspots",
      "gs.web_li2": "NWS official flood + tsunami alerts",
      "gs.web_li3": "Live NEXRAD rain radar",
      "gs.web_li4": "Fire weather + wind context",
      "gs.web_li5": "FRESH / STALE data transparency",
      "gs.web_cta": "Open Live Map \u2192",
      "gs.mobile_badge": "iOS \xb7 Coming Soon",
      "gs.mobile_title": "Mobile App",
      "gs.mobile_desc": "The Kahu Ola mobile app brings the full hazard intelligence dashboard to iOS with native notifications for critical alerts and offline-first resilience.",
      "gs.mobile_li1": "Push alerts for active warnings",
      "gs.mobile_li2": "On-device proximity geofencing",
      "gs.mobile_li3": "Offline-first \u2014 works without signal",
      "gs.mobile_li4": "Zero PII \xb7 No account required",
      "gs.mobile_cta": "Get Notified at Launch",

      // Footer
      "footer.follow": "Follow for daily hazard briefs:",

      // Language selector
      "lang.label": "Language",
      "lang.select_aria": "Select language"
    },

    // ── VIETNAMESE (Phase 1 — fully usable) ───────────────────
    // All hazard terms use glossary-locked translations from TRANSLATION_GLOSSARY_SEED.md
    // Agency acronyms (NWS, NOAA, NASA FIRMS, EPA, USGS, HIEMA) are preserved
    vi: {
      "meta.label": "Ti\u1ebfng Vi\u1ec7t",
      "meta.lang_html": "vi",

      // Navigation
      "nav.live_map": "B\u1ea3n \u0111\u1ed3 tr\u1ef1c ti\u1ebfp",
      "nav.official_alerts": "C\u1ea3nh b\u00e1o ch\u00ednh th\u1ee9c",
      "nav.how_it_works": "C\u00e1ch th\u1ee9c ho\u1ea1t \u0111\u1ed9ng",
      "nav.mission": "S\u1ee9 m\u1ec7nh",
      "nav.privacy": "Quy\u1ec1n ri\u00eang t\u01b0",
      "nav.support": "H\u1ed7 tr\u1ee3",
      "nav.home": "Trang ch\u1ee7",
      "nav.data_sources": "Ngu\u1ed3n d\u1eef li\u1ec7u",

      // Brand
      "brand.kicker": "Kahu Ola \xb7 Ng\u01b0\u1eddi b\u1ea3o v\u1ec7 cu\u1ed9c s\u1ed1ng",
      "brand.title": "T\xedn hi\u1ec7u nguy c\u01a1 Hawai\u02bfi",
      "brand.sub": "T\xedn hi\u1ec7u nguy c\u01a1 d\u00e2n s\u1ef1 r\u00f5 r\u00e0ng v\u1ec1 ch\u00e1y r\u1eebng, l\u0169 l\u1ee5t, b\u00e3o v\u00e0 ch\u1ea5t l\u01b0\u1ee3ng kh\u00f4ng kh\xed tr\xean qu\u1ea7n \u0111\u1ea3o Hawaii.",
      "brand.guardian": "Ng\u01b0\u1eddi b\u1ea3o v\u1ec7 cu\u1ed9c s\u1ed1ng",

      // Signal labels — using glossary-locked terms
      // hazard.fire_signal (LOCKED) = "T\xedn hi\u1ec7u ch\u00e1y"
      "signal.fire_label": "T\xedn hi\u1ec7u ch\u00e1y \xb7 NASA FIRMS",
      "signal.flood_label": "L\u0169 \xb7 NWS Ch\xednh th\u1ee9c",
      "signal.fire_no_detections": "Kh\xf4ng ph\u00e1t hi\u1ec7n ch\u00e1y",
      "signal.flood_no_watches": "Kh\xf4ng c\xf3 theo d\xf5i l\u0169 l\u1ee5t",
      // state.monitoring (LOCKED) = "\u0110ang theo d\xf5i"
      "signal.fire_monitoring": "\ud83d\udd25 T\xedn hi\u1ec7u ch\u00e1y \u2014 \u0110ang theo d\xf5i",
      "signal.flood_monitoring": "\ud83c\udf0a T\xedn hi\u1ec7u l\u0169 \u2014 \u0110ang theo d\xf5i",
      "signal.fire_copy_clear": "Kh\xf4ng ph\u00e1t hi\u1ec7n ch\u00e1y r\u1eebng qua v\u1ec7 tinh trong \u1ea3nh ch\u1ee5p to\u00e0n ti\u1ec3u bang hi\u1ec7n t\u1ea1i.",
      "signal.flood_copy_clear": "Kh\xf4ng c\xf3 c\u1ea3nh b\u00e1o ho\u1eb7c theo d\xf5i l\u0169 qu\u00e9t ch\xednh th\u1ee9c t\u1eeb NWS tr\xean to\u00e0n ti\u1ec3u bang.",
      "signal.conditions_unchanged": "\u0110i\u1ec1u ki\u1ec7n kh\xf4ng thay \u0111\u1ed5i k\u1ec3 t\u1eeb l\u1ea7n truy c\u1eadp tr\u01b0\u1edbc",
      "signal.check_neighborhood": "\ud83d\udccd Ki\u1ec3m tra khu v\u1ef1c c\u1ee7a t\xf4i",
      "signal.detail_label": "Chi ti\u1ebft t\xedn hi\u1ec7u",

      // Status — glossary-locked
      "status.clear": "B\xccNH TH\u01af\u1edcNG",
      // state.active (LOCKED) = "\u0110ang ho\u1ea1t \u0111\u1ed9ng"
      "status.active": "\u0110ang ho\u1ea1t \u0111\u1ed9ng",
      // state.monitoring (LOCKED) = "\u0110ang theo d\xf5i"
      "status.monitoring": "\u0110ang theo d\xf5i",
      "status.normal": "B\xccNH TH\u01af\u1edcNG",
      "status.watch": "THEO D\xd5I",
      "status.warning": "C\u1ea2NH B\xc1O",
      "status.alert": "C\u1ea2NH B\xc1O",
      "status.unavailable": "Kh\xf4ng c\xf3 d\u1eef li\u1ec7u",
      // state.no_active_signal (LOCKED) = "Kh\xf4ng c\xf3 t\xedn hi\u1ec7u \u0111ang ho\u1ea1t \u0111\u1ed9ng"
      "status.no_active_signal": "Kh\xf4ng c\xf3 t\xedn hi\u1ec7u \u0111ang ho\u1ea1t \u0111\u1ed9ng",

      // Freshness — glossary-locked
      // freshness.updated (LOCKED) = "C\u1eadp nh\u1eadt"
      "freshness.updated_recently": "C\u1eadp nh\u1eadt g\u1ea7n \u0111\xe2y",
      "freshness.updated_just_now": "V\u1eeba c\u1eadp nh\u1eadt",
      "freshness.updated_min": "C\u1eadp nh\u1eadt {n} ph\xfat tr\u01b0\u1edbc",
      "freshness.updated_hr": "C\u1eadp nh\u1eadt {n} gi\u1edd tr\u01b0\u1edbc",
      "freshness.updated_day": "C\u1eadp nh\u1eadt {n} ng\u00e0y tr\u01b0\u1edbc",
      "freshness.loading": "\u0110ang t\u1ea3i\u2026",
      // freshness.data_may_be_stale (LOCKED) = "D\u1eef li\u1ec7u c\xf3 th\u1ec3 \u0111\xe3 c\u0169"
      "freshness.data_may_be_stale": "D\u1eef li\u1ec7u c\xf3 th\u1ec3 \u0111\xe3 c\u0169",
      "freshness.delayed": "B\u1ecb ch\u1eadm",

      // Legend
      "legend.signal": "T\xedn hi\u1ec7u",
      // state.monitoring (LOCKED) = "\u0110ang theo d\xf5i"
      "legend.monitoring": "\u0110ang theo d\xf5i",
      "legend.fire_active": "Ch\u00e1y \u0111ang x\u1ea3y ra",
      "legend.flood_alert": "C\u1ea3nh b\u00e1o l\u0169",

      // CTAs
      "cta.view_live_map": "Xem b\u1ea3n \u0111\u1ed3 tr\u1ef1c ti\u1ebfp",
      "cta.open_live_map": "M\u1edf b\u1ea3n \u0111\u1ed3 tr\u1ef1c ti\u1ebfp \u2192",
      "cta.official_alerts": "C\u1ea3nh b\u00e1o ch\xednh th\u1ee9c",
      // civic.view_official_guidance (LOCKED) = "Xem h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c"
      "cta.view_official_guidance": "Xem h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c",
      "cta.check_neighborhood": "\ud83d\udccd Ki\u1ec3m tra khu v\u1ef1c c\u1ee7a t\xf4i",

      // Context labels — glossary-locked
      // hazard.fire_weather (LOCKED) = "Th\u1eddi ti\u1ebft ch\u00e1y r\u1eebng"
      "context.fire_weather": "Th\u1eddi ti\u1ebft ch\u00e1y r\u1eebng",
      // hazard.rainfall (LOCKED) = "L\u01b0\u1ee3ng m\u01b0a"
      "context.rainfall": "L\u01b0\u1ee3ng m\u01b0a",
      "context.flood_risk": "Nguy c\u01a1 l\u0169 l\u1ee5t",

      // Civic phrases — glossary-locked
      // civic.not_official_alert (LOCKED) = "Kh\xf4ng ph\u1ea3i c\u1ea3nh b\u00e1o ch\xednh th\u1ee9c"
      "civic.not_official_alert": "Kh\xf4ng ph\u1ea3i c\u1ea3nh b\u00e1o ch\xednh th\u1ee9c",
      // civic.follow_official_guidance (LOCKED) = "H\xe3y l\xe0m theo h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c"
      "civic.follow_official_guidance": "H\xe3y l\xe0m theo h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c",
      // civic.monitor_conditions (LOCKED) = "Theo d\xf5i t\xecnh h\xecnh"
      "civic.monitor_conditions": "Theo d\xf5i t\xecnh h\xecnh",
      "civic.view_official_guidance": "Xem h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c",
      // civic.review_local_updates (LOCKED) = "Xem c\u1eadp nh\u1eadt \u0111\u1ecba ph\u01b0\u01a1ng"
      "civic.review_local_updates": "Xem c\u1eadp nh\u1eadt \u0111\u1ecba ph\u01b0\u01a1ng",
      "civic.no_account_required": "Kh\xf4ng c\u1ea7n t\xe0i kho\u1ea3n",
      "civic.on_device_proximity": "T\xednh kho\u1ea3ng c\u00e1ch tr\xean thi\u1ebft b\u1ecb",
      "civic.no_ads": "Kh\xf4ng b\u00e1n d\u1eef li\u1ec7u \xb7 Kh\xf4ng qu\u1ea3ng c\u00e1o",
      "civic.guardian_note": "Kahu Ola l\xe0 n\u1ec1n t\u1ea3ng c\xf4ng ngh\u1ec7 d\u00e2n s\u1ef1 \u0111\u1ed9c l\u1eadp t\u1ed5ng h\u1ee3p c\u00e1c ngu\u1ed3n d\u1eef li\u1ec7u c\u1ee7a ch\xednh ph\u1ee7. Kh\xf4ng thay th\u1ebf c\u00e1c d\u1ecbch v\u1ee5 kh\u1ea9n c\u1ea5p, l\u1ec7nh s\u01a1 t\u00e1n, ho\u1eb7c ch\u1ec9 th\u1ecb c\u1ee7a ch\xednh ph\u1ee7. Lu\xf4n tu\xe2n theo h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c c\u1ee7a ch\xednh quy\u1ec1n \u0111\u1ecba ph\u01b0\u01a1ng v\xe0 ti\u1ec3u bang.",
      "civic.source_disclosure": "Kahu Ola cung c\u1ea5p nh\u1eadn th\u1ee9c t\xecnh hu\u1ed1ng v\xe0 kh\xf4ng thay th\u1ebf c\u00e1c ch\u1ec9 \u0111\u1ea1o kh\u1ea9n c\u1ea5p ch\xednh th\u1ee9c.",
      // ai.not_official_hazard_signal (LOCKED) = "Kh\xf4ng ph\u1ea3i t\xedn hi\u1ec7u nguy c\u01a1 ch\xednh th\u1ee9c"
      "civic.not_official_hazard_signal": "Kh\xf4ng ph\u1ea3i t\xedn hi\u1ec7u nguy c\u01a1 ch\xednh th\u1ee9c",

      // Official links
      "links.official_resources": "T\xe0i nguy\xean kh\u1ea9n c\u1ea5p ch\xednh th\u1ee9c",
      "links.official_copy": "Kahu Ola kh\xf4ng ph\u00e1t l\u1ec7nh kh\u1ea9n c\u1ea5p. H\xe3y tu\xe2n theo c\u01a1 quan ch\u1ee9c n\u0103ng ch\xednh th\u1ee9c cho c\u00e1c quy\u1ebft \u0111\u1ecbnh kh\u1ea9n c\u1ea5p.",

      // Map page
      "map.panel_head_hawaii": "T\xedn hi\u1ec7u ch\u00e1y \xb7 Hawai\u02bfi",
      "map.panel_head_usa": "T\xedn hi\u1ec7u ch\u00e1y \xb7 To\u00e0n n\u01b0\u1edbc M\u1ef9",
      "map.scope_hint_hawaii": "\u0110ang hi\u1ec3n th\u1ecb ph\u00e1t hi\u1ec7n ch\u00e1y qua v\u1ec7 tinh t\u1ea1i Hawai\u02bfi.",
      "map.scope_hint_usa": "\u0110ang hi\u1ec3n th\u1ecb ph\u00e1t hi\u1ec7n ch\u00e1y qua v\u1ec7 tinh tr\xean to\u00e0n n\u01b0\u1edbc M\u1ef9.",
      "map.scope_label": "Ph\u1ea1m vi ch\u00e1y",
      "map.scope_hawaii": "Hawai\u02bfi",
      "map.scope_usa": "To\u00e0n n\u01b0\u1edbc M\u1ef9",
      "map.refresh": "\u21bb L\xe0m m\u1edbi",
      "map.use_location": "D\xf9ng v\u1ecb tr\xed c\u1ee7a t\xf4i",
      "map.locating": "\u0110ang \u0111\u1ecbnh v\u1ecb...",
      "map.satellite": "V\u1ec7 tinh",
      "map.smoke_on": "L\u1edbp kh\xf3i: B\u1eadt",
      "map.smoke_off": "L\u1edbp kh\xf3i: T\u1eaft",
      "map.perimeters_on": "Ranh gi\u1edbi ch\u00e1y: B\u1eadt",
      "map.perimeters_off": "Ranh gi\u1edbi ch\u00e1y: T\u1eaft",
      "map.flood_on": "L\u1edbp l\u0169: B\u1eadt",
      "map.flood_off": "L\u1edbp l\u0169: T\u1eaft",
      "map.weather_on": "Th\u1eddi ti\u1ebft ch\u00e1y: B\u1eadt",
      "map.weather_off": "Th\u1eddi ti\u1ebft ch\u00e1y: T\u1eaft",
      "map.map_details": "Chi ti\u1ebft b\u1ea3n \u0111\u1ed3",
      "map.hide_details": "\u1ea8n chi ti\u1ebft",
      "map.footer": "C\xf4ng ngh\u1ec7 d\u00e2n s\u1ef1 Kahu Ola",
      "map.low_bandwidth": "Ch\u1ebf \u0111\u1ed9 b\u0103ng th\xf4ng th\u1ea5p",
      "map.static_preview": "\u1ea2nh t\u0129nh \u2014 t\u1ea3i ngay c\u1ea3 khi m\u1ea1ng ch\u1eadm.",
      "map.open_full_map": "M\u1edf b\u1ea3n \u0111\u1ed3 \u0111\u1ea7y \u0111\u1ee7 \u2197",
      "map.mini_map_title": "B\u1ea3n \u0111\u1ed3 thu nh\u1ecf Hawai\u02bfi",
      "map.mini_map_desc": "X\xe1c nh\u1eadn t\xecnh tr\u1ea1ng nguy c\u01a1 to\u00e0n ti\u1ec3u bang. Nh\u1ea5n v\xe0o b\u1ea3n \u0111\u1ed3 \u0111\u1ec3 m\u1edf ch\u1ebf \u0111\u1ed9 t\u01b0\u01a1ng t\u00e1c.",

      // Source labels — agency acronyms locked
      "source.label": "Ngu\u1ed3n",
      "source.sources": "Ngu\u1ed3n d\u1eef li\u1ec7u",
      "source.nasa_firms": "NASA FIRMS",
      "source.nws": "NWS",
      "source.noaa": "NOAA",
      "source.epa": "EPA",
      "source.usgs": "USGS",
      "source.hiema": "HIEMA",

      // AI / disclosure labels — glossary-locked
      // ai.ai_generated_context (LOCKED) = "Ng\u1eef c\u1ea3nh do AI t\u1ea1o"
      "ai.ai_generated_context": "Ng\u1eef c\u1ea3nh do AI t\u1ea1o",
      // ai.not_official_hazard_signal (LOCKED) = "Kh\xf4ng ph\u1ea3i t\xedn hi\u1ec7u nguy c\u01a1 ch\xednh th\u1ee9c"
      "ai.not_official_hazard_signal": "Kh\xf4ng ph\u1ea3i t\xedn hi\u1ec7u nguy c\u01a1 ch\xednh th\u1ee9c",
      // ai.community_submitted (LOCKED) = "Do c\u1ed9ng \u0111\u1ed3ng g\u1eedi"
      "ai.community_submitted": "Do c\u1ed9ng \u0111\u1ed3ng g\u1eedi",
      // ai.unverified (LOCKED) = "Ch\u01b0a x\xe1c minh"
      "ai.unverified": "Ch\u01b0a x\xe1c minh",

      // ── Hero kickers ──────────────────────────────────────────
      "hero.kicker.system_normal": "H\u1ec6 TH\u1ed0NG B\u00ccNH TH\u01af\u1edcNG",
      "hero.kicker.fire_active": "T\xcdN HI\u1ec6U CH\u00c1Y \u0110ANG HO\u1ea0T \u0110\u1ed8NG",
      // hazard.red_flag_warning LOCKED vi: C\u1ea3nh b\u00e1o c\u1edd \u0111\u1ecf
      "hero.kicker.red_flag": "C\u1ea2NH B\u00c1O C\u1edd \u0110\u1ecf",
      // hazard.flash_flood_warning LOCKED vi: C\u1ea3nh b\u00e1o l\u0169 qu\u00e9t
      "hero.kicker.flood_warning": "C\u1ea2NH B\u00c1O L\u0168 QU\u00c9T \u0110ANG HO\u1ea0T \u0110\u1ed8NG",
      // hazard.flash_flood_watch LOCKED vi: Theo d\xf5i l\u0169 qu\u00e9t
      "hero.kicker.flood_watch": "THEO D\xd5I L\u0168 QU\u00c9T",
      // hazard.fire_weather LOCKED vi: Th\u1eddi ti\u1ebft ch\u00e1y r\u1eebng
      "hero.kicker.fire_watch": "THEO D\xd5I TH\u1edci TI\u1ebeT CH\u00c1Y R\u1eebNG",
      "hero.kicker.degraded": "D\u1eee LI\u1ec6U B\u1eca TR\u1ec4",

      // ── Hero titles (innerHTML — developer-controlled) ────────
      "hero.title_html.monitoring": "Hawai\u02bfi \u0111ang <span class=\"hero-title-key\">b\u00ecnh y\xean</span> l\xfac n\xe0y.",
      "hero.title_html.fire_active": "<span class=\"hero-title-key\">Ch\u00e1y r\u1eebng</span> ph\u00e1t hi\u1ec7n t\u1ea1i Hawai\u02bfi.",
      "hero.title_html.flood_warning": "C\u1ea3nh b\u00e1o <span class=\"hero-title-key\">l\u0169 qu\u00e9t</span> \u0111ang c\xf3 hi\u1ec7u l\u1ef1c.",
      "hero.title_html.flood_watch": "Theo d\xf5i <span class=\"hero-title-key\">l\u0169</span> \u0111ang ph\u00e1t tri\u1ec3n.",
      "hero.title_html.degraded": "D\u1eef li\u1ec7u t\u1ea1m th\u1eddi <span class=\"hero-title-key\">b\u1ecb tr\u1ec5</span>.",

      // ── Hero narratives ───────────────────────────────────────
      "hero.narrative.system_normal": "Kh\xf4ng c\xf3 theo d\xf5i, c\u1ea3nh b\u00e1o ho\u1eb7c ph\u00e1t hi\u1ec7n ch\u00e1y r\u1eebng qua v\u1ec7 tinh n\xe0o tr\xean to\xe0n ti\u1ec3u bang.",
      "hero.narrative.fire_active": "V\u1ec7 tinh NASA FIRMS \u0111\xe3 ph\u00e1t hi\u1ec7n nhi\u1ec7t t\xedn hi\u1ec7u ch\u00e1y r\u1eebng \u0111ang ho\u1ea1t \u0111\u1ed9ng. M\u1edf b\u1ea3n \u0111\u1ed3 tr\u1ef1c ti\u1ebfp \u0111\u1ec3 xem v\u1ecb tr\xed v\xe0 kho\u1ea3ng c\u00e1ch \u0111\u1ebfn v\u1ecb tr\xed c\u1ee7a b\u1ea1n.",
      "hero.narrative.red_flag": "NWS \u0111\xe3 ph\u00e1t c\u1ea3nh b\u00e1o C\u1edd \u0110\u1ecf. \u0110\u1ed9 \u1ea9m th\u1ea5p, gi\xf3 m\u1ea1nh v\xe0 th\u1ef1c v\u1eadt kh\xf4 l\xe0m t\u0103ng nguy c\u01a1 ch\u00e1y r\u1eebng \u0111\u00e1ng k\u1ec3.",
      "hero.narrative.flood_warning": "NWS \u0111\xe3 ph\u00e1t c\u1ea3nh b\u00e1o l\u0169 qu\u00e9t \u0111ang c\xf3 hi\u1ec7u l\u1ef1c. Di chuy\u1ec3n xa kh\u1ecfi su\u1ed1i, tr\u00e1nh \u0111\u01b0\u1eddng th\u1ea5p v\xe0 l\xe0m theo h\u01b0\u1edbng d\u1eabn ch\xednh th\u1ee9c.",
      "hero.narrative.flood_watch": "NWS \u0111ang theo d\xf5i c\u00e1c \u0111i\u1ec1u ki\u1ec7n c\xf3 th\u1ec3 g\xe2y l\u0169 qu\u00e9t. H\xe3y chu\u1ea9n b\u1ecb, c\u1eadp nh\u1eadt th\xf4ng tin v\xe0 tr\u00e1nh c\u00e1c v\xf9ng d\u1ec5 l\u0169.",
      "hero.narrative.fire_watch": "NWS \u0111ang theo d\xf5i \u0111i\u1ec1u ki\u1ec7n th\u1eddi ti\u1ebft ch\u00e1y r\u1eebng t\u1ea1i m\u1ed9t s\u1ed1 khu v\u1ef1c c\u1ee7a Hawai\u02bfi. C\u1eadp nh\u1eadt th\xf4ng tin, tr\u00e1nh \u0111\u1ed1t l\u1eeda ngo\xe0i tr\u1eddi v\xe0 ch\xfa \xfd c\u1eadp nh\u1eadt ch\xednh th\u1ee9c.",
      "hero.narrative.degraded": "M\u1ed9t s\u1ed1 ngu\u1ed3n d\u1eef li\u1ec7u b\u1ecb tr\u1ec5. \u0110ang hi\u1ec3n th\u1ecb tr\u1ea1ng th\u00e1i bi\u1ebft l\u1ea7n cu\u1ed1i. Lu\xf4n tu\xe2n theo h\u01b0\u1edbng d\u1eabn kh\u1ea9n c\u1ea5p ch\xednh th\u1ee9c.",

      // ── Banner titles ─────────────────────────────────────────
      "hero.banner.system_normal": "\u2705 Kh\xf4ng ph\u00e1t hi\u1ec7n nguy c\u01a1 n\xe0o",
      "hero.banner.fire_active": "\ud83d\udd25 {n} T\xedn hi\u1ec7u ch\u00e1y r\u1eebng",
      "hero.banner.red_flag": "\ud83d\udea9 C\u1ea3nh b\u00e1o C\u1edd \u0110\u1ecf NWS \u0110ang ho\u1ea1t \u0111\u1ed9ng",
      "hero.banner.flood_warning": "\ud83c\udf0a C\u1ea3nh b\u00e1o L\u0169 qu\u00e9t \u2014 NWS Ch\xednh th\u1ee9c",
      "hero.banner.flood_watch": "\ud83d\udc41 Theo D\xf5i L\u0169 qu\u00e9t NWS \u0110ang ho\u1ea1t \u0111\u1ed9ng",
      "hero.banner.fire_watch": "\u26a0\ufe0f Theo D\xf5i Th\u1eddi Ti\u1ebft Ch\u00e1y NWS \u0110ang ho\u1ea1t \u0111\u1ed9ng",
      "hero.banner.degraded": "\u26a0\ufe0f D\u1eef li\u1ec7u d\u1ef1 ph\xf2ng \u0111ang ho\u1ea1t \u0111\u1ed9ng",

      // ── Banner copies (agency names LOCKED, translated surrounding text) ──
      "hero.banner_copy.nasa_nws": "NASA FIRMS \xb7 NWS \xb7 NEXRAD \xb7 \u0111\xe3 x\xe1c minh",
      "hero.banner_copy.nasa_firms": "Ngu\u1ed3n: NASA FIRMS VIIRS/MODIS \xb7 \u0111\xe3 x\xe1c minh",
      "hero.banner_copy.nws_official": "Ngu\u1ed3n: National Weather Service \xb7 c\u1ea3nh b\u00e1o ch\xednh th\u1ee9c",
      "hero.banner_copy.nws_watch": "Ngu\u1ed3n: National Weather Service \xb7 theo d\xf5i \u0111ang hi\u1ec7u l\u1ef1c",
      "hero.banner_copy.nws_red_flag": "Ngu\u1ed3n: National Weather Service \xb7 ch\xednh th\u1ee9c",
      "hero.banner_copy.degraded": "D\u1eef li\u1ec7u d\u1ef1 ph\xf2ng \u2014 kh\xf4ng ph\u1ea3i hi\u1ec7n t\u1ea1i",

      // ── Signal strip ──────────────────────────────────────────
      "signal.strip.fire_clear": "Kh\xf4ng ph\u00e1t hi\u1ec7n ch\u00e1y",
      "signal.strip.fire_count": "Ph\u00e1t hi\u1ec7n {n} \u0111i\u1ec3m",
      "signal.strip.flood_clear": "Kh\xf4ng c\xf3 theo d\xf5i ho\u1eb7c c\u1ea3nh b\u00e1o l\u0169",
      "signal.strip.flood_warning_active": "C\u1ea3nh b\u00e1o l\u0169 qu\u00e9t \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "signal.strip.flood_watch_active": "Theo d\xf5i l\u0169 qu\u00e9t \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "signal.strip.wx_clear": "Kh\xf4ng c\xf3 c\u1ea3nh b\u00e1o th\u1eddi ti\u1ebft ch\u00e1y n\xe0o",
      "signal.strip.wx_redflag": "C\u1ea3nh b\u00e1o C\u1edd \u0110\u1ecf \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "signal.strip.wx_watch": "Theo d\xf5i Th\u1eddi Ti\u1ebft Ch\u00e1y \u2014 NWS Ch\xednh th\u1ee9c",

      // ── Status labels (additional) ────────────────────────────
      // state.elevated not in glossary — using descriptive vi term
      "status.elevated": "N\u00c2NG CAO",
      // status.red_flag: preserve English display badge
      "status.red_flag": "C\u1edd \u0110\u1ecf",

      // ── Signal card titles ────────────────────────────────────
      "signal.fire_title_active": "\ud83d\udd25 T\xedn hi\u1ec7u ch\u00e1y \u2014 {n} \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "signal.flood_title_active": "\ud83c\udf27 T\xedn hi\u1ec7u l\u0169 \u2014 {n} n\u00e2ng cao",

      // ── Signal card long copies ───────────────────────────────
      "signal.fire_copy_monitoring_long": "Kahu Ola li\xean t\u1ee5c qu\xe9t d\u1eef li\u1ec7u v\u1ec7 tinh \u0111\u1ec3 b\u1ea3o v\u1ec7 c\u1ed9ng \u0111\u1ed3ng. M\u1eb7c d\xf9 t\xedn hi\u1ec7u to\xe0n ti\u1ec3u bang hi\u1ec7n t\u1ea1i \u0111ang r\xf5 r\xe0ng, \u0111i\u1ec1u ki\u1ec7n ch\u00e1y r\u1eebng thay \u0111\u1ed5i nhanh ch\xf3ng. D\xf9ng B\u1ea3n \u0111\u1ed3 tr\u1ef1c ti\u1ebfp \u0111\u1ec3 ki\u1ec3m tra khu v\u1ef1c c\u1ee7a b\u1ea1n.",
      "signal.fire_copy_active_tmpl": "Ph\u00e1t hi\u1ec7n {n} t\xedn hi\u1ec7u ch\u00e1y r\u1eebng trong \u1ea3nh ch\u1ee5p to\xe0n ti\u1ec3u bang hi\u1ec7n t\u1ea1i. M\u1edf b\u1ea3n \u0111\u1ed3 tr\u1ef1c ti\u1ebfp \u0111\u1ec3 bi\u1ebft chi ti\u1ebft t\u1eebng h\xf2n \u0111\u1ea3o.",
      "signal.flood_copy_monitoring_long": "H\u1ec7 th\u1ed1ng c\u1ee7a ch\xfang t\xf4i \u0111ang theo d\xf5i \u0111i\u1ec1u ki\u1ec7n l\u01b0u v\u1ef1c \u0111\u1ec3 b\u1ea3o v\u1ec7 c\u01b0 d\xe2n. Kh\xf4ng c\xf3 c\u1ea3nh b\u00e1o l\u0169 r\u1ed9ng n\xe0o \u0111ang ho\u1ea1t \u0111\u1ed9ng, nh\u01b0ng su\u1ed1i tr\xean n\xfai c\xf3 th\u1ec3 d\xe2ng l\u0169 b\u1ea5t ng\u1edd. H\xe3y ki\u1ec3m tra khu v\u1ef1c c\u1ee7a b\u1ea1n \u0111\u1ec3 ch\u1eafc ch\u1eafn.",
      "signal.flood_copy_active_tmpl": "Ph\u00e1t hi\u1ec7n {n} \u0111\u1eb7c \u0111i\u1ec3m ng\u1eef c\u1ea3nh l\u0169 trong \u1ea3nh ch\u1ee5p to\xe0n ti\u1ec3u bang hi\u1ec7n t\u1ea1i. M\u01b0a l\u1edbn c\xf3 th\u1ec3 khi\u1ebfn su\u1ed1i v\xe0 \u0111\u01b0\u1eddng th\u1ea5p thay \u0111\u1ed5i nhanh ch\xf3ng.",

      // ── Context metric values ─────────────────────────────────
      // context.wind_red_flag: short badge form of "Cảnh báo cờ đỏ"
      "context.wind_red_flag": "C\u1edd \u0110\u1ecf",
      "context.wind_watch": "Theo d\xf5i",
      "context.wind_high": "Cao",
      "context.wind_normal": "B\u00ecnh th\u01b0\u1eddng",
      "context.rain_heavy": "M\u01b0a n\u1eb7ng",
      "context.rain_moderate": "M\u01b0a v\u1eeba",
      "context.rain_light": "M\u01b0a nh\u1eb9",
      "context.none": "Kh\xf4ng c\xf3",
      "context.flood_warning_active": "C\u1ea3nh b\u00e1o \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "context.flood_watch_active": "Theo d\xf5i \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "context.flood_none_active": "Kh\xf4ng c\xf3",
      "context.nws_official": "NWS Ch\xednh th\u1ee9c",
      "context.nexrad_mrms": "NEXRAD / MRMS",

      // ── System notes ──────────────────────────────────────────
      "system.note_default": "Kahu Ola cung c\u1ea5p nh\u1eadn th\u1ee9c t\xecnh hu\u1ed1ng nguy c\u01a1 c\xf4ng c\u1ed9ng d\u1ef1a tr\xean c\u00e1c ngu\u1ed3n d\u1eef li\u1ec7u khoa h\u1ecdc v\xe0 ch\xednh ph\u1ee7 \u0111\u00e1ng tin c\u1eady.",
      "system.note_degraded": "M\u1ed9t s\u1ed1 ngu\u1ed3n d\u1eef li\u1ec7u b\u1ecb tr\u1ec5. Kahu Ola \u0111ang hi\u1ec3n th\u1ecb d\u1eef li\u1ec7u d\u1ef1 ph\xf2ng an to\xe0n nh\u1ea5t. Lu\xf4n tu\xe2n theo h\u01b0\u1edbng d\u1eabn kh\u1ea9n c\u1ea5p ch\xednh th\u1ee9c.",
      "system.note_flood_warning": "C\u1ea3nh b\u00e1o l\u0169 qu\u00e9t \u0111ang ho\u1ea1t \u0111\u1ed9ng. Tr\u00e1nh \u0111\u01b0\u1eddng b\u1ecb ng\u1eadp v\xe0 su\u1ed1i \u0111ang d\xe2ng. L\xe0m theo h\u01b0\u1edbng d\u1eabn c\u1ee7a NWS v\xe0 qu\u1eadn.",
      "system.degraded_chip": "H\u1ec6 TH\u1ed0NG B\u1eca L\u1ed6I",
      "system.snapshot_delayed": "\u1ea2nh ch\u1ee5p t\u1ea1m th\u1eddi b\u1ecb tr\u1ec5",

      // ── Signal detail toggle labels ───────────────────────────
      "signal.detail_fire_count": "{n} t\xedn hi\u1ec7u ch\u00e1y \u2014 xem chi ti\u1ebft",
      "signal.detail_flood": "Chi ti\u1ebft l\u0169",
      "signal.detail_all_clear": "Chi ti\u1ebft t\xedn hi\u1ec7u \u2014 t\u1ea5t c\u1ea3 b\u00ecnh th\u01b0\u1eddng",

      // ── Kupuna & Keiki notes ───────────────────────────────────
      // "K\u016bpuna" (ng\u01b0\u1eddi cao tu\u1ed5i), "keiki" (tr\u1ebb em), "E m\u0101lama pono" kept in all languages
      "kupuna.title.fire": "An To\xe0n Ch\u00e1y cho Ng\u01b0\u1eddi Cao Tu\u1ed5i & Tr\u1ebb Em",
      "kupuna.title.flood_warning": "An To\xe0n L\u0169 cho Ng\u01b0\u1eddi Cao Tu\u1ed5i & Tr\u1ebb Em",
      "kupuna.title.flood_watch": "Nh\u1eadn Th\u1ee9c L\u0169 cho Ng\u01b0\u1eddi Cao Tu\u1ed5i & Tr\u1ebb Em",
      "kupuna.title.elevated": "An To\xe0n cho Ng\u01b0\u1eddi Cao Tu\u1ed5i & Tr\u1ebb Em",
      "kupuna.title.calm": "An To\xe0n cho Ng\u01b0\u1eddi Cao Tu\u1ed5i & Tr\u1ebb Em",
      "kupuna.body.fire": "\u0110\xe3 ph\u00e1t hi\u1ec7n t\xedn hi\u1ec7u ch\u00e1y r\u1eebng. Ng\u01b0\u1eddi cao tu\u1ed5i, tr\u1ebb em v\xe0 nh\u1eefng ai c\xf3 v\u1ea5n \u0111\u1ec1 h\xf4 h\u1ea5p n\xean \u1edf trong nh\xe0 v\u1edbi c\u1eeda s\u1ed5 \u0111\xf3ng. Theo d\xf5i l\u1ec7nh s\u01a1 t\u00e1n ch\xednh th\u1ee9c v\xe0 gi\u1eef t\xfai \u0111\u1ed3 kh\u1ea9n c\u1ea5p s\u1eb5n s\xe0ng. E m\u0101lama pono.",
      "kupuna.body.flood_warning": "C\u1ea3nh b\u00e1o l\u0169 qu\u00e9t \u0111ang ho\u1ea1t \u0111\u1ed9ng. Ng\u01b0\u1eddi cao tu\u1ed5i, tr\u1ebb em v\xe0 c\u01b0 d\xe2n g\u1ea7n su\u1ed1i ho\u1eb7c \u0111\u01b0\u1eddng th\u1ea5p n\xean di chuy\u1ec3n l\xean v\xf9ng cao ngay. Kh\xf4ng c\u1ed1 qua \u0111\u01b0\u1eddng b\u1ecb ng\u1eadp. L\xe0m theo h\u01b0\u1edbng d\u1eabn c\u1ee7a NWS v\xe0 c\u1ea5p c\u1ee9u qu\u1eadn. E m\u0101lama pono.",
      "kupuna.body.flood_watch": "Theo d\xf5i l\u0169 \u0111ang c\xf3 hi\u1ec7u l\u1ef1c. Ng\u01b0\u1eddi cao tu\u1ed5i, tr\u1ebb em v\xe0 c\u01b0 d\xe2n v\xf9ng th\u1ea5p n\xean chu\u1ea9n b\u1ecb cho kh\u1ea3 n\u0103ng n\u01b0\u1edbc d\xe2ng nhanh. S\u1eb5n s\xe0ng k\u1ebf ho\u1ea1ch kh\u1ea9n c\u1ea5p v\xe0 theo d\xf5i c\u1ea3nh b\u00e1o ch\xednh th\u1ee9c. E m\u0101lama pono.",
      "kupuna.body.elevated": "\u0110i\u1ec1u ki\u1ec7n th\u1eddi ti\u1ebft ch\u00e1y r\u1eebng t\u0103ng cao t\u1ea1i m\u1ed9t s\u1ed1 khu v\u1ef1c c\u1ee7a Hawai\u02bfi. Ng\u01b0\u1eddi cao tu\u1ed5i, tr\u1ebb em v\xe0 ng\u01b0\u1eddi c\xf3 v\u1ea5n \u0111\u1ec1 h\xf4 h\u1ea5p n\xean c\u1eadp nh\u1eadt th\xf4ng tin v\xe0 h\u1ea1n ch\u1ebf ho\u1ea1t \u0111\u1ed9ng ngo\xe0i tr\u1eddi m\u1ea1nh. E m\u0101lama pono.",
      "kupuna.body.calm": "\u0110i\u1ec1u ki\u1ec7n to\xe0n ti\u1ec3u bang \u0111ang b\u00ecnh y\xean. Ng\u01b0\u1eddi cao tu\u1ed5i, tr\u1ebb em v\xe0 c\u01b0 d\xe2n v\xf9ng th\u1ea5p n\xean ti\u1ebfp t\u1ee5c theo d\xf5i qua c\u1ea3nh b\u00e1o ch\xednh th\u1ee9c. E m\u0101lama pono.",

      // ── Delta / what-changed ───────────────────────────────────
      "delta.first_check": "L\u1ea7n ki\u1ec3m tra \u0111\u1ea7u \u2014 \u0111\xe3 thi\u1ebft l\u1eadp c\u01a1 s\u1edf",
      "delta.improved": "\u0110i\u1ec1u ki\u1ec7n c\u1ea3i thi\u1ec7n t\u1eeb {age}",
      "delta.status_changed": "Tr\u1ea1ng th\u00e1i thay \u0111\u1ed5i t\u1eeb {age}",
      "delta.new_fires": "C\xf3 th\xeam {n} \u0111i\u1ec3m ch\u00e1y t\u1eeb {age}",
      "delta.fires_down": "S\u1ed1 \u0111i\u1ec3m ch\u00e1y gi\u1ea3m t\u1eeb {last} k\u1ec3 t\u1eeb {age}",
      "delta.no_change": "Kh\xf4ng c\xf3 thay \u0111\u1ed5i t\u1eeb {age}",
      "delta.checked": "\u0110\xe3 ki\u1ec3m tra \u0111i\u1ec1u ki\u1ec7n",
      "delta.age_min": "{n} ph\xfat tr\u01b0\u1edbc",
      "delta.age_hr": "{n} gi\u1edd tr\u01b0\u1edbc",

      // ── Map freshness chip ────────────────────────────────────
      "map.fresh.unknown": "\u25cf KH\xd4NG R\xd5",
      "map.fresh.fresh": "\u2713 M\u1edaI",
      "map.fresh.stale": "\u26a0 C\xd3 TH\u1ec2 \u0110\xc3 C\u0168",
      "map.fresh.outdated": "\u2717 H\u1ebebT H\u1ea0N",

      // ── Map footer mode labels ────────────────────────────────
      "map.footer_live": "C\xf4ng ngh\u1ec7 d\xe2n s\u1ef1 Kahu Ola \xb7 tr\u1ef1c ti\u1ebfp",
      "map.footer_local": "C\xf4ng ngh\u1ec7 d\xe2n s\u1ef1 Kahu Ola \xb7 th\u1eed nghi\u1ec7m",

      // ── Homepage lower sections ───────────────────────────────

      // System Transparency card
      "transparency.title": "Minh b\u1ea1ch H\u1ec7 th\u1ed1ng",
      "transparency.copy": "Kahu Ola t\xedch h\u1ee3p d\u1eef li\u1ec7u c\xf4ng c\u1ed9ng t\u1eeb c\xe1c ngu\u1ed3n khoa h\u1ecdc v\xe0 ch\xednh ph\u1ee7 \u0111\xe1ng tin c\u1eady.",
      "transparency.disclaimer": "Kahu Ola cung c\u1ea5p nh\u1eadn th\u1ee9c t\xecnh hu\u1ed1ng nguy c\u01a1 c\xf4ng c\u1ed9ng. \u0110\xe2y kh\xf4ng ph\u1ea3i d\u1ecbch v\u1ee5 kh\u1ea9n c\u1ea5p ch\xednh th\u1ee9c. N\u1ebfu m\u1ed9t ngu\u1ed3n d\u1eef li\u1ec7u b\u1ecb suy gi\u1ea3m ho\u1eb7c c\u0169, n\xf3 s\u1ebd \u0111\u01b0\u1ee3c g\u1eafn nh\xe3n r\xf5 r\xe0ng.",

      // Official links — individual card descriptions
      "links.hiema_desc": "Th\xf4ng tin kh\u1ea9n c\u1ea5p v\xe0 h\u01b0\u1edbng d\u1eabn chu\u1ea9n b\u1ecb c\u1ee7a ti\u1ec3u bang",
      "links.maui_ema_desc": "H\u01b0\u1edbng d\u1eabn kh\u1ea9n c\u1ea5p, c\u1ea3nh b\xe1o v\xe0 th\xf4ng tin an to\xe0n \u0111\u1ecba ph\u01b0\u01a1ng c\u1ee7a qu\u1eadn",
      "links.nws_hfo_desc": "Theo d\xf5i, c\u1ea3nh b\xe1o v\xe0 th\xf4ng b\xe1o th\u1eddi ti\u1ebft ch\xednh th\u1ee9c cho Hawai\u02bfi",

      // How It Works
      "how.label": "C\xe1ch Th\u1ee9c Ho\u1ea1t \u0110\u1ed9ng",
      "how.title_l1": "D\u1eef li\u1ec7u v\u1ec7 tinh th\xe0nh ng\xf4n ng\u1eef \u0111\u01a1n gi\u1ea3n",
      "how.title_l2": "\u2014 trong v\xf2ng 15 ph\xfat",
      "how.lead": "Kahu Ola k\u1ebft n\u1ed1i s\xe1u h\u1ec7 th\u1ed1ng d\u1eef li\u1ec7u ch\xednh ph\u1ee7 v\xe0 chu\u1ea9n h\xf3a ch\xfang th\xe0nh ba lo\u1ea1i t\xedn hi\u1ec7u d\u1ec5 \u0111\u1ecdc. Kh\xf4ng thu\u1eadt ng\u1eef kh\xf3 hi\u1ec3u. Kh\xf4ng d\u1eef li\u1ec7u th\xf4. Ch\u1ec9 l\xe0 tr\u1ea1ng th\xe1i nguy c\u01a1 r\xf5 r\xe0ng, trung th\u1ef1c.",
      "how.step1_title": "C\u1ea3m bi\u1ebfn ch\xednh ph\u1ee7 ph\xe1t hi\u1ec7n",
      "how.step1_body": "V\u1ec7 tinh NASA FIRMS bay qua m\u1ed7i 90 ph\xfat. Radar NOAA qu\xe9t li\xean t\u1ee5c. Nh\xe0 kh\xed t\u01b0\u1ee3ng h\u1ecdc NWS ph\xe1t theo d\xf5i v\xe0 c\u1ea3nh b\xe1o. C\xe1c h\u1ec7 th\u1ed1ng n\xe0y kh\xf4ng bao gi\u1edd ng\u1eebng.",
      "how.step2_title": "B\u1ed9 t\u1ed5ng h\u1ee3p chu\u1ea9n h\xf3a",
      "how.step2_body": "B\u1ed9 T\u1ed5ng h\u1ee3p Kahu Ola thu th\u1eadp, x\xe1c nh\u1eadn v\xe0 l\u01b0u cache m\u1ed7i t\xedn hi\u1ec7u ph\xeda m\xe1y ch\u1ee7. D\u1eef li\u1ec7u ch\xednh ph\u1ee7 th\xf4 tr\u1edf th\xe0nh FireSignal \xb7 SmokeSignal \xb7 Perimeter \u0111\xe3 \u0111\u01b0\u1ee3c phi\xean b\u1ea3n h\xf3a. Kh\xf3a API kh\xf4ng bao gi\u1edd \u0111\u1ebfn m\xe1y kh\xe1ch.",
      "how.step3_title": "B\u1ea1n th\u1ea5y ng\xf4n ng\u1eef \u0111\u01a1n gi\u1ea3n",
      "how.step3_body": "\u1ee8ng d\u1ee5ng hi\u1ec3n th\u1ecb c\xe1c t\xedn hi\u1ec7u trung th\u1ef1c, c\xf3 d\u1ea5u th\u1eddi gian v\u1edbi nh\xe3n \u0111\u1ed9 t\u01b0\u01a1i r\xf5 r\xe0ng. D\u1eef li\u1ec7u c\u0169 lu\xf4n \u0111\u01b0\u1ee3c \u0111\xe1nh d\u1ea5u. Chu vi \u01b0\u1edbc t\xednh kh\xf4ng bao gi\u1edd \u0111\u01b0\u1ee3c g\xe1n nh\xe3n ch\xednh th\u1ee9c. V\u1ecb tr\xed c\u1ee7a b\u1ea1n kh\xf4ng bao gi\u1edd r\u1eddi thi\u1ebft b\u1ecb.",

      // Mission
      "mission.label": "S\u1ee9 M\u1ec7nh C\u1ee7a Ch\xfang T\xf4i",
      "mission.title_l1": "X\xe2y d\u1ef1ng sau Lahaina.",
      "mission.title_l2": "X\xe2y d\u1ef1ng cho m\u1ecdi ng\u01b0\u1eddi.",
      "mission.lead": "V\u1ee5 ch\xe1y r\u1eebng Lahaina n\u0103m 2023 b\u1ed9c l\u1ed9 kho\u1ea3ng c\xe1ch tai h\u1ea1i: c\xe1c v\u1ec7 tinh ti\xean ti\u1ebfn \u0111ang theo d\xf5i \u0111\xe1m ch\xe1y theo th\u1eddi gian th\u1ef1c trong khi c\u01b0 d\xe2n kh\xf4ng c\xf3 t\xedn hi\u1ec7u r\xf5 r\xe0ng, d\u1ec5 ti\u1ebfp c\u1eadn. D\u1eef li\u1ec7u c\u1ee9u ng\u01b0\u1eddi \u0111\xe3 t\u1ed3n t\u1ea1i \u2014 ch\u1ec9 l\xe0 kh\xf4ng \u0111\u1ebfn \u0111\u01b0\u1ee3c m\u1ecdi ng\u01b0\u1eddi b\u1eb1ng ng\xf4n ng\u1eef \u0111\u01a1n gi\u1ea3n.",
      "mission.body": "Kahu Ola \u0111\u01b0\u1ee3c x\xe2y d\u1ef1ng \u0111\u1ec3 thu h\u1eb9p kho\u1ea3ng c\xe1ch \u0111\xf3. Kh\xf4ng thay th\u1ebf d\u1ecbch v\u1ee5 kh\u1ea9n c\u1ea5p ch\xednh th\u1ee9c \u2014 m\xe0 \u0111\u1ec3 cung c\u1ea5p cho m\u1ecdi c\u01b0 d\xe2n Hawai\u02bfi quy\u1ec1n ti\u1ebfp c\u1eadn d\u1eef li\u1ec7u m\xe0 c\xe1c nh\xe0 qu\u1ea3n l\xfd kh\u1ea9n c\u1ea5p s\u1eed d\u1ee5ng, \u0111\u01b0\u1ee3c d\u1ecbch th\xe0nh ng\xf4n ng\u1eef b\xecnh t\u0129nh, d\u1ec5 hi\u1ec3u tr\u01b0\u1edbc, trong v\xe0 sau nguy c\u01a1.",
      "mission.chip_fire": "\ud83d\udd25 \u01afu ti\xean Ch\xe1y r\u1eebng",
      "mission.chip_privacy": "\ud83d\udd12 \u01afu ti\xean Quy\u1ec1n ri\xeang t\u01b0",
      "mission.chip_resilience": "\u26a1 Ch\u1ecbu l\u1ed7i",
      "mission.chip_grant": "\ud83c\udfd3 S\u1eb5n s\xe0ng T\xe0i tr\u1ee3",
      "mission.val1_title": "\u0110\u01b0\u1ee3c k\u1ef9 thu\u1eadt h\xf3a cho s\u1ef1 b\u1ec1n v\u1eefng",
      "mission.val1_body": "Ki\u1ebfn tr\xfac cache-first v\u1edbi \u1ea3nh ch\u1ee5p d\u1eef li\u1ec7u \u0111\xe3 x\xe1c nh\u1eadn. \u1ee8ng d\u1ee5ng hi\u1ec3n th\u1ecb trong 8 \u0111i\u1ec1u ki\u1ec7n l\u1ed7i kh\xe1c nhau \u2014 k\u1ec3 c\u1ea3 m\u1ea5t m\u1ea1ng ho\xe0n to\xe0n. T\xedn hi\u1ec7u suy gi\u1ea3m an to\xe0n h\u01a1n v\xf4 h\u1ea1n so v\u1edbi m\xe0n h\xecnh tr\u1ed1ng.",
      "mission.val2_title": "Quy\u1ec1n ri\xeang t\u01b0 nh\u01b0 nguy\xean t\u1eafc thi\u1ebft k\u1ebf",
      "mission.val2_body": "An to\xe0n kh\xf4ng n\xean \u0111\xf2i h\u1ecfi gi\xe1m s\xe1t. Nh\u1eadn th\u1ee9c kho\u1ea3ng c\xe1ch \u0111\u01b0\u1ee3c t\xednh to\xe1n tr\xean thi\u1ebft b\u1ecb. Kh\xf4ng c\xf3 l\u1ecbch s\u1eed v\u1ecb tr\xed n\xe0o \u0111\u01b0\u1ee3c t\u1ea1o, l\u01b0u tr\u1eef ho\u1eb7c truy\u1ec1n \u2014 m\xe3i m\xe3i. Kh\xf4ng t\xe0i kho\u1ea3n. Kh\xf4ng qu\u1ea3ng c\xe1o. Kh\xf4ng b\xe1n d\u1eef li\u1ec7u.",
      "mission.val3_title": "Trung th\u1ef1c v\u1ec1 s\u1ef1 kh\xf4ng ch\u1eafc ch\u1eafn",
      "mission.val3_body": "M\u1ed7i t\xedn hi\u1ec7u hi\u1ec3n th\u1ecb ngu\u1ed3n v\xe0 tu\u1ed5i. Chu vi ch\xe1y \u01b0\u1edbc t\xednh kh\xf4ng bao gi\u1edd \u0111\u01b0\u1ee3c g\xe1n nh\xe3n ch\xednh th\u1ee9c. D\u1eef li\u1ec7u c\u0169 lu\xf4n \u0111\u01b0\u1ee3c \u0111\xe1nh d\u1ea5u. Kahu Ola kh\xf4ng bao gi\u1edd b\u1ecba \u0111\u1eb7t ho\u1eb7c ph\xf3ng \u0111\u1ea1i m\u1ee9c \u0111\u1ed9 nguy c\u01a1.",
      "mission.val4_title": "Do c\u1ed9ng \u0111\u1ed3ng \xb7 D\u1ecbch v\u1ee5 c\xf4ng c\u1ed9ng mi\u1ec5n ph\xed",
      "mission.val4_body": "M\u1ed9t s\xe1ng ki\u1ebfn c\xf4ng ngh\u1ec7 d\xe2n s\u1ef1 \u0111\u1ed9c l\u1eadp \u2014 kh\xf4ng ph\u1ea3i c\u01a1 quan ch\xednh ph\u1ee7, kh\xf4ng ph\u1ea3i s\u1ea3n ph\u1ea9m th\u01b0\u01a1ng m\u1ea1i. \u0110\u01b0\u1ee3c x\xe2y d\u1ef1ng \u0111\u1ec3 lu\xf4n c\xf3 th\u1ec3 truy c\u1eadp mi\u1ec5n ph\xed cho m\u1ecdi c\u01b0 d\xe2n Hawai\u02bfi.",

      // Privacy-First Architecture
      "privarch.label": "Ki\u1ebfn Tr\xfac \u01afu Ti\xean Quy\u1ec1n Ri\xeang T\u01b0",
      "privarch.title": "Kh\xf4ng PII. Kh\xf4ng theo d\xf5i.",
      "privarch.lead": "Ch\xfang t\xf4i kh\xf4ng c\u1ea7n bi\u1ebft b\u1ea1n l\xe0 ai \u0111\u1ec3 gi\xfap b\u1ea1n an to\xe0n. Kahu Ola \u0111\u01b0\u1ee3c thi\u1ebft k\u1ebf xung quanh m\u1ed9t quy t\u1eafc duy nh\u1ea5t: d\u1eef li\u1ec7u c\u1ee7a b\u1ea1n \u1edf l\u1ea1i tr\xean thi\u1ebft b\u1ecb c\u1ee7a b\u1ea1n.",
      "privarch.card1_title": "Kh\xf4ng c\u1ea7n t\xe0i kho\u1ea3n",
      "privarch.card1_body": "C\xe1c ch\u1ebf \u0111\u1ed9 xem an to\xe0n c\u01a1 b\u1ea3n c\xf3 th\u1ec3 truy c\u1eadp m\xe0 kh\xf4ng c\u1ea7n \u0111\u0103ng nh\u1eadp. Kh\xf4ng email. Kh\xf4ng s\u1ed1 \u0111i\u1ec7n tho\u1ea1i. Kh\xf4ng h\u1ed3 s\u01a1.",
      "privarch.card2_title": "Kho\u1ea3ng c\xe1ch tr\xean thi\u1ebft b\u1ecb",
      "privarch.card2_body": "Ki\u1ec3m tra kho\u1ea3ng c\xe1ch nguy c\u01a1 t\xednh to\xe1n c\u1ee5c b\u1ed9 tr\xean thi\u1ebft b\u1ecb c\u1ee7a b\u1ea1n. T\u1ecda \u0111\u1ed9 GPS c\u1ee7a b\u1ea1n kh\xf4ng bao gi\u1edd v\u01b0\u1ee3t qua ranh gi\u1edbi thi\u1ebft b\u1ecb.",
      "privarch.card3_title": "Kh\xf4ng b\xe1n d\u1eef li\u1ec7u \xb7 Kh\xf4ng qu\u1ea3ng c\xe1o",
      "privarch.card3_body": "Kh\xf4ng c\xf3 h\u1ed3 s\u01a1 qu\u1ea3ng c\xe1o. Kh\xf4ng theo d\xf5i h\xe0nh vi. Kh\xf4ng c\xf3 d\u1eef li\u1ec7u c\xe1 nh\xe2n \u0111\u01b0\u1ee3c m\xf4i gi\u1edbi. N\u1ec1n t\u1ea3ng kh\xf4ng c\xf3 qu\u1ea3ng c\xe1o theo thi\u1ebft k\u1ebf.",
      "privarch.footnote_prefix": "Chi ti\u1ebft \u0111\u1ea7y \u0111\u1ee7 cho ng\u01b0\u1eddi \u0111\xe1nh gi\xe1 v\xe0 ki\u1ec3m to\xe1n vi\xean:",
      "privarch.footnote_link": "Ch\xednh s\xe1ch B\u1ea3o m\u1eadt",

      // Data Infrastructure
      "infra.label": "H\u1ea1 T\u1ea7ng D\u1eef Li\u1ec7u",
      "infra.title_l1": "16 ngu\u1ed3n ch\xednh ph\u1ee7 m\u1edf.",
      "infra.title_l2": "M\u1ed9t l\u1edbp d\xe2n s\u1ef1.",
      "infra.lead": "M\u1ed7i ngu\u1ed3n d\u1eef li\u1ec7u \u0111\u1ec1u c\xf4ng khai, m\u1edf v\xe0 c\xf3 th\u1ec3 x\xe1c minh. Kahu Ola kh\xf4ng bao gi\u1edd t\u1ea1o d\u1eef li\u1ec7u nguy c\u01a1 c\u1ee7a ri\xeang m\xecnh \u2014 n\xf3 chu\u1ea9n h\xf3a, g\u1eafn th\u1eddi gian v\xe0 tr\xecnh b\xe0y nh\u1eefng g\xec c\xe1c c\u01a1 quan ch\xednh ph\u1ee7 \u0111\xe3 xu\u1ea5t b\u1ea3n.",
      "infra.note": "T\u1ea5t c\u1ea3 c\xe1c cu\u1ed9c g\u1ecdi upstream \u0111\u01b0\u1ee3c proxy ph\xeda m\xe1y ch\u1ee7 qua Kahu Ola Cloudflare Worker. Tr\xecnh duy\u1ec7t kh\xf4ng bao gi\u1edd li\xean h\u1ec7 tr\u1ef1c ti\u1ebfp v\u1edbi API ch\xednh ph\u1ee7 \u2014 m\u1ed9t b\u1ea5t bi\u1ebfn ki\u1ebfn tr\xfac c\u1ed1t l\xf5i b\u1ea3o v\u1ec7 kh\xf3a API v\xe0 \u0111\u1ea3m b\u1ea3o an to\xe0n gi\u1edbi h\u1ea1n t\u1ed1c \u0111\u1ed9.",

      // Get Started
      "gs.label": "B\u1eaft \u0110\u1ea7u",
      "gs.title_l1": "C\xf3 s\u1eb5n ngay tr\xean web.",
      "gs.title_l2": "\u1ee8ng d\u1ee5ng di \u0111\u1ed9ng s\u1eafp ra m\u1eaft.",
      "gs.lead": "M\u1edf Kahu Ola tr\xean b\u1ea5t k\u1ef3 tr\xecnh duy\u1ec7t n\xe0o \u2014 kh\xf4ng c\u1ea7n t\u1ea3i xu\u1ed1ng, kh\xf4ng c\u1ea7n t\xe0i kho\u1ea3n, kh\xf4ng c\u1ea7n c\xe0i \u0111\u1eb7t. B\u1ea3n \u0111\u1ed3 nguy c\u01a1 tr\u1ef1c ti\u1ebfp t\u1ea3i ngay l\u1eadp t\u1ee9c v\xe0 ho\u1ea1t \u0111\u1ed9ng ngo\u1ea1i tuy\u1ebfn sau l\u1ea7n truy c\u1eadp \u0111\u1ea7u ti\xean.",
      "gs.web_badge": "Web \xb7 C\xf3 s\u1eb5n ngay",
      "gs.web_title": "B\u1ea3n \u0111\u1ed3 Tr\u1ef1c ti\u1ebfp Kahu Ola",
      "gs.web_desc": "Ph\xe1t hi\u1ec7n ch\xe1y r\u1eebng th\u1eddi gian th\u1ef1c, c\u1ea3nh b\xe1o l\u0169 qu\xe9t, tr\u1ea1ng th\xe1i s\xf3ng th\u1ea7n, \u0111\u01b0\u1eddng \u0111i b\xe3o v\xe0 radar m\u01b0a \u2014 t\u1ea5t c\u1ea3 trong m\u1ed9t b\u1ea3ng \u0111i\u1ec1u khi\u1ec3n d\xe2n s\u1ef1. Ho\u1ea1t \u0111\u1ed9ng tr\xean m\u1ecdi thi\u1ebft b\u1ecb, m\u1ecdi tr\xecnh duy\u1ec7t.",
      "gs.web_li1": "\u0110i\u1ec3m n\xf3ng ch\xe1y NASA FIRMS",
      "gs.web_li2": "C\u1ea3nh b\xe1o l\u0169 + s\xf3ng th\u1ea7n ch\xednh th\u1ee9c NWS",
      "gs.web_li3": "Radar m\u01b0a NEXRAD tr\u1ef1c ti\u1ebfp",
      "gs.web_li4": "Th\u1eddi ti\u1ebft ch\xe1y + b\u1ed1i c\u1ea3nh gi\xf3",
      "gs.web_li5": "Minh b\u1ea1ch d\u1eef li\u1ec7u M\u1edaI / C\u0168",
      "gs.web_cta": "M\u1edf B\u1ea3n \u0111\u1ed3 Tr\u1ef1c ti\u1ebfp \u2192",
      "gs.mobile_badge": "iOS \xb7 S\u1eafp ra m\u1eaft",
      "gs.mobile_title": "\u1ee8ng d\u1ee5ng Di \u0111\u1ed9ng",
      "gs.mobile_desc": "\u1ee8ng d\u1ee5ng di \u0111\u1ed9ng Kahu Ola mang b\u1ea3ng \u0111i\u1ec1u khi\u1ec3n th\xf4ng minh nguy c\u01a1 \u0111\u1ea7y \u0111\u1ee7 l\xean iOS v\u1edbi th\xf4ng b\xe1o g\u1ed1c cho c\xe1c c\u1ea3nh b\xe1o quan tr\u1ecdng v\xe0 kh\u1ea3 n\u0103ng ph\u1ee5c h\u1ed3i offline-first.",
      "gs.mobile_li1": "Th\xf4ng b\xe1o \u0111\u1ea9y cho c\u1ea3nh b\xe1o \u0111ang ho\u1ea1t \u0111\u1ed9ng",
      "gs.mobile_li2": "\u0110\u1ecba l\xfd ph\xf2ng ng\u1eeba tr\xean thi\u1ebft b\u1ecb",
      "gs.mobile_li3": "Offline-first \u2014 ho\u1ea1t \u0111\u1ed9ng kh\xf4ng c\u1ea7n t\xedn hi\u1ec7u",
      "gs.mobile_li4": "Kh\xf4ng PII \xb7 Kh\xf4ng c\u1ea7n t\xe0i kho\u1ea3n",
      "gs.mobile_cta": "Nh\u1eadn Th\xf4ng b\xe1o khi Ra m\u1eaft",

      // Footer
      "footer.follow": "Theo d\xf5i \u0111\u1ec3 nh\u1eadn b\u1ea3n tin nguy c\u01a1 h\xe0ng ng\xe0y:",

      // Language selector
      "lang.label": "Ng\xf4n ng\u1eef",
      "lang.select_aria": "Ch\u1ecdn ng\xf4n ng\u1eef"
    },

    // ── HAWAIIAN (Phase 2 — glossary-locked, conservative) ────
    // Doctrine: use approved glossary terms only.
    // Where no approved translation exists: KEEP ENGLISH (use KEEP_ENGLISH sentinel).
    // Do NOT translate hazard severity, official warnings, freshness timing, or source attribution.
    haw: {
      "meta.label": "\u02bbo\u02bblelo Hawai\u02bfi",
      "meta.lang_html": "haw",

      // Navigation — safe non-hazard labels only
      "nav.privacy": "Pilikino",
      "nav.support": "K\u014dkua",
      "nav.home": "Ka Hale",
      // All other nav: KEEP ENGLISH (hazard-adjacent)
      "nav.live_map": KEEP_ENGLISH,
      "nav.official_alerts": KEEP_ENGLISH,
      "nav.how_it_works": KEEP_ENGLISH,
      "nav.mission": KEEP_ENGLISH,
      "nav.data_sources": KEEP_ENGLISH,

      // Brand — Kahu Ola IS the Hawaiian brand name
      "brand.guardian": "Kahu Ola",
      // Other brand strings: KEEP ENGLISH pending native review
      "brand.kicker": KEEP_ENGLISH,
      "brand.title": KEEP_ENGLISH,
      "brand.sub": KEEP_ENGLISH,

      // ALL hazard terms: KEEP ENGLISH
      // Doctrine: "where translation is not approved, KEEP ENGLISH"
      "signal.fire_label": KEEP_ENGLISH,
      "signal.flood_label": KEEP_ENGLISH,
      "signal.fire_no_detections": KEEP_ENGLISH,
      "signal.flood_no_watches": KEEP_ENGLISH,
      "signal.fire_monitoring": KEEP_ENGLISH,
      "signal.flood_monitoring": KEEP_ENGLISH,
      "signal.fire_copy_clear": KEEP_ENGLISH,
      "signal.flood_copy_clear": KEEP_ENGLISH,
      "signal.conditions_unchanged": KEEP_ENGLISH,

      // Status: KEEP ENGLISH
      "status.clear": KEEP_ENGLISH,
      "status.active": KEEP_ENGLISH,
      "status.monitoring": KEEP_ENGLISH,
      "status.normal": KEEP_ENGLISH,
      "status.watch": KEEP_ENGLISH,
      "status.warning": KEEP_ENGLISH,
      "status.alert": KEEP_ENGLISH,
      "status.no_active_signal": KEEP_ENGLISH,

      // Freshness: KEEP ENGLISH — timing precision is critical
      "freshness.updated_recently": KEEP_ENGLISH,
      "freshness.updated_just_now": KEEP_ENGLISH,
      "freshness.updated_min": KEEP_ENGLISH,
      "freshness.updated_hr": KEEP_ENGLISH,
      "freshness.updated_day": KEEP_ENGLISH,
      "freshness.loading": "E kali ana\u2026",
      "freshness.data_may_be_stale": KEEP_ENGLISH,

      // Legend: KEEP ENGLISH
      "legend.signal": KEEP_ENGLISH,
      "legend.monitoring": KEEP_ENGLISH,
      "legend.fire_active": KEEP_ENGLISH,
      "legend.flood_alert": KEEP_ENGLISH,

      // CTAs: safe non-hazard labels
      "cta.view_live_map": KEEP_ENGLISH,
      "cta.official_alerts": KEEP_ENGLISH,

      // Civic: KEEP ENGLISH — critical safety language needs native review
      "civic.not_official_alert": KEEP_ENGLISH,
      "civic.follow_official_guidance": KEEP_ENGLISH,
      "civic.monitor_conditions": KEEP_ENGLISH,
      "civic.guardian_note": KEEP_ENGLISH,
      "civic.source_disclosure": KEEP_ENGLISH,

      // Map: safe non-hazard labels only
      "map.panel_head_hawaii": KEEP_ENGLISH,
      "map.panel_head_usa": KEEP_ENGLISH,
      "map.scope_hint_hawaii": KEEP_ENGLISH,
      "map.scope_hint_usa": KEEP_ENGLISH,
      "map.scope_label": KEEP_ENGLISH,
      "map.scope_hawaii": "Hawai\u02bfi",
      "map.scope_usa": "USA",
      "map.refresh": KEEP_ENGLISH,
      "map.use_location": KEEP_ENGLISH,
      "map.satellite": KEEP_ENGLISH,
      "map.footer": "Kahu Ola \xb7 Kaiaulu",
      "map.map_details": KEEP_ENGLISH,

      // Source acronyms: always preserved
      "source.nasa_firms": "NASA FIRMS",
      "source.nws": "NWS",
      "source.noaa": "NOAA",
      "source.epa": "EPA",
      "source.usgs": "USGS",
      "source.hiema": "HIEMA",

      // Language selector
      "lang.label": "\u02bbolelo",
      "lang.select_aria": "E w\u0101lau i ka \u02bbolelo"
    },

    // ── TAGALOG (Phase 3 — framework, controlled coverage) ────
    // Safe UI chrome translated. All hazard terms KEEP ENGLISH pending review.
    tl: {
      "meta.label": "Tagalog",
      "meta.lang_html": "tl",

      // Navigation — safe labels
      "nav.live_map": "Live na Mapa",
      "nav.privacy": "Pribasidad",
      "nav.support": "Suporta",
      "nav.home": "Tahanan",
      // Hazard-adjacent: KEEP ENGLISH
      "nav.official_alerts": KEEP_ENGLISH,
      "nav.how_it_works": KEEP_ENGLISH,
      "nav.mission": KEEP_ENGLISH,
      "nav.data_sources": KEEP_ENGLISH,

      // Brand
      "brand.guardian": "Tagapagtanggol ng Buhay",
      "brand.kicker": KEEP_ENGLISH,
      "brand.title": KEEP_ENGLISH,
      "brand.sub": KEEP_ENGLISH,

      // ALL hazard signals: KEEP ENGLISH — pending review
      "signal.fire_label": KEEP_ENGLISH,
      "signal.flood_label": KEEP_ENGLISH,
      "signal.fire_no_detections": KEEP_ENGLISH,
      "signal.flood_no_watches": KEEP_ENGLISH,
      "signal.fire_monitoring": KEEP_ENGLISH,
      "signal.flood_monitoring": KEEP_ENGLISH,
      "signal.fire_copy_clear": KEEP_ENGLISH,
      "signal.flood_copy_clear": KEEP_ENGLISH,
      "signal.conditions_unchanged": KEEP_ENGLISH,

      // Status: KEEP ENGLISH
      "status.clear": KEEP_ENGLISH,
      "status.active": KEEP_ENGLISH,
      "status.monitoring": KEEP_ENGLISH,
      "status.normal": KEEP_ENGLISH,
      "status.watch": KEEP_ENGLISH,
      "status.warning": KEEP_ENGLISH,
      "status.no_active_signal": KEEP_ENGLISH,

      // Freshness: KEEP ENGLISH — timing precision critical
      "freshness.updated_recently": KEEP_ENGLISH,
      "freshness.updated_just_now": KEEP_ENGLISH,
      "freshness.updated_min": KEEP_ENGLISH,
      "freshness.updated_hr": KEEP_ENGLISH,
      "freshness.updated_day": KEEP_ENGLISH,
      "freshness.loading": "Naglo-load\u2026",
      "freshness.data_may_be_stale": KEEP_ENGLISH,

      // Legend: KEEP ENGLISH
      "legend.signal": KEEP_ENGLISH,
      "legend.monitoring": KEEP_ENGLISH,
      "legend.fire_active": KEEP_ENGLISH,
      "legend.flood_alert": KEEP_ENGLISH,

      // CTAs
      "cta.view_live_map": "Tingnan ang Live na Mapa",
      "cta.official_alerts": KEEP_ENGLISH,

      // Civic: KEEP ENGLISH pending review
      "civic.not_official_alert": KEEP_ENGLISH,
      "civic.follow_official_guidance": KEEP_ENGLISH,
      "civic.monitor_conditions": KEEP_ENGLISH,
      "civic.guardian_note": KEEP_ENGLISH,
      "civic.no_account_required": "Hindi na kailangan ng account",
      "civic.no_ads": "Walang pagbebenta ng data \xb7 Walang ads",

      // Map
      "map.scope_label": KEEP_ENGLISH,
      "map.scope_hawaii": "Hawai\u02bfi",
      "map.scope_usa": "USA",
      "map.refresh": KEEP_ENGLISH,
      "map.use_location": "Gamitin ang Aking Lokasyon",
      "map.satellite": KEEP_ENGLISH,
      "map.footer": "Kahu Ola sibilyang teknolohiya",
      "map.map_details": "Detalye ng Mapa",

      // Source acronyms: always preserved
      "source.nasa_firms": "NASA FIRMS",
      "source.nws": "NWS",
      "source.noaa": "NOAA",
      "source.epa": "EPA",
      "source.usgs": "USGS",
      "source.hiema": "HIEMA",

      // Language selector
      "lang.label": "Wika",
      "lang.select_aria": "Pumili ng wika"
    },

    // ── ILOCANO (Phase 3 — framework, controlled coverage) ────
    // Ilocano spoken across Hawaii. Safe UI chrome only. Hazard terms KEEP ENGLISH.
    ilo: {
      "meta.label": "Ilocano",
      "meta.lang_html": "ilo",

      // Navigation
      "nav.live_map": "Live nga Mapa",
      "nav.privacy": "Pribado",
      "nav.support": "Tulong",
      "nav.home": "Balay",
      "nav.official_alerts": KEEP_ENGLISH,
      "nav.how_it_works": KEEP_ENGLISH,
      "nav.mission": KEEP_ENGLISH,
      "nav.data_sources": KEEP_ENGLISH,

      // Brand
      "brand.guardian": "Bantay ti Biag",
      "brand.kicker": KEEP_ENGLISH,
      "brand.title": KEEP_ENGLISH,
      "brand.sub": KEEP_ENGLISH,

      // ALL hazard signals: KEEP ENGLISH
      "signal.fire_label": KEEP_ENGLISH,
      "signal.flood_label": KEEP_ENGLISH,
      "signal.fire_no_detections": KEEP_ENGLISH,
      "signal.flood_no_watches": KEEP_ENGLISH,
      "signal.fire_monitoring": KEEP_ENGLISH,
      "signal.flood_monitoring": KEEP_ENGLISH,
      "signal.fire_copy_clear": KEEP_ENGLISH,
      "signal.flood_copy_clear": KEEP_ENGLISH,
      "signal.conditions_unchanged": KEEP_ENGLISH,

      // Status: KEEP ENGLISH
      "status.clear": KEEP_ENGLISH,
      "status.active": KEEP_ENGLISH,
      "status.monitoring": KEEP_ENGLISH,
      "status.normal": KEEP_ENGLISH,
      "status.watch": KEEP_ENGLISH,
      "status.warning": KEEP_ENGLISH,
      "status.no_active_signal": KEEP_ENGLISH,

      // Freshness: KEEP ENGLISH
      "freshness.updated_recently": KEEP_ENGLISH,
      "freshness.updated_just_now": KEEP_ENGLISH,
      "freshness.updated_min": KEEP_ENGLISH,
      "freshness.updated_hr": KEEP_ENGLISH,
      "freshness.updated_day": KEEP_ENGLISH,
      "freshness.loading": "Agload\u2026",
      "freshness.data_may_be_stale": KEEP_ENGLISH,

      // Legend: KEEP ENGLISH
      "legend.signal": KEEP_ENGLISH,
      "legend.monitoring": KEEP_ENGLISH,
      "legend.fire_active": KEEP_ENGLISH,
      "legend.flood_alert": KEEP_ENGLISH,

      // CTAs
      "cta.view_live_map": "Kitaen ti Live nga Mapa",
      "cta.official_alerts": KEEP_ENGLISH,

      // Civic: KEEP ENGLISH
      "civic.not_official_alert": KEEP_ENGLISH,
      "civic.follow_official_guidance": KEEP_ENGLISH,
      "civic.monitor_conditions": KEEP_ENGLISH,
      "civic.guardian_note": KEEP_ENGLISH,
      "civic.no_account_required": "Saanna a kasapulan ti account",
      "civic.no_ads": "Awan ti pannagited ti data \xb7 Awan ti ads",

      // Map
      "map.scope_label": KEEP_ENGLISH,
      "map.scope_hawaii": "Hawai\u02bfi",
      "map.scope_usa": "USA",
      "map.refresh": KEEP_ENGLISH,
      "map.use_location": "Usaren ti Lokasionko",
      "map.satellite": KEEP_ENGLISH,
      "map.footer": "Kahu Ola sibilyan a teknolohia",
      "map.map_details": "Detalye ti Mapa",

      // Source acronyms: always preserved
      "source.nasa_firms": "NASA FIRMS",
      "source.nws": "NWS",
      "source.noaa": "NOAA",
      "source.epa": "EPA",
      "source.usgs": "USGS",
      "source.hiema": "HIEMA",

      // Language selector
      "lang.label": "Pagsasao",
      "lang.select_aria": "Piliem ti pagsasao"
    },

    // ── JAPANESE (Phase 3 — framework, controlled coverage) ────
    // Safe UI chrome translated. All hazard terms KEEP ENGLISH pending review.
    ja: {
      "meta.label": "\u65e5\u672c\u8a9e",
      "meta.lang_html": "ja",

      // Navigation
      "nav.live_map": "\u30e9\u30a4\u30d6\u30de\u30c3\u30d7",
      "nav.privacy": "\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc",
      "nav.support": "\u30b5\u30dd\u30fc\u30c8",
      "nav.home": "\u30db\u30fc\u30e0",
      "nav.official_alerts": KEEP_ENGLISH,
      "nav.how_it_works": KEEP_ENGLISH,
      "nav.mission": KEEP_ENGLISH,
      "nav.data_sources": KEEP_ENGLISH,

      // Brand
      "brand.guardian": "\u547d\u306e\u5b88\u308a\u795e",
      "brand.kicker": KEEP_ENGLISH,
      "brand.title": KEEP_ENGLISH,
      "brand.sub": KEEP_ENGLISH,

      // ALL hazard signals: KEEP ENGLISH
      "signal.fire_label": KEEP_ENGLISH,
      "signal.flood_label": KEEP_ENGLISH,
      "signal.fire_no_detections": KEEP_ENGLISH,
      "signal.flood_no_watches": KEEP_ENGLISH,
      "signal.fire_monitoring": KEEP_ENGLISH,
      "signal.flood_monitoring": KEEP_ENGLISH,
      "signal.fire_copy_clear": KEEP_ENGLISH,
      "signal.flood_copy_clear": KEEP_ENGLISH,
      "signal.conditions_unchanged": KEEP_ENGLISH,

      // Status: KEEP ENGLISH
      "status.clear": KEEP_ENGLISH,
      "status.active": KEEP_ENGLISH,
      "status.monitoring": KEEP_ENGLISH,
      "status.normal": KEEP_ENGLISH,
      "status.watch": KEEP_ENGLISH,
      "status.warning": KEEP_ENGLISH,
      "status.no_active_signal": KEEP_ENGLISH,

      // Freshness: KEEP ENGLISH — timing critical
      "freshness.updated_recently": KEEP_ENGLISH,
      "freshness.updated_just_now": KEEP_ENGLISH,
      "freshness.updated_min": KEEP_ENGLISH,
      "freshness.updated_hr": KEEP_ENGLISH,
      "freshness.updated_day": KEEP_ENGLISH,
      "freshness.loading": "\u8aad\u307f\u8fbc\u307f\u4e2d\u2026",
      "freshness.data_may_be_stale": KEEP_ENGLISH,

      // Legend: KEEP ENGLISH
      "legend.signal": KEEP_ENGLISH,
      "legend.monitoring": KEEP_ENGLISH,
      "legend.fire_active": KEEP_ENGLISH,
      "legend.flood_alert": KEEP_ENGLISH,

      // CTAs
      "cta.view_live_map": "\u30e9\u30a4\u30d6\u30de\u30c3\u30d7\u3092\u8868\u793a",
      "cta.official_alerts": KEEP_ENGLISH,

      // Civic: KEEP ENGLISH — critical safety language
      "civic.not_official_alert": KEEP_ENGLISH,
      "civic.follow_official_guidance": KEEP_ENGLISH,
      "civic.monitor_conditions": KEEP_ENGLISH,
      "civic.guardian_note": KEEP_ENGLISH,
      "civic.no_account_required": "\u30a2\u30ab\u30a6\u30f3\u30c8\u4e0d\u8981",
      "civic.no_ads": "\u30c7\u30fc\u30bf\u8ca9\u58f2\u306a\u3057 \xb7 \u5e83\u544a\u306a\u3057",

      // Map
      "map.scope_label": KEEP_ENGLISH,
      "map.scope_hawaii": "Hawai\u02bfi",
      "map.scope_usa": "USA",
      "map.refresh": "\u66f4\u65b0",
      "map.use_location": "\u73fe\u5728\u5730\u3092\u4f7f\u7528",
      "map.satellite": "\u885b\u661f\u753b\u50cf",
      "map.footer": "Kahu Ola \u5e02\u6c11\u6280\u8853",
      "map.map_details": "\u30de\u30c3\u30d7\u306e\u8a73\u7d30",

      // Source acronyms: always preserved
      "source.nasa_firms": "NASA FIRMS",
      "source.nws": "NWS",
      "source.noaa": "NOAA",
      "source.epa": "EPA",
      "source.usgs": "USGS",
      "source.hiema": "HIEMA",

      // Language selector
      "lang.label": "\u8a00\u8a9e",
      "lang.select_aria": "\u8a00\u8a9e\u3092\u9078\u629e"
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // TRANSLATION ENGINE
  // ═══════════════════════════════════════════════════════════════

  var currentLang = DEFAULT_LANG;

  function safeLs(op, key, value) {
    try {
      if (op === "get") return localStorage.getItem(key);
      if (op === "set") localStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  /**
   * t(key) — translate a Class A key.
   * Falls back to English if key is missing or KEEP_ENGLISH.
   * Falls back to key itself if not in English either.
   */
  function t(key) {
    var dict = LOCALES[currentLang] || {};
    var en = LOCALES.en || {};
    var val = dict[key];
    if (val === undefined || val === null || val === "" || val === KEEP_ENGLISH) {
      var enVal = en[key];
      return (enVal !== undefined && enVal !== null && enVal !== "") ? enVal : key;
    }
    return val;
  }

  /**
   * tmpl(key, vars) — translate a Class B template.
   * Replaces {placeholder} tokens with safe variable values.
   * Falls back identically to t().
   */
  function tmpl(key, vars) {
    var s = t(key);
    if (!vars) return s;
    var keys = Object.keys(vars);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k]));
    }
    return s;
  }

  /**
   * applyAll() — walk all [data-i18n] elements and apply current locale.
   * Safe to call multiple times. Never throws.
   */
  function applyAll() {
    try {
      var elems = document.querySelectorAll("[data-i18n]");
      for (var i = 0; i < elems.length; i++) {
        var el = elems[i];
        var key = el.getAttribute("data-i18n");
        var val = t(key);
        // Only set if we resolved to something meaningful (not the bare key)
        if (val && val !== key) el.textContent = val;
      }
      var ariaElems = document.querySelectorAll("[data-i18n-aria]");
      for (var j = 0; j < ariaElems.length; j++) {
        var ariaEl = ariaElems[j];
        var ariaKey = ariaEl.getAttribute("data-i18n-aria");
        var ariaVal = t(ariaKey);
        if (ariaVal && ariaVal !== ariaKey) ariaEl.setAttribute("aria-label", ariaVal);
      }
      // Sync the selector widget value if present
      var sel = document.getElementById("kahuola-lang-select");
      if (sel && sel.value !== currentLang) sel.value = currentLang;
    } catch (e) {
      // Silent fail — never break the page
    }
  }

  /**
   * setLang(lang) — switch language, persist, re-apply, emit event.
   */
  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
    currentLang = lang;
    safeLs("set", STORAGE_KEY, lang);
    var htmlLang = (LOCALES[lang] || {})["meta.lang_html"] || lang;
    document.documentElement.lang = htmlLang;
    applyAll();
    try {
      window.dispatchEvent(
        new CustomEvent("kahuola:langchange", { detail: { lang: lang } })
      );
    } catch (e) {}
  }

  function getLang() { return currentLang; }

  function getSupportedLanguages() {
    return SUPPORTED.map(function (code) {
      return {
        code: code,
        label: (LOCALES[code] || {})["meta.label"] || code,
        phase: PHASES[code] || 3
      };
    });
  }

  /**
   * init() — restore persisted language, apply to DOM.
   * Called automatically. Safe to call again.
   */
  function init() {
    var saved = safeLs("get", STORAGE_KEY) || DEFAULT_LANG;
    currentLang = (SUPPORTED.indexOf(saved) !== -1) ? saved : DEFAULT_LANG;
    var htmlLang = (LOCALES[currentLang] || {})["meta.lang_html"] || currentLang;
    document.documentElement.lang = htmlLang;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyAll);
    } else {
      applyAll();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CLASS C — Dynamic AI Translation Interface (STUB / FUTURE)
  // ═══════════════════════════════════════════════════════════════
  // This interface is intentionally unimplemented.
  // Class C content (morning briefs, AI summaries, operator notes)
  // must be translated by Gemma 4 only after Layer C safety checks pass.
  //
  // See: docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md
  // See: docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md
  //
  // Future API shape (do not implement without Layer C safety wrapper):
  //
  //   KAHUOLA_I18N.translateAIContent(canonicalText, targetLang, opts)
  //     → Promise<{ translated: string, safetyPassed: bool, fallback: string }>
  //
  //   KAHUOLA_I18N.wrapAIDisclosure(translatedText, sourcesArray, targetLang)
  //     → string  // appends required disclosure label in target language
  //
  //   KAHUOLA_I18N.validateLayerC(translated, original, targetLang)
  //     → { valid: bool, flags: string[] }  // checks severity, source, freshness preservation
  //
  // Layer C checks must verify before any Class C content is published:
  //   1. all source labels are preserved
  //   2. timestamps remain correct
  //   3. glossary-locked terms are respected
  //   4. no forbidden certainty language present
  //   5. no prohibited civic instruction added
  //   6. required disclosure labels present
  // ═══════════════════════════════════════════════════════════════

  // ── Expose global ──────────────────────────────────────────────
  window.KAHUOLA_I18N = {
    t: t,
    tmpl: tmpl,
    setLang: setLang,
    getLang: getLang,
    applyAll: applyAll,
    init: init,
    getSupportedLanguages: getSupportedLanguages,
    SUPPORTED: SUPPORTED,
    PHASES: PHASES
  };

  // Auto-init
  init();

})();
