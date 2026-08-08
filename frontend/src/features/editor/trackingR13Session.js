export const TRACKING_RUNS_STORAGE_KEY = "kickclip-tracking-r13-runs";

const MAX_STORED_RUNS = 20;
const ALLOWED_KEYS = Object.freeze([
  "projectId",
  "revisionId",
  "editorClipId",
  "trackingJobId",
  "pendingAmbiguityId",
  "currentCandidateId",
  "reviewedCandidateIds",
]);

function safeStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function sanitizeRun(run) {
  return Object.fromEntries(ALLOWED_KEYS
    .filter((key) => run?.[key] !== undefined)
    .map((key) => [key, run[key]]));
}

export function loadTrackingRuns(storage) {
  try {
    const raw = safeStorage(storage)?.getItem(TRACKING_RUNS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Legacy entries without a complete scope must never be restored because
    // their job id cannot be attributed to the currently opened revision.
    return parsed
      .filter((run) => (
        run?.trackingJobId
        && run?.projectId
        && run?.revisionId
        && run?.editorClipId
      ))
      .map(sanitizeRun);
  } catch {
    return [];
  }
}

export function saveTrackingRuns(runs, storage) {
  const sanitized = [...(runs || [])]
    .filter((run) => run?.trackingJobId)
    .map(sanitizeRun)
    .slice(0, MAX_STORED_RUNS);
  safeStorage(storage)?.setItem(TRACKING_RUNS_STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function upsertTrackingRun(runs, patch) {
  if (!patch?.trackingJobId) return runs || [];
  const current = (runs || []).find((run) => run.trackingJobId === patch.trackingJobId) || {};
  const next = sanitizeRun({ ...current, ...patch });
  return [next, ...(runs || []).filter((run) => run.trackingJobId !== patch.trackingJobId)];
}

export function trackingRunFromJob(context, job, previous = {}) {
  const hasCurrentCandidate = Object.prototype.hasOwnProperty.call(
    context || {},
    "currentCandidateId",
  );
  return sanitizeRun({
    projectId: context?.projectId,
    revisionId: context?.revisionId,
    editorClipId: context?.editorClipId,
    trackingJobId: job?.tracking_job_id || job?.job_id || context?.jobId || previous.trackingJobId,
    pendingAmbiguityId: job?.pending_ambiguity_id
      || context?.pendingAmbiguityId
      || null,
    currentCandidateId: hasCurrentCandidate
      ? context.currentCandidateId
      : (job?.next_ambiguity?.candidate_ids?.[0] || previous.currentCandidateId || null),
    reviewedCandidateIds: Array.from(new Set([
      ...(previous.reviewedCandidateIds || []),
      ...(context?.reviewedCandidateIds || []),
    ])),
  });
}

export function findRecoverableTrackingRun(runs, scope = {}) {
  if (!scope.projectId || !scope.revisionId) return null;
  return (runs || []).find((run) => (
    run.trackingJobId
    && run.projectId === scope.projectId
    && run.revisionId === scope.revisionId
    && (!scope.editorClipId || run.editorClipId === scope.editorClipId)
  )) || null;
}
