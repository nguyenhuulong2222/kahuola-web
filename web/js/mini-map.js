const ISLANDS = ["Kaua'i", "O'ahu", "Maui", "Hawai'i Island"];

function labelForState(state) {
  switch (state) {
    case "fire":
      return "Fire hotspot";
    case "flood":
      return "Flood watch/warning context";
    case "storm":
      return "Storm/rain context";
    default:
      return "Monitoring";
  }
}

export function renderMiniMap(container, islandStates) {
  if (!container) return;

  const rows = ISLANDS.map((island) => {
    const state = islandStates[island] ?? "monitoring";
    return `
      <li class="mini-map-row">
        <span class="mini-map-dot ${state}" aria-hidden="true"></span>
        <span class="mini-map-name">${island}</span>
        <span class="mini-map-state">${labelForState(state)}</span>
      </li>
    `;
  }).join("");

  container.innerHTML = `
    <div class="mini-map-card">
      <h4>Mini Hawai'i Status</h4>
      <ul class="mini-map-list">${rows}</ul>
      <p class="mini-map-note">Statewide summary only. Open Live Map for full detail.</p>
    </div>
  `;
}