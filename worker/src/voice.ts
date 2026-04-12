/**
 * Kahu Ola — Voice brief pipeline (Phase 2.2)
 *
 * GET /api/voice?zone={zone_id}&lang={lang}
 *
 * 1. Generate a 60-second spoken script via Gemma 4
 * 2. Convert to MP3 via OpenAI TTS API
 * 3. Cache result in R2 (daily invalidation, HST-keyed)
 *
 * Doctrine:
 *   - Gemma 4 writes the script (reasoning). OpenAI does the speech
 *     synthesis (mechanical). They never swap roles.
 *   - If TTS fails, return the script text as JSON fallback so the
 *     /listen page can still display the written brief.
 *   - OPENAI_API_KEY is used ONLY for TTS, never for reasoning.
 */

import type { ZoneBrief } from "./zone-brief";
import type { GemmaEnv } from "./gemma";
import { GEMMA_MODEL, FALLBACK_MARKER, stripReasoningPreamble, extractResponseText } from "./gemma";

const TTS_VOICE = "alloy";
const TTS_MODEL = "tts-1";
const TTS_TIMEOUT_MS = 30_000;
const GEMMA_VOICE_MAX_TOKENS = 1024;

const LANG_NAMES: Record<string, string> = {
  en: "English",
  vi: "Vietnamese",
  tl: "Tagalog",
  ilo: "Ilocano",
  haw: "Hawaiian",
  ja: "Japanese",
};

export interface VoiceInput {
  zoneId: string;
  lang: string;
  zoneBrief: {
    headline: string;
    what_it_means: string;
    what_to_do: string;
    household_note: string | null;
  };
  zoneName: string;
  islandName: string;
}

export function voiceCacheKey(zoneId: string, lang: string): string {
  const nowHST = new Date(Date.now() - 10 * 60 * 60 * 1000);
  const date = nowHST.toISOString().slice(0, 10);
  return `voice/${zoneId}/${lang}/${date}.mp3`;
}

export async function generateVoiceScript(
  env: GemmaEnv,
  input: VoiceInput,
): Promise<string> {
  const { lang, zoneBrief, zoneName } = input;

  const systemPrompt = [
    "<|thinking|>off",
    "/no_think",
    "Thinking mode: disabled. Produce only the spoken script.",
    "",
    "You are Kahu Ola — Guardian of Life. A civic hazard voice for Hawaiʻi.",
    "Write a spoken audio brief of exactly 130-150 words.",
    "Warm, calm, civic Hawaiian voice. Like a trusted neighbor on the radio.",
    'Start with: "Aloha. This is Kahu Ola, your Hawaiʻi hazard signal."',
    'End with: "Stay informed at kahuola dot org. E mālama pono."',
    `Language: ${LANG_NAMES[lang] || "English"}. Write entirely in that language.`,
    'If Hawaiian (haw): use ʻŌlelo Hawaiʻi with warm, respectful tone.',
    "Do not read out URLs, brackets, or technical labels.",
    "Do not invent facts beyond the structured input.",
    "If conditions are CLEAR (LOW risk, no alerts): celebrate the calm. Do not mention terrain dangers.",
    "Output ONLY the spoken script. No stage directions. No asterisks. No reasoning.",
    `If the input is insufficient, return: ${FALLBACK_MARKER}`,
  ].join("\n");

  const userPrompt = [
    `Zone: ${zoneName}`,
    `Headline: ${zoneBrief.headline}`,
    `Conditions: ${zoneBrief.what_it_means}`,
    `Action: ${zoneBrief.what_to_do}`,
    zoneBrief.household_note ? `Household: ${zoneBrief.household_note}` : "",
    "",
    "Write the 60-second spoken brief now.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response: any = await env.AI.run(GEMMA_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: GEMMA_VOICE_MAX_TOKENS,
      temperature: 0.3,
    });

    const rawText = extractResponseText(response);
    const cleaned = stripReasoningPreamble(rawText.trim());

    if (!cleaned || cleaned.length < 50 || cleaned.includes(FALLBACK_MARKER)) {
      return buildFallbackScript(zoneBrief, zoneName);
    }
    return cleaned;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("generateVoiceScript error:", msg);
    return buildFallbackScript(zoneBrief, zoneName);
  }
}

function buildFallbackScript(
  brief: VoiceInput["zoneBrief"],
  zoneName: string,
): string {
  return (
    `Aloha. This is Kahu Ola, your Hawaiʻi hazard signal. ` +
    `Here is the latest for ${zoneName}. ` +
    `${brief.headline} ${brief.what_it_means} ` +
    `Stay informed at kahuola dot org. E mālama pono.`
  );
}

export async function generateTTSAudio(
  apiKey: string,
  script: string,
): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: script,
        response_format: "mp3",
        speed: 0.95,
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("TTS API error:", response.status, errText.slice(0, 200));
      return null;
    }

    return response.arrayBuffer();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("TTS fetch error:", msg);
    return null;
  }
}
