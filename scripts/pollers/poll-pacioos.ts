/**
 * PacIOOS poller starter for Kahu Ola V4.8.
 * TODO: fetch PacIOOS endpoint and parse with worker/parsers/pacioos.ts.
 */
export interface PollPacioosResult {
  ok: boolean;
  count: number;
  errors: string[];
}

export async function pollPacioos(): Promise<PollPacioosResult> {
  return {
    ok: false,
    count: 0,
    errors: ["TODO: pollPacioos not implemented yet"],
  };
}