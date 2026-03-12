import { resolveHeroState } from "./state-machine.js";
import { renderSignalStack } from "./signals.js";
import { renderDiagnostics } from "./diagnostics.js";
import { isDegraded } from "./event-priority.js";

const API_URL = "/api/v1/home/summary";

function setFallback(message) {
  const heroTitle = document.getElementById("heroTitle");
  const heroSummary = document.getElementById("heroSummary");
  const freshnessLabel = document.getElementById("freshnessLabel");
  const degradedBanner = document.getElementById("degradedBanner");

  heroTitle.textContent = "Hazard Signals Temporarily Limited";
  heroSummary.textContent = message;
  freshnessLabel.textContent = "Freshness unknown";
  degradedBanner.classList.remove("hidden");
  degradedBanner.textContent = "Some data sources are delayed. Use official alerts for urgent decisions.";
}

async function fetchSummary() {
  const response = await fetch(API_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Worker summary request failed: ${response.status}`);
  }

  return response.json();
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

  const freshness = summary.freshness_state ?? "STALE_DROP";
  freshnessLabel.textContent = `Freshness: ${freshness}`;

  if (isDegraded(primaryEvent, summary.degraded)) {
    degradedBanner.classList.remove("hidden");
    degradedBanner.textContent = "Some data sources are delayed. Showing the latest verified snapshot where possible.";
  } else {
    degradedBanner.classList.add("hidden");
    degradedBanner.textContent = "";
  }

  renderSignalStack(signalStack, summary);
  renderDiagnostics(diagnosticsLine, summary);
}

(async function initHomepage() {
  try {
    const summary = await fetchSummary();
    renderSummary(summary);
  } catch (error) {
    console.error(error);
    setFallback("Unable to load the latest Worker snapshot at this time.");
  }
})();