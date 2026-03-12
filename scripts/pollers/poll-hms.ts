/**
 * HMS poller starter for Kahu Ola V4.8.
 * TODO: fetch HMS endpoint and parse with worker/parsers/hms.ts.
 */
export interface PollHmsResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollHms(): Promise<PollHmsResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollHms not implemented yet"],
  };
}