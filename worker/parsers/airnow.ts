/**
 * AirNow parser starter for Kahu Ola V4.8
 * TODO: implement real AirQualitySignal parsing.
 */
export interface AirNowParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parseAirNowPayload(_payload: unknown): AirNowParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parseAirNowPayload not implemented yet"],
  };
}