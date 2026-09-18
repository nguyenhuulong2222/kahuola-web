/**
 * Kahu Ola — No Door resource navigator (P34, Proof 1)
 *
 * Invariant I   — ZERO network calls. The graph is read from an inline
 *                 <script type="application/json"> embed in resources.html.
 *                 External URLs are rendered as links for the user to tap;
 *                 this file never fetches anything.
 * Invariant II  — The static floor and disclaimer are raw HTML in the page.
 *                 If this file throws, dies, or never loads, they remain.
 * Invariant III — Fail closed per node: a node that fails validation is
 *                 dropped and counted, never rendered, never "assumed fine".
 * Invariant IV  — Zero PII. Selections live in module memory only. No fetch,
 *                 no beacon, no analytics, no browser storage, no location.
 *
 * R1 — nodes only; no edge database. R2 — 3-tier freshness computed here at
 * render time. R3 — the banned kinship-placement term appears nowhere; routing
 * uses child + caregiver_support only.
 *
 * Every function is declared at module scope. Nothing is defined inside an
 * event binding: a function born inside a bind closure disappears from every
 * other call site and fails as a silent ReferenceError.
 */
(function () {
  "use strict";

  var EMBED_ID = "capability-graph-embed";
  var PIN_ID = "cap-auw-211";
  var SCHEMA_VERSION = "capgraph-1.1";

  var CAPABILITIES = ["transportation", "shelter", "medication_continuity"];
  // Five chips in P34. wheelchair_mobility is a valid data value with no chip
  // yet, so it is accepted here but never offered as a filter.
  var AUDIENCE = ["child", "kupuna", "pet", "no_vehicle", "limited_english", "wheelchair_mobility"];
  var AVAILABILITY = ["standing", "disaster_activated", "seasonal"];
  var AUTHORITY = ["official", "partner", "community"];
  var AUTHORITY_RANK = { official: 0, partner: 1, community: 2 };

  var state = { needs: [], constraints: [], nodes: [], invalidCount: 0 };

  // ── logging ───────────────────────────────────────────────────────────
  // The only place console is touched, and only at error level.
  function logError(module, eventCode) {
    try {
      console.error("[kahuola] " + module + " " + eventCode);
    } catch (e) { /* a console that throws must not take the page with it */ }
  }

  // ── i18n helpers, same contract as the other pages ────────────────────
  function _t(key) {
    if (!window.KAHUOLA_I18N) return null;
    var v = window.KAHUOLA_I18N.t(key);
    return (v !== undefined && v !== null && v !== key) ? v : null;
  }
  function _tmpl(key, vars) {
    if (!window.KAHUOLA_I18N) return null;
    var v = window.KAHUOLA_I18N.tmpl(key, vars);
    return (v !== undefined && v !== null && v !== key) ? v : null;
  }
  function label(key, fallback) {
    return _t(key) || fallback;
  }

  // ── validation: a mirror of scripts/validate-graph.mjs ────────────────
  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }
  function allIn(list, allowed, allowStar) {
    if (!Array.isArray(list) || list.length === 0) return false;
    for (var i = 0; i < list.length; i++) {
      if (allowStar && list[i] === "*") continue;
      if (allowed.indexOf(list[i]) === -1) return false;
    }
    return true;
  }
  function isIsoDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  }
  function validateNode(node) {
    if (!isPlainObject(node)) return false;
    if (typeof node.id !== "string" || node.id.indexOf("cap-") !== 0) return false;
    if (typeof node.name !== "string" || !node.name) return false;
    if (typeof node.i18n_key !== "string" || !node.i18n_key) return false;
    if (!allIn(node.capabilities, CAPABILITIES, false)) return false;
    if (!allIn(node.audience, AUDIENCE, true)) return false;
    if (!Array.isArray(node.requires) || node.requires.length !== 0) return false;
    if (AVAILABILITY.indexOf(node.availability) === -1) return false;
    if (AUTHORITY.indexOf(node.authority) === -1) return false;
    if (typeof node.max_age_hours !== "number" || !isFinite(node.max_age_hours) || node.max_age_hours <= 0) return false;
    if (!isPlainObject(node.channels)) return false;
    if (!node.channels.phone && !node.channels.url) return false;
    if (!Array.isArray(node.languages) || node.languages.indexOf("en") === -1) return false;
    if (!isIsoDate(node.last_verified)) return false;
    return true;
  }

  // ── R2 freshness, computed at render time ─────────────────────────────
  function freshnessOf(node, nowMs) {
    var ageHours = (nowMs - Date.parse(node.last_verified)) / 3600000;
    if (ageHours <= node.max_age_hours) return "FRESH";
    if (ageHours <= node.max_age_hours * 3) return "STALE_OK";
    return "STALE_DROP";
  }

  // ── filtering ─────────────────────────────────────────────────────────
  function intersects(a, b) {
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) !== -1) return true;
    return false;
  }
  // Needs are OR within themselves, AND-ed with audience compatibility.
  // No needs selected → the need filter is off, same as no constraints.
  function matchesSelection(node) {
    if (state.needs.length && !intersects(node.capabilities, state.needs)) return false;
    if (state.constraints.length) {
      if (node.audience.indexOf("*") === -1 && !intersects(node.audience, state.constraints)) return false;
    }
    return true;
  }
  function isExactAudienceMatch(node) {
    return state.constraints.length > 0 &&
      node.audience.indexOf("*") === -1 &&
      intersects(node.audience, state.constraints);
  }

  // ── ranking ───────────────────────────────────────────────────────────
  // authority → exact-audience-match before "*" → FRESH before STALE_OK → id
  function compareNodes(a, b) {
    var ra = AUTHORITY_RANK[a.node.authority], rb = AUTHORITY_RANK[b.node.authority];
    if (ra !== rb) return ra - rb;
    var ea = isExactAudienceMatch(a.node) ? 0 : 1, eb = isExactAudienceMatch(b.node) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    var fa = a.freshness === "FRESH" ? 0 : 1, fb = b.freshness === "FRESH" ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.node.id < b.node.id ? -1 : (a.node.id > b.node.id ? 1 : 0);
  }

  // ── DOM builders (textContent only — never innerHTML) ──────────────────
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function buildAuthorityBadge(authority) {
    // Icon + text, never colour alone (WCAG 1.4.1).
    var icons = { official: "★", partner: "◆", community: "○" };
    var keys = { official: "nodoor.badge_official", partner: "nodoor.badge_partner", community: "nodoor.badge_community" };
    var fallbacks = { official: "Official", partner: "Partner", community: "Community" };
    var b = el("span", "nd-badge nd-badge--" + authority);
    b.appendChild(el("span", "nd-badge-icon", icons[authority]));
    b.appendChild(el("span", null, label(keys[authority], fallbacks[authority])));
    return b;
  }

  function buildChannelRow(node) {
    var row = el("div", "nd-channels");
    var ch = node.channels;
    if (ch.phone) {
      // Phone first and largest: on a wildfire page the call is the action.
      var a = el("a", "nd-call", label("nodoor.call", "Call") + " " + ch.phone);
      a.href = "tel:" + ch.phone.replace(/[^0-9+]/g, "");
      row.appendChild(a);
    }
    if (ch.url) {
      var u = el("a", "nd-link", label("nodoor.website", "Website"));
      u.href = ch.url;
      u.target = "_blank";
      u.rel = "noopener noreferrer";
      row.appendChild(u);
    }
    if (ch.sms) {
      var s = el("a", "nd-link", label("nodoor.text_label", "Text") + " " + ch.sms);
      s.href = "sms:" + ch.sms.replace(/[^0-9+]/g, "");
      row.appendChild(s);
    }
    return row;
  }

  function buildCard(entry, pinned) {
    var node = entry.node;
    var card = el("article", "nd-card" + (pinned ? " nd-card--pinned" : ""));

    var head = el("div", "nd-card-head");
    head.appendChild(el("h3", "nd-name", label(node.i18n_key, node.name)));
    head.appendChild(buildAuthorityBadge(node.authority));
    card.appendChild(head);

    if (pinned) card.appendChild(el("p", "nd-pinned-note", label("nodoor.pinned", "Start here")));

    card.appendChild(buildChannelRow(node));

    var availKeys = {
      standing: "nodoor.avail_standing",
      disaster_activated: "nodoor.avail_disaster_activated",
      seasonal: "nodoor.avail_seasonal"
    };
    var availFallback = {
      standing: "Always available",
      disaster_activated: "Open during activated disasters",
      seasonal: "Seasonal"
    };
    card.appendChild(el("p", "nd-avail", label(availKeys[node.availability], availFallback[node.availability])));

    if (node.channels.offline_note_i18n_key) {
      var note = _t(node.channels.offline_note_i18n_key);
      if (note) card.appendChild(el("p", "nd-offline", note));
    }

    var meta = el("div", "nd-meta");
    meta.appendChild(el("span", "nd-verified",
      _tmpl("nodoor.verified_on", { d: node.last_verified }) || ("Verified: " + node.last_verified)));
    // R2: FRESH carries no badge. Only STALE_OK is called out.
    if (entry.freshness === "STALE_OK") {
      meta.appendChild(el("span", "nd-stale",
        label("nodoor.badge_stale_ok", "Not verified recently — call to confirm")));
    }
    card.appendChild(meta);

    return card;
  }

  // ── render ────────────────────────────────────────────────────────────
  function render() {
    var results = document.getElementById("nd-results");
    var staleLine = document.getElementById("nd-stale-count");
    var invalidLine = document.getElementById("nd-invalid-count");
    if (!results) return;

    while (results.firstChild) results.removeChild(results.firstChild);

    var now = Date.now();
    var staleDropped = 0;
    var visible = [];

    for (var i = 0; i < state.nodes.length; i++) {
      var node = state.nodes[i];
      var f = freshnessOf(node, now);
      if (f === "STALE_DROP") { staleDropped++; continue; }   // R2: hidden, counted
      if (!matchesSelection(node)) continue;
      visible.push({ node: node, freshness: f });
    }

    visible.sort(compareNodes);

    // 211 is pinned on top whether or not anything else matched — it is the
    // one door that always answers.
    var pinIdx = -1;
    for (var j = 0; j < visible.length; j++) if (visible[j].node.id === PIN_ID) { pinIdx = j; break; }
    var pinEntry = null;
    if (pinIdx !== -1) { pinEntry = visible.splice(pinIdx, 1)[0]; }
    else {
      for (var k = 0; k < state.nodes.length; k++) {
        if (state.nodes[k].id === PIN_ID) {
          var pf = freshnessOf(state.nodes[k], now);
          if (pf !== "STALE_DROP") pinEntry = { node: state.nodes[k], freshness: pf };
          break;
        }
      }
    }

    // Absence must never read as safety: an empty result says so out loud
    // and still hands over 211.
    if (!visible.length) {
      results.appendChild(el("p", "nd-empty", label("nodoor.empty_result", "No matching service found — call 211")));
    }

    if (pinEntry) results.appendChild(buildCard(pinEntry, true));
    for (var m = 0; m < visible.length; m++) results.appendChild(buildCard(visible[m], false));

    if (staleLine) {
      staleLine.textContent = staleDropped
        ? (_tmpl("nodoor.stale_drop_n", { n: staleDropped }) || (staleDropped + " source(s) awaiting re-verification"))
        : "";
    }
    if (invalidLine) {
      invalidLine.textContent = state.invalidCount
        ? (_tmpl("nodoor.dropped_invalid_n", { n: state.invalidCount }) || (state.invalidCount + " entry(ies) withheld — failed validation"))
        : "";
    }
  }

  // ── chip handling ─────────────────────────────────────────────────────
  function toggleIn(list, value) {
    var i = list.indexOf(value);
    if (i === -1) list.push(value); else list.splice(i, 1);
    return list;
  }

  function onChipClick(ev) {
    try {
      var chip = ev.currentTarget;
      var group = chip.getAttribute("data-group");
      var value = chip.getAttribute("data-value");
      if (group === "need") toggleIn(state.needs, value);
      else if (group === "constraint") toggleIn(state.constraints, value);
      else return;
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
      render();
    } catch (e) {
      logError("nodoor.navigator", "CHIP_CLICK_FAILED");
    }
  }

  function bindChips() {
    var chips = document.querySelectorAll(".nd-chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", onChipClick);
    }
  }

  // ── load: embed only, never a fetch (Invariant I) ─────────────────────
  function readEmbeddedGraph() {
    var tag = document.getElementById(EMBED_ID);
    if (!tag) { logError("nodoor.navigator", "EMBED_MISSING"); return null; }
    try {
      return JSON.parse(tag.textContent);
    } catch (e) {
      logError("nodoor.navigator", "EMBED_PARSE_FAILED");
      return null;
    }
  }

  function loadNodes() {
    var graph = readEmbeddedGraph();
    if (!graph || graph.schema_version !== SCHEMA_VERSION || !Array.isArray(graph.nodes)) {
      logError("nodoor.navigator", "EMBED_SCHEMA_REJECTED");
      return;
    }
    for (var i = 0; i < graph.nodes.length; i++) {
      // Per node, so one malformed entry can never take the registry down.
      try {
        if (validateNode(graph.nodes[i])) state.nodes.push(graph.nodes[i]);
        else state.invalidCount++;
      } catch (e) {
        state.invalidCount++;
        logError("nodoor.navigator", "NODE_VALIDATION_THREW");
      }
    }
    if (state.invalidCount) logError("nodoor.navigator", "NODES_DROPPED_" + state.invalidCount);
  }

  function onLangChange() {
    try {
      render();
    } catch (e) {
      logError("nodoor.navigator", "RERENDER_FAILED");
    }
  }

  function init() {
    try {
      loadNodes();
      bindChips();
      render();
      window.addEventListener("kahuola:langchange", onLangChange);
    } catch (e) {
      // The floor and the disclaimer are static HTML. They survive this.
      logError("nodoor.navigator", "INIT_FAILED");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
