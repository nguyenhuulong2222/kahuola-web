/**
 * PacIOOS parser starter for Kahu Ola V4.8
 * TODO: implement real OceanSignal parsing.
 */
export interface PacioosParseResult {
  items: unknown[];
  dropped: number;
  errors: string[];
}

export function parsePacioosPayload(_payload: unknown): PacioosParseResult {
  return {
    items: [],
    dropped: 0,
    errors: ["TODO: parsePacioosPayload not implemented yet"],
  };
}