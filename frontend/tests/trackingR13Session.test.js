import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACKING_RUNS_STORAGE_KEY,
  findRecoverableTrackingRun,
  loadTrackingRuns,
  saveTrackingRuns,
  trackingRunFromJob,
  upsertTrackingRun,
} from "../src/features/editor/trackingR13Session.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("tracking job id is persisted only with its project, revision, and clip scope", () => {
  const storage = memoryStorage();

  const runs = saveTrackingRuns([{
    projectId: "project-1",
    revisionId: "revision-1",
    editorClipId: "clip-1",
    trackingJobId: "job-1",
    status: "RUNNING",
    accessToken: "secret",
  }], storage);

  assert.equal(runs[0].trackingJobId, "job-1");
  assert.deepEqual(loadTrackingRuns(storage), [{
    projectId: "project-1",
    revisionId: "revision-1",
    editorClipId: "clip-1",
    trackingJobId: "job-1",
  }]);
  assert.doesNotMatch(storage.values.get(TRACKING_RUNS_STORAGE_KEY), /secret|status/);
});

test("legacy unscoped tracking job ids are ignored", () => {
  const storage = memoryStorage();
  storage.setItem(TRACKING_RUNS_STORAGE_KEY, JSON.stringify([
    { trackingJobId: "old-job" },
    { projectId: "project-1", trackingJobId: "also-old-job" },
  ]));

  assert.deepEqual(loadTrackingRuns(storage), []);
});

test("job response stores only scoped recovery fields in memory", () => {
  const first = trackingRunFromJob({
    projectId: "project-1",
    revisionId: "revision-1",
    editorClipId: "clip-1",
    jobId: "job-1",
  }, {
    job_id: "job-1",
    status: "WAITING_CROSS_SHOT_CONFIRMATION",
    pending_ambiguity_id: "ambiguity-2",
    next_ambiguity: { candidate_ids: ["candidate-b"] },
  }, {
    reviewedCandidateIds: ["candidate-a"],
  });

  assert.deepEqual(first, {
    projectId: "project-1",
    revisionId: "revision-1",
    editorClipId: "clip-1",
    trackingJobId: "job-1",
    pendingAmbiguityId: "ambiguity-2",
    currentCandidateId: "candidate-b",
    reviewedCandidateIds: ["candidate-a"],
  });
});

test("only a job from the current project and revision is recoverable", () => {
  const runs = [{
    projectId: "project-1",
    revisionId: "revision-1",
    editorClipId: "clip-1",
    trackingJobId: "active",
  }];

  assert.equal(findRecoverableTrackingRun(runs, {
    projectId: "project-1",
    revisionId: "revision-1",
    editorClipId: "clip-1",
  }).trackingJobId, "active");
  assert.equal(findRecoverableTrackingRun(runs, {
    projectId: "project-1",
    revisionId: "revision-2",
    editorClipId: "clip-1",
  }), null);
  assert.equal(findRecoverableTrackingRun(runs, {
    projectId: "project-2",
    revisionId: "revision-1",
    editorClipId: "clip-1",
  }), null);
  assert.equal(findRecoverableTrackingRun(runs), null);

  const saved = saveTrackingRuns(upsertTrackingRun([], runs[0]), memoryStorage());
  assert.equal(saved[0].trackingJobId, "active");
});
