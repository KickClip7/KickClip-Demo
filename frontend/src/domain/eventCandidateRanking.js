export const EVENT_CANDIDATE_RANKING_VERSION = "v1.1.2a";
export const EVENT_CANDIDATE_RANKING_TASK_TYPE = "EVENT_CANDIDATE_RANKING_V1_1_2A_SHADOW";
export const PRODUCTION_RECOMMENDATION_UI_BLOCKED = "BLOCKED";

export const SHORTLIST_REASON_LABELS = Object.freeze({
  CUT_ADJACENT_ACTION_CANDIDATE: "컷 인접 액션 후보",
  EVENT_CONTAINING_POST_PHASE_SLOT: "이벤트 포함 이후 구간",
  PRE_EVENT_ACTION_PHASE_SLOT: "이벤트 이전 액션 구간",
  GLOBAL_SCORE_FALLBACK: "전체 점수 기반 보완",
});

export const SHORTLIST_EXCLUSION_LABELS = Object.freeze({
  SHOT_CANDIDATE_CAP: "샷별 후보 수 제한",
  EVENT_CONTAINING_POST_PHASE_CAP: "이벤트 이후 구간 수 제한",
  SHORTLIST_CAPACITY_REACHED: "추천 후보 수 제한 도달",
  INELIGIBLE_RELIABILITY_STATE: "신뢰도 기준 미충족",
});

const TERMINAL_TASK_STATUSES = new Set(["COMPLETED", "FAILED"]);
const UNRELIABLE_RANKING_STATUSES = new Set([
  "UNSUPPORTED_EVENT_CLASS",
  "NO_RELIABLE_SHORTLIST",
]);

function requiredId(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${fieldName} is required`);
  return normalized;
}

/**
 * The backend rejects unknown fields, so construct a new object rather than
 * spreading an event or scene model into the request.
 */
export function buildEventCandidateRankingRequest(input = {}) {
  const shortlistSize = input.shortlist_size ?? input.shortlistSize ?? 5;
  if (!Number.isInteger(shortlistSize) || shortlistSize < 3 || shortlistSize > 5) {
    throw new RangeError("shortlist_size must be an integer between 3 and 5");
  }

  return {
    event_id: requiredId(input.event_id ?? input.eventId, "event_id"),
    scene_id: requiredId(input.scene_id ?? input.sceneId, "scene_id"),
    shortlist_size: shortlistSize,
  };
}

export function normalizeEventCandidateViewModels(candidates = []) {
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: candidate.candidate_id ?? candidate.id,
    shortlistRank: candidate.shortlist_rank ?? null,
    originalGlobalRank: candidate.original_global_rank ?? candidate.rank ?? null,
    recommendationScore: candidate.recommendation_score ?? null,
    reasonCodes: [...(candidate.reason_codes || [])],
    riskCodes: [...(candidate.risk_codes || [])],
    shortlistPatchReasonCodes: [...(candidate.shortlist_patch_reason_codes || [])],
    shortlistPhase: candidate.shortlist_phase ?? null,
    shotId: candidate.shot_id ?? null,
    reliabilityState: candidate.reliability_state ?? null,
    serverShortlistIndex: index,
  }));
}

export function normalizeEventCandidateRankingResult(result = {}) {
  return {
    ...result,
    rankingId: result.ranking_id ?? null,
    artifactId: result.artifact_id ?? null,
    rankingStatus: String(result.ranking_status || "").toUpperCase(),
    featureCompletenessState: String(result.feature_completeness_state || "").toUpperCase(),
    shortlistCandidateIds: [...(result.shortlist_candidate_ids || [])],
    fullGalleryFallbackCandidateIds: [...(result.full_gallery_fallback_candidate_ids || [])],
    outputSha256: result.output_sha256 ?? null,
    // Ranking is advisory in every supported version. Never promote this field
    // into target-selection state, even if a malformed response says otherwise.
    automaticTargetConfirmation: false,
    productionRecommendationUi: String(
      result.production_recommendation_ui || PRODUCTION_RECOMMENDATION_UI_BLOCKED,
    ).toUpperCase(),
  };
}

export function canRetryRankingTask(task) {
  return String(task?.status || "").toUpperCase() === "FAILED" && Boolean(task?.retry_url);
}

export function canShowEventCandidateRecommendations(result, { developerMode = false } = {}) {
  const normalized = normalizeEventCandidateRankingResult(result);
  if (!developerMode && normalized.productionRecommendationUi === PRODUCTION_RECOMMENDATION_UI_BLOCKED) {
    return false;
  }
  return (
    normalized.shortlistCandidateIds.length > 0
    && !UNRELIABLE_RANKING_STATUSES.has(normalized.rankingStatus)
  );
}

export function eventCandidateRankingDisplayState(task, { developerMode = false } = {}) {
  const taskStatus = String(task?.status || "").toUpperCase();
  if (taskStatus === "QUEUED") return { key: "queued", label: "분석 대기 중", tone: "pending" };
  if (taskStatus === "RUNNING") return { key: "running", label: "분석 중", tone: "pending" };
  if (taskStatus === "FAILED") {
    return {
      key: "failed",
      label: "분석 실패",
      detail: task?.error_message || "추천 분석을 완료하지 못했습니다.",
      tone: "danger",
      canRetry: canRetryRankingTask(task),
    };
  }

  if (taskStatus !== "COMPLETED") {
    return { key: "idle", label: "전체 후보 보기", tone: "neutral" };
  }

  const result = normalizeEventCandidateRankingResult(task?.result);
  if (result.rankingStatus === "UNSUPPORTED_EVENT_CLASS") {
    return { key: "unsupported", label: "지원하지 않는 이벤트", tone: "neutral" };
  }
  if (
    result.rankingStatus === "NO_RELIABLE_SHORTLIST"
    || result.shortlistCandidateIds.length === 0
  ) {
    return { key: "unreliable", label: "신뢰할 수 있는 shortlist 없음", tone: "caution" };
  }
  if (!canShowEventCandidateRecommendations(result, { developerMode })) {
    return { key: "blocked", label: "전체 후보 보기", tone: "neutral" };
  }
  if (result.featureCompletenessState === "PARTIAL_FEATURES") {
    return {
      key: "partial",
      label: "일부 feature만 사용됨",
      detail: "제한된 정보로 생성된 시험 추천입니다.",
      tone: "caution",
    };
  }
  return { key: "ready", label: "추천 준비 완료", tone: "success" };
}

export function rankingRiskSummary(riskCodes = []) {
  const codes = new Set(riskCodes);
  if (codes.has("BALL_SIGNAL_UNAVAILABLE") || codes.has("CRITICAL_FEATURES_MISSING")) {
    return "일부 경기 정보가 부족합니다.";
  }
  return "";
}

export function debugRankingCodeLabels(codes = []) {
  return codes.map((code) => (
    SHORTLIST_REASON_LABELS[code]
    || SHORTLIST_EXCLUSION_LABELS[code]
    || "알 수 없는 내부 사유"
  ));
}

export function eventCandidateSections(result, { developerMode = false } = {}) {
  const normalized = normalizeEventCandidateRankingResult(result);
  return {
    recommendationCandidateIds: canShowEventCandidateRecommendations(normalized, { developerMode })
      ? normalized.shortlistCandidateIds
      : [],
    fullGalleryCandidateIds: normalized.fullGalleryFallbackCandidateIds,
    showFullGalleryAction: true,
    showManualEarlierAnchor: true,
  };
}

/**
 * Ranking completion must not mutate an existing target or begin tracking.
 */
export function preserveExplicitTargetSelection(currentCandidateId) {
  return {
    selectedCandidateId: currentCandidateId ?? null,
    targetConfirmed: false,
    startTracking: false,
  };
}

function abortError() {
  return new DOMException("The ranking poll was cancelled.", "AbortError");
}

/** @param {number} ms @param {AbortSignal|undefined} signal @returns {Promise<void>} */
function defaultPollDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

/**
 * Owns one ranking submission at a time. Consumers should call setContext when
 * revision/event/scene changes and dispose from component cleanup.
 */
export function createEventCandidateRankingController({
  api,
  pollIntervalMs = 1800,
  pollDelay = defaultPollDelay,
  onTask = () => {},
} = /** @type {{api?: any, pollIntervalMs?: number, pollDelay?: (ms:number, signal:AbortSignal)=>Promise<void>, onTask?: (task:any)=>void}} */ ({})) {
  if (!api?.createEventCandidateRanking || !api?.getSceneAiTask) {
    throw new TypeError("ranking API methods are required");
  }

  let contextKey = "";
  let activeRun = null;
  let activePromise = null;
  let lastTask = null;

  function cancel() {
    if (activeRun) {
      activeRun.cancelled = true;
      activeRun.abortController.abort();
    }
    activeRun = null;
    activePromise = null;
  }

  /** @param {{revisionId?: string, eventId?: string, sceneId?: string}} [context] */
  function setContext({ revisionId, eventId, sceneId } = {}) {
    const nextKey = JSON.stringify([
      revisionId ?? null,
      eventId ?? null,
      sceneId ?? null,
    ]);
    if (contextKey && contextKey !== nextKey) cancel();
    contextKey = nextKey;
  }

  async function pollFrom(initialTask, run) {
    let task = initialTask;
    while (!run.cancelled) {
      lastTask = task;
      onTask(task);
      const status = String(task?.status || "").toUpperCase();
      if (TERMINAL_TASK_STATUSES.has(status)) return task;
      if (!["QUEUED", "RUNNING"].includes(status)) {
        throw new Error(`Unsupported SceneAITask status: ${status || "EMPTY"}`);
      }
      if (!task?.status_url) throw new Error("SceneAITask status_url is required");
      await pollDelay(pollIntervalMs, run.abortController.signal);
      if (run.cancelled) return null;
      task = await api.getSceneAiTask(task.status_url, {
        signal: run.abortController.signal,
      });
    }
    return null;
  }

  /** @param {(signal: AbortSignal) => Promise<any>} operation */
  function begin(operation) {
    if (activePromise) return activePromise;
    const run = {
      cancelled: false,
      abortController: new AbortController(),
    };
    activeRun = run;
    activePromise = (async () => {
      try {
        const initialTask = await operation(run.abortController.signal);
        if (run.cancelled) return null;
        return await pollFrom(initialTask, run);
      } catch (error) {
        if (run.cancelled || isAbortError(error)) return null;
        throw error;
      } finally {
        if (activeRun === run) {
          activeRun = null;
          activePromise = null;
        }
      }
    })();
    return activePromise;
  }

  /** @param {{projectId?: string, revisionId?: string, eventId?: string, sceneId?: string, shortlistSize?: number}} [input] */
  function submit({
    projectId,
    revisionId,
    eventId,
    sceneId,
    shortlistSize = 5,
  } = {}) {
    setContext({ revisionId, eventId, sceneId });
    return begin((signal) => api.createEventCandidateRanking(
      projectId,
      revisionId,
      buildEventCandidateRankingRequest({
        eventId,
        sceneId,
        shortlistSize,
      }),
      { signal },
    ));
  }

  function retry() {
    if (!canRetryRankingTask(lastTask) || !api.retrySceneAiTask) return null;
    return begin((signal) => api.retrySceneAiTask(lastTask.retry_url, { signal }));
  }

  return {
    submit,
    retry,
    cancel,
    dispose: cancel,
    setContext,
    isSubmitLocked: () => Boolean(activePromise),
    getLastTask: () => lastTask,
  };
}
