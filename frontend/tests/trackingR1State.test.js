import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateReviewTransition,
  chooseFreshTrackingJob,
  isR1TrackingJob,
  normalizeTimelineFrames,
  stableReviewIdempotencyKey,
  terminalTrackingPresentation,
  trackingPollDelay,
} from "../src/features/editor/trackingR1State.js";

test("execution_kind로 R1과 legacy를 구분한다", () => {
  assert.equal(isR1TrackingJob({ execution_kind: "EVENT_CANDIDATE_HANDOFF_R1" }), true);
  assert.equal(isR1TrackingJob({ execution_kind: "LEGACY_TARGET_TRACKING" }), false);
});

test("실행 상태는 빠르게, review 대기는 낮은 빈도로 polling하고 terminal에서 멈춘다", () => {
  assert.equal(trackingPollDelay({ status: "QUEUED" }), 1800);
  assert.equal(trackingPollDelay({ status: "RUNNING" }), 1800);
  assert.equal(trackingPollDelay({ status: "WAITING_CROSS_SHOT_CONFIRMATION" }), 4000);
  assert.equal(trackingPollDelay({ status: "WAITING_MEMORY_REVIEW" }), 4000);
  assert.equal(trackingPollDelay({ status: "WAITING_SEGMENT_REVIEW" }), 4000);
  for (const status of ["COMPLETED", "COMPLETED_WITH_UNRESOLVED_GAPS", "COMPLETED_SAFE_BLOCK", "FAILED", "CANCELLED"]) {
    assert.equal(trackingPollDelay({ status }), null);
  }
});

test("updated_at이 오래된 응답과 처리 전 ambiguity를 복원하는 응답을 버린다", () => {
  const current = { job_id: "job-a", status: "RUNNING", pending_ambiguity_id: null, updated_at: "2026-08-01T10:00:01Z" };
  const stale = { job_id: "job-a", status: "WAITING_CROSS_SHOT_CONFIRMATION", pending_ambiguity_id: "ambiguity-a", updated_at: "2026-08-01T10:00:00Z" };
  assert.equal(chooseFreshTrackingJob(current, stale), current);
  assert.equal(chooseFreshTrackingJob(current, { ...stale, updated_at: current.updated_at }), current);
});

test("null bbox는 비활성 timeline state에서 유효하다", () => {
  const frames = normalizeTimelineFrames({ frames: [
    { state: "ACTIVE", bbox: [1, 2, 3, 4] },
    { state: "REACQUIRED", bbox_xyxy: [5, 6, 7, 8] },
    { state: "LOST", bbox: null },
    { state: "SEARCHING", bbox: [9, 9, 9, 9] },
    { state: "AMBIGUOUS", bbox: null },
    { state: "ABSENT", bbox: null },
    { state: "TERMINATED", bbox: null },
  ] });
  assert.deepEqual(frames.map((frame) => frame.bbox), [
    [1, 2, 3, 4], [5, 6, 7, 8], null, null, null, null, null,
  ]);
});

test("terminal 결과의 unresolved gaps, safe block, failure를 별도로 표시한다", () => {
  assert.equal(terminalTrackingPresentation({ status: "COMPLETED_WITH_UNRESOLVED_GAPS" }).tone, "warning");
  assert.equal(terminalTrackingPresentation({ status: "COMPLETED_SAFE_BLOCK" }).tone, "safe-block");
  assert.deepEqual(
    terminalTrackingPresentation({ status: "FAILED", error: { type: "RUNTIME", message: "reference invalid" } }),
    { tone: "error", title: "트래킹 실패", outcome: "", detail: "RUNTIME: reference invalid" },
  );
});

test("동일 review 재시도는 같은 idempotency key를 사용한다", () => {
  const input = { jobId: "job-a", ambiguityId: "ambiguity-a", state: "DIFFERENT_PLAYER", candidateId: "candidate-a" };
  assert.equal(stableReviewIdempotencyKey(input), stableReviewIdempotencyKey(input));
  assert.notEqual(stableReviewIdempotencyKey(input), stableReviewIdempotencyKey({ ...input, candidateId: "candidate-b" }));
  assert.match(stableReviewIdempotencyKey(input), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("R14 후보 검토 continuation을 화면 상태로 변환한다", () => {
  assert.deepEqual(candidateReviewTransition({ continuation: "REVIEW_NEXT_CANDIDATE" }), {
    stage: "ambiguity", refetch: true, preparingNextBatch: false,
  });
  assert.deepEqual(candidateReviewTransition({ continuation: "REVIEW_NEXT_BATCH" }), {
    stage: "ambiguity", refetch: true, preparingNextBatch: true,
  });
  assert.equal(candidateReviewTransition({ continuation: "SEARCH_NEXT_SHOT" }).stage, "tracking");
});

test("rejection resume 미지원 safe block은 개발 오류로 표시한다", () => {
  const presentation = terminalTrackingPresentation({
    status: "COMPLETED_SAFE_BLOCK",
    failure_code: "RUNTIME_REJECTION_RESUME_UNSUPPORTED",
  });
  assert.equal(presentation.tone, "error");
  assert.match(presentation.title, /백엔드에서 실행되지 않았습니다/);
});
