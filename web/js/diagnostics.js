export function renderDiagnostics(target, summary) {
  const freshness = summary.freshness_state ?? "UNKNOWN";
  const source = summary.source ?? "Kahu Ola Worker";
  const generatedAt = summary.generated_at ?? "unknown";

  target.textContent = `Source: ${source} | State: ${summary.primary_event ?? "MONITORING"} | Freshness: ${freshness} | Generated: ${generatedAt}`;
}