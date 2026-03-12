/**
 * USGS poller starter for Kahu Ola V4.8.
 * TODO: fetch USGS endpoint and parse with worker/parsers/usgs.ts.
 */
export interface PollUsgsResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollUsgs(): Promise<PollUsgsResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollUsgs not implemented yet"],
  };
}