# KAHU OLA — NO DOOR
## Engineering Spec V2 — aligned với Concept Draft 3.0

**Document type:** Engineering Specification (companion)
**Version:** V2.0
**Ngày:** 2026-09-17
**Supersedes:** Engineering Spec V1 (file KAHUOLA_NO_DOOR_DRAFT_3_ENGINEERING.md — đổi tên để tránh trùng số với Concept Draft 3.0)
**Concept authority:** `KAHUOLA_NO_DOOR_DRAFT_3.md` (Prior-Art Research + Concept) — mọi naming và claim theo bản đó
**Stack rules:** Cloudflare Workers + TypeScript · No ML/heavy compute in Worker · Deterministic & auditable · Free data only

---

## 0. QUAN HỆ GIỮA HAI DÒNG TÀI LIỆU

```
CONCEPT LINE (vision, research, claims)
  Draft 1 → Draft 2 → Draft 3.0  ← authoritative cho naming + novelty discipline

ENGINEERING LINE (schema, thuật toán, phasing build)
  Spec V1 → Spec V2 (file này)   ← authoritative cho code
```

### Naming adopted từ Draft 3.0 (final)

| Cũ (Spec V1) | Mới (chuẩn) | Viết tắt |
|---|---|---|
| Response Compiler | Household Response Path Compiler | **HRPC** |
| Capability Graph | Resilient Human-Services Capability Graph | **RHSCG** |
| Digital Twin / Gap Simulator | Household Path Resilience Simulator | **HPRS** |
| Continuity Token | Need Continuity Capsule | **NCC** |

("Human-Services Resilience Twin" dành cho hệ trưởng thành sau này — không dùng trong code v1.)

### Những điểm Draft 3.0 độc lập xác nhận Spec V1 (không cần bàn lại)

- **NCC sau HPRS** — Draft 3.0 Phase 5 sau Phase 4 = đúng ruling "twin trước token" của Spec V1
- **Same-graph invariant** — Draft 3.0 §9: "The simulation should test the exact same graph used by the public-facing routing system. No separate demo simulation model." = đúng thiết kế HPRS gọi thẳng `compiler.js` production
- **AI chỉ là translator** — Draft 3.0 §15 (LLM → NeedState → user confirm → deterministic engine) = đúng Spec V1 §3.3
- **Engine deterministic, client-side** — giữ nguyên: NeedState không rời thiết bị, offline miễn phí

---

## 1. THAY ĐỔI LỚN NHẤT: EDGE LÀ ĐƠN VỊ TEST — NHƯNG NODE LÀ ĐƠN VỊ LƯU

Draft 3.0 §8–9 chuyển data object sang **PATH EDGE** với edge contract đầy đủ
(status, authority, channels, freshness, fallback_edges…).

Vấn đề thực thi cho solo dev: hand-curate một **edge database** nghĩa là maintain
N needs × M providers records — mỗi lần thêm 1 provider phải viết tay 3–5 edges,
mỗi lần verify lại phải sửa nhiều chỗ. Không bền với một người.

### Ruling đề xuất chốt (R1): **Node-stored, Edge-derived**

```
LƯU TRỮ:  CapabilityNode (registry JSON, người curate)
RUNTIME:  HRPC derive edges từ nodes → mỗi edge kế thừa properties của node
TEST:     HPRS test trên edges đã derive — đúng "every edge independently testable"
```

Edge trở thành **intermediate representation** của compiler — vẫn có đầy đủ contract
Draft 3.0 §9, nhưng sinh ra bằng code thay vì viết tay:

```ts
// Derived tại runtime — KHÔNG lưu trong registry
interface PathEdge {
  edge_id: string;              // deterministic: `${need}--${node.id}`
  from: { type: "need"; id: Need };
  to:   { type: "capability"; id: string; node: CapabilityNode };
  channels: { web: boolean; phone: boolean; sms: boolean; offline_cached: boolean };
  languages: string[];
  authority: "official" | "partner" | "community";   // field MỚI trên node — xem §2
  freshness: { verified_at: string; state: "fresh" | "stale_ok" | "stale_drop" };
  connectivity_required: boolean;                     // true nếu chỉ có web channel
  dependency_edges: PathEdge[];                       // từ node.requires
  fallback_edges: string[];                           // từ node.fallback_for (đảo chiều)
}
```

Nếu sau này cần override edge cụ thể (1 provider có capability X chỉ mở ở Lahaina),
thêm optional `edge_overrides[]` vào registry — chưa cần ở v1.

---

## 2. RHSCG — SCHEMA V1.1 (capgraph-1.1)

Delta so với capgraph-1.0 (Spec V1 §2), theo edge contract Draft 3.0 §9:

```ts
interface CapabilityNode {
  // ... giữ nguyên toàn bộ capgraph-1.0 ...

  // MỚI — bắt buộc:
  authority: "official" | "partner" | "community";
  //   official  = gov agency / 211 / Red Cross
  //   partner   = nonprofit đã verify trực tiếp
  //   community = CBO/church — hiện sau official trong ranking
  //   (Draft 3.0: "Prefer authoritative paths" — compiler step 9)

  max_age_hours: number;
  //   ngưỡng freshness riêng từng node (hotline 211: 2160h;
  //   disaster_activated shelter info: 168h)

  // MỚI — optional:
  channels: {
    phone?: string;
    url?: string;
    sms?: string;
    offline_note_i18n_key?: string;  // hướng dẫn dùng được khi offline hoàn toàn
  };
}
```

### Ruling đề xuất chốt (R2): Freshness 3 bậc — KHÔNG hard-reject

Draft 3.0 §10 step 7 nói "Reject stale/unverified edges" (fail-closed).
Áp nguyên văn sẽ phản tác dụng: số điện thoại Red Cross verify cách đây 3 tuần
vẫn an toàn hơn là **không hiện gì** giữa disaster khi mình chưa kịp verify lại.

Đề xuất: áp đúng **freshness doctrine sẵn có của Kahu Ola** vào edge:

```
age = now − verified_at

age ≤ max_age_hours            → FRESH      : dùng bình thường
age ≤ 3 × max_age_hours        → STALE_OK   : dùng được, ranking hạ,
                                              label "Chưa verify gần đây — gọi xác nhận"
age > 3 × max_age_hours        → STALE_DROP : edge loại khỏi path (fail closed)
                                              → có thể tạo BROKEN_EDGE
```

Vừa giữ tinh thần fail-closed của Draft 3.0 (quá cũ = drop thật), vừa nhất quán
với FRESH/STALE_OK/STALE_DROP toàn hệ thống — một doctrine, mọi tầng.
HPRS đo được thêm metric mới miễn phí: *bao nhiêu % path gãy chỉ vì verification lag*.

---

## 3. NEED STATE — TAXONOMY V1.1

Delta so với Spec V1 §1:

```ts
interface NeedState {
  v: "needstate-1.1";
  island: Island;
  hazard: Hazard;
  needs: Need[];
  constraints: Constraint[];
  urgency: Urgency;
  lang: Lang;

  // MỚI (Draft 3.0 §10 input) — AUTO-DETECT, không phải user nhập:
  connectivity: "online" | "degraded" | "offline";
  //   detect bằng navigator.onLine + fetch-timeout heuristic
  //   compiler dùng để filter channel: offline → edges có phone/offline_note lên đầu,
  //   web-only edges đánh dấu "cần mạng"
}
```

### Ruling đề xuất chốt (R3): Foster/kinship — narrative vs graph input

Điểm vênh duy nhất giữa 2 tài liệu: archetype A02 của Draft 3.0 §11 có
"foster/kinship child", trong khi Spec V1 ruling #2 loại `foster_kinship`
khỏi taxonomy/NCC.

Giải quyết — **cả hai đều đúng, ở hai tầng khác nhau:**

```
ARCHETYPE (HPRS, synthetic)          GRAPH INPUT (taxonomy)
─────────────────────────           ─────────────────────────
A02: "Caregiver + foster/kinship     maps → constraints:
child + medication + pet + no          [child, pet, no_vehicle,
vehicle + Vietnamese"                   medication_dependent]
                                      + needs: [caregiver_support, ...]
(narrative — mô tả người thật
 sẽ ở tình huống nào; synthetic      (routing input — foster và non-foster
 nên nhắc foster không rủi ro gì)     compile RA CÙNG MỘT PATH, vì đích
                                      đến như nhau: DHS CWS/caseworker
                                      nằm trong caregiver_support)
```

- Taxonomy/NeedState/NCC: **không có** `foster_kinship` (giữ ruling Spec V1 — không encode status của trẻ vào thứ scan được)
- Archetype description (file `archetypes.json`, synthetic): **được phép** ghi foster trong label/narrative, kèm field `maps_to: Constraint[]` là input thật cho compiler
- Foster-specific content đầy đủ ở ʻOhana Ready checklist (on-device)

---

## 4. HRPC — THUẬT TOÁN V1.1

Cập nhật pipeline Spec V1 §3.1 theo 11 bước Draft 3.0 §10, đánh dấu chỗ mới:

```
1.  Normalize NeedState (validate enum, drop unknown — fail closed)
2.  ORDER needs theo canonical priority (giữ nguyên Spec V1)
3.  Derive edges từ RHSCG nodes (§1)                                [MỚI]
4.  Filter: island ∧ capability ∧ audience
5.  Filter theo connectivity (§3): offline → ưu tiên phone/offline  [MỚI]
6.  Freshness gate 3 bậc (§2 R2): STALE_DROP loại, STALE_OK hạ hạng [MỚI]
7.  Dependency resolution (max depth 2, chống vòng — giữ nguyên)
8.  RANKING: authority (official > partner > community)             [MỚI — lên đầu]
    → audience match cụ thể > "*"
    → availability khớp hazard state
    → FRESH > STALE_OK
    → lang match
    → alphabet id (deterministic tie-break)
9.  Attach fallbacks (tối đa 2/step)
10. BROKEN_EDGE cho need không còn edge khả thi
    → output có "Missing capability" + "Affected downstream needs"
      (đúng format Draft 3.0 §10 — downstream = các need có dependency vào nó)
11. Explanation layer: mỗi step kèm why[] bằng lang của user
```

Nguyên tắc Draft 3.0 §10 giữ nguyên văn làm invariant của engine:
> **"Kahu Ola should never fabricate a complete path."**
PATH INCOMPLETE là output hạng nhất, không phải error state.

---

## 5. NCC — RECONCILE HAI FORMAT

Draft 3.0 §14 dùng schema `kahuola.need.v1` (YAML/JSON, có `identity: null` tường minh).
Spec V1 §5 dùng wire format `KO1|...` (pipe-delimited, human-readable).

**Không mâu thuẫn — hai tầng của cùng một object:**

```
CONCEPTUAL SCHEMA (kahuola.need.v1)        WIRE FORMAT (KO1)
JSON — dùng cho:                           pipe string — dùng cho:
• UI "xem capsule chứa gì"                 • QR payload (ngắn, scan nhanh)
• demo Scene 6: hiện identity: null,       • plain text in dưới QR
  eligibility_claim: null tường minh       • printable Response Passport
• docs cho partner đọc capsule
```

Encode/decode 1-1 giữa hai dạng. Parser (cả hai chiều): key lạ → reject toàn bộ
capsule; version lạ → reject; hết hạn → "Capsule đã hết hạn — tạo lại".
`identity: null` trong JSON view là **hiển thị của sự vắng mặt** — wire format
không có field identity để điền, đó mới là bảo đảm thật.

Danh sách NCC-must-NOT-represent của Draft 3.0 §14 (identity, custody, immigration
status, medical authorization, eligibility, benefit, case status) → copy nguyên
vào docs partner + comment đầu file `ncc.ts`.

---

## 6. HPRS — METRICS MODULE (Draft 3.0 §12)

`simulate-gaps.ts` output mở rộng, tính đủ bộ metric survivability:

```json
{
  "generated_at": "...",
  "graph_version": "...",
  "scenario": "westmaui-wildfire",
  "archetypes_tested": 100,
  "metrics": {
    "complete_path_rate": 0.93,
    "degraded_path_rate": { "internet_loss": 0.81, "provider_plus_road": 0.67 },
    "single_point_of_failure": [
      { "capability": "accessible_transportation", "sole_provider": "cap-xxx" }
    ],
    "handoff_burden_avg": 3.2,
    "connectivity_dependency_rate": 0.19,
    "language_path_coverage": { "en": 0.93, "vi": 0.78 },
    "accessibility_path_coverage": { "wheelchair_mobility": 0.71 },
    "stale_induced_breaks": 4
  },
  "broken_edges": [
    { "edge": "no_vehicle → shelter", "count": 9,
      "reason": "no verified fallback under road failure" }
  ]
}
```

- Failure injection theo 7 TEST của Draft 3.0 §11 — **trừ TEST 5 (capacity)**:
  giữ ruling Spec V1 "không mô hình capacity khi chưa có data thật" (khớp luôn
  Draft 3.0 Phase 6: "capacity constraints where trustworthy data exists")
- Vòng lặp mỗi scenario: `compile() → degrade() → recompile() → measure()` — nguyên văn §11
- Mọi số render kèm label: "Simulation trên RHSCG như đã ghi nhận — không phải
  dự đoán thực tế" (claims discipline §20 của Draft 3.0)

---

## 7. PHASING — MAP DRAFT 3.0 PHASE 0–6 VÀO ROADMAP

| Prompt | Draft 3.0 Phase | Nội dung | Ghi chú |
|---|---|---|---|
| — | 0 — Evidence | Claims matrix → copy rules cho site/grant text; eval methodology | Không phải code prompt — làm tay, 1 buổi |
| **P34** | 1 — Graph MVP | `resources.html` + registry capgraph-1.1, **scope Proof 1**: Maui · 3 needs (transportation, shelter routing, medication_continuity) · caregiver+child+lang · wildfire | Draft 3.0 §18 thu hẹp Proof 1 nhỏ hơn Spec V1 — theo bản hẹp |
| **P35** | 2 — HRPC | compiler.js v1.1 (§4) + Response Path UI + explanations EN/VI | |
| **P36** | 3 — Failure Lab | degradation modes + broken-edge reporting + static floor + **nút "Simulate failure" trong debug UI** (nền cho demo Scene 3–5) | |
| **P37** | 4 — HPRS | archetypes (maps_to §3 R3) + scenarios + metrics module (§6) + gap dashboard | |
| **P38** | 5 — NCC | capsule 2-format (§5) + QR + reader page + Passport print + threat model review **trước khi ship** | |
| **P39** | 6 — Resilience Twin | scenario library lớn, multi-hazard, capacity nếu có data, partner validation | DEFERRED — chỉ mở sau khi P34–P38 live |

Thứ tự **A→B→C→E→D** của Spec V1 = **Phase 1→2→3→4→5** của Draft 3.0. Trùng khớp — coi như đã chốt bằng chính research.

Proof 1–5 của Draft 3.0 §18 = definition of done cho P34–P37:
mỗi prompt ship xong phải demo được proof tương ứng, không proof = không merge.

---

## 8. NHỮNG GÌ V2 VẪN CỐ Ý CẮT (cập nhật)

1. Capacity modeling — chờ data thật (Draft 3.0 Phase 6 đồng ý)
2. Cryptographic capsule integrity — capsule không cấp quyền gì; xem lại nếu partner cần
3. Edge database viết tay — dùng node-stored/edge-derived (R1)
4. Conversational layer — Draft 3.0 §18: "Do not begin with AI"; chỉ sau Proof 1–5
5. Competition submission — Draft 3.0 §17: cần state partner; Long build tính năng, không thi. Nếu sau này thi: partnership = workstream riêng, không phải code
6. `foster_kinship` trong taxonomy/NCC — R3

---

## 9. ĐỀ XUẤT CHỐT (3 ruling mới)

1. **R1 — Node-stored, Edge-derived:** registry lưu nodes, HRPC derive edges runtime với đầy đủ contract Draft 3.0 §9. Solo-maintainable, vẫn "every edge independently testable"
2. **R2 — Freshness 3 bậc trên edge:** FRESH / STALE_OK (label + hạ hạng) / STALE_DROP (loại) theo `max_age_hours` từng node — thay vì hard-reject mọi stale edge
3. **R3 — Foster ở archetype narrative, không ở graph input:** A02 giữ nguyên mô tả, `maps_to` → [child, pet, no_vehicle, medication_dependent] + caregiver_support; NCC/NeedState không bao giờ chứa foster status

Chốt R1–R3 → P34 prompt-ready theo scope Proof 1 (hẹp hơn và chắc hơn bản cũ).

---

*Kahu Ola — Guardian of Life · kahuola.org*
*"A resource directory tells us what exists. Kahu Ola tests whether a household can actually reach help."*
*E mālama pono.*
