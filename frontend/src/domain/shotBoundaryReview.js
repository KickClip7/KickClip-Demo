export const REVIEWED_SHOT_BOUNDARIES_NOT_READY = "REVIEWED_SHOT_BOUNDARIES_NOT_READY";
export const SHOT_BOUNDARY_REVIEW_REQUIRED = "SHOT_BOUNDARY_REVIEW_REQUIRED";
export const SHOT_BOUNDARY_RECOVERY_KEY = "kickclip-shot-boundary-review-scope-v1";
export const SHOT_BOUNDARY_AUTO_READY = "AUTO_READY";
export const SHOT_BOUNDARY_CONFIRMED = "CONFIRMED";
export const SHOT_BOUNDARY_DETECTIONS_READY = "READY";

export function isShotBoundaryReady(reviewState) {
  const status = String(reviewState?.status || "").toUpperCase();
  const detectionsStatus = String(reviewState?.detections_status || "").toUpperCase();
  return (
    detectionsStatus === SHOT_BOUNDARY_DETECTIONS_READY
    && [SHOT_BOUNDARY_AUTO_READY, SHOT_BOUNDARY_CONFIRMED].includes(status)
  );
}

export class ShotBoundaryReviewRequiredError extends Error {
  constructor(scope, reviewState) {
    super("자동 장면 경계 검증에 실패해 수동 복구가 필요합니다.");
    this.name = "ShotBoundaryReviewRequiredError";
    this.code = SHOT_BOUNDARY_REVIEW_REQUIRED;
    this.scope = scope;
    this.reviewState = reviewState;
  }
}

export function saveShotBoundaryReviewScope(scope, reviewSessionId = null) {
  const value = {
    projectId: String(scope.projectId || ""),
    revisionId: String(scope.revisionId || ""),
    eventId: String(scope.eventId || ""),
    sceneId: String(scope.sceneId || ""),
    shotBoundaryReviewSessionId: reviewSessionId ? String(reviewSessionId) : null,
  };
  window.localStorage.setItem(SHOT_BOUNDARY_RECOVERY_KEY, JSON.stringify(value));
  return value;
}

export function clearShotBoundaryReviewScope() {
  window.localStorage.removeItem(SHOT_BOUNDARY_RECOVERY_KEY);
}

export function loadShotBoundaryReviewScope() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SHOT_BOUNDARY_RECOVERY_KEY) || "null");
    if (!value || ["projectId", "revisionId", "eventId", "sceneId"].some((key) => !value[key])) return null;
    return {
      projectId: String(value.projectId),
      revisionId: String(value.revisionId),
      eventId: String(value.eventId),
      sceneId: String(value.sceneId),
      shotBoundaryReviewSessionId: value.shotBoundaryReviewSessionId ? String(value.shotBoundaryReviewSessionId) : null,
    };
  } catch {
    return null;
  }
}

export function validateShotCoverage(shots, frameCount) {
  const errors = [];
  if (!Number.isInteger(frameCount) || frameCount <= 0) return ["전체 frame 수가 올바르지 않습니다."];
  if (!Array.isArray(shots) || !shots.length) return ["최소 한 개의 shot이 필요합니다."];
  const ids = shots.map((shot) => String(shot.shot_id || ""));
  if (ids.some((id) => !id)) errors.push("모든 shot에 ID가 필요합니다.");
  if (new Set(ids).size !== ids.length) errors.push("shot ID가 중복되었습니다.");
  shots.forEach((shot, index) => {
    const start = Number(shot.start_frame);
    const end = Number(shot.end_frame_inclusive);
    if (!Number.isInteger(start) || !Number.isInteger(end)) errors.push(`${ids[index] || index}: frame은 정수여야 합니다.`);
    else if (start > end) errors.push(`${ids[index] || index}: 시작 frame이 끝 frame보다 큽니다.`);
    if (start < 0 || end >= frameCount) errors.push(`${ids[index] || index}: scene frame 범위를 벗어났습니다.`);
  });
  if (Number(shots[0]?.start_frame) !== 0) errors.push("첫 shot은 frame 0에서 시작해야 합니다.");
  if (Number(shots.at(-1)?.end_frame_inclusive) !== frameCount - 1) errors.push(`마지막 shot은 frame ${frameCount - 1}에서 끝나야 합니다.`);
  for (let index = 1; index < shots.length; index += 1) {
    const expected = Number(shots[index - 1].end_frame_inclusive) + 1;
    const actual = Number(shots[index].start_frame);
    if (actual > expected) errors.push(`${ids[index]} 앞에 gap이 있습니다.`);
    if (actual < expected) errors.push(`${ids[index]} 앞에 overlap이 있습니다.`);
  }
  return errors;
}

export function shotsFromCuts(cuts, frameCount) {
  const normalized = [...new Set(cuts.map(Number).filter((frame) => Number.isInteger(frame) && frame > 0 && frame < frameCount))].sort((a, b) => a - b);
  const bounds = [0, ...normalized, frameCount];
  return bounds.slice(0, -1).map((start, index) => ({
    shot_id: `shot_${String(index).padStart(4, "0")}`,
    start_frame: start,
    end_frame_inclusive: bounds[index + 1] - 1,
    review_status: "PENDING",
  }));
}
