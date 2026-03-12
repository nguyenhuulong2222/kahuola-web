function createCard(label, count) {
  const card = document.createElement("article");
  card.className = "signal-card";
  card.innerHTML = `<h4>${label}</h4><p>${count} active in current snapshot</p>`;
  return card;
}

export function renderSignalStack(container, summary) {
  container.replaceChildren(
    createCard("Fire Signal", Number(summary.fire_count ?? 0)),
    createCard("Flood Signal", Number(summary.flood_count ?? 0)),
    createCard("Storm Signal", Number(summary.storm_count ?? 0)),
  );
}