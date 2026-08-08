import test from "node:test";
import assert from "node:assert/strict";
import {
  REPLACEMENT_PLAYER_REQUEST,
  allowReplacementRetry,
  beginReplacementRequest,
  candidateReviewMatchesPending,
  crossShotWaitingContractViolation,
  buildTrackingSelectionPayload,
  prepareReplacementTrackingCandidatesWorkflow,
  selectTrackingSceneStatus,
  shouldAutomaticallyPrepareReplacement,
  trackingAmbiguityDetails,
  isCrossShotConfirmation,
  isResolvedCrossShotAmbiguity,
  normalizeCrossShotCandidates,
  selectedTargetGalleryUrls,
  trackingJobProvenance,
  trackingScoreLabel,
  trackingConfidenceLabel,
  trackingPendingActionValue,
} from "../src/features/editor/trackingReplacement.js";

test("거절 완료 후 source revision에서 새 player-focus revision을 정확히 한 번 만든다", async () => {
  const calls = [];
  const api = {
    async startHighlightPlayerFocus(projectId, payload) {
      calls.push({ type: "focus", projectId, payload });
      return { revision_id: "revision_new" };
    },
    async getHighlightPlayerCandidates(projectId) {
      calls.push({ type: "candidates", projectId });
      return {
        revision: { revision_id: "revision_new" },
        candidates: [{
          candidate_id: "candidate_2",
          scene_id: "scene_1",
          display_label: "7번 선수",
          thumbnail_url: "/candidate-2.jpg",
        }],
      };
    },
  };
  let receivedPredicate = null;

  const result = await prepareReplacementTrackingCandidatesWorkflow({
    api,
    projectId: "project_1",
    sourceRevisionId: "revision_rejected",
    sceneId: "scene_1",
    waitForHighlightStatus: async (predicate) => {
      receivedPredicate = predicate;
      return {
        revision: {
          revision_id: "revision_new",
          status: "PLAYER_SELECTION_REQUIRED",
        },
      };
    },
  });

  assert.equal(calls.filter((call) => call.type === "focus").length, 1);
  assert.deepEqual(calls[0], {
    type: "focus",
    projectId: "project_1",
    payload: {
      revision_id: "revision_rejected",
      request: REPLACEMENT_PLAYER_REQUEST,
    },
  });
  assert.equal(receivedPredicate({
    revision: { revision_id: "revision_new", status: "PLAYER_SELECTION_REQUIRED" },
  }), true);
  assert.equal(result.revisionId, "revision_new");
  assert.equal(result.candidates[0].id, "candidate_2");
  assert.equal(result.candidates[0].displayName, "7번 선수");
});

test("새 후보 선택 payload에는 거절된 revision이 아닌 새 revisionId를 전달한다", () => {
  const payload = buildTrackingSelectionPayload({
    revisionId: "revision_new",
    sceneId: "scene_1",
    candidate: {
      candidate_id: "candidate_2",
      displayName: "7번 선수",
    },
  });

  assert.deepEqual(payload, {
    revision_id: "revision_new",
    display_name: "7번 선수",
    anchor_scene_id: "scene_1",
    candidate_id: "candidate_2",
  });
  assert.notEqual(payload.revision_id, "revision_rejected");
});

test("polling이 반복되어도 replacement revision 생성 guard는 첫 요청만 허용한다", () => {
  const requestRef = { current: false };

  assert.equal(beginReplacementRequest(requestRef), true);
  assert.equal(beginReplacementRequest(requestRef), false);
  assert.equal(beginReplacementRequest(requestRef), false);

  allowReplacementRetry(requestRef);
  assert.equal(beginReplacementRequest(requestRef), true);
});

test("approve 또는 일반 완료에서는 재선택 흐름을 시작하지 않는다", () => {
  assert.equal(shouldAutomaticallyPrepareReplacement("COMPLETED", false), false);
  assert.equal(shouldAutomaticallyPrepareReplacement("COMPLETED", true), false);
  assert.equal(shouldAutomaticallyPrepareReplacement("COMPLETED_SAFE_BLOCK", false), false);
  assert.equal(shouldAutomaticallyPrepareReplacement("COMPLETED_SAFE_BLOCK", true), false);
});

test("candidate_ids 순서를 보존하면서 이미 처리된 상태 후보를 제외한다", () => {
  const candidates = normalizeCrossShotCandidates({
    candidateIds: ["candidate-a", "candidate-b", "candidate-c"],
    candidates: [
      { candidate_id: "candidate-a", status: "EXCLUDED" },
      { candidate_id: "candidate-b", status: "PENDING" },
      { candidate_id: "candidate-c", status: "UNREVIEWABLE_LOW_RESOLUTION" },
    ],
  });
  assert.deepEqual(candidates.map((candidate) => candidate.candidate_id), ["candidate-b"]);
});

test("재탐지 API 오류는 실제 오류 메시지를 그대로 전달한다", async () => {
  const apiError = new Error("후보 탐지 서비스가 일시적으로 중단되었습니다.");
  const api = {
    async startHighlightPlayerFocus() {
      throw apiError;
    },
    async getHighlightPlayerCandidates() {
      throw new Error("호출되지 않아야 합니다.");
    },
  };

  await assert.rejects(
    prepareReplacementTrackingCandidatesWorkflow({
      api,
      projectId: "project_1",
      sourceRevisionId: "revision_rejected",
      sceneId: "scene_1",
      waitForHighlightStatus: async () => {
        throw new Error("호출되지 않아야 합니다.");
      },
    }),
    /후보 탐지 서비스가 일시적으로 중단되었습니다/,
  );
});

test("R1 dynamic candidates can come from pending_candidates or next_ambiguity", () => {
  const pending = trackingAmbiguityDetails({
    pending_ambiguity_id: "ambiguity-a",
    pending_candidates: [{ candidate_id: "candidate-a", shot_id: "shot-a" }],
  });
  assert.equal(pending.candidates[0].candidate_id, "candidate-a");

  const next = trackingAmbiguityDetails({
    next_ambiguity: {
      ambiguity_id: "ambiguity-b",
      candidate_ids: ["candidate-b"],
      candidates: [{ candidate_id: "candidate-b", tracklet_id: "tracklet-b" }],
      full_frame_context_sha256: "a".repeat(64),
      shot_clip_sha256: "b".repeat(64),
    },
  });
  assert.equal(next.ambiguityId, "ambiguity-b");
  assert.deepEqual(next.candidateIds, ["candidate-b"]);
  assert.equal(next.fullFrameContextSha256, "a".repeat(64));
  assert.equal(next.shotClipSha256, "b".repeat(64));

  const dbAuthoritative = trackingAmbiguityDetails({
    pending_ambiguity_id: "ambiguity-c",
    pending_action: {
      ambiguity_id: "ambiguity-c",
      candidate_ids: ["rejected", "candidate-c"],
      candidates: [
        { candidate_id: "rejected", status: "PENDING" },
        { candidate_id: "candidate-c", status: "PENDING" },
      ],
    },
    next_ambiguity: {
      ambiguity_id: "ambiguity-c",
      candidate_ids: ["candidate-c"],
      candidates: [{ candidate_id: "candidate-c", status: "PENDING" }],
    },
  });
  assert.deepEqual(dbAuthoritative.candidateIds, ["candidate-c"]);
  assert.deepEqual(dbAuthoritative.candidates.map((row) => row.candidate_id), ["candidate-c"]);
});

test("상태 복원은 현재 scene/event와 일치하는 트래킹만 선택하고 여러 장면을 추측하지 않는다", () => {
  const statuses = [
    { scene_id: "scene_1", event_id: "event_1" },
    { scene_id: "scene_2", timeline_event_id: "event_2" },
  ];

  assert.equal(
    selectTrackingSceneStatus(statuses, { sceneId: "scene_2" }).scene_id,
    "scene_2",
  );
  assert.equal(
    selectTrackingSceneStatus(statuses, { eventId: "event_1" }).scene_id,
    "scene_1",
  );
  assert.equal(selectTrackingSceneStatus(statuses, { eventId: "unknown" }), null);
  assert.equal(
    selectTrackingSceneStatus([{ scene_id: "only_scene" }], {}).scene_id,
    "only_scene",
  );
});

test("추가 선수 확인은 ambiguity id와 후보를 읽되 자동 후보를 선택하지 않는다", () => {
  const details = trackingAmbiguityDetails({
    pending_ambiguity_id: "ambiguity_1",
    pending_action: {
      type: "CONFIRM_AMBIGUITY",
      ambiguity_id: "ambiguity_1",
      candidate_ids: ["candidate_2", "candidate_3"],
      message: "겹침 구간 확인 필요",
    },
  });

  assert.deepEqual(details, {
    ambiguityId: "ambiguity_1",
    pendingAmbiguityId: "ambiguity_1",
    currentAmbiguityId: "ambiguity_1",
    candidateIds: ["candidate_2", "candidate_3"],
    candidates: [],
    status: null,
    message: "겹침 구간 확인 필요",
    fullFrameContextUrl: "",
    shotClipUrl: "",
    fullFrameContextSha256: "",
    shotClipSha256: "",
  });
  assert.equal("selectedCandidateId" in details, false);
  assert.equal(
    trackingPendingActionValue({}, { pending_action: { type: "CONFIRM_AMBIGUITY" } }),
    "CONFIRM_AMBIGUITY",
  );
});

test("pending_ambiguity_id만 현재 ambiguity source of truth로 사용한다", () => {
  const job = {
    job_id: "trk_dc6ef57e4fbc",
    selection_id: "ecselr1_61136aa579dc",
    selected_candidate_id: "candidate-charlie",
    anchor_frame: 342,
    status: "WAITING_CANDIDATE_REVIEW",
    pending_ambiguity_id: "ambiguity_0001",
    ambiguities: [
      { ambiguity_id: "ambiguity_0003", status: "PENDING", candidate_ids: ["legacy"] },
      { ambiguity_id: "ambiguity_0001", candidate_ids: ["current"] },
    ],
  };
  const details = trackingAmbiguityDetails(job);
  assert.equal(details.ambiguityId, "ambiguity_0001");
  assert.equal(details.currentAmbiguityId, "ambiguity_0001");
  assert.deepEqual(details.candidateIds, ["current"]);
  assert.equal(candidateReviewMatchesPending(job, "ambiguity_0001"), true);
  assert.equal(candidateReviewMatchesPending(job, "ambiguity_0003"), false);
  assert.deepEqual(trackingJobProvenance(job), {
    trackingJobId: "trk_dc6ef57e4fbc",
    selectionId: "ecselr1_61136aa579dc",
    selectedCandidateId: "candidate-charlie",
    anchorFrame: 342,
    pendingAmbiguityId: "ambiguity_0001",
    backendStatus: "WAITING_CANDIDATE_REVIEW",
  });
});

test("선택 대상 reference gallery는 backend URL 순서를 보존한다", () => {
  assert.deepEqual(selectedTargetGalleryUrls({
    selected_target_reference_gallery_urls: ["/target/1.jpg", "/target/2.jpg"],
  }), [
    "http://127.0.0.1:8000/target/1.jpg",
    "http://127.0.0.1:8000/target/2.jpg",
  ]);
});

test("후보 신뢰도가 없으면 0%가 아니라 정보 없음으로 표시한다", () => {
  assert.equal(trackingConfidenceLabel({}), "신뢰도 정보 없음");
  assert.equal(trackingConfidenceLabel({ confidence: 0.824 }), "신뢰도 82%");
  assert.equal(trackingConfidenceLabel({ trackability_score: 76 }), "신뢰도 76%");
});

test("CROSS_SHOT_CONFIRMATION을 전용 action으로 정확히 판별한다", () => {
  assert.equal(isCrossShotConfirmation({}, {
    pending_action: { type: "CROSS_SHOT_CONFIRMATION" },
  }), true);
  assert.equal(isCrossShotConfirmation({}, {
    pending_action: { type: "REVIEW_TRACKING_SEGMENT" },
  }), false);
});

test("cross-shot 후보 ID만 있어도 순서를 유지하며 빈 이미지 상태를 만든다", () => {
  const candidates = normalizeCrossShotCandidates({
    candidateIds: ["candidate-alpha", "candidate-bravo"],
    candidates: [{
      candidate_id: "candidate-alpha",
      rank: 1,
      score: 0.9131,
      frame_image_urls: ["/frames/1.jpg", "/frames/2.jpg"],
    }],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.candidate_id), [
    "candidate-alpha",
    "candidate-bravo",
  ]);
  assert.equal(candidates[0].frameImageUrls.length, 2);
  assert.equal(candidates[1].frameImageUrls.length, 0);
  assert.equal(trackingScoreLabel(candidates[0]), "91.3%");
  assert.equal(trackingScoreLabel(candidates[1]), "매칭 점수 미제공");
});

test("제외된 마지막 후보는 active count에서 빠지고 WAITING 계약 위반으로 판별한다", () => {
  const job = {
    status: "WAITING_CROSS_SHOT_CONFIRMATION",
    pending_ambiguity_id: "ambiguity_phase4b_shot_0004_g002",
    next_ambiguity: {
      ambiguity_id: "ambiguity_phase4b_shot_0004_g002",
      status: "ALL_CANDIDATES_REJECTED",
      candidate_ids: ["candidate-final"],
      candidates: [{ candidate_id: "candidate-final", status: "EXCLUDED" }],
    },
  };
  const details = trackingAmbiguityDetails(job);
  const active = normalizeCrossShotCandidates(details, []);

  assert.equal(active.length, 0);
  assert.equal(isResolvedCrossShotAmbiguity(details), true);
  assert.equal(crossShotWaitingContractViolation(job, active), true);
});
