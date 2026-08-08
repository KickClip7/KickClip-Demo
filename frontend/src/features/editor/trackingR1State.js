export const R1_EXECUTION_KIND = "EVENT_CANDIDATE_HANDOFF_R1";
export const LEGACY_EXECUTION_KIND = "LEGACY_TARGET_TRACKING";
export const MAX_CROSS_SHOT_REVIEW_CANDIDATES = 3;

export const TRACKING_RENDER_MODES = Object.freeze({
  TARGET_CENTERED: "TARGET_CENTERED",
  HOLD_LAST_STABLE: "HOLD_LAST_STABLE",
  FULL_FRAME_NON_WIDE: "FULL_FRAME_NON_WIDE",
  FULL_FRAME_FALLBACK: "FULL_FRAME_FALLBACK",
});

export const TERMINAL_TRACKING_STATUSES = Object.freeze([
  "COMPLETED",
  "COMPLETED_WITH_UNRESOLVED_GAPS",
  "COMPLETED_SAFE_BLOCK",
  "FAILED",
  "CANCELLED",
]);

export function trackingExecutionKind(job) {
  return String(job?.execution_kind || "").toUpperCase();
}

export function isR1TrackingJob(job) {
  return trackingExecutionKind(job) === R1_EXECUTION_KIND;
}

export function isTerminalTrackingStatus(status) {
  return TERMINAL_TRACKING_STATUSES.includes(String(status || "").toUpperCase());
}

export function trackingPollDelay(job) {
  const status = String(job?.status || "").toUpperCase();
  if (isTerminalTrackingStatus(status)) return null;
  if (status.startsWith("WAITING_")) return 4000;
  return ["QUEUED", "RUNNING"].includes(status) ? 1800 : 3000;
}

function updatedAtMillis(job) {
  const value = Date.parse(job?.updated_at || "");
  return Number.isFinite(value) ? value : 0;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function frameBbox(frame) {
  const value = frame?.bbox ?? frame?.bbox_xyxy ?? null;
  return Array.isArray(value)
    && value.length === 4
    && value.every(Number.isFinite)
    && value[2] > value[0]
    && value[3] > value[1]
    ? value
    : null;
}

// A delayed GET must never put an already-reviewed ambiguity back on screen.
export function chooseFreshTrackingJob(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  const currentId = current.tracking_job_id || current.job_id;
  const incomingId = incoming.tracking_job_id || incoming.job_id;
  if (currentId && incomingId && currentId !== incomingId) return current;

  const currentTime = updatedAtMillis(current);
  const incomingTime = updatedAtMillis(incoming);
  if (currentTime && incomingTime && incomingTime < currentTime) return current;
  if (
    currentTime === incomingTime
    && current.pending_ambiguity_id
    && !incoming.pending_ambiguity_id
  ) return incoming;
  if (
    currentTime === incomingTime
    && !current.pending_ambiguity_id
    && incoming.pending_ambiguity_id
  ) return current;
  return incoming;
}

export function normalizeTimelineFrames(response) {
  const frames = Array.isArray(response) ? response : response?.frames || response?.timeline || [];

  return frames.map((frame) => {
    const state = upper(frame?.state || frame?.tracking_state);
    const decisionReason = upper(frame?.decision_reason);
    const identitySource = upper(frame?.identity_source);
    const shotMode = upper(frame?.shot_mode || frame?.scene_mode);

    // P1.8 WIDE-only contract:
    // CLOSEUP/MIXED broadcast shots remain in the timeline but target tracking
    // is intentionally disabled. They must render as the original full frame
    // and must not look like an ordinary tracking failure.
    const nonWideExcluded = decisionReason === "NON_WIDE_SHOT_EXCLUDED_FROM_TARGET_TRACKING"
      || identitySource === "WIDE_ONLY_SCENE_POLICY"
      || ["CLOSEUP", "MIXED"].includes(shotMode) && frame?.tracking_allowed === false;

    const bboxAllowed = [
      "INITIALIZING",
      "ACTIVE",
      "REACQUIRED",
      "USER_CONFIRMED",
    ].includes(state) && !nonWideExcluded;

    const bbox = bboxAllowed ? frameBbox(frame) : null;

    let renderMode = TRACKING_RENDER_MODES.FULL_FRAME_FALLBACK;
    if (nonWideExcluded) {
      renderMode = TRACKING_RENDER_MODES.FULL_FRAME_NON_WIDE;
    } else if (bbox) {
      renderMode = TRACKING_RENDER_MODES.TARGET_CENTERED;
    } else if (state === "OCCLUDED") {
      // The editing layer may ease/hold the last trusted target center instead
      // of using an unverified current-frame bbox.
      renderMode = TRACKING_RENDER_MODES.HOLD_LAST_STABLE;
    }

    return {
      ...frame,
      state,
      bbox,
      decision_reason: frame?.decision_reason || "",
      identity_source: frame?.identity_source || "",
      nonWideExcluded,
      renderMode,
    };
  });
}

export function readinessAllows(record, key) {
  return record?.[key] === true;
}

export function terminalTrackingPresentation(job) {
  const status = String(job?.status || "").toUpperCase();
  const outcome = String(job?.outcome || "");
  const failureCode = String(job?.failure_code || "").toUpperCase();
  if (failureCode === "RUNTIME_REJECTION_RESUME_UNSUPPORTED") {
    return {
      tone: "error",
      title: "후보 거절 후 탐색 재개 기능이 백엔드에서 실행되지 않았습니다.",
      outcome,
      detail: failureCode,
    };
  }
  if (status === "COMPLETED") return { tone: "success", title: "트래킹 완료", outcome };
  if (status === "COMPLETED_WITH_UNRESOLVED_GAPS") {
    return { tone: "warning", title: "일부 shot을 해결하지 못한 채 완료", outcome };
  }
  if (status === "COMPLETED_SAFE_BLOCK") {
    return { tone: "safe-block", title: "잘못된 선수 연결을 막기 위해 안전 중단", outcome };
  }
  if (status === "FAILED") {
    return {
      tone: "error",
      title: "트래킹 실패",
      outcome,
      detail: [job?.error?.type, job?.error?.message].filter(Boolean).join(": "),
    };
  }
  if (status === "CANCELLED") return { tone: "neutral", title: "트래킹 취소됨", outcome };
  return null;
}

const reviewIdempotencyKeys = new Map();

function createUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

export function candidateReviewTransition(response = {}) {
  const continuation = String(response.continuation || "TRACKING_RESUMED").toUpperCase();

  // Product contract: one ambiguity is one user decision over at most three
  // tracklet candidates. Legacy REVIEW_NEXT_* continuations must never create
  // an image-by-image or candidate-batch approval loop in the UI. After any
  // submitted decision we return to tracking and refetch the canonical job
  // state. If a genuinely new ambiguity exists in a later WIDE shot, the job
  // state will expose a new pending_ambiguity_id and the normal polling path
  // will open it once. CLOSEUP/MIXED shots are skipped by the WIDE-only runtime
  // and therefore must never create a new review page.
  if (["REVIEW_NEXT_CANDIDATE", "REVIEW_NEXT_BATCH", "SEARCH_NEXT_SHOT"].includes(continuation)) {
    return {
      stage: "tracking",
      refetch: true,
      preparingNextBatch: false,
      legacyPaginationSuppressed: continuation.startsWith("REVIEW_NEXT_"),
    };
  }
  if (continuation === "COMPLETED") {
    return { stage: "terminal", refetch: true, preparingNextBatch: false };
  }
  return { stage: "tracking", refetch: true, preparingNextBatch: false };
}

export function stableReviewIdempotencyKey({ jobId, ambiguityId, state, candidateId }) {
  const actionKey = ["kickclip-r13", jobId, ambiguityId, state, candidateId || "none"]
    .map((value) => encodeURIComponent(String(value)))
    .join(":");
  if (!reviewIdempotencyKeys.has(actionKey)) reviewIdempotencyKeys.set(actionKey, createUuid());
  return reviewIdempotencyKeys.get(actionKey);
}
