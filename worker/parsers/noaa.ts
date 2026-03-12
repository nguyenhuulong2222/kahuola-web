/**
 * NOAA parser starter for Kahu Ola V4.8
 * TODO: implement real NOAA normalization into RadarSignal/StormSignal.
 */
export interface NoaaParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parseNoaaPayload(_payload: unknown): NoaaParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parseNoaaPayload not implemented yet"],
  };
}