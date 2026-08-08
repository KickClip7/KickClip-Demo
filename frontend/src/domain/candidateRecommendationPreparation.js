import {
  REVIEWED_SHOT_BOUNDARIES_NOT_READY,
  SHOT_BOUNDARY_REVIEW_REQUIRED,
  ShotBoundaryReviewRequiredError,
  isShotBoundaryReady,
} from "./shotBoundaryReview.js";

export const CANDIDATE_RECOMMENDATION_NOT_PREPARED = "CANDIDATE_RECOMMENDATION_NOT_PREPARED";
export const PREPARATION_RUNNING = "PREPARATION_RUNNING";
export const REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID = "REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID";
export const ACTIVE_PREPARATION_STATUSES = Object.freeze(["QUEUED", "RUNNING"]);

function statusOf(task) {
  return String(task?.status || "").toUpperCase();
}

function abortError() {
  return new DOMException("Candidate recommendation request cancelled.", "AbortError");
}

export function candidateRecommendationScopeKey({ projectId, revisionId, eventId, sceneId }) {
  return [projectId, revisionId, eventId, sceneId].map((value) => String(value || "")).join(":");
}

export function candidatePreparationDetail(error) {
  const detail = error?.data?.detail;
  return error?.status === 409 && detail && typeof detail === "object" ? detail : null;
}

export function findScenePreparationTask(selectionResponse, sceneId) {
  const tasks = selectionResponse?.candidate_discovery?.recommendation_preparation;
  if (!Array.isArray(tasks)) return null;
  return tasks.find((task) => String(task?.scene_id) === String(sceneId)) || null;
}

export class CandidatePreparationFailedError extends Error {
  constructor(task, scope) {
    super(task?.error_message || "선수 후보 준비에 실패했습니다.");
    this.name = "CandidatePreparationFailedError";
    this.task = task;
    this.scope = scope;
    this.retryUrl = task?.retry_url || null;
    this.code = null;
    this.contractReason = null;
  }
}

export function waitForCandidatePreparationDelay(ms, signal) {
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
      resolve(undefined);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function loadCandidateRecommendations({
  api,
  projectId,
  revisionId,
  eventId,
  sceneId,
  selectionResponse,
  signal,
  onState = (_state) => {},
  pollIntervalMs = 2000,
  maxTransientErrors = 3,
  delay = (ms) => waitForCandidatePreparationDelay(ms, signal),
}) {
  const scope = { projectId, revisionId, eventId, sceneId };
  const scopeKey = candidateRecommendationScopeKey(scope);
  if ([projectId, revisionId, eventId, sceneId].some((value) => !value)) {
    throw new TypeError(`Candidate recommendation scope is incomplete: ${scopeKey}`);
  }

  const assertActive = () => {
    if (signal?.aborted) throw abortError();
  };
  const emit = (phase, task = null) => {
    assertActive();
    onState({ phase, task, scope, scopeKey });
  };

  const pollTask = async (initialTask) => {
    let task = initialTask;
    let transientErrors = 0;
    while (ACTIVE_PREPARATION_STATUSES.includes(statusOf(task))) {
      emit("preparing", task);
      await delay(pollIntervalMs);
      assertActive();
      try {
        task = await api.getSceneAiTask(task.status_url, { signal });
        transientErrors = 0;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        transientErrors += 1;
        if (transientErrors > maxTransientErrors) throw error;
      }
    }
    assertActive();
    if (statusOf(task) === "FAILED") {
      emit("failed", task);
      throw new CandidatePreparationFailedError(task, scope);
    }
    if (statusOf(task) !== "COMPLETED") {
      throw new Error(`Unsupported candidate preparation task status: ${statusOf(task) || "UNKNOWN"}`);
    }
    emit("loading", task);
    return task;
  };

  const requestRecommendation = async () => {
    emit("loading");
    return api.getEventCandidateRecommendations(projectId, revisionId, eventId, sceneId, { signal });
  };

  let task = findScenePreparationTask(selectionResponse, sceneId);
  if (task) {
    const status = statusOf(task);
    if (ACTIVE_PREPARATION_STATUSES.includes(status)) await pollTask(task);
    else if (status === "FAILED") throw new CandidatePreparationFailedError(task, scope);
    // A COMPLETED task means the bundle is ready to be fetched immediately.
    return requestRecommendation();
  }

  try {
    return await requestRecommendation();
  } catch (error) {
    const detail = candidatePreparationDetail(error);
    if (
      detail?.code === SHOT_BOUNDARY_REVIEW_REQUIRED
      || detail?.code === REVIEWED_SHOT_BOUNDARIES_NOT_READY
    ) {
      let reviewState = {
        status: detail.review_status || "NOT_PREPARED",
        detections_status: detail.detections_status || null,
        automatic_confirmation: false,
      };

      if (api.getShotBoundaryReview) {
        reviewState = await api.getShotBoundaryReview(
          projectId,
          revisionId,
          eventId,
          sceneId,
          { signal },
        );

        if (
          String(reviewState?.status || "").toUpperCase() === "NOT_PREPARED"
          && api.prepareShotBoundaryReview
        ) {
          reviewState = await api.prepareShotBoundaryReview(
            projectId,
            revisionId,
            eventId,
            sceneId,
            { signal },
          );
        }
      }

      // Normal product flow: the backend validates camera cuts automatically.
      // AUTO_READY is a continuation state, not a user-review state.
      if (isShotBoundaryReady(reviewState)) {
        return requestRecommendation();
      }

      // Manual shot-boundary UI is kept only as a fail-closed recovery path
      // when the automatic boundary contract cannot become ready.
      throw new ShotBoundaryReviewRequiredError(scope, reviewState);
    }
    if (detail?.code === REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID) {
      const failure = new CandidatePreparationFailedError({
        error_message: detail.message,
        contract_reason: detail.detail?.reason,
      }, scope);
      failure.code = REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID;
      failure.contractReason = detail.detail?.reason || null;
      throw failure;
    }
    if (detail?.code !== CANDIDATE_RECOMMENDATION_NOT_PREPARED) throw error;

    task = detail.preparation_task || null;
    const status = statusOf(task);
    if (status === "FAILED") throw new CandidatePreparationFailedError(task, scope);
    if (status === "COMPLETED") return requestRecommendation();
    if (ACTIVE_PREPARATION_STATUSES.includes(status)) {
      await pollTask(task);
      return requestRecommendation();
    }
    if (detail.reason === PREPARATION_RUNNING) {
      // PREPARATION_RUNNING must always identify the existing task; starting a
      // second idempotent prepare request here can still create competing loops.
      throw new Error("Running candidate preparation response is missing preparation_task.status_url.", { cause: error });
    }

    emit("preparing");
    task = await api.prepareEventCandidateRecommendations(
      projectId,
      revisionId,
      eventId,
      sceneId,
      { shortlistSize: 5, prepareUrl: detail.prepare_url, signal },
    );
    const preparedStatus = statusOf(task);
    if (preparedStatus === "FAILED") throw new CandidatePreparationFailedError(task, scope);
    if (ACTIVE_PREPARATION_STATUSES.includes(preparedStatus)) await pollTask(task);
    else if (preparedStatus !== "COMPLETED") {
      throw new Error(`Unsupported candidate preparation task status: ${preparedStatus || "UNKNOWN"}`, { cause: error });
    }
    return requestRecommendation();
  }
}
