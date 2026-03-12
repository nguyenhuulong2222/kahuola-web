/**
 * NOAA HMS parser starter for Kahu Ola V4.8
 * TODO: implement real SmokeSignal parsing.
 */
export interface HmsParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parseHmsPayload(_payload: unknown): HmsParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parseHmsPayload not implemented yet"],
  };
}