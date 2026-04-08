# Kahu Ola — Translation Glossary Seed
**Version:** 1.0  
**Status:** Seed  
**Document type:** Glossary  
**Owner:** Long Nguyen · kahuola.org  
**Last updated:** 2026-04-07  
**Supersedes:** none (new document)

---

## Purpose

This glossary seed defines the first locked set of hazard, civic, system, and disclosure terms for multilingual Kahu Ola output.

Its purpose is to prevent semantic drift across languages, especially for:
- hazard severity wording
- source attribution
- freshness labels
- AI disclosure labels
- civic safety posture

This is a **seed glossary**, not the final full translation system.  
Where a translation is not yet approved, the English term should be preserved until reviewed.

---

## Usage Rules

1. If a term is marked **LOCKED**, use the approved translation exactly.
2. If a target-language translation is blank or marked **KEEP ENGLISH**, preserve the English original.
3. Do not paraphrase locked hazard terms in AI output.
4. Do not translate agency names into invented local equivalents.
5. Disclosure labels and civic disclaimers must remain semantically strict.
6. If any translation introduces more certainty than the English original, reject it.

---

## Language Keys

- `en` = English
- `vi` = Vietnamese
- `tl` = Tagalog
- `ilo` = Ilocano
- `ja` = Japanese
- `haw` = Hawaiian

---

## 1. Hazard Terms

| Key | Status | en | vi | tl | ilo | ja | haw | Notes |
|---|---|---|---|---|---|---|---|---|
| hazard.fire_signal | LOCKED | Fire Signal | Tín hiệu cháy | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Product-specific label; preserve until reviewed |
| hazard.fire_weather | LOCKED | Fire Weather | Thời tiết cháy rừng | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Context layer |
| hazard.flash_flood | LOCKED | Flash Flood | Lũ quét | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Generic hazard term |
| hazard.flash_flood_warning | LOCKED | Flash Flood Warning | Cảnh báo lũ quét | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Official-style warning label |
| hazard.flash_flood_watch | LOCKED | Flash Flood Watch | Theo dõi lũ quét | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Watch ≠ warning |
| hazard.red_flag_warning | LOCKED | Red Flag Warning | Cảnh báo cờ đỏ | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Consider future refinement with native review |
| hazard.tsunami_warning | LOCKED | Tsunami Warning | Cảnh báo sóng thần | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Official-style warning label |
| hazard.tsunami_advisory | LOCKED | Tsunami Advisory | Khuyến cáo sóng thần | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Advisory ≠ warning |
| hazard.smoke | LOCKED | Smoke | Khói | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Context term |
| hazard.air_quality | LOCKED | Air Quality | Chất lượng không khí | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Public-facing context |
| hazard.wind | LOCKED | Wind | Gió | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Generic context term |
| hazard.rainfall | LOCKED | Rainfall | Lượng mưa | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Context term |
| hazard.landslide | LOCKED | Landslide | Sạt lở đất | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Future hazard module |

---

## 2. Severity and State Terms

| Key | Status | en | vi | tl | ilo | ja | haw | Notes |
|---|---|---|---|---|---|---|---|---|
| state.active | LOCKED | Active | Đang hoạt động | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | State label |
| state.monitoring | LOCKED | Monitoring | Đang theo dõi | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Must not imply safety |
| state.no_active_signal | LOCKED | No active signal | Không có tín hiệu đang hoạt động | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Better than “safe” |
| state.review_recommended | LOCKED | Review recommended | Đề nghị xem xét | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Operator-facing or bounded public context |
| state.unverified | LOCKED | Unverified | Chưa xác minh | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Important for community content |
| state.possible | LOCKED | Possible | Có thể | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Preserve uncertainty |
| state.confirmed | RESTRICTED | Confirmed | Đã xác nhận | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Use only if canonical system explicitly allows |
| state.safe | PROHIBITED | Safe | An toàn | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Do not use as direct hazard conclusion |
| state.unsafe | PROHIBITED | Unsafe | Không an toàn | PROHIBITED | PROHIBITED | PROHIBITED | PROHIBITED | Do not use as direct hazard conclusion |

---

## 3. Freshness Terms

| Key | Status | en | vi | tl | ilo | ja | haw | Notes |
|---|---|---|---|---|---|---|---|---|
| freshness.updated | LOCKED | Updated | Cập nhật | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Timestamp label |
| freshness.generated_at | LOCKED | Generated at | Tạo lúc | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Internal/public as needed |
| freshness.fresh | LOCKED | Fresh | Mới | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Internal label first |
| freshness.stale | LOCKED | Stale | Cũ | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Internal label first |
| freshness.data_may_be_stale | LOCKED | Data may be stale | Dữ liệu có thể đã cũ | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Must preserve uncertainty |
| freshness.delayed | LOCKED | Delayed | Bị chậm | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Public-friendly |

---

## 4. Source and Agency Terms

| Key | Status | en | vi | tl | ilo | ja | haw | Notes |
|---|---|---|---|---|---|---|---|---|
| source.source | LOCKED | Source | Nguồn | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Label only |
| source.sources | LOCKED | Sources | Nguồn dữ liệu | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Label only |
| source.nws | LOCKED | NWS | NWS | NWS | NWS | NWS | NWS | Preserve acronym |
| source.noaa | LOCKED | NOAA | NOAA | NOAA | NOAA | NOAA | NOAA | Preserve acronym |
| source.nasa_firms | LOCKED | NASA FIRMS | NASA FIRMS | NASA FIRMS | NASA FIRMS | NASA FIRMS | NASA FIRMS | Preserve exact source name |
| source.epa | LOCKED | EPA | EPA | EPA | EPA | EPA | EPA | Preserve acronym |
| source.usgs | LOCKED | USGS | USGS | USGS | USGS | USGS | USGS | Preserve acronym |
| source.hiema | LOCKED | HIEMA | HIEMA | HIEMA | HIEMA | HIEMA | HIEMA | Preserve acronym |
| source.county_emergency_management | LOCKED | County Emergency Management | Cơ quan quản lý khẩn cấp quận | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Can refine later with native review |

---

## 5. Civic Guidance Terms

| Key | Status | en | vi | tl | ilo | ja | haw | Notes |
|---|---|---|---|---|---|---|---|---|
| civic.follow_official_guidance | LOCKED | Follow official guidance | Hãy làm theo hướng dẫn chính thức | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Allowed civic instruction |
| civic.not_official_alert | LOCKED | Not an official alert | Không phải cảnh báo chính thức | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Critical disclosure |
| civic.current_status | LOCKED | Current status | Tình trạng hiện tại | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Safe template label |
| civic.view_official_guidance | LOCKED | View official guidance | Xem hướng dẫn chính thức | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | CTA label |
| civic.monitor_conditions | LOCKED | Monitor conditions | Theo dõi tình hình | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Neutral civic wording |
| civic.review_local_updates | LOCKED | Review local updates | Xem cập nhật địa phương | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Safe civic wording |

---

## 6. Disclosure and AI Labels

| Key | Status | en | vi | tl | ilo | ja | haw | Notes |
|---|---|---|---|---|---|---|---|---|
| ai.ai_generated_context | LOCKED | AI-generated context | Ngữ cảnh do AI tạo | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Required public label |
| ai.community_submitted | LOCKED | Community-submitted | Do cộng đồng gửi | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Label for public uploads |
| ai.unverified | LOCKED | Unverified | Chưa xác minh | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Repeat allowed if needed |
| ai.not_official_hazard_signal | LOCKED | Not an official hazard signal | Không phải tín hiệu nguy cơ chính thức | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Important boundary |
| ai.operator_note | LOCKED | Operator note | Ghi chú vận hành | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | KEEP ENGLISH | Internal mostly |

---

## 7. Prohibited Terms and Phrases

These should not appear in public-facing multilingual output unless explicitly supported by canonical policy and approved templates.

| Key | Status | en | vi | Notes |
|---|---|---|---|---|
| prohibited.safe_to_return | PROHIBITED | safe to return | an toàn để quay lại | Too definitive |
| prohibited.area_is_safe | PROHIBITED | area is safe | khu vực an toàn | Not allowed as direct conclusion |
| prohibited.immediately_leave | PROHIBITED | immediately leave | rời đi ngay lập tức | Too directive unless canonical policy supports exact template |
| prohibited.mandatory_evacuation | PROHIBITED | mandatory evacuation | sơ tán bắt buộc | High-risk phrase |
| prohibited.voluntary_evacuation | PROHIBITED | voluntary evacuation | sơ tán tự nguyện | High-risk phrase |
| prohibited.confirmed_fire | PROHIBITED | confirmed fire | cháy đã được xác nhận | Only allowed if canonical system explicitly supplies this phrase |
| prohibited.confirmed_flood | PROHIBITED | confirmed flood | lũ đã được xác nhận | Same restriction |
| prohibited.official_order | PROHIBITED | official order | lệnh chính thức | Must not be invented |

---

## 8. Seed Translation Strategy

### Immediate rule
For launch, English and Vietnamese can be partially locked now.  
Other languages should preserve English for high-risk terms until reviewed.

### Recommended rollout
1. Lock English
2. Lock Vietnamese
3. Build template coverage
4. Add Tagalog and Ilocano with review
5. Add Japanese
6. Add Hawaiian with local/native review

---

## 9. Review Flags

The following terms require special review before broad public use in non-English languages:

- Red Flag Warning
- Watch vs Warning distinctions
- Advisory vs Warning distinctions
- County Emergency Management
- AI-generated context
- Not an official alert
- community-submitted / unverified wording

---

## 10. Recommended Repository Placement

**Primary path:** `docs/doctrine/TRANSLATION_GLOSSARY_SEED.md`

This file should sit next to:
- `docs/doctrine/GEMMA4_INTEGRATION_DOCTRINE.md`
- `docs/doctrine/MULTILINGUAL_TRANSLATION_DOCTRINE.md`

---

## 11. Maintenance Rule

Any new multilingual feature must:
- add new keys here first
- mark each key as LOCKED / RESTRICTED / PROHIBITED
- specify whether untranslated terms should remain in English
- document native review status before public rollout

---

*Kahu Ola — Guardian of Life · kahuola.org*  
*Translation improves access. It must never change truth.*
