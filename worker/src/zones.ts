/**
 * Kahu Ola — Zone profiles (Maui V1, 15 zones)
 *
 * Static terrain + civic context for each zone. These profiles are the
 * deterministic base layer for zone briefs: they never change at runtime,
 * they encode institutional knowledge (evacuation routes, historical
 * incidents, notable locations) that hazard feeds do not carry, and they
 * make the downstream brief template (and later AI) safe by grounding
 * every generated sentence in a structured fact that exists on disk.
 *
 * Invariants respected:
 *  I.  No upstream calls — pure static data.
 *  III. Values here are civic knowledge, not inferences — when unknown,
 *       leave the array empty rather than guess.
 *  IV. No PII — generic place and facility references only.
 */

export type IslandName = "Maui" | "Hawaii" | "Oahu" | "Kauai" | "Molokai" | "Lanai";
export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "EXTREME";
export type NotableLocationType = "school" | "medical" | "shelter" | "fire_station";

export interface ZoneProfile {
  zone_id: string;
  zone_name: string;
  island: IslandName;
  terrain_type: string;
  typical_fire_risk: RiskLevel;
  typical_flood_risk: RiskLevel;
  drainage_context: string;
  evacuation_constraints: string[];
  evacuation_routes: {
    primary: string;
    avoid_when_flood: string[];
    choke_points: string[];
  };
  notable_locations: Array<{
    name: string;
    type: NotableLocationType;
  }>;
  historical_signals: string[];
  zone_notes: string[];
}

/**
 * Runtime-observed state for a zone. Populated by the /api/hazards/zone/:id
 * handler from the existing hazard endpoints (flash-flood, fire-weather,
 * smoke, etc.) and/or cached snapshots. Used by the brief template and by
 * the cache delta logic to compare current vs. previous day.
 *
 * fetched_at is required: cache age and snapshot diff depend on it.
 */
export interface ZoneDynamicState {
  fetched_at: string;              // ISO timestamp — required
  fire_risk: RiskLevel;
  flood_risk: RiskLevel;
  nws_alerts: string[];            // active alert event names, stable-sorted
  wind_mph: number | null;
  humidity_pct: number | null;
  notes: string[];                 // free-form observational notes (never UI)
  sources: string[];               // upstream labels for provenance display
}

export const MAUI_ZONES: ZoneProfile[] = [
  {
    zone_id: "lahaina",
    zone_name: "Lahaina",
    island: "Maui",
    terrain_type: "Leeward coastal urban — West Maui lee slopes meeting the sea",
    typical_fire_risk: "EXTREME",
    typical_flood_risk: "MODERATE",
    drainage_context:
      "Short, steep gulches from the West Maui Mountains discharge directly into town: Kahoma Stream, Kauaʻula, Launiupoko. Flash response after mauka rainfall is minutes, not hours.",
    evacuation_constraints: [
      "Single arterial in and out: Honoapiʻilani Highway (Route 30)",
      "Coastal Front Street is narrow, one-way in sections, and easily blocked",
      "Strong afternoon kona winds routinely push fire downslope toward town",
      "Limited cell coverage and historic power-line vulnerability on the lee side"
    ],
    evacuation_routes: {
      primary: "Honoapiʻilani Highway (Route 30), north toward Kāʻanapali or south toward Māʻalaea",
      avoid_when_flood: [
        "Kahoma Stream bridge",
        "Kauaʻula Stream crossing",
        "Front Street low points"
      ],
      choke_points: [
        "Lahaina Bypass / Route 30 junction",
        "Olowalu curve (Route 30 southbound)",
        "Honoapiʻilani at Launiupoko"
      ]
    },
    notable_locations: [
      { name: "Lahainaluna High School", type: "school" },
      { name: "Lahaina Intermediate School", type: "school" },
      { name: "Princess Nāhiʻenaʻena Elementary", type: "school" },
      { name: "Lahaina Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "August 8, 2023 — catastrophic wildfire",
      "Periodic brush fires along the bypass corridor during drought years"
    ],
    zone_notes: [
      "Dry leeward microclimate — humidity routinely drops below 35% during trade wind shadow events.",
      "Invasive guinea and buffel grass load elevates fire spread rate under wind.",
      "Post-2023 rebuild has altered some road alignments; published maps may be out of date."
    ]
  },
  {
    zone_id: "lahaina_mauka",
    zone_name: "Lahaina Mauka",
    island: "Maui",
    terrain_type: "Leeward upslope grass and scrub — transitional wildland-urban interface",
    typical_fire_risk: "EXTREME",
    typical_flood_risk: "MODERATE",
    drainage_context:
      "Headwaters of Kahoma and Kauaʻula gulches. Runoff is brief but intense; debris and ash from recent burn scars significantly raise flash flood volume.",
    evacuation_constraints: [
      "No continuous mauka road — evacuation must route through Lahaina town",
      "Burn-scar debris flow risk elevated for 2–3 years following any wildfire",
      "Dirt access roads impassable in even moderate rain"
    ],
    evacuation_routes: {
      primary: "Downslope to Honoapiʻilani Highway via Lahainaluna Road",
      avoid_when_flood: [
        "Kahoma Stream upper crossings",
        "Unpaved mauka access roads"
      ],
      choke_points: [
        "Lahainaluna Road single-lane sections",
        "Lahaina Bypass merge"
      ]
    },
    notable_locations: [
      { name: "Lahainaluna High School", type: "school" }
    ],
    historical_signals: [
      "August 2023 fire ignition zone",
      "Recurring brush fires in dry guinea grass"
    ],
    zone_notes: [
      "Classic wildland-urban interface: structures directly abutting unmanaged vegetation.",
      "Wind funneling through mauka gulches accelerates fire runs toward Lahaina town."
    ]
  },
  {
    zone_id: "kaanapali",
    zone_name: "Kāʻanapali",
    island: "Maui",
    terrain_type: "Leeward coastal resort — low-gradient coastal plain backed by dry slopes",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context:
      "Honokōwai Stream and several smaller kahawai drain from the West Maui range. Ordinary rainfall is absorbed; sustained events overtop culverts along Lower Honoapiʻilani Road.",
    evacuation_constraints: [
      "Resort density concentrates large transient populations with limited local knowledge",
      "Single coastal corridor (Lower Honoapiʻilani Road) parallels the evacuation route and shares it in emergencies"
    ],
    evacuation_routes: {
      primary: "Honoapiʻilani Highway (Route 30) north to Honokōwai / Nāpili or south toward Māʻalaea",
      avoid_when_flood: [
        "Honokōwai Stream bridge",
        "Lower Honoapiʻilani flood-prone low points"
      ],
      choke_points: [
        "Kāʻanapali Parkway entrance/exit",
        "Route 30 at Honokōwai"
      ]
    },
    notable_locations: [
      { name: "Kāʻanapali Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "Periphery impacted during 2023 West Maui fire week (smoke, closures)"
    ],
    zone_notes: [
      "High visitor population — outreach cannot assume familiarity with local roads or shelter locations.",
      "Dry leeward exposure shares the fire-weather regime of Lahaina."
    ]
  },
  {
    zone_id: "kihe_north",
    zone_name: "Kīhei North",
    island: "Maui",
    terrain_type: "Leeward low coastal plain — South Maui flats",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "MODERATE",
    drainage_context:
      "Kulanihākoʻi Gulch and several smaller drainages cross town toward the ocean. Kulanihākoʻi is a repeat flash-flood site during upslope thunderstorms even when North Kīhei is dry.",
    evacuation_constraints: [
      "Two parallel roads (South Kīhei Road and Piʻilani Highway) — both vulnerable to gulch overtopping",
      "Dry guinea grass on undeveloped lots burns quickly toward residential areas"
    ],
    evacuation_routes: {
      primary: "Piʻilani Highway (Route 31) north to Māʻalaea / Central Maui or south to Wailea",
      avoid_when_flood: [
        "Kulanihākoʻi Gulch crossings on South Kīhei Road",
        "Piʻilani Highway low points near gulch crossings"
      ],
      choke_points: [
        "Māʻalaea intersection (Routes 30/31)",
        "Piʻikea Avenue / Piʻilani junction"
      ]
    },
    notable_locations: [
      { name: "Kīhei Elementary School", type: "school" },
      { name: "Lokelani Intermediate School", type: "school" },
      { name: "Kīhei Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "Repeat Kulanihākoʻi Gulch flash floods across multiple years",
      "Brush fires in Māʻalaea flats"
    ],
    zone_notes: [
      "Dry leeward exposure and low humidity during trade-wind shadow events.",
      "Flood response must assume minutes of warning — upslope rain is often invisible from shore."
    ]
  },
  {
    zone_id: "kihe_south",
    zone_name: "Kīhei South (Wailea)",
    island: "Maui",
    terrain_type: "Leeward coastal resort — low rise meeting the sea",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context:
      "Small ephemeral drainages discharge directly to the coast; flooding is rare but wind-driven brush fire risk is persistent during the dry season.",
    evacuation_constraints: [
      "High resort visitor population — local-knowledge gap in emergencies",
      "Single primary road (Wailea Alanui / Piʻilani Highway) for evacuation"
    ],
    evacuation_routes: {
      primary: "Piʻilani Highway (Route 31) north through Kīhei to Central Maui",
      avoid_when_flood: [
        "Low crossings along South Kīhei Road"
      ],
      choke_points: [
        "Wailea Ike Drive junction",
        "Piʻilani Highway at Keonekai Road"
      ]
    },
    notable_locations: [],
    historical_signals: [
      "Brush fires in upslope kiawe during drought years"
    ],
    zone_notes: [
      "Large visitor population with limited familiarity with Hawaiian place names and route numbers.",
      "Shares Kīhei North fire-weather profile; drought conditions propagate across the entire South Maui coast."
    ]
  },
  {
    zone_id: "kahului_harbor",
    zone_name: "Kahului Harbor",
    island: "Maui",
    terrain_type: "Low-lying coastal urban — central Maui isthmus harbor frontage",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context:
      "Terminus of ʻĪao Stream and associated lowland drainages. Tsunami inundation zone, king-tide impact zone, and urban stormwater backup point all overlap here.",
    evacuation_constraints: [
      "Tsunami evacuation requires inland movement within minutes",
      "Airport and harbor operations constrain routing during large events",
      "Low elevation (near sea level) across most of the zone"
    ],
    evacuation_routes: {
      primary: "Kaʻahumanu Avenue (Route 32) / Hāna Highway (Route 36) inland toward Wailuku or upcountry",
      avoid_when_flood: [
        "Kaʻahumanu Avenue underpass at Puʻunēnē",
        "Dairy Road low sections",
        "ʻĪao Stream crossings in the harbor district"
      ],
      choke_points: [
        "Dairy Road / Hāna Highway junction",
        "Puʻunēnē Avenue at Kaʻahumanu Avenue",
        "Airport access road"
      ]
    },
    notable_locations: [
      { name: "Maui Memorial Medical Center", type: "medical" },
      { name: "Kahului Elementary School", type: "school" },
      { name: "Maui High School", type: "school" },
      { name: "War Memorial Complex (evacuation shelter)", type: "shelter" },
      { name: "Kahului Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "1946 and 1960 tsunamis devastated the harbor frontage",
      "Recurring urban flooding at Dairy Road during heavy rain",
      "ʻĪao Stream overflow events"
    ],
    zone_notes: [
      "Only tertiary hospital on the island — critical-care evacuation is not feasible.",
      "Primary island evacuation shelter (War Memorial Complex) is located in this zone."
    ]
  },
  {
    zone_id: "wailuku_central",
    zone_name: "Wailuku Central",
    island: "Maui",
    terrain_type: "Valley-mouth urban — county seat at the base of ʻĪao Valley",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context:
      "Direct discharge path for ʻĪao Stream and its tributaries draining the West Maui Mountains. Even modest mauka rainfall produces fast, debris-laden stream rise.",
    evacuation_constraints: [
      "County government and emergency services are concentrated here — any severe local impact is a single point of failure",
      "Historic downtown has narrow streets and limited alternate routing"
    ],
    evacuation_routes: {
      primary: "Kaʻahumanu Avenue (Route 32) toward Kahului, or Honoapiʻilani Highway (Route 30) south toward Māʻalaea",
      avoid_when_flood: [
        "Main Street at ʻĪao Stream crossing",
        "Lower Main Street near ʻĪao outlet"
      ],
      choke_points: [
        "Main Street / High Street junction",
        "Waiehu Beach Road approach"
      ]
    },
    notable_locations: [
      { name: "Wailuku Elementary School", type: "school" },
      { name: "ʻĪao Intermediate School", type: "school" },
      { name: "Wailuku Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "September 2016 ʻĪao Valley flood — damaging flows reached downtown",
      "Recurring heavy-rain stream rise events"
    ],
    zone_notes: [
      "Hub of county emergency operations — degraded access here degrades islandwide response.",
      "Upstream rainfall in ʻĪao can raise the stream faster than visual indicators downtown."
    ]
  },
  {
    zone_id: "wailuku_mauka",
    zone_name: "Wailuku Mauka (ʻĪao Valley)",
    island: "Maui",
    terrain_type: "Upper valley — steep amphitheater headwalls of the West Maui Mountains",
    typical_fire_risk: "MODERATE",
    typical_flood_risk: "EXTREME",
    drainage_context:
      "Headwaters zone of ʻĪao Stream. One of the wettest points on Maui during upslope events; flash flood response time is extremely short.",
    evacuation_constraints: [
      "Single dead-end road (ʻĪao Valley Road) in and out",
      "Landslide and rockfall exposure on valley walls",
      "Cell coverage marginal in the upper valley"
    ],
    evacuation_routes: {
      primary: "ʻĪao Valley Road downslope toward Wailuku",
      avoid_when_flood: [
        "All valley-floor stream crossings",
        "Low-gradient park roads near ʻĪao Stream"
      ],
      choke_points: [
        "ʻĪao Valley Road single-lane sections",
        "Park entrance gate"
      ]
    },
    notable_locations: [],
    historical_signals: [
      "September 2016 catastrophic ʻĪao flood",
      "Recurring trail closures from landslides and stream rise"
    ],
    zone_notes: [
      "Visitors and hikers concentrate here on dry days — outreach must reach non-residents.",
      "A 'sunny downtown / flooding upper valley' split is a known failure mode for situational awareness."
    ]
  },
  {
    zone_id: "pukalani",
    zone_name: "Pukalani",
    island: "Maui",
    terrain_type: "Upcountry residential — mid-elevation leeward Haleakalā slopes",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context:
      "Sparse ephemeral drainages; runoff is absorbed or routed through streetside ditches. Flooding is uncommon but brush fire exposure is persistent.",
    evacuation_constraints: [
      "Residential density with tight cul-de-sac road network",
      "Limited primary egress routes to Central Maui"
    ],
    evacuation_routes: {
      primary: "Haleakalā Highway (Route 37) downslope toward Kahului",
      avoid_when_flood: [
        "Lower Haleakalā Highway low points after heavy upcountry rain"
      ],
      choke_points: [
        "Haleakalā Highway / Old Haleakalā Highway junction",
        "Pukalani roundabout"
      ]
    },
    notable_locations: [
      { name: "Pukalani Elementary School", type: "school" }
    ],
    historical_signals: [
      "Periodic upcountry brush fires during drought years"
    ],
    zone_notes: [
      "Dry leeward regime with strong afternoon wind — fire behavior can be aggressive.",
      "Residential fuel load (landscaping, ornamentals) elevates structure-to-structure fire risk."
    ]
  },
  {
    zone_id: "makawao",
    zone_name: "Makawao",
    island: "Maui",
    terrain_type: "Upcountry paniolo town — rolling pasture and residential mix",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context:
      "Pasture runoff drains toward Haʻikū and the north shore. Flooding rare; wildland fire in adjacent pasture is the dominant hazard.",
    evacuation_constraints: [
      "Winding two-lane roads with limited shoulder",
      "Multiple dispersed ignition points possible across pasture lands"
    ],
    evacuation_routes: {
      primary: "Makawao Avenue / Baldwin Avenue downslope toward Pāʻia, or Kaupakalua Road toward Haʻikū",
      avoid_when_flood: [
        "Baldwin Avenue low points near Pāʻia"
      ],
      choke_points: [
        "Makawao Avenue / Baldwin Avenue junction (town center)",
        "Olinda Road narrow sections"
      ]
    },
    notable_locations: [
      { name: "Makawao Elementary School", type: "school" },
      { name: "Makawao Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "October 2023 Olinda / Kula fire (same week as Lahaina)",
      "2018 upcountry brush fires"
    ],
    zone_notes: [
      "Pasture grass cures to flash-fuel state within days of drying wind.",
      "Historic wooden town center has high structural vulnerability to ember wash."
    ]
  },
  {
    zone_id: "kula_upper",
    zone_name: "Kula Upper",
    island: "Maui",
    terrain_type: "High-elevation leeward slope — upper Haleakalā residential and agricultural",
    typical_fire_risk: "EXTREME",
    typical_flood_risk: "LOW",
    drainage_context:
      "Sparse, ephemeral gulches carry only brief runoff. Drainage is not the hazard; rapid fire spread through cured grass and gorse is.",
    evacuation_constraints: [
      "Long, winding, single-lane sections of Kula Highway and Lower Kula Road",
      "Dispersed residential parcels — door-to-door warning is slow",
      "Upslope fire behavior under kona wind can outrun vehicles on local roads"
    ],
    evacuation_routes: {
      primary: "Kula Highway (Route 37) downslope toward Pukalani and Kahului",
      avoid_when_flood: [
        "Lower Kula Highway low points (rare but possible)"
      ],
      choke_points: [
        "Kula Highway narrow curves",
        "Lower Kula Road intersections"
      ]
    },
    notable_locations: [
      { name: "Kula Hospital", type: "medical" },
      { name: "Kula Elementary School", type: "school" }
    ],
    historical_signals: [
      "August 2023 Kula / Olinda fire — burned structures, required evacuations",
      "Recurring brush fires during dry seasons"
    ],
    zone_notes: [
      "Cool temperatures mask extreme fire risk — humidity is often the critical variable.",
      "Kula Hospital is a critical-care facility whose evacuation would overwhelm regional resources."
    ]
  },
  {
    zone_id: "kula_lower",
    zone_name: "Kula Lower",
    island: "Maui",
    terrain_type: "Mid-elevation leeward slope — transitional agricultural and residential",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context:
      "Occasional ephemeral gulches cross Lower Kula Road; most rainfall is absorbed before reaching the coast.",
    evacuation_constraints: [
      "Narrow two-lane sections of Lower Kula Road and Kula Highway",
      "Dispersed parcels with long driveways"
    ],
    evacuation_routes: {
      primary: "Kula Highway (Route 37) downslope to Pukalani and Central Maui",
      avoid_when_flood: [
        "Gulch crossings on Lower Kula Road"
      ],
      choke_points: [
        "Kula Highway / Lower Kula Road junction"
      ]
    },
    notable_locations: [],
    historical_signals: [
      "Periphery impacted during 2023 Kula fire"
    ],
    zone_notes: [
      "Shares Kula Upper fire-weather regime but with marginally more moisture retention."
    ]
  },
  {
    zone_id: "paia",
    zone_name: "Pāʻia",
    island: "Maui",
    terrain_type: "North shore coastal town — windward coastal lowland",
    typical_fire_risk: "MODERATE",
    typical_flood_risk: "HIGH",
    drainage_context:
      "Māliko Gulch and smaller kahawai discharge near town. Pāʻia is the first stop after the wettest stretch of the Hāna Highway — upstream rainfall arrives with little warning.",
    evacuation_constraints: [
      "Single arterial (Hāna Highway / Route 36) for all traffic",
      "Historic narrow streets and limited alternate routes through town"
    ],
    evacuation_routes: {
      primary: "Hāna Highway (Route 36) west to Kahului or east toward Haʻikū",
      avoid_when_flood: [
        "Māliko Gulch bridge",
        "Low coastal sections of Baldwin Beach access"
      ],
      choke_points: [
        "Hāna Highway / Baldwin Avenue junction (town center)",
        "Māliko Gulch approach"
      ]
    },
    notable_locations: [
      { name: "Pāʻia Elementary School", type: "school" },
      { name: "Pāʻia-Haʻikū Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "Recurring Māliko Gulch flooding",
      "Hāna Highway closures from windward rainfall events"
    ],
    zone_notes: [
      "High visitor traffic through the town center — messaging must reach non-residents.",
      "Windward moisture keeps fire risk lower than leeward zones but not zero during summer droughts."
    ]
  },
  {
    zone_id: "hana",
    zone_name: "Hāna",
    island: "Maui",
    terrain_type: "East Maui rainforest coast — isolated windward community",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context:
      "Dense network of windward streams and waterfalls discharging directly to the coast. Hāna Highway crosses dozens of one-lane bridges that close readily under heavy rain.",
    evacuation_constraints: [
      "Single road access: Hāna Highway (Route 360) — 52 miles of curves from Kahului",
      "Frequent Hāna Highway closures from rainfall, rockfall, and landslides",
      "Cell coverage is marginal and intermittent",
      "Hāna airfield has very limited capacity"
    ],
    evacuation_routes: {
      primary: "Hāna Highway (Route 360) west toward Keʻanae and Central Maui",
      avoid_when_flood: [
        "All Hāna Highway stream crossings east of Keʻanae",
        "One-lane bridges along the Hāna coast",
        "Kīpahulu low crossings south of town"
      ],
      choke_points: [
        "One-lane bridges across the Hāna Highway",
        "Keʻanae peninsula approach",
        "Hāna town center (single road)"
      ]
    },
    notable_locations: [
      { name: "Hāna Health Center", type: "medical" },
      { name: "Hāna High and Elementary School", type: "school" },
      { name: "Hāna Fire Station", type: "fire_station" }
    ],
    historical_signals: [
      "Multi-day Hāna Highway closures from heavy rain events",
      "Landslide and rockfall closures recurring across years",
      "Isolated-community supply shortfalls during extended closures"
    ],
    zone_notes: [
      "Geographic isolation is the defining civic constraint: if Hāna Highway is closed, Hāna is on its own.",
      "Kahu Ola briefs for Hāna should assume self-sufficiency windows measured in days, not hours."
    ]
  },
  {
    zone_id: "upcountry_interface",
    zone_name: "Upcountry Wildland-Urban Interface",
    island: "Maui",
    terrain_type: "Transitional WUI — boundary between upcountry residential areas and unmanaged dry grasslands",
    typical_fire_risk: "EXTREME",
    typical_flood_risk: "LOW",
    drainage_context:
      "No dominant drainage — the zone is defined by the fire interface, not by a watershed. Runoff in the underlying gulches feeds toward Central Maui.",
    evacuation_constraints: [
      "Parcels are dispersed and connected by long private driveways",
      "Multiple possible ignition origins across a wide perimeter",
      "Wind-aligned fire runs can cross the interface faster than local road networks permit orderly evacuation"
    ],
    evacuation_routes: {
      primary: "Downslope via Kula Highway (Route 37) or Haleakalā Highway (Route 37) toward Central Maui",
      avoid_when_flood: [
        "Lower Kula Road ephemeral gulch crossings"
      ],
      choke_points: [
        "Kula Highway / Pukalani transition",
        "Olinda Road single-lane sections",
        "Lower Kula Road intersections"
      ]
    },
    notable_locations: [],
    historical_signals: [
      "August 2023 Kula / Olinda fire demonstrated the full interface failure mode",
      "Recurring brush fires along the interface during dry seasons"
    ],
    zone_notes: [
      "This is a synthesized planning zone: it represents the vulnerable seam between structured communities and unmanaged fuel.",
      "Kahu Ola uses this zone to raise upcountry-wide alert tone when conditions elevate, even when no single named zone is 'in' a fire."
    ]
  }
];

export function getZoneById(zoneId: string): ZoneProfile | undefined {
  return MAUI_ZONES.find((z) => z.zone_id === zoneId);
}

export function listZoneIds(): string[] {
  return MAUI_ZONES.map((z) => z.zone_id);
}
