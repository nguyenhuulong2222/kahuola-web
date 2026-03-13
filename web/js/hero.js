import { resolveHeroState } from "./state-machine.js";
import { renderSignalStack } from "./signals.js";
import { renderDiagnostics } from "./diagnostics.js";
import { isDegraded } from "./event-priority.js";

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
  const freshnessLabel = document.getElementById("freshnessLabel");
  const degradedBanner = document.getElementById("degradedBanner");
  const diagnosticsLine = document.getElementById("diagnosticsLine");

  heroTitle.textContent = "Hazard Signals Temporarily Limited";
  heroSummary.textContent = message;
  freshnessLabel.textContent = "Freshness unknown";
  degradedBanner.classList.remove("hidden");
  degradedBanner.textContent = "Some data sources are delayed. Use official alerts for urgent decisions.";
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
  if (!iso) return "Freshness unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Freshness unknown";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Updated just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `Updated ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `Updated ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
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

function renderSummary(summary) {
  const heroTitle = document.getElementById("heroTitle");
  const heroSummary = document.getElementById("heroSummary");
  const freshnessLabel = document.getElementById("freshnessLabel");
  const degradedBanner = document.getElementById("degradedBanner");
  const signalStack = document.getElementById("signalStack");
  const diagnosticsLine = document.getElementById("diagnosticsLine");

  const primaryEvent = summary.primary_event ?? "MONITORING";
  const heroState = resolveHeroState(primaryEvent);

  heroTitle.textContent = heroState.title;
  heroSummary.textContent = heroState.summary;
  freshnessLabel.textContent = relativeTimeLabel(summary.generated_at);

  if (isDegraded(primaryEvent, summary.degraded)) {
    degradedBanner.classList.remove("hidden");
    degradedBanner.textContent = "Some data sources are delayed. Showing verified data where available.";
  } else {
    degradedBanner.classList.add("hidden");
    degradedBanner.textContent = "";
  }

  renderSignalStack(signalStack, summary);
  renderDiagnostics(diagnosticsLine, summary);
}

(async function initHomepage() {
  try {
    const raw = await fetchAll();
    const summary = createSummary(raw);
    renderSummary(summary);
  } catch (error) {
    console.error(error);
    setFallback("Unable to load the latest Worker hazard snapshot at this time.");
  }
})();