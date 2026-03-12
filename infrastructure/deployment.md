# Kahu Ola Deployment Guide

This document explains how to deploy the Kahu Ola Worker and Web frontend.

---

# Architecture

Browser
↓
Cloudflare Pages
↓
Cloudflare Worker
↓
Hazard Data Sources


Sources include:

- NASA FIRMS
- NOAA
- NWS
- EPA AirNow
- PacIOOS
- USGS

---

# Deploy Worker

Install Wrangler


npm install -g wrangler


Login


wrangler login


Deploy


wrangler deploy


---

# Deploy Web

The web frontend is deployed using **Cloudflare Pages**.

Directory:


/web


Build command:


none


Output directory:


web


---

# Environment Variables

Set using Cloudflare dashboard.

Examples:


NASA_FIRMS_ENDPOINT
NOAA_ENDPOINT
NWS_ENDPOINT
AIRNOW_ENDPOINT


---

# Cache Strategy

The system uses:

• Edge caching  
• Snapshot caching  
• Freshness labeling  

Clients never query external APIs directly.

---

# Monitoring

Health endpoint:


/v1/system/health


Diagnostics endpoint:


/v1/system/status


---

# Safety Policy

Kahu Ola is an **information platform**, not an emergency authority.

Users must follow instructions from:

• HIEMA  
• Maui Emergency Management Agency  
• National Weather Service  

Always prioritize official guidance.
