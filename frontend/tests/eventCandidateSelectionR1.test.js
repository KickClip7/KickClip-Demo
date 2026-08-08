import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_ANCHOR_MODE,
  PROVENANCE_ERROR_CODE,
  buildCandidateReviewPayload,
  buildCandidateSelectionPayload,
  canSelectCandidate,
  candidateMediaKeys,
  candidateReasonLabel,
  errorDisplayCode,
  isCandidateHardBlocked,
  normalizeCandidateRecommendations,
  splitCandidateRecommendations,
  validateCandidateRecommendationResponse,
  validateSelectionResponse,
  validateTrackingHandoff,
} from "../src/features/editor/eventCandidateSelection.js";

const expectedIds = [
  "candidate-alpha",
  "candidate-bravo",
  "candidate-charlie",
  "candidate-delta",
  "candidate-echo",
];

function candidate(candidateId, shortlistRank, overrides = {}) {
  const shotId = `shot-${shortlistRank}`;
  return {
    ranking_version: "v1.2",
    ranking_id: "ranking_r1",
    shortlist_patch_id: "patch_r1",
    candidate_id: candidateId,
    shortlist_rank: shortlistRank,
    global_rank: shortlistRank + 4,
    shot_id: shotId,
    tracklet_id: candidateId,
    reviewability: "CLEAR",
    best_frame: candidateId === expectedIds[2] ? 342 : 100 + shortlistRank,
    media: Object.fromEntries(candidateMediaKeys.map((key) => [key, `/media/${candidateId}/${key}`])),
    reason_codes: ["TRACKLET_QUALITY"],
    risk_codes: [],
    possible_fragment_duplicate: false,
    automatic_target_confirmation: false,
    ...overrides,
  };
}

function fixture(overrides = {}) {
  return {
    ranking_version: "v1.2",
    ranking_id: "ranking_r1",
    shortlist_patch_id: "patch_r1",
    revision_id: "revision_r1",
    event_id: "event_1",
    scene_id: "scene_1",
    source_video_asset_id: "asset_1",
    candidates: expectedIds.map((id, index) => candidate(id, index + 1)),
    automatic_target_confirmation: false,
    production_recommendation_ui: "BLOCKED",
    ...overrides,
  };
}

test("V1.2 Top 5 순서와 immutable candidate ID를 그대로 유지한다", () => {
  const source = fixture();
  const normalized = normalizeCandidateRecommendations({ ...source, candidates: [...source.candidates].reverse() });
  assert.deepEqual(normalized.map((item) => item.candidate_id), expectedIds);
  assert.deepEqual(normalized.map((item) => item.shortlist_rank), [1, 2, 3, 4, 5]);

  const rerendered = [...normalized].sort((a, b) => b.global_rank - a.global_rank)
    .filter((item) => item.reviewability !== "UNREVIEWABLE");
  assert.deepEqual(
    new Set(rerendered.map((item) => item.candidate_id)),
    new Set(expectedIds),
  );
});

test("화면 후보 순서는 global_rank가 아니라 shortlist_rank만 사용한다", () => {
  const candidates = [
    candidate("candidate-low-global", 2, { global_rank: 1 }),
    candidate("candidate-high-global", 1, { global_rank: 99 }),
  ];
  const groups = splitCandidateRecommendations(candidates);
  assert.deepEqual(groups.primary.map((item) => item.candidate_id), [
    "candidate-high-global",
    "candidate-low-global",
  ]);
});

test("UNREVIEWABLE만 선택을 hard block하고 LOW_RESOLUTION은 경고 후 선택 가능하다", () => {
  for (const reviewability of ["CLEAR", "USABLE", "LOW_RESOLUTION"]) {
    const item = candidate(`candidate-${reviewability}`, 1, { reviewability });
    assert.equal(isCandidateHardBlocked(item), false);
    assert.equal(canSelectCandidate(item, false), true);
    assert.equal(canSelectCandidate(item, true), false);
  }
  const blocked = candidate("candidate-unreviewable", 1, { reviewability: "UNREVIEWABLE" });
  assert.equal(isCandidateHardBlocked(blocked), true);
  assert.equal(canSelectCandidate(blocked, false), false);
});

test("product reason code를 사용자용 라벨로 표시한다", () => {
  assert.equal(candidateReasonLabel("PRODUCT_ACTION_ADJACENT_PRIORITY"), "이벤트 직전 핵심 장면");
  assert.equal(candidateReasonLabel("PRODUCT_FIELD_SUPPORTED_PRIORITY"), "경기 화면 후보");
  assert.equal(candidateReasonLabel("PRODUCT_PRE_EVENT_CONTEXT_PRIORITY"), "이벤트 이전 후보");
  assert.equal(candidateReasonLabel("PRODUCT_EVENT_POST_CONTEXT_PRIORITY"), "이벤트 이후 후보");
  assert.equal(candidateReasonLabel("PRODUCT_CLOSEUP_ROLE_UNVERIFIED"), "역할 미확인 클로즈업");
  assert.equal(candidateReasonLabel("UNKNOWN_REASON"), "UNKNOWN_REASON");
});

test("각 카드의 6종 media URL은 같은 candidate ID와 연결된다", () => {
  const normalized = normalizeCandidateRecommendations(fixture());
  normalized.forEach((item) => {
    candidateMediaKeys.forEach((key) => assert.match(item.media[key], new RegExp(item.candidate_id)));
  });
  assert.equal(candidateMediaKeys.length, 6);
});

test("세 번째 후보 선택 payload와 selection/tracking provenance가 일치한다", () => {
  const response = fixture();
  const clicked = response.candidates[2];
  assert.deepEqual(buildCandidateSelectionPayload(response, clicked, "asset_1"), {
    ranking_id: "ranking_r1",
    shortlist_patch_id: "patch_r1",
    candidate_id: expectedIds[2],
    source_video_asset_id: "asset_1",
  });
  const selection = validateSelectionResponse({
    selection_id: "selection_1",
    candidate_id: clicked.candidate_id,
    ranking_id: clicked.ranking_id,
    shortlist_patch_id: clicked.shortlist_patch_id,
    shot_id: clicked.shot_id,
    tracklet_id: clicked.tracklet_id,
  }, clicked, response);
  const handoff = validateTrackingHandoff({
    tracking_job_id: "tracking_1",
    selection_id: "selection_1",
    selected_candidate_id: clicked.candidate_id,
    selected_shot_id: clicked.shot_id,
    selected_reference_frame: 342,
    selected_bbox: [10, 20, 110, 220],
    anchor_mode: EXPECTED_ANCHOR_MODE,
    provenance_artifact_sha256: "a".repeat(64),
    status: "QUEUED",
  }, selection, clicked);
  assert.equal(handoff.selected_reference_frame, 342);
});

test("selection 응답 candidate가 다르면 provenance 오류라 tracking을 시작할 수 없다", () => {
  const response = fixture();
  assert.throws(() => validateSelectionResponse({
    selection_id: "selection_1",
    candidate_id: expectedIds[0],
    ranking_id: response.ranking_id,
    shortlist_patch_id: response.shortlist_patch_id,
    shot_id: response.candidates[2].shot_id,
    tracklet_id: response.candidates[2].tracklet_id,
  }, response.candidates[2], response), new RegExp(PROVENANCE_ERROR_CODE));
});

test("tracking candidate/shot/frame/anchor/bbox mismatch를 각각 차단한다", () => {
  const response = fixture();
  const clicked = response.candidates[2];
  const selection = {
    selection_id: "selection_1",
    candidate_id: clicked.candidate_id,
    ranking_id: response.ranking_id,
    shortlist_patch_id: response.shortlist_patch_id,
    shot_id: clicked.shot_id,
    tracklet_id: clicked.tracklet_id,
  };
  const valid = {
    tracking_job_id: "tracking_1",
    selection_id: selection.selection_id,
    selected_candidate_id: clicked.candidate_id,
    selected_shot_id: clicked.shot_id,
    selected_reference_frame: clicked.best_frame,
    selected_bbox: [1, 2, 3, 4],
    anchor_mode: EXPECTED_ANCHOR_MODE,
  };
  for (const bad of [
    { selected_candidate_id: "other" },
    { selected_shot_id: "other" },
    { selected_reference_frame: 0 },
    { anchor_mode: "SCENE_FRAME_ZERO" },
    { selected_bbox: [0, 0, 0, 0] },
  ]) {
    assert.throws(() => validateTrackingHandoff({ ...valid, ...bad }, selection, clicked), new RegExp(PROVENANCE_ERROR_CODE));
  }
});

test("fragment duplicate는 Top 5에서 분리하고 ID를 치환하지 않는다", () => {
  const candidates = normalizeCandidateRecommendations(fixture({
    candidates: [
      ...fixture().candidates,
      candidate("candidate-fragment", 6, { possible_fragment_duplicate: true }),
    ],
  }));
  const groups = splitCandidateRecommendations(candidates);
  assert.deepEqual(groups.primary.map((item) => item.candidate_id), expectedIds);
  assert.equal(groups.fragmentedDuplicates[0].candidate_id, "candidate-fragment");
});

test("UNREVIEWABLE_LOW_RESOLUTION은 TARGET_ABSENT로 매핑되지 않는다", () => {
  assert.deepEqual(buildCandidateReviewPayload({
    state: "UNREVIEWABLE_LOW_RESOLUTION",
    candidateId: expectedIds[2],
  }), {
    state: "UNREVIEWABLE_LOW_RESOLUTION",
    candidate_id: expectedIds[2],
    note: "",
  });
});

test("TARGET_ABSENT는 두 evidence SHA가 모두 있어야 한다", () => {
  assert.throws(() => buildCandidateReviewPayload({ state: "TARGET_ABSENT" }), new RegExp(PROVENANCE_ERROR_CODE));
  assert.deepEqual(buildCandidateReviewPayload({
    state: "TARGET_ABSENT",
    fullFrameContextSha256: "a".repeat(64),
    shotClipSha256: "b".repeat(64),
  }), {
    state: "TARGET_ABSENT",
    candidate_id: null,
    full_frame_context_sha256: "a".repeat(64),
    shot_clip_sha256: "b".repeat(64),
    note: "The selected target is absent from the full shot.",
  });
});

test("NONE_OF_THESE 계열도 exact evidence SHA와 candidate_id null을 사용한다", () => {
  for (const state of ["NONE_OF_THESE", "NONE_OF_THESE_NON_PLAYER_ROLE"]) {
    const payload = buildCandidateReviewPayload({
      state,
      fullFrameContextSha256: "c".repeat(64),
      shotClipSha256: "d".repeat(64),
    });
    assert.equal(payload.candidate_id, null);
    assert.equal(payload.full_frame_context_sha256, "c".repeat(64));
    assert.equal(payload.shot_clip_sha256, "d".repeat(64));
  }
});

test("automatic confirmation과 잘못된 ranking version을 차단한다", () => {
  assert.equal(validateCandidateRecommendationResponse(fixture()).automatic_target_confirmation, false);
  assert.throws(
    () => validateCandidateRecommendationResponse(fixture({ ranking_version: "v1.1" })),
    new RegExp(PROVENANCE_ERROR_CODE),
  );
  assert.throws(
    () => validateCandidateRecommendationResponse(fixture({ automatic_target_confirmation: true })),
    new RegExp(PROVENANCE_ERROR_CODE),
  );
});

test("409 detail.code를 일반 tracking failed로 뭉개지 않는다", () => {
  assert.equal(errorDisplayCode({
    status: 409,
    code: "TRACKLET_IDENTITY_INCONSISTENT",
    detail: "identity conflict",
  }), "TRACKLET_IDENTITY_INCONSISTENT");
  assert.equal(errorDisplayCode({
    status: 409,
    data: { detail: { code: "INSUFFICIENT_REVIEWABLE_TARGET_REFERENCE" } },
  }), "INSUFFICIENT_REVIEWABLE_TARGET_REFERENCE");
});
