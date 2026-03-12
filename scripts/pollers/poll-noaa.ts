/**
 * NOAA poller starter for Kahu Ola V4.8.
 * TODO: fetch NOAA endpoint and parse with worker/parsers/noaa.ts.
 */
export interface PollNoaaResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollNoaa(): Promise<PollNoaaResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollNoaa not implemented yet"],
  };
}