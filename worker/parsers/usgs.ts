/**
 * USGS parser starter for Kahu Ola V4.8
 * TODO: implement real VolcanicSignal parsing.
 */
export interface UsgsParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parseUsgsPayload(_payload: unknown): UsgsParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parseUsgsPayload not implemented yet"],
  };
}