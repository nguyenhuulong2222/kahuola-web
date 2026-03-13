import { resolveHeroState } from "./state-machine.js";
import { renderSignalStack } from "./signals.js";
import { renderDiagnostics } from "./diagnostics.js";
import { isDegraded } from "./event-priority.js";
import { renderMiniMap } from "./mini-map.js";

const ENDPOINTS = {
  health: "/api/health",
  firms: "/api/firms/hotspots?bbox=-161,18,-154,23&days=1",
  flashFlood: "/api/hazards/flash-flood",
  rainRadar: "/api/hazards/rain-radar",
  floodContext: "/api/hazards/flood-context",
};

const PRIORITY = [
  "DEGRADED",
  "FIRE_ACTIVE",
  "FLOOD_WARNING",
  "FLOOD_WATCH",
  "STORM_ACTIVE",
  "MONITORING",
];


function setFallback(message) {
  const heroTitle = document.getElementById("heroTitle");
  const heroSummary = document.getElementById("heroSummary");
  const heroContext = document.getElementById("heroContext");
  const freshnessLabel = document.getElementById("freshnessLabel");
  const degradedBanner = document.getElementById("degradedBanner");
  const diagnosticsLine = document.getElementById("diagnosticsLine");

  heroTitle.textContent = "Hazard Signals Temporarily Limited";
  heroSummary.textContent = message;
  heroContext.textContent = "Source context unavailable.";
  freshnessLabel.textContent = "Freshness unknown";
  degradedBanner.classList.remove("hidden");
  degradedBanner.textContent = "Some hazard feeds are delayed. Kahu Ola is showing available worker data only.";
  diagnosticsLine.textContent = "Source: Kahu Ola Worker | Freshness: UNKNOWN | Generated: unknown";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

function relativeTimeLabel(iso) {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "recently updated";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `updated ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `updated ${hrs} hr ago`;
}

function hasFloodWarning(flashFloodSignals) {
  return flashFloodSignals.some((feature) => {
    const event = String(feature?.properties?.event ?? "").toLowerCase();
    return event.includes("warning");
  });
}

function hasFloodWatch(flashFloodSignals, floodContext) {
  const flashWatch = flashFloodSignals.some((feature) => {
    const event = String(feature?.properties?.event ?? "").toLowerCase();
    return event.includes("watch");
  });

  if (flashWatch) return true;

  const high = Number(floodContext?.summary?.high_count ?? 0);
  const elevated = Number(floodContext?.summary?.elevated_count ?? 0);
  return high > 0 || elevated > 0;
}

function hasStormActive(rainRadar, floodContext) {
  const heavy = Number(rainRadar?.summary?.heavy_count ?? 0);
  const moderate = Number(rainRadar?.summary?.moderate_count ?? 0);
  const floodHigh = Number(floodContext?.summary?.high_count ?? 0);

  return heavy > 0 || moderate >= 3 || floodHigh > 0;
}

function mapPointToIsland(longitude, latitude) {
  // Lightweight statewide bounding boxes for mini-map summary.
  if (longitude <= -159.3 && latitude >= 21.75) return "Kaua'i";
  if (longitude > -159.3 && longitude <= -157.5 && latitude >= 21.1) return "O'ahu";
  if (longitude > -157.5 && longitude <= -155.9 && latitude >= 20.4) return "Maui";
  if (longitude > -156.3 && longitude <= -154.6 && latitude >= 18.8 && latitude <= 20.4) return "Hawai'i Island";
  return null;
}

function islandFromText(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("kauai") || text.includes("kaua'i")) return "Kaua'i";
  if (text.includes("oahu") || text.includes("o'ahu")) return "O'ahu";
  if (text.includes("maui")) return "Maui";
  if (text.includes("hawaii") || text.includes("hawai'i") || text.includes("big island")) return "Hawai'i Island";
  return null;
}

function mergeIslandState(current, next) {
  const rank = { monitoring: 0, storm: 1, flood: 2, fire: 3 };
  return rank[next] > rank[current] ? next : current;
}

function buildIslandStates(result) {
  const states = {
    "Kaua'i": "monitoring",
    "O'ahu": "monitoring",
    Maui: "monitoring",
    "Hawai'i Island": "monitoring",
  };

  const radarSignals = result.rainRadar.ok ? result.rainRadar.data?.signals ?? [] : [];
  radarSignals.forEach((signal) => {
    const island = islandFromText(signal?.properties?.island);
    if (island) states[island] = mergeIslandState(states[island], "storm");
  });

  const floodSignals = result.floodContext.ok ? result.floodContext.data?.signals ?? [] : [];
  floodSignals.forEach((signal) => {
    const island = islandFromText(signal?.properties?.island);
    const risk = String(signal?.properties?.risk_index ?? "").toLowerCase();
    if (island && (risk === "high" || risk === "elevated" || risk === "moderate")) {
      states[island] = mergeIslandState(states[island], "flood");
    }
  });

  const flashFloodSignals = result.flashFlood.ok ? result.flashFlood.data?.signals ?? [] : [];
  flashFloodSignals.forEach((signal) => {
    const island = islandFromText(signal?.properties?.areaDesc || signal?.properties?.event);
    if (island) {
      states[island] = mergeIslandState(states[island], "flood");
    }
  });

  const fireFeatures = result.firms.ok ? result.firms.data?.features ?? [] : [];
  fireFeatures.forEach((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;
    const island = mapPointToIsland(Number(coords[0]), Number(coords[1]));
    if (island) states[island] = mergeIslandState(states[island], "fire");
  });

  return states;
}

function computePrimaryEvent({
  degraded,
  fireCount,
  flashFloodSignals,
  rainRadar,
  floodContext,
}) {
  const candidates = [];

  if (degraded) candidates.push("DEGRADED");
  if (fireCount > 0) candidates.push("FIRE_ACTIVE");
  if (hasFloodWarning(flashFloodSignals)) candidates.push("FLOOD_WARNING");
  if (hasFloodWatch(flashFloodSignals, floodContext)) candidates.push("FLOOD_WATCH");
  if (hasStormActive(rainRadar, floodContext)) candidates.push("STORM_ACTIVE");

  if (candidates.length === 0) return "MONITORING";

  return candidates.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0];
}

function buildSourceFreshness(result) {
  return [
    {
      label: "NASA FIRMS",
      status: result.firms.ok ? relativeTimeLabel(result.firms.data?.properties?.generated_at) : "delayed",
    },
    {
      label: "NWS flood / flash-flood",
      status: result.flashFlood.ok ? relativeTimeLabel(result.flashFlood.data?.generated_at) : "delayed",
    },
    {
      label: "Radar / storm context",
      status: result.rainRadar.ok ? relativeTimeLabel(result.rainRadar.data?.generated_at) : "delayed",
    },
  ];
}

function createSummary(result) {
  const healthOk = result.health.ok;
  const firmsFeatures = result.firms.ok ? (result.firms.data?.features ?? []) : [];
  const flashFloodSignals = result.flashFlood.ok ? (result.flashFlood.data?.signals ?? []) : [];
  const rainRadar = result.rainRadar.ok ? result.rainRadar.data : null;
  const floodContext = result.floodContext.ok ? result.floodContext.data : null;

  const fireCount = firmsFeatures.length;
  const floodCount = Number(result.flashFlood.data?.summary?.count ?? 0);
  const heavy = Number(result.rainRadar.data?.summary?.heavy_count ?? 0);
  const moderate = Number(result.rainRadar.data?.summary?.moderate_count ?? 0);
  const stormCount = heavy + moderate;

  const degraded = !healthOk;

  const primary_event = computePrimaryEvent({
    degraded,
    fireCount,
    flashFloodSignals,
    rainRadar,
    floodContext,
  });

  const generatedCandidates = [
    result.health.data?.generated_at,
    result.firms.data?.properties?.generated_at,
    result.flashFlood.data?.generated_at,
    result.rainRadar.data?.generated_at,
    result.floodContext.data?.generated_at,
  ].filter(Boolean);

  const generated_at = generatedCandidates.sort().at(-1) ?? null;

  return {
    status: "ok",
    source: "Kahu Ola Worker (/api/*)",
    primary_event,
    fire_count: fireCount,
    flood_count: floodCount,
    storm_count: stormCount,
    degraded,
    freshness_state: degraded ? "STALE_OK" : "FRESH",
    generated_at,
    source_freshness: buildSourceFreshness(result),
    island_states: buildIslandStates(result),
  };
}

async function fetchAll() {
  const [health, firms, flashFlood, rainRadar, floodContext] = await Promise.all([
    fetchJson(ENDPOINTS.health).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
    fetchJson(ENDPOINTS.firms).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
    fetchJson(ENDPOINTS.flashFlood).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
    fetchJson(ENDPOINTS.rainRadar).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
    fetchJson(ENDPOINTS.floodContext).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error })),
  ]);

  return { health, firms, flashFlood, rainRadar, floodContext };
}

function renderSourceFreshness(summary) {
  const freshnessList = document.getElementById("sourceFreshness");
  if (!freshnessList) return;

  const rows = (summary.source_freshness ?? []).map((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.label}: ${entry.status}`;
    return li;
  });

  freshnessList.replaceChildren(...rows);
}

function renderSummary(summary) {
  const heroTitle = document.getElementById("heroTitle");
  const heroSummary = document.getElementById("heroSummary");
  const heroContext = document.getElementById("heroContext");
  const freshnessLabel = document.getElementById("freshnessLabel");
  const degradedBanner = document.getElementById("degradedBanner");
  const signalStack = document.getElementById("signalStack");
  const diagnosticsLine = document.getElementById("diagnosticsLine");
  const miniMapContainer = document.getElementById("miniMapContainer");

  const primaryEvent = summary.primary_event ?? "MONITORING";
  const heroState = resolveHeroState(primaryEvent);

  heroTitle.textContent = heroState.title;
  heroSummary.textContent = heroState.summary;
  heroContext.textContent = heroState.context;
  freshnessLabel.textContent = `Statewide snapshot: ${relativeTimeLabel(summary.generated_at)}`;

  if (isDegraded(primaryEvent, summary.degraded)) {
    degradedBanner.classList.remove("hidden");
    degradedBanner.textContent = "Some hazard feeds are delayed. Kahu Ola is showing the latest verified worker data available.";
  } else {
    degradedBanner.classList.add("hidden");
    degradedBanner.textContent = "";
  }

  renderSignalStack(signalStack, summary);
  renderSourceFreshness(summary);
  renderMiniMap(miniMapContainer, summary.island_states);
  renderDiagnostics(diagnosticsLine, summary);
}

(async function initHomepage() {
  try {
    const raw = await fetchAll();
    const summary = createSummary(raw);
    renderSummary(summary);
  } catch (error) {
    console.error(error);
    setFallback("Unable to load the latest worker hazard snapshot at this time.");
  }
})();