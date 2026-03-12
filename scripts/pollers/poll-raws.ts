/**
 * RAWS poller starter for Kahu Ola V4.8.
 * TODO: fetch RAWS endpoint and parse with worker/parsers/raws.ts.
 */
export interface PollRawsResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollRaws(): Promise<PollRawsResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollRaws not implemented yet"],
  };
}