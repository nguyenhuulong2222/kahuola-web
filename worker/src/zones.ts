/**
 * Kahu Ola — Zone profiles (Hawaiʻi statewide, 31 zones)
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

export const HAWAII_ZONES: ZoneProfile[] = [
  {
    zone_id: "hilo",
    zone_name: "Hilo",
    island: "Hawaii",
    terrain_type: "Windward coastal urban — wettest city in the US, direct Hilo Bay exposure",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context: "Wailuku River and Wailoa River drain directly through town. Flash flood response can be under 30 minutes after heavy rain.",
    evacuation_constraints: ["Wailuku River bridge closure during high water", "Hilo Bay tsunami inundation zone", "Single Mamalahoa Hwy corridor inland"],
    evacuation_routes: {
      primary: "Mamalahoa Highway (Route 11 or 19) west toward Volcano or north toward Waimea",
      avoid_when_flood: ["Wailuku River crossings", "Hilo Bay front street", "Kamehameha Ave low points"],
      choke_points: ["Wailuku River bridge (Route 19)", "Bayfront Hwy / Kamehameha Ave junction"],
    },
    notable_locations: [
      { name: "Hilo High School", type: "school" },
      { name: "Waiakea High School", type: "school" },
      { name: "Hilo Medical Center", type: "medical" },
      { name: "Hilo Fire Station", type: "fire_station" },
    ],
    historical_signals: ["1960 Hilo tsunami — 61 fatalities", "Recurring Wailuku River floods", "Frequent flash flood warnings"],
    zone_notes: ["Tsunami inundation zone — know your evacuation route", "Rainfall can exceed 200 inches/year — fast stream response"],
  },
  {
    zone_id: "puna",
    zone_name: "Puna District",
    island: "Hawaii",
    terrain_type: "Lower East Rift Zone — active lava field, geothermal activity, isolated communities",
    typical_fire_risk: "MODERATE",
    typical_flood_risk: "MODERATE",
    drainage_context: "Porous lava substrate limits surface flooding but volcanic gases and lava flow are primary hazards.",
    evacuation_constraints: ["Highway 130 is sole paved evacuation route — was cut by 2018 lava", "Multiple communities on dead-end roads", "SO2 and volcanic gas hazard"],
    evacuation_routes: {
      primary: "Highway 130 north toward Keaau and Hilo",
      avoid_when_flood: ["Low-lying areas near Wailuku River tributaries"],
      choke_points: ["Highway 130 / Keaau junction", "Pahoa town center"],
    },
    notable_locations: [
      { name: "Pahoa High and Elementary School", type: "school" },
      { name: "Pahoa Transfer Station shelter", type: "shelter" },
    ],
    historical_signals: ["2018 Lower East Rift Zone eruption — destroyed 700+ homes", "Ongoing Kilauea volcanic activity"],
    zone_notes: ["Lava flow hazard zone — know your lava zone (1-9)", "SO2 advisory common — sensitive groups should monitor air quality"],
  },
  {
    zone_id: "kona",
    zone_name: "Kailua-Kona",
    island: "Hawaii",
    terrain_type: "Leeward volcanic coast — dry, steep lava slopes to ocean",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context: "Occasional flash floods in gulches after rare heavy rain. Primary hazard is fire and lava.",
    evacuation_constraints: ["Queen Kaʻahumanu Highway (Route 19) is primary corridor", "Steep lava terrain limits off-road options"],
    evacuation_routes: {
      primary: "Queen Kaʻahumanu Highway (Route 19) north toward Waikoloa or south toward Captain Cook",
      avoid_when_flood: ["Ali'i Drive low points near Kailua Bay"],
      choke_points: ["Palani Road / Queen Kaʻahumanu junction", "Kailua town center"],
    },
    notable_locations: [
      { name: "Konawaena High School", type: "school" },
      { name: "Kona Community Hospital", type: "medical" },
      { name: "Kailua-Kona Fire Station", type: "fire_station" },
    ],
    historical_signals: ["Periodic brush fires on dry lava fields", "Kona storms bring rare but intense rainfall"],
    zone_notes: ["Driest side of Hawaii Island — fire risk elevated during Kona wind events", "Lava tube network under the town"],
  },
  {
    zone_id: "kohala",
    zone_name: "North Kohala",
    island: "Hawaii",
    terrain_type: "Remote leeward peninsula — dry ranching land, limited road access",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context: "Steep gulches on windward side can flood. Leeward side very dry.",
    evacuation_constraints: ["Route 270 is sole road — no alternate route", "Extreme isolation"],
    evacuation_routes: {
      primary: "Route 270 south toward Kawaihae and Queen Kaʻahumanu Highway",
      avoid_when_flood: ["Pololu Valley access road"],
      choke_points: ["Kapaau town", "Route 270 / Route 19 junction at Kawaihae"],
    },
    notable_locations: [
      { name: "Kohala High School", type: "school" },
    ],
    historical_signals: ["Dry grass fires during drought years"],
    zone_notes: ["Most isolated zone on Hawaii Island — self-sufficiency critical", "Limited emergency services response time"],
  },
  {
    zone_id: "waimea_hi",
    zone_name: "Waimea (Kamuela)",
    island: "Hawaii",
    terrain_type: "Upcountry saddle — high elevation cattle ranch land between Kohala and Mauna Kea",
    typical_fire_risk: "MODERATE",
    typical_flood_risk: "MODERATE",
    drainage_context: "Elevation brings cool wet weather. Flash floods in Waimea town center during heavy rain.",
    evacuation_constraints: ["Multiple highway access points", "Fog and poor visibility common"],
    evacuation_routes: {
      primary: "Route 19 east toward Hilo or west toward Kona",
      avoid_when_flood: ["Waimea town center low areas"],
      choke_points: ["Route 19 / Route 190 junction"],
    },
    notable_locations: [
      { name: "Waimea Middle School", type: "school" },
      { name: "North Hawaii Community Hospital", type: "medical" },
    ],
    historical_signals: ["Flash flooding in town center during Kona Low events"],
    zone_notes: ["High elevation — temperature drops and fog can affect driving conditions rapidly"],
  },
  {
    zone_id: "volcano_hi",
    zone_name: "Volcano Village",
    island: "Hawaii",
    terrain_type: "Kilauea summit rim — active volcanic area, high elevation rainforest",
    typical_fire_risk: "LOW",
    typical_flood_risk: "LOW",
    drainage_context: "High rainfall but volcanic terrain. Primary hazard is volcanic gas (SO2, vog) and lava.",
    evacuation_constraints: ["Route 11 sole exit", "Volcanic gas can make evacuation hazardous"],
    evacuation_routes: {
      primary: "Route 11 north toward Hilo or south toward Naalehu",
      avoid_when_flood: ["Chain of Craters Road (may be closed)"],
      choke_points: ["Park entrance / Route 11 junction"],
    },
    notable_locations: [
      { name: "Volcano School of Arts and Sciences", type: "school" },
    ],
    historical_signals: ["2018 Kilauea summit collapse — 6.9 earthquake", "Ongoing volcanic activity at Halemaumau"],
    zone_notes: ["Vog and SO2 advisory — sensitive groups monitor air quality daily", "Inside Hawaii Volcanoes National Park boundary"],
  },
];

export const OAHU_ZONES: ZoneProfile[] = [
  {
    zone_id: "honolulu",
    zone_name: "Honolulu",
    island: "Oahu",
    terrain_type: "Urban coastal — state capital, high density, sea level to steep Ko'olau slopes",
    typical_fire_risk: "LOW",
    typical_flood_risk: "MODERATE",
    drainage_context: "Nuuanu Stream and Manoa Stream flood regularly. Urban runoff concentrates quickly.",
    evacuation_constraints: ["H-1 freeway congestion", "Tunnel closures during flooding (Pali, Likelike)", "High population density"],
    evacuation_routes: {
      primary: "H-1 Freeway west toward Kapolei or H-3 toward Kaneohe",
      avoid_when_flood: ["Nuuanu Avenue low points", "Manoa Valley road", "Palolo Valley road"],
      choke_points: ["H-1 / Pali Highway junction", "Downtown Honolulu grid"],
    },
    notable_locations: [
      { name: "Kaiser High School", type: "school" },
      { name: "Queen's Medical Center", type: "medical" },
      { name: "Honolulu Fire Department HQ", type: "fire_station" },
    ],
    historical_signals: ["Recurring Nuuanu Stream flooding", "2004 Manoa flash flood"],
    zone_notes: ["State capital — traffic bottlenecks during emergencies", "Tsunami evacuation zones A-E — know your zone"],
  },
  {
    zone_id: "kailua_oahu",
    zone_name: "Kailua",
    island: "Oahu",
    terrain_type: "Windward coastal — Ko'olau mountain runoff, Kailua Bay, low-lying areas",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context: "Kailu Stream and Kaelepulu Stream flood frequently. Low-lying areas near beach fill quickly.",
    evacuation_constraints: ["Pali Highway or Likelike Highway to cross Ko'olau — both can close", "Single coastal road"],
    evacuation_routes: {
      primary: "Pali Highway (Route 61) west toward Honolulu",
      avoid_when_flood: ["Kailua Road low sections", "Oneawa Street flooding areas"],
      choke_points: ["Pali Highway / Kailua Road junction", "Castle Junction (Routes 61/72)"],
    },
    notable_locations: [
      { name: "Kailua High School", type: "school" },
      { name: "Castle Medical Center", type: "medical" },
    ],
    historical_signals: ["Frequent flash flood warnings", "2021 Kailua flooding event"],
    zone_notes: ["Windward side — rainfall can be intense and rapid", "Beach communities in tsunami inundation zone"],
  },
  {
    zone_id: "kaneohe",
    zone_name: "Kāneʻohe",
    island: "Oahu",
    terrain_type: "Windward valley — Ko'olau slopes, Kaneohe Bay, wettest area on Oahu",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context: "Multiple streams drain from Ko'olau directly into town. Kaneohe Bay flooding risk during heavy rain.",
    evacuation_constraints: ["Ko'olau crossing limited to Pali or Likelike Highway", "H-3 Freeway may close"],
    evacuation_routes: {
      primary: "H-3 Freeway or Likelike Highway (Route 63) toward Honolulu",
      avoid_when_flood: ["Kamehameha Highway low sections near Bay", "Valley roads"],
      choke_points: ["H-3 / Likelike interchange", "Kaneohe town center"],
    },
    notable_locations: [
      { name: "Kaneohe Elementary School", type: "school" },
      { name: "Windward Community College shelter", type: "shelter" },
    ],
    historical_signals: ["Recurring flash floods — highest rainfall on Oahu", "2021 Ko'olau flooding"],
    zone_notes: ["Marine Corps Base Hawaii nearby — may affect traffic during alerts"],
  },
  {
    zone_id: "pearl_city",
    zone_name: "Pearl City",
    island: "Oahu",
    terrain_type: "Central urban — Pearl Harbor adjacent, H-1 corridor, moderate elevation",
    typical_fire_risk: "LOW",
    typical_flood_risk: "MODERATE",
    drainage_context: "Pearl Harbor watershed. Urban drainage can back up during heavy rain.",
    evacuation_constraints: ["H-1 and H-2 freeway access", "Pearl Harbor military restricted areas"],
    evacuation_routes: {
      primary: "H-1 Freeway east toward Honolulu or west toward Kapolei",
      avoid_when_flood: ["Low-lying areas near Pearl Harbor"],
      choke_points: ["H-1 / H-2 interchange", "Kamehameha Highway / H-1 ramps"],
    },
    notable_locations: [
      { name: "Pearl City High School", type: "school" },
      { name: "Pali Momi Medical Center", type: "medical" },
    ],
    historical_signals: ["Periodic urban flooding during Kona storms"],
    zone_notes: ["Pearl Harbor federal security zone may affect evacuation routing"],
  },
  {
    zone_id: "waianae",
    zone_name: "Waiʻanae Coast",
    island: "Oahu",
    terrain_type: "Leeward coastal — dry, isolated coast backed by Waianae Range",
    typical_fire_risk: "HIGH",
    typical_flood_risk: "LOW",
    drainage_context: "Rare but intense rain events can cause flash floods in gulches.",
    evacuation_constraints: ["Farrington Highway (Route 93) sole road — no alternate", "Extreme isolation from rest of Oahu"],
    evacuation_routes: {
      primary: "Farrington Highway (Route 93) east toward Kapolei and H-1",
      avoid_when_flood: ["Waianae Valley gulch crossings"],
      choke_points: ["Kapolei / Farrington Highway junction", "Makaha Valley Road"],
    },
    notable_locations: [
      { name: "Waianae High School", type: "school" },
      { name: "Waianae Coast Comprehensive Health Center", type: "medical" },
    ],
    historical_signals: ["Dry grass fires on leeward slopes", "Isolation during road closures"],
    zone_notes: ["Most isolated community on Oahu — self-sufficiency important", "Fire risk highest during summer drought"],
  },
  {
    zone_id: "north_shore_oahu",
    zone_name: "North Shore",
    island: "Oahu",
    terrain_type: "Rural north coast — agricultural, surf beaches, Ko'olau foothills",
    typical_fire_risk: "MODERATE",
    typical_flood_risk: "MODERATE",
    drainage_context: "Anahulu River and agricultural drainage. Flash floods in valley areas.",
    evacuation_constraints: ["Kamehameha Highway sole coastal road", "Limited interior routes"],
    evacuation_routes: {
      primary: "Kamehameha Highway (Route 83) east toward Kaneohe or south via Route 99 toward Wahiawa",
      avoid_when_flood: ["Haleiwa bridge", "Waimea Bay area during high surf"],
      choke_points: ["Haleiwa town", "Weed Junction (Routes 83/99)"],
    },
    notable_locations: [
      { name: "Kahuku High and Intermediate School", type: "school" },
    ],
    historical_signals: ["Occasional flash floods in valley areas", "High surf closures affecting evacuation"],
    zone_notes: ["High surf season (Nov-Mar) can affect coastal road access"],
  },
];

export const KAUAI_ZONES: ZoneProfile[] = [
  {
    zone_id: "lihue",
    zone_name: "Līhuʻe",
    island: "Kauai",
    terrain_type: "East coast urban center — county seat, Nawiliwili Harbor, low elevation",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context: "Huleia Stream and Nawiliwili watershed. Airport and harbor in flood-prone area.",
    evacuation_constraints: ["Kaumuali'i Highway and Kuhio Highway primary routes", "Airport may close during flooding"],
    evacuation_routes: {
      primary: "Kaumuali'i Highway (Route 50) west toward Koloa or Kuhio Highway (Route 56) north toward Kapaa",
      avoid_when_flood: ["Nawiliwili Harbor area", "Huleia Stream crossings"],
      choke_points: ["Lihue shopping center corridor", "Routes 50/56 junction"],
    },
    notable_locations: [
      { name: "Kauai High School", type: "school" },
      { name: "Wilcox Medical Center", type: "medical" },
      { name: "Lihue Fire Station", type: "fire_station" },
    ],
    historical_signals: ["2018 flooding from 50-inch rainfall event", "Hurricane Iniki 1992"],
    zone_notes: ["County seat — emergency operations center here", "2018 set national 24-hour rainfall record nearby"],
  },
  {
    zone_id: "hanalei",
    zone_name: "Hanalei",
    island: "Kauai",
    terrain_type: "Remote north coast — Na Pali cliffs, Hanalei Bay, isolated valley communities",
    typical_fire_risk: "LOW",
    typical_flood_risk: "EXTREME",
    drainage_context: "Hanalei River and multiple north shore streams. Wettest area of Kauai. Flash floods close Kuhio Highway regularly.",
    evacuation_constraints: ["Kuhio Highway (Route 56) sole road — closes during flooding", "North of Hanalei completely isolated when bridge closes", "No alternate route"],
    evacuation_routes: {
      primary: "Kuhio Highway (Route 56) south toward Princeville and Kapaa",
      avoid_when_flood: ["All Hanalei Valley stream crossings", "One-lane bridges north of Hanalei"],
      choke_points: ["Hanalei Bridge (one lane)", "Wainiha and Haena area bridges"],
    },
    notable_locations: [
      { name: "Hanalei Colony School", type: "school" },
    ],
    historical_signals: ["2018 catastrophic flooding — 200+ residents airlifted", "Recurring Kuhio Highway closures from flooding"],
    zone_notes: ["Most flood-prone community in Hawaii — road closures are routine", "Communities past Hanalei Bridge can be isolated for days"],
  },
  {
    zone_id: "poipu",
    zone_name: "Poʻipū",
    island: "Kauai",
    terrain_type: "South shore resort coast — leeward, sunny, low tsunami exposure",
    typical_fire_risk: "MODERATE",
    typical_flood_risk: "LOW",
    drainage_context: "South shore dry conditions. Sporadic flash floods after Kona storms.",
    evacuation_constraints: ["Poipu Road sole access", "Resort density creates traffic during emergencies"],
    evacuation_routes: {
      primary: "Poipu Road north to Koloa, then Kaumuali'i Highway (Route 50) west",
      avoid_when_flood: ["Waiohai Beach area low points"],
      choke_points: ["Koloa town center", "Route 50 / Koloa Road junction"],
    },
    notable_locations: [
      { name: "Koloa Elementary School", type: "school" },
    ],
    historical_signals: ["Hurricane Iniki 1992 — direct hit on south shore", "Periodic tsunami advisory"],
    zone_notes: ["High visitor population — evacuation messaging in multiple languages important"],
  },
  {
    zone_id: "kapaa",
    zone_name: "Kapaʻa",
    island: "Kauai",
    terrain_type: "East coast town — largest town on Kauai, Wailua River delta",
    typical_fire_risk: "LOW",
    typical_flood_risk: "HIGH",
    drainage_context: "Wailua River is major flooding source. Town sits in flood-prone lowlands.",
    evacuation_constraints: ["Kuhio Highway (Route 56) through town — congests quickly", "Wailua River bridge critical link"],
    evacuation_routes: {
      primary: "Kuhio Highway (Route 56) north toward Hanalei or south toward Lihue",
      avoid_when_flood: ["Wailua River bridge if flooding", "Kapaa town center low areas"],
      choke_points: ["Wailua River bridge", "Kapaa town bypass road"],
    },
    notable_locations: [
      { name: "Kapaa High School", type: "school" },
      { name: "Samuel Mahelona Medical Center", type: "medical" },
    ],
    historical_signals: ["Recurring Wailua River flooding", "2018 flooding event"],
    zone_notes: ["Largest town on Kauai — traffic bottlenecks during emergencies"],
  },
];

const ALL_ZONES: ZoneProfile[] = [
  ...MAUI_ZONES,
  ...HAWAII_ZONES,
  ...OAHU_ZONES,
  ...KAUAI_ZONES,
];

export function getZoneById(zoneId: string): ZoneProfile | undefined {
  return ALL_ZONES.find((z) => z.zone_id === zoneId);
}

export function listZoneIds(): string[] {
  return ALL_ZONES.map((z) => z.zone_id);
}
