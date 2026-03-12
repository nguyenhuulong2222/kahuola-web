/**
 * AirNow poller starter for Kahu Ola V4.8.
 * TODO: fetch AirNow endpoint and parse with worker/parsers/airnow.ts.
 */
export interface PollAirNowResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollAirNow(): Promise<PollAirNowResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollAirNow not implemented yet"],
  };
}