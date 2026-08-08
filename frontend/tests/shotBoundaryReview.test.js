import test from "node:test";
import assert from "node:assert/strict";
import { kickclipApi } from "../src/api/kickclipApi.js";

import {
  ShotBoundaryReviewRequiredError,
  loadShotBoundaryReviewScope,
  saveShotBoundaryReviewScope,
  shotsFromCuts,
  validateShotCoverage,
} from "../src/domain/shotBoundaryReview.js";
import {
  CandidatePreparationFailedError,
  loadCandidateRecommendations,
} from "../src/domain/candidateRecommendationPreparation.js";


test("cut 추가·삭제·이동의 source of truth는 연속 frame 구간이다", () => {
  const shots = shotsFromCuts([40, 10, 40, 75], 100);
  assert.deepEqual(shots.map((shot) => [shot.start_frame, shot.end_frame_inclusive]), [
    [0, 9], [10, 39], [40, 74], [75, 99],
  ]);
  assert.deepEqual(validateShotCoverage(shots, 100), []);
});

test("gap과 overlap을 confirm 전에 client에서 차단한다", () => {
  assert.match(validateShotCoverage([
    { shot_id: "a", start_frame: 0, end_frame_inclusive: 5 },
    { shot_id: "b", start_frame: 7, end_frame_inclusive: 9 },
  ], 10).join(" "), /gap/);
  assert.match(validateShotCoverage([
    { shot_id: "a", start_frame: 0, end_frame_inclusive: 6 },
    { shot_id: "b", start_frame: 6, end_frame_inclusive: 9 },
  ], 10).join(" "), /overlap/);
});

test("새로고침 복구에는 다섯 ID만 저장한다", () => {
  const originalWindow = globalThis.window;
  const memory = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  } };
  try {
    saveShotBoundaryReviewScope({ projectId: "p", revisionId: "r", eventId: "e", sceneId: "s", shots: [{ unsafe: true }] }, "session");
    assert.deepEqual(loadShotBoundaryReviewScope(), {
      projectId: "p", revisionId: "r", eventId: "e", sceneId: "s", shotBoundaryReviewSessionId: "session",
    });
  } finally { globalThis.window = originalWindow; }
});

test("SHOT_BOUNDARY_REVIEW_REQUIRED일 때만 review state를 prepare한다", async () => {
  const scope = { projectId: "p", revisionId: "r", eventId: "e", sceneId: "s" };
  const error = Object.assign(new Error("not ready"), {
    status: 409,
    data: { detail: { code: "SHOT_BOUNDARY_REVIEW_REQUIRED", review_status: "NOT_PREPARED" } },
  });
  let prepared = 0;
  const api = {
    async getEventCandidateRecommendations() { throw error; },
    async getShotBoundaryReview() { return { status: "NOT_PREPARED" }; },
    async prepareShotBoundaryReview() { prepared += 1; return { status: "WAITING_REVIEW", shots: [] }; },
  };
  await assert.rejects(
    loadCandidateRecommendations({ api, ...scope }),
    (reason) => reason instanceof ShotBoundaryReviewRequiredError && reason.reviewState.status === "WAITING_REVIEW",
  );
  assert.equal(prepared, 1);
});

test("자동 경계 gate가 통과하면 human review API 없이 후보를 바로 조회한다", async () => {
  const scope = { projectId: "p", revisionId: "r", eventId: "e", sceneId: "s" };
  let reviewCalls = 0;
  const result = await loadCandidateRecommendations({
    ...scope,
    api: {
      async getEventCandidateRecommendations() {
        return { candidates: [{ candidate_id: "candidate-1" }] };
      },
      async getShotBoundaryReview() { reviewCalls += 1; },
      async prepareShotBoundaryReview() { reviewCalls += 1; },
    },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(reviewCalls, 0);
});

test("장면 경계 다시 검토는 new_review_revision=true로 새 session을 요청한다", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = {
    localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    dispatchEvent: () => {},
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ status: "WAITING_REVIEW" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.prepareShotBoundaryReview("p", "r", "e", "s", {
      newReviewRevision: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
  assert.match(
    requests[0].url,
    /shot-boundaries\/prepare\?scene_id=s&new_review_revision=true$/,
  );
  assert.equal(requests[0].options.method, "POST");
});

test("frozen runtime 계약 오류는 재검토 가능한 scope를 보존한다", async () => {
  const scope = { projectId: "p", revisionId: "r", eventId: "e", sceneId: "s" };
  const api = {
    async getEventCandidateRecommendations() {
      throw Object.assign(new Error("invalid contract"), {
        status: 409,
        data: { detail: {
          code: "REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID",
          message: "Confirmed shot boundaries are incompatible with Scene Target Selection.",
          detail: { reason: "SHOT_INDEXES_NOT_CONTIGUOUS" },
        } },
      });
    },
  };
  await assert.rejects(
    loadCandidateRecommendations({ api, ...scope }),
    (error) => error instanceof CandidatePreparationFailedError
      && error.code === "REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID"
      && error.contractReason === "SHOT_INDEXES_NOT_CONTIGUOUS"
      && error.scope.revisionId === "r",
  );
});
