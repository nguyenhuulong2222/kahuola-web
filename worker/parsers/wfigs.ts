/**
 * WFIGS parser starter for Kahu Ola V4.8
 * TODO: implement real PerimeterSignal parsing.
 */
export interface WfigsParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parseWfigsPayload(_payload: unknown): WfigsParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parseWfigsPayload not implemented yet"],
  };
}