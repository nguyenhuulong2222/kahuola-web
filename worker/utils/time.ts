export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function parseDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ageSecondsFrom(date: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

export function ageSecondsFromIso(
  timestamp: string | null | undefined,
  now = new Date(),
): number | null {
  if (!timestamp) return null;
  const parsed = parseDateSafe(timestamp);
  return parsed ? ageSecondsFrom(parsed, now) : null;
}

export function formatAcqDateTimeUtc(
  acqDate?: string,
  acqTime?: string | number,
): string | null {
  if (!acqDate || acqTime === undefined || acqTime === null) return null;
  const date = acqDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const time = String(acqTime).trim();
  if (!/^\d{1,4}$/.test(time)) return null;

  const raw = time.padStart(4, "0");
  const hh = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));

  if (hh > 23 || mm > 59) return null;

  const iso = `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
  return parseDateSafe(iso)?.toISOString() ?? null;
}

export function minutesAgoLabel(timestamp: string | null | undefined, now = new Date()): string {
  const age = ageSecondsFromIso(timestamp, now);
  if (age === null) return "Unknown";

  const minutes = Math.floor(age / 60);
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 minute ago";
  return `Updated ${minutes} minutes ago`;
}