<!-- SOURCE: docs/architecture/CURRENT_PRODUCTION_STATUS.md -->
<!-- CATEGORY: architecture -->
<!-- EXTRACTED: 2026-04-07T07:50:14Z -->

# Kahu Ola Current Production Status

Last updated: 2026

---

# Live Domain

https://kahuola.org

---

# System Components

Frontend

Static civic dashboard deployed via Cloudflare Pages.

Worker Aggregator

Cloudflare Worker responsible for:

• Fetching upstream hazard sources  
• Parsing data  
• Validating schemas  
• Building hazard signals  

---

# Upstream Data Sources

NASA FIRMS — wildfire hotspots  
NWS — alerts and warnings  
NOAA — radar and weather data  
EPA AirNow — air quality  
USGS — volcanic activity  
PacIOOS — ocean and coastal sensors  

---

# Core Endpoints


/v1/home/summary
/v1/hazards
/v1/context
/v1/health


---

# Current Hazard Prioritization

Priority order:

1. Fire
2. Flood
3. Storm
4. Volcanic
5. Monitoring

---

# Known Limitations

Some upstream sources may temporarily fail.

The system will automatically fall back to stale data states.

---

# Operational Goal

Maintain continuous situational awareness for Hawaiʻi residents during wildfire, storm, flood, and volcanic events.
