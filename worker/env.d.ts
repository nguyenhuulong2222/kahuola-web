interface Env {
  CACHE: KVNamespace;

  PROJECT_NAME?: string;
  PROJECT_VERSION?: string;
  ENVIRONMENT?: "development" | "staging" | "production" | string;
  REGION?: string;

  // Upstream endpoints (configured via Wrangler vars/secrets, never hardcoded in client code)
  NASA_FIRMS_ENDPOINT?: string;
  NWS_ALERTS_ENDPOINT?: string;
  NOAA_ENDPOINT?: string;
  AIRNOW_ENDPOINT?: string;
  HMS_ENDPOINT?: string;
  PACIOOS_ENDPOINT?: string;
  WFIGS_ENDPOINT?: string;
  RAWS_ENDPOINT?: string;
  USGS_ENDPOINT?: string;

  // Optional API keys/secrets for upstream systems
  NASA_FIRMS_API_KEY?: string;
  AIRNOW_API_KEY?: string;
  MEDIA_BRIEF_WEBHOOK?: string;
  MEDIA_BRIEF_WEBHOOK_TOKEN?: string;
  MEDIA_BRIEF_TOKEN?: string;
  MRMS_QPE_URL?: string;
  MRMS_QPE_TOKEN?: string;
}
