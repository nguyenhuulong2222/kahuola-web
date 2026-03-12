/**
 * RAWS parser starter for Kahu Ola V4.8
 * TODO: implement real FireWeatherSignal parsing.
 */
export interface RawsParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parseRawsPayload(_payload: unknown): RawsParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parseRawsPayload not implemented yet"],
  };
}