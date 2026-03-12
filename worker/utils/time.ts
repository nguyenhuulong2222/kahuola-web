export function nowIso(): string {
  return new Date().toISOString();
}

export function parseDateSafe(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ageSecondsFrom(date: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

export function formatAcqDateTimeUtc(
  acqDate?: string,
  acqTime?: string | number,
): string | null {
  if (!acqDate || acqTime === undefined || acqTime === null) return null;

  const raw = String(acqTime).padStart(4, "0");
  const hh = raw.slice(0, 2);
  const mm = raw.slice(2, 4);
  const iso = `${acqDate}T${hh}:${mm}:00Z`;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
