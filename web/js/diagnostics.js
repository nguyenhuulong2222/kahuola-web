export function renderDiagnostics(target, summary) {
  const freshness = summary.freshness_state ?? "UNKNOWN";
  const source = summary.source ?? "Kahu Ola Worker";
  const generatedAt = summary.generated_at ?? "unknown";

  target.textContent = `Source: ${source} | Freshness: ${freshness} | Generated: ${generatedAt}`;
}