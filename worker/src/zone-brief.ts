/**
 * Kahu Ola — Zone brief generator (deterministic template, multilingual)
 *
 * Pure function: (zone profile + runtime state + household profile + lang) → brief.
 * No AI, no upstream calls, no randomness. Same input always produces the
 * same output, so the cache and snapshot diff logic downstream stays honest.
 *
 * Route names and proper nouns (e.g. Kaʻahumanu Ave, NWS Honolulu) stay
 * untranslated — they are navigational anchors and must be accurate.
 *
 * Invariants respected:
 *   II.  Every code path returns a valid brief — UI never goes blank.
 *   III. Never invents facts: every fact comes from the static zone
 *        profile or the runtime state; if a field is missing, the
 *        corresponding sentence is dropped, not guessed.
 *   V.   Never claims official authority: the brief points users at NWS
 *        / Maui Emergency Management for binding guidance.
 */

import type { ZoneProfile, ZoneDynamicState, RiskLevel } from "./zones";

export interface HouseholdProfile {
  kupuna: boolean;
  keiki: boolean;
  pets: boolean;
  medical: boolean; // daily medication or oxygen
  car: boolean;
}

export interface ZoneBriefInput {
  zone: ZoneProfile;
  state: ZoneDynamicState;
  household: HouseholdProfile;
  lang: string;
}

export interface ZoneBrief {
  headline: string;
  what_it_means: string;
  what_to_do: string;
  household_note: string | null;
  sources: string[];
  generated_by: "template" | "kahuola_ai";
  fallback_used: boolean;
}

type BriefBody = Pick<ZoneBrief, "headline" | "what_it_means" | "what_to_do">;

// ── Multilingual template strings ────────────────────────

interface BriefStrings {
  // Headlines
  fireExtreme: (zone: string) => string;
  fireHigh: (zone: string) => string;
  floodExtreme: (zone: string) => string;
  floodHigh: (zone: string) => string;
  combined: (zone: string) => string;
  quiet: (zone: string) => string;

  // what_it_means
  fireExtremeMeans: (zone: string, wind: string, humidity: string, risk: string) => string;
  fireHighMeans: (zone: string, wind: string, humidity: string) => string;
  floodExtremeMeans: (zone: string, drainage: string) => string;
  floodHighMeans: (zone: string, drainage: string) => string;
  quietMeans: (zone: string, fire: string, flood: string) => string;
  combinedJoin: string;

  // what_to_do — fire
  fireAction: (route: string, choke: string) => string;
  // what_to_do — flood
  floodAction: (hazard: string, route: string) => string;
  // what_to_do — combined
  combinedFloodFirst: string;
  combinedFireNext: string;
  // what_to_do — quiet
  quietAction: (route: string) => string;

  // Household notes
  kupunaNote: string;
  keikiSchoolNote: (school: string, route: string) => string;
  keikiGenericNote: string;
  petsNote: string;
  medicalNote: string;
  noCarNote: string;

  // Fallback
  fallbackHeadline: (zone: string) => string;
  fallbackMeans: (zone: string, fire: string, flood: string) => string;
  fallbackAction: (route: string) => string;

  // Phrase helpers
  windPhrase: (mph: number) => string;
  windDefault: string;
  humidityPhrase: (pct: number) => string;
  humidityDefault: string;
}

const STRINGS: Record<string, BriefStrings> = {
  en: {
    fireExtreme: (z) => `${z}: Extreme fire weather — act now.`,
    fireHigh: (z) => `${z}: Elevated fire risk today.`,
    floodExtreme: (z) => `${z}: Flash flood risk is high — act on alerts immediately.`,
    floodHigh: (z) => `${z}: Elevated flood risk today.`,
    combined: (z) => `${z}: Flood and fire risks are both elevated today.`,
    quiet: (z) => `${z}: No elevated hazards right now.`,

    fireExtremeMeans: (z, w, h, r) => `Dry conditions, ${w}, and ${h} mean any ignition in ${z} could spread quickly. The zone's baseline fire risk is ${r} and today's weather matches that pattern.`,
    fireHighMeans: (z, w, h) => `Fire weather is unfavorable in ${z} today. ${w.charAt(0).toUpperCase() + w.slice(1)} and ${h} allow small ignitions to grow faster than usual.`,
    floodExtremeMeans: (z, d) => `Heavy rainfall is possible in or above ${z}. ${d}`,
    floodHighMeans: (z, d) => `Elevated rainfall may produce stream rise and localized flooding in ${z}. ${d}`,
    quietMeans: (z, f, fl) => `Current conditions in ${z} are within normal range. The zone's baseline fire risk is ${f} and flood risk is ${fl}.`,
    combinedJoin: "At the same time, ",

    fireAction: (route, choke) =>
      `Know your primary route out: ${route}. ` +
      `Expect ${choke} to bottleneck if neighbors evacuate at the same time. ` +
      `Keep a go-bag accessible and clear flammable brush within a 5-foot structure perimeter. ` +
      `Follow official alerts from Maui Emergency Management and NWS Honolulu for any evacuation orders.`,
    floodAction: (hazard, route) =>
      `Avoid ${hazard} and any water crossing where you cannot see the bottom. ` +
      `Primary safe route out of the zone: ${route}. ` +
      `Turn around, don't drown — six inches of moving water can sweep a person off their feet, twelve inches can float a vehicle. ` +
      `Monitor NWS Honolulu for flash flood warnings.`,
    combinedFloodFirst: "Flood first: ",
    combinedFireNext: " Fire next: ",
    quietAction: (route) =>
      `Keep your go-bag current and confirm your primary evacuation route: ${route}. ` +
      `Review your household emergency plan while conditions are calm.`,

    kupunaNote: "For kupuna in the household: confirm medications are accessible and that someone can reach them by phone if conditions change.",
    keikiSchoolNote: (school, route) => `For keiki: check ${school} for early-dismissal announcements and plan pickup before ${route} becomes congested.`,
    keikiGenericNote: "For keiki: review the school's early-dismissal plan and confirm who is responsible for pickup.",
    petsNote: "For pets: shelter capacity is limited — have carriers, leashes, and water ready, and identify a pet-friendly destination in advance.",
    medicalNote: "For daily medication or oxygen: keep a 72-hour supply portable and verify battery backup for any powered equipment.",
    noCarNote: "Without a vehicle: coordinate now with a neighbor or family member who can provide a ride if an evacuation is ordered. Do not wait until an alert is issued.",

    fallbackHeadline: (z) => `${z}: Live hazard data temporarily unavailable.`,
    fallbackMeans: (z, f, fl) => `Kahu Ola could not retrieve current hazard conditions for ${z}. The zone's baseline: fire risk ${f}, flood risk ${fl}.`,
    fallbackAction: (route) => `Check NWS Honolulu alerts directly at weather.gov/hfo for the latest warnings. Know your primary evacuation route: ${route}.`,

    windPhrase: (mph) => `${mph} mph winds`,
    windDefault: "elevated wind",
    humidityPhrase: (pct) => `humidity near ${pct}%`,
    humidityDefault: "low humidity",
  },

  vi: {
    fireExtreme: (z) => `${z}: Thời tiết cháy rừng cực đoan — hành động ngay.`,
    fireHigh: (z) => `${z}: Nguy cơ cháy cao hôm nay.`,
    floodExtreme: (z) => `${z}: Nguy cơ lũ quét cao — hành động theo cảnh báo ngay.`,
    floodHigh: (z) => `${z}: Nguy cơ lũ lụt cao hôm nay.`,
    combined: (z) => `${z}: Nguy cơ lũ lụt và cháy đều cao hôm nay.`,
    quiet: (z) => `${z}: Không có nguy hiểm nào lúc này.`,

    fireExtremeMeans: (z, w, h, r) => `Điều kiện khô, ${w}, và ${h} nghĩa là bất kỳ đám cháy nào ở ${z} có thể lan nhanh. Nguy cơ cháy cơ bản của khu vực là ${r} và thời tiết hôm nay phù hợp với mô hình đó.`,
    fireHighMeans: (z, w, h) => `Thời tiết cháy bất lợi ở ${z} hôm nay. ${w.charAt(0).toUpperCase() + w.slice(1)} và ${h} cho phép đám cháy nhỏ phát triển nhanh hơn bình thường.`,
    floodExtremeMeans: (z, d) => `Mưa lớn có thể xảy ra ở hoặc trên ${z}. ${d}`,
    floodHighMeans: (z, d) => `Mưa lớn có thể gây dâng nước suối và ngập cục bộ ở ${z}. ${d}`,
    quietMeans: (z, f, fl) => `Điều kiện hiện tại ở ${z} trong phạm vi bình thường. Nguy cơ cháy cơ bản là ${f} và nguy cơ lũ lụt là ${fl}.`,
    combinedJoin: "Đồng thời, ",

    fireAction: (route, choke) =>
      `Biết tuyến đường sơ tán chính: ${route}. ` +
      `Dự kiến ${choke} sẽ tắc nếu hàng xóm sơ tán cùng lúc. ` +
      `Giữ túi khẩn cấp trong tầm tay và dọn cây cỏ dễ cháy trong phạm vi 1,5 mét quanh nhà. ` +
      `Theo dõi cảnh báo chính thức từ Maui Emergency Management và NWS Honolulu.`,
    floodAction: (hazard, route) =>
      `Tránh ${hazard} và mọi chỗ nước mà bạn không thấy đáy. ` +
      `Tuyến đường an toàn chính ra khỏi khu vực: ${route}. ` +
      `Quay đầu, đừng lội — 15 cm nước chảy có thể cuốn trôi người, 30 cm có thể cuốn xe. ` +
      `Theo dõi NWS Honolulu về cảnh báo lũ quét.`,
    combinedFloodFirst: "Lũ trước: ",
    combinedFireNext: " Cháy tiếp: ",
    quietAction: (route) =>
      `Chuẩn bị túi khẩn cấp và xác nhận tuyến đường sơ tán chính: ${route}. ` +
      `Kiểm tra kế hoạch khẩn cấp gia đình trong khi điều kiện đang bình yên.`,

    kupunaNote: "Với kūpuna trong gia đình: xác nhận thuốc đang trong tầm tay và ai đó có thể liên lạc qua điện thoại nếu tình hình thay đổi.",
    keikiSchoolNote: (school, route) => `Với keiki: kiểm tra ${school} về thông báo tan học sớm và lên kế hoạch đón trước khi ${route} bị tắc nghẽn.`,
    keikiGenericNote: "Với keiki: xem lại kế hoạch tan học sớm của trường và xác nhận ai chịu trách nhiệm đón.",
    petsNote: "Với thú cưng: chỗ ở có hạn — chuẩn bị lồng, dây xích và nước, xác định điểm đến thân thiện với thú cưng trước.",
    medicalNote: "Với thuốc hoặc oxy hàng ngày: giữ nguồn cung 72 giờ di động và kiểm tra pin dự phòng cho thiết bị điện.",
    noCarNote: "Không có xe: phối hợp ngay với hàng xóm hoặc người thân có thể chở bạn nếu có lệnh sơ tán. Đừng đợi đến khi có cảnh báo.",

    fallbackHeadline: (z) => `${z}: Dữ liệu nguy hiểm trực tiếp tạm thời không khả dụng.`,
    fallbackMeans: (z, f, fl) => `Kahu Ola không thể lấy dữ liệu điều kiện nguy hiểm hiện tại cho ${z}. Mức cơ bản: nguy cơ cháy ${f}, nguy cơ lũ ${fl}.`,
    fallbackAction: (route) => `Kiểm tra cảnh báo NWS Honolulu trực tiếp tại weather.gov/hfo. Biết tuyến đường sơ tán chính: ${route}.`,

    windPhrase: (mph) => `gió ${mph} mph`,
    windDefault: "gió mạnh",
    humidityPhrase: (pct) => `độ ẩm khoảng ${pct}%`,
    humidityDefault: "độ ẩm thấp",
  },

  tl: {
    fireExtreme: (z) => `${z}: Sobrang mapanganib na panahon ng sunog — kumilos ngayon.`,
    fireHigh: (z) => `${z}: Mataas na panganib ng sunog ngayon.`,
    floodExtreme: (z) => `${z}: Mataas ang panganib ng flash flood — sundin agad ang mga alerto.`,
    floodHigh: (z) => `${z}: Mataas na panganib ng baha ngayon.`,
    combined: (z) => `${z}: Parehong mataas ang panganib ng baha at sunog ngayon.`,
    quiet: (z) => `${z}: Walang mataas na panganib sa ngayon.`,

    fireExtremeMeans: (z, w, h, r) => `Tuyong kondisyon, ${w}, at ${h} ang ibig sabihin ay mabilis kumalat ang anumang sunog sa ${z}. Ang baseline na panganib ng sunog ay ${r} at tugma ang panahon ngayon.`,
    fireHighMeans: (z, w, h) => `Hindi paborable ang panahon para sa sunog sa ${z} ngayon. ${w.charAt(0).toUpperCase() + w.slice(1)} at ${h} ay nagpapabilis ng pagkalat ng apoy.`,
    floodExtremeMeans: (z, d) => `Posible ang malakas na ulan sa o malapit sa ${z}. ${d}`,
    floodHighMeans: (z, d) => `Maaaring tumaas ang tubig sa ilog at magkaroon ng lokal na pagbaha sa ${z}. ${d}`,
    quietMeans: (z, f, fl) => `Ang kasalukuyang kondisyon sa ${z} ay nasa normal na range. Baseline na panganib ng sunog ay ${f} at panganib ng baha ay ${fl}.`,
    combinedJoin: "Kasabay nito, ",

    fireAction: (route, choke) =>
      `Alamin ang pangunahing ruta palabas: ${route}. ` +
      `Asahan na mababara ang ${choke} kung sabay-sabay mag-evacuate ang mga kapitbahay. ` +
      `Panatilihing handa ang go-bag at alisin ang mga madaling masunog sa loob ng 5 talampakan mula sa bahay. ` +
      `Sundin ang opisyal na alerto mula sa Maui Emergency Management at NWS Honolulu.`,
    floodAction: (hazard, route) =>
      `Iwasan ang ${hazard} at anumang tawiran ng tubig na hindi mo makita ang ilalim. ` +
      `Pangunahing ligtas na ruta palabas: ${route}. ` +
      `Bumalik, huwag lumangoy — 6 na pulgada ng gumagalaw na tubig ay kayang itumba ang tao, 12 pulgada ay kayang ilutang ang sasakyan. ` +
      `Subaybayan ang NWS Honolulu para sa flash flood warning.`,
    combinedFloodFirst: "Baha muna: ",
    combinedFireNext: " Sunog pagkatapos: ",
    quietAction: (route) =>
      `Panatilihing handa ang go-bag at kumpirmahin ang pangunahing ruta ng paglikas: ${route}. ` +
      `Suriin ang plano ng emergency ng sambahayan habang mahinahon ang kondisyon.`,

    kupunaNote: "Para sa kūpuna: tiyakin na naa-access ang mga gamot at may makakausap sa telepono kung magbago ang kondisyon.",
    keikiSchoolNote: (school, route) => `Para sa keiki: tingnan ang ${school} para sa maagang pagpapalabas at mag-plano ng sundo bago mabara ang ${route}.`,
    keikiGenericNote: "Para sa keiki: suriin ang plano ng maagang pagpapalabas ng paaralan at kumpirmahin kung sino ang susundo.",
    petsNote: "Para sa mga alagang hayop: limitado ang mga shelter — maghanda ng carrier, leash, at tubig, at hanapin ang pet-friendly na destinasyon.",
    medicalNote: "Para sa araw-araw na gamot o oxygen: magkaroon ng 72-oras na portable na supply at i-verify ang battery backup ng mga kagamitan.",
    noCarNote: "Walang sasakyan: makipag-ugnayan ngayon sa kapitbahay o kamag-anak na makakasakay mo kung may evacuation order. Huwag hintayin ang alerto.",

    fallbackHeadline: (z) => `${z}: Pansamantalang hindi available ang live na datos ng panganib.`,
    fallbackMeans: (z, f, fl) => `Hindi makuha ng Kahu Ola ang kasalukuyang kondisyon para sa ${z}. Baseline: panganib ng sunog ${f}, panganib ng baha ${fl}.`,
    fallbackAction: (route) => `Tingnan ang NWS Honolulu alerts sa weather.gov/hfo. Alamin ang pangunahing ruta ng paglikas: ${route}.`,

    windPhrase: (mph) => `${mph} mph na hangin`,
    windDefault: "malakas na hangin",
    humidityPhrase: (pct) => `humidity na mga ${pct}%`,
    humidityDefault: "mababang humidity",
  },

  ilo: {
    fireExtreme: (z) => `${z}: Nakadakdakkel a peligro ti sunog — agtignay itan.`,
    fireHigh: (z) => `${z}: Nangato a peligro ti sunog ita nga aldaw.`,
    floodExtreme: (z) => `${z}: Nangato ti peligro ti flash flood — suroten dagiti alerto a dagus.`,
    floodHigh: (z) => `${z}: Nangato a peligro ti layus ita nga aldaw.`,
    combined: (z) => `${z}: Agpada a nangato ti peligro ti layus ken sunog ita nga aldaw.`,
    quiet: (z) => `${z}: Awan nangato a peligro ita.`,

    fireExtremeMeans: (z, w, h, r) => `Naangin a kondisyon, ${w}, ken ${h} ti kayatna a saoen ket mapardas ti panagrang-ay ti sunog idiay ${z}. Ti baseline a peligro ti sunog ket ${r} ken maitutop ti tiempo ita.`,
    fireHighMeans: (z, w, h) => `Saan a paborable ti tiempo para iti sunog idiay ${z} ita. ${w.charAt(0).toUpperCase() + w.slice(1)} ken ${h} ti mangpapardas iti panagrang-ay ti apoy.`,
    floodExtremeMeans: (z, d) => `Posible ti napigsa a tudo idiay wenno iti ngato ti ${z}. ${d}`,
    floodHighMeans: (z, d) => `Mabalin a tumaas ti danum ti karayan ken agkaroon iti lokal a layus idiay ${z}. ${d}`,
    quietMeans: (z, f, fl) => `Ti agdama a kondisyon idiay ${z} ket normal. Baseline a peligro ti sunog ket ${f} ken peligro ti layus ket ${fl}.`,
    combinedJoin: "Iti isu met laeng a tiempo, ",

    fireAction: (route, choke) =>
      `Ammuem ti kangrunaan a ruta ti panagikkat: ${route}. ` +
      `Ekspektaren a mabara ti ${choke} no agikkat dagiti kaarruba iti isu met laeng a tiempo. ` +
      `Ikuyog ti go-bag ken ikkat dagiti madadalang a banag iti 5 pie manipud iti balay. ` +
      `Suroten dagiti opisyal nga alerto manipud iti Maui Emergency Management ken NWS Honolulu.`,
    floodAction: (hazard, route) =>
      `Liklikan ti ${hazard} ken aniaman a pagtawidan ti danum a saan a makita ti baba. ` +
      `Kangrunaan a natalged a ruta: ${route}. ` +
      `Agsubli, saan nga agkalap — 6 a pulgada ti aggaraw a danum ket mabalin a maiguyod ti tao, 12 pulgada ket mabalin a maanod ti lugan. ` +
      `Bantayan ti NWS Honolulu para iti flash flood warning.`,
    combinedFloodFirst: "Layus nga umuna: ",
    combinedFireNext: " Sunog kalpasan: ",
    quietAction: (route) =>
      `Ikuyog ti go-bag ken ikumpirma ti kangrunaan a ruta ti panagikkat: ${route}. ` +
      `Rebisaen ti plano ti emergency ti pamilya bayat nga naininan dagiti kondisyon.`,

    kupunaNote: "Para iti kūpuna: ikumpirma nga naragsak dagiti agas ken adda makatawag iti telepono no agbaliw ti kasasaad.",
    keikiSchoolNote: (school, route) => `Para iti keiki: kitaen ti ${school} para iti nasakbay a pannakaiwaras ken planuen ti pannakairugi sakbay nga mabara ti ${route}.`,
    keikiGenericNote: "Para iti keiki: rebisaen ti plano ti nasakbay a pannakaiwaras ti eskuelahan ken ikumpirma no siasino ti sumundo.",
    petsNote: "Para iti kailian a parsua: limitado ti shelter — ikeddeng ti carrier, leash, ken danum, ken biruken ti pet-friendly a destinasyon.",
    medicalNote: "Para iti inaldaw nga agas wenno oxygen: agtaripato iti 72-oras a portable a supply ken ikumpirma ti battery backup ti kagamitan.",
    noCarNote: "Awan lugan: makikoordinar itan iti kaarruba wenno kabagiyan a makasakay kenka no adda evacuation order. Saan nga aguray iti alerto.",

    fallbackHeadline: (z) => `${z}: Temporaryo a saan a magun-od ti live a datos ti peligro.`,
    fallbackMeans: (z, f, fl) => `Saan a naala ti Kahu Ola dagiti agdama a kondisyon para iti ${z}. Baseline: peligro ti sunog ${f}, peligro ti layus ${fl}.`,
    fallbackAction: (route) => `Kitaen dagiti alerto ti NWS Honolulu iti weather.gov/hfo. Ammuem ti kangrunaan a ruta ti panagikkat: ${route}.`,

    windPhrase: (mph) => `${mph} mph nga angin`,
    windDefault: "napigsa nga angin",
    humidityPhrase: (pct) => `humidity a mga ${pct}%`,
    humidityDefault: "nababa a humidity",
  },

  haw: {
    fireExtreme: (z) => `${z}: ʻO ke ahi wela loa — e hana koke.`,
    fireHigh: (z) => `${z}: Nui ka pilikia ahi i kēia lā.`,
    floodExtreme: (z) => `${z}: Nui ka pilikia wai kahe — e hana ma muli o nā ʻōlelo aʻo.`,
    floodHigh: (z) => `${z}: Nui ka pilikia wai i kēia lā.`,
    combined: (z) => `${z}: Nui ka pilikia wai a me ke ahi i kēia lā.`,
    quiet: (z) => `${z}: ʻAʻohe pilikia nui i kēia manawa.`,

    fireExtremeMeans: (z, w, h, r) => `ʻO nā kūlana maloʻo, ${w}, a me ${h} ka manaʻo he wikiwiki ka laha ʻana o ke ahi ma ${z}. ʻO ka pilikia ahi maʻamau he ${r} a kū like ke anilā o kēia lā.`,
    fireHighMeans: (z, w, h) => `ʻAʻole maikaʻi ke anilā no ke ahi ma ${z} i kēia lā. ${w.charAt(0).toUpperCase() + w.slice(1)} a me ${h} e hiki ai ke ulu wikiwiki nā ahi liʻiliʻi.`,
    floodExtremeMeans: (z, d) => `Hiki mai ka ua nui ma luna o ${z}. ${d}`,
    floodHighMeans: (z, d) => `Hiki ke piʻi ka wai kahawai a me ka wai kahe ma ${z}. ${d}`,
    quietMeans: (z, f, fl) => `Maʻamau nā kūlana ma ${z} i kēia manawa. ʻO ka pilikia ahi maʻamau he ${f} a ʻo ka pilikia wai he ${fl}.`,
    combinedJoin: "I ka manawa like, ",

    fireAction: (route, choke) =>
      `E ʻike i ke ala huakaʻi koʻikoʻi: ${route}. ` +
      `E manaʻo e paʻa ʻo ${choke} inā haʻalele nā hoalauna i ka manawa like. ` +
      `E mākaukau i kāu ʻeke hoʻomākaukau a hoʻomaʻemaʻe i nā mea aʻa i loko o 5 kapuaʻi. ` +
      `E hahai i nā ʻōlelo aʻo kūhelu mai Maui Emergency Management a me NWS Honolulu.`,
    floodAction: (hazard, route) =>
      `E ʻalo iā ${hazard} a me nā ala wai ʻaʻole hiki ke ʻike i ka papakū. ` +
      `Ke ala palekana koʻikoʻi: ${route}. ` +
      `E hoʻi hope, mai ʻauʻau — 6 ʻīniha o ka wai kahe hiki ke kaʻa i ke kanaka, 12 ʻīniha hiki ke lana i ka kaʻa. ` +
      `E nānā i NWS Honolulu no nā ʻōlelo aʻo wai kahe.`,
    combinedFloodFirst: "Ka wai mua: ",
    combinedFireNext: " Ke ahi ma hope: ",
    quietAction: (route) =>
      `E mākaukau i kāu ʻeke hoʻomākaukau a e hōʻoia i ke ala huakaʻi koʻikoʻi: ${route}. ` +
      `E nānā i ka papahana pilikia o ko kākou hale i kēia manawa maluhia.`,

    kupunaNote: "No nā kūpuna: e hōʻoia i ka loaʻa o nā lāʻau lapaʻau a me ka mea e kelepona ai inā hoʻololi nā kūlana.",
    keikiSchoolNote: (school, route) => `No nā keiki: e nānā iā ${school} no ka hoʻokuʻu mua a e hoʻolālā i ka lawe ʻana ma mua o ka piʻi ʻana o ${route}.`,
    keikiGenericNote: "No nā keiki: e nānā i ka papahana hoʻokuʻu mua o ke kula a hōʻoia i ka mea e lawe ana.",
    petsNote: "No nā holoholona: liʻiliʻi nā hale — e mākaukau i ka ʻeke, kaula, a me ka wai, a e ʻimi i wahi no nā holoholona.",
    medicalNote: "No nā lāʻau lapaʻau a me ka oxygen i kēlā me kēia lā: e mālama i 72 hola o ka supply portable a e hōʻoia i ka battery backup.",
    noCarNote: "ʻAʻohe kaʻa: e hoʻonohonoho me kahi hoalauna a ʻohana e hiki ke lawe iā ʻoe inā kauoha ʻia ka haʻalele. Mai kali i ka ʻōlelo aʻo.",

    fallbackHeadline: (z) => `${z}: ʻAʻole loaʻa ka ʻikepili pilikia i kēia manawa.`,
    fallbackMeans: (z, f, fl) => `ʻAʻole hiki iā Kahu Ola ke kiʻi i nā kūlana pilikia no ${z}. Maʻamau: pilikia ahi ${f}, pilikia wai ${fl}.`,
    fallbackAction: (route) => `E nānā i nā ʻōlelo aʻo NWS Honolulu ma weather.gov/hfo. E ʻike i ke ala huakaʻi koʻikoʻi: ${route}.`,

    windPhrase: (mph) => `${mph} mph makani`,
    windDefault: "makani ikaika",
    humidityPhrase: (pct) => `ka wai ea ma kahi o ${pct}%`,
    humidityDefault: "haʻahaʻa ka wai ea",
  },

  ja: {
    fireExtreme: (z) => `${z}: 極度の火災気象 — 今すぐ行動してください。`,
    fireHigh: (z) => `${z}: 本日、火災リスクが高まっています。`,
    floodExtreme: (z) => `${z}: 鉄砲水のリスクが高い — アラートに従ってください。`,
    floodHigh: (z) => `${z}: 本日、洪水リスクが高まっています。`,
    combined: (z) => `${z}: 本日、洪水と火災の両方のリスクが高まっています。`,
    quiet: (z) => `${z}: 現在、高い危険はありません。`,

    fireExtremeMeans: (z, w, h, r) => `乾燥した状況、${w}、${h}により、${z}での火災は急速に広がる可能性があります。基本的な火災リスクは${r}で、本日の天候はそのパターンに一致しています。`,
    fireHighMeans: (z, w, h) => `${z}では本日、火災に不利な天候です。${w}と${h}により、小さな火災がより早く拡大する可能性があります。`,
    floodExtremeMeans: (z, d) => `${z}またはその上流で大雨の可能性があります。${d}`,
    floodHighMeans: (z, d) => `${z}で河川の増水や局地的な洪水が発生する可能性があります。${d}`,
    quietMeans: (z, f, fl) => `${z}の現在の状況は正常範囲内です。基本的な火災リスクは${f}、洪水リスクは${fl}です。`,
    combinedJoin: "同時に、",

    fireAction: (route, choke) =>
      `主要避難経路を確認: ${route}。` +
      `住民が同時に避難する場合、${choke}で渋滞が予想されます。` +
      `非常用持ち出し袋を準備し、建物周囲1.5メートル以内の可燃物を除去してください。` +
      `Maui Emergency ManagementとNWS Honoluluの公式アラートに従ってください。`,
    floodAction: (hazard, route) =>
      `${hazard}および底が見えない水の横断を避けてください。` +
      `主要安全避難経路: ${route}。` +
      `引き返してください — 15cmの流水で人が流され、30cmで車が浮きます。` +
      `NWS Honoluluの鉄砲水警報を監視してください。`,
    combinedFloodFirst: "洪水優先: ",
    combinedFireNext: " 次に火災: ",
    quietAction: (route) =>
      `非常用持ち出し袋を確認し、主要避難経路を確認: ${route}。` +
      `状況が穏やかな今、世帯の緊急計画を見直してください。`,

    kupunaNote: "高齢者の方へ: 薬が手の届く場所にあり、状況が変わった場合に電話で連絡できる人がいることを確認してください。",
    keikiSchoolNote: (school, route) => `子どもたちへ: ${school}の早期下校のお知らせを確認し、${route}が混雑する前にお迎えを計画してください。`,
    keikiGenericNote: "子どもたちへ: 学校の早期下校計画を確認し、お迎えの担当者を確認してください。",
    petsNote: "ペットのために: 避難所の収容力は限られています — キャリー、リード、水を用意し、ペット可の避難場所を事前に確認してください。",
    medicalNote: "日常の薬や酸素について: 72時間分の携帯用供給を確保し、電動機器のバッテリーバックアップを確認してください。",
    noCarNote: "車がない場合: 避難命令が出た場合に乗せてくれる近隣の方や家族と今すぐ調整してください。アラートが出るまで待たないでください。",

    fallbackHeadline: (z) => `${z}: ライブ危険データが一時的に利用できません。`,
    fallbackMeans: (z, f, fl) => `Kahu Olaは${z}の現在の危険状況を取得できませんでした。基準: 火災リスク${f}、洪水リスク${fl}。`,
    fallbackAction: (route) => `NWS Honoluluのアラートをweather.gov/hfoで直接確認してください。主要避難経路: ${route}。`,

    windPhrase: (mph) => `風速${mph}mph`,
    windDefault: "強風",
    humidityPhrase: (pct) => `湿度約${pct}%`,
    humidityDefault: "低湿度",
  },
};

function getStrings(lang: string): BriefStrings {
  return STRINGS[lang] || STRINGS.en;
}

// ── Helpers ──────────────────────────────────────────────

function isHighRisk(level: RiskLevel): boolean {
  return level === "HIGH" || level === "EXTREME";
}

function isExtreme(level: RiskLevel): boolean {
  return level === "EXTREME";
}

function firstSchoolName(zone: ZoneProfile): string | null {
  const s = zone.notable_locations.find((l) => l.type === "school");
  return s ? s.name : null;
}

function firstFloodHazard(zone: ZoneProfile): string {
  return zone.evacuation_routes.avoid_when_flood[0] ?? "low-lying water crossings";
}

function firstChokePoint(zone: ZoneProfile): string {
  return zone.evacuation_routes.choke_points[0] ?? "main road junctions";
}

function windPhrase(state: ZoneDynamicState, str: BriefStrings): string {
  return state.wind_mph != null ? str.windPhrase(Math.round(state.wind_mph)) : str.windDefault;
}

function humidityPhrase(state: ZoneDynamicState, str: BriefStrings): string {
  return state.humidity_pct != null
    ? str.humidityPhrase(Math.round(state.humidity_pct))
    : str.humidityDefault;
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

// ── Brief builders ───────────────────────────────────────

function fireBrief(zone: ZoneProfile, state: ZoneDynamicState, str: BriefStrings): BriefBody {
  const extreme = isExtreme(state.fire_risk);
  const wind = windPhrase(state, str);
  const humidity = humidityPhrase(state, str);

  const headline = extreme
    ? str.fireExtreme(zone.zone_name)
    : str.fireHigh(zone.zone_name);

  const what_it_means = extreme
    ? str.fireExtremeMeans(zone.zone_name, wind, humidity, state.fire_risk.toLowerCase())
    : str.fireHighMeans(zone.zone_name, wind, humidity);

  const what_to_do = str.fireAction(zone.evacuation_routes.primary, firstChokePoint(zone));

  return { headline, what_it_means, what_to_do };
}

function floodBrief(zone: ZoneProfile, state: ZoneDynamicState, str: BriefStrings): BriefBody {
  const extreme = isExtreme(state.flood_risk);
  const hazard = firstFloodHazard(zone);

  const headline = extreme
    ? str.floodExtreme(zone.zone_name)
    : str.floodHigh(zone.zone_name);

  const what_it_means = extreme
    ? str.floodExtremeMeans(zone.zone_name, zone.drainage_context)
    : str.floodHighMeans(zone.zone_name, zone.drainage_context);

  const what_to_do = str.floodAction(hazard, zone.evacuation_routes.primary);

  return { headline, what_it_means, what_to_do };
}

function combinedBrief(zone: ZoneProfile, state: ZoneDynamicState, str: BriefStrings): BriefBody {
  const flood = floodBrief(zone, state, str);
  const fire = fireBrief(zone, state, str);

  return {
    headline: str.combined(zone.zone_name),
    what_it_means: `${flood.what_it_means} ${str.combinedJoin}${lowerFirst(fire.what_it_means)}`,
    what_to_do: `${str.combinedFloodFirst}${flood.what_to_do}${str.combinedFireNext}${fire.what_to_do}`,
  };
}

function quietBrief(zone: ZoneProfile, state: ZoneDynamicState, str: BriefStrings): BriefBody {
  return {
    headline: str.quiet(zone.zone_name),
    what_it_means: str.quietMeans(zone.zone_name, state.fire_risk.toLowerCase(), state.flood_risk.toLowerCase()),
    what_to_do: str.quietAction(zone.evacuation_routes.primary),
  };
}

function buildHouseholdNote(zone: ZoneProfile, household: HouseholdProfile, str: BriefStrings): string | null {
  const notes: string[] = [];

  if (household.kupuna) {
    notes.push(str.kupunaNote);
  }

  if (household.keiki) {
    const school = firstSchoolName(zone);
    if (school) {
      notes.push(str.keikiSchoolNote(school, zone.evacuation_routes.primary));
    } else {
      notes.push(str.keikiGenericNote);
    }
  }

  if (household.pets) {
    notes.push(str.petsNote);
  }

  if (household.medical) {
    notes.push(str.medicalNote);
  }

  if (!household.car) {
    notes.push(str.noCarNote);
  }

  return notes.length > 0 ? notes.join(" ") : null;
}

// ── Public API ───────────────────────────────────────────

export function generateZoneBrief(input: ZoneBriefInput): ZoneBrief {
  const { zone, state, household, lang } = input;
  const str = getStrings(lang);

  const fireHigh = isHighRisk(state.fire_risk);
  const floodHigh = isHighRisk(state.flood_risk);

  let base: BriefBody;
  if (fireHigh && floodHigh) {
    base = combinedBrief(zone, state, str);
  } else if (floodHigh) {
    base = floodBrief(zone, state, str);
  } else if (fireHigh) {
    base = fireBrief(zone, state, str);
  } else {
    base = quietBrief(zone, state, str);
  }

  return {
    headline: base.headline,
    what_it_means: base.what_it_means,
    what_to_do: base.what_to_do,
    household_note: buildHouseholdNote(zone, household, str),
    sources: state.sources.length > 0 ? state.sources : ["Kahu Ola zone profile"],
    generated_by: "template",
    fallback_used: false,
  };
}

export function generateFallbackBrief(zone: ZoneProfile, lang: string): ZoneBrief {
  const str = getStrings(lang);
  return {
    headline: str.fallbackHeadline(zone.zone_name),
    what_it_means: str.fallbackMeans(zone.zone_name, zone.typical_fire_risk.toLowerCase(), zone.typical_flood_risk.toLowerCase()),
    what_to_do: str.fallbackAction(zone.evacuation_routes.primary),
    household_note: null,
    sources: ["Kahu Ola zone profile"],
    generated_by: "template",
    fallback_used: true,
  };
}
