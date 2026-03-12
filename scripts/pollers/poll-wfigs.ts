/**
 * WFIGS poller starter for Kahu Ola V4.8.
 * TODO: fetch WFIGS endpoint and parse with worker/parsers/wfigs.ts.
 */
export interface PollWfigsResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollWfigs(): Promise<PollWfigsResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollWfigs not implemented yet"],
  };
}