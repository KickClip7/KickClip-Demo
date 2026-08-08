import test from "node:test";
import assert from "node:assert/strict";
import { kickclipApi } from "../src/api/kickclipApi.js";
import {
  CandidatePreparationFailedError,
  candidatePreparationDetail,
  candidateRecommendationScopeKey,
  findScenePreparationTask,
  loadCandidateRecommendations,
} from "../src/domain/candidateRecommendationPreparation.js";

const scope = {
  projectId: "project_child",
  revisionId: "revision_child",
  eventId: "event_1",
  sceneId: "scene_1",
};

function task(status, overrides = {}) {
  return {
    task_id: "saitask_1",
    status,
    status_url: "/api/v1/scene-ai-tasks/saitask_1",
    result: {},
    ...overrides,
  };
}

function notPrepared(detail = {}) {
  return Object.assign(new Error("Candidate recommendation preparation is running."), {
    status: 409,
    data: {
      detail: {
        code: "CANDIDATE_RECOMMENDATION_NOT_PREPARED",
        message: "Candidate recommendation preparation is running.",
        reason: "PREPARATION_RUNNING",
        ...detail,
      },
    },
  });
}

test("prepare API는 현재 scope 경로와 shortlist_size 5를 사용한다", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = {
    localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    dispatchEvent: () => {},
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(task("QUEUED")), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.prepareEventCandidateRecommendations(...Object.values(scope));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
  assert.match(requests[0].url, /\/projects\/project_child\/highlight\/revisions\/revision_child\/events\/event_1\/candidate-recommendations\/prepare\?scene_id=scene_1$/);
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { shortlist_size: 5 });
});

test("409 detail을 구조적으로 파싱하고 scope key에 revision을 포함한다", () => {
  const error = notPrepared({ preparation_task: task("RUNNING") });
  assert.equal(candidatePreparationDetail(error).reason, "PREPARATION_RUNNING");
  assert.equal(candidateRecommendationScopeKey(scope), "project_child:revision_child:event_1:scene_1");
});

test("scene select 응답에서 현재 scene task만 선택한다", () => {
  const selected = findScenePreparationTask({
    candidate_discovery: {
      recommendation_preparation: [
        { scene_id: "scene_other", task_id: "wrong" },
        { scene_id: "scene_1", task_id: "right" },
      ],
    },
  }, "scene_1");
  assert.equal(selected.task_id, "right");
});

test("PREPARATION_RUNNING은 fatal 처리하지 않고 status_url polling 후 GET을 재호출한다", async () => {
  let recommendationCalls = 0;
  let prepareCalls = 0;
  const polled = [];
  const states = [];
  const api = {
    async getEventCandidateRecommendations(...args) {
      recommendationCalls += 1;
      assert.deepEqual(args.slice(0, 4), Object.values(scope));
      if (recommendationCalls === 1) throw notPrepared({ preparation_task: task("RUNNING") });
      return { ranking_version: "v1.2", candidates: [{ candidate_id: "candidate_1" }] };
    },
    async prepareEventCandidateRecommendations() { prepareCalls += 1; },
    async getSceneAiTask(statusUrl) {
      polled.push(statusUrl);
      return task("COMPLETED", { result: { ready: true } });
    },
  };
  const result = await loadCandidateRecommendations({
    api,
    ...scope,
    delay: async () => {},
    onState: ({ phase }) => states.push(phase),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(recommendationCalls, 2);
  assert.equal(prepareCalls, 0);
  assert.deepEqual(polled, ["/api/v1/scene-ai-tasks/saitask_1"]);
  assert.ok(states.includes("preparing"));
  assert.equal(states.at(-1), "loading");
});

test("task 정보가 없는 NOT_PREPARED는 prepare를 정확히 한 번 호출하고 RUNNING 중 반복하지 않는다", async () => {
  let recommendationCalls = 0;
  let prepareCalls = 0;
  const polledStatuses = [task("RUNNING"), task("COMPLETED", { result: { ready: true } })];
  const api = {
    async getEventCandidateRecommendations() {
      recommendationCalls += 1;
      if (recommendationCalls === 1) throw notPrepared({
        reason: "BUNDLE_MISSING",
        preparation_task: null,
        prepare_url: "/api/v1/projects/project_child/highlight/revisions/revision_child/events/event_1/candidate-recommendations/prepare?scene_id=scene_1",
      });
      return { ranking_version: "v1.2", candidates: [] };
    },
    async prepareEventCandidateRecommendations(projectId, revisionId, eventId, sceneId, options) {
      prepareCalls += 1;
      assert.deepEqual([projectId, revisionId, eventId, sceneId], Object.values(scope));
      assert.equal(options.shortlistSize, 5);
      assert.match(options.prepareUrl, /candidate-recommendations\/prepare/);
      return task("QUEUED");
    },
    async getSceneAiTask() { return polledStatuses.shift(); },
  };
  await loadCandidateRecommendations({ api, ...scope, delay: async () => {} });
  assert.equal(prepareCalls, 1);
  assert.equal(recommendationCalls, 2);
});

test("select가 준 child revision task를 즉시 polling하고 parent revision을 사용하지 않는다", async () => {
  const recommendationScopes = [];
  let prepareCalls = 0;
  const api = {
    async getEventCandidateRecommendations(projectId, revisionId, eventId, sceneId) {
      recommendationScopes.push({ projectId, revisionId, eventId, sceneId });
      return { ranking_version: "v1.2", candidates: [{}, {}] };
    },
    async prepareEventCandidateRecommendations() { prepareCalls += 1; },
    async getSceneAiTask() { return task("COMPLETED", { result: { ready: true } }); },
  };
  const response = await loadCandidateRecommendations({
    api,
    ...scope,
    selectionResponse: {
      revision_id: "revision_child",
      candidate_discovery: { recommendation_preparation: [{ ...task("QUEUED"), scene_id: "scene_1" }] },
    },
    delay: async () => {},
  });
  assert.equal(response.candidates.length, 2);
  assert.deepEqual(recommendationScopes, [scope]);
  assert.notEqual(recommendationScopes[0].revisionId, "revision_parent");
  assert.equal(prepareCalls, 0);
});

test("FAILED일 때만 preparation failure를 만들고 error_message/retry_url/scope를 보존한다", async () => {
  const failed = task("FAILED", { error_message: "worker failed", retry_url: "/api/v1/scene-ai-tasks/saitask_1/retry" });
  await assert.rejects(
    loadCandidateRecommendations({
      api: { async getEventCandidateRecommendations() { throw notPrepared({ preparation_task: failed }); } },
      ...scope,
    }),
    (error) => error instanceof CandidatePreparationFailedError
      && error.message === "worker failed"
      && error.retryUrl.endsWith("/retry")
      && error.scope.revisionId === "revision_child",
  );
});

test("revision 변경 또는 unmount의 AbortSignal은 polling timer와 stale 완료 반영을 막는다", async () => {
  const controller = new AbortController();
  let recommendationCalls = 0;
  let pollCalls = 0;
  const phases = [];
  const promise = loadCandidateRecommendations({
    api: {
      async getEventCandidateRecommendations() {
        recommendationCalls += 1;
        throw notPrepared({ preparation_task: task("RUNNING") });
      },
      async getSceneAiTask() { pollCalls += 1; return task("COMPLETED"); },
    },
    ...scope,
    signal: controller.signal,
    delay: async () => {
      controller.abort();
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
    },
    onState: ({ phase }) => phases.push(phase),
  });
  await assert.rejects(promise, (error) => error.name === "AbortError");
  assert.equal(recommendationCalls, 1);
  assert.equal(pollCalls, 0);
  assert.deepEqual(phases, ["loading", "preparing"]);
});
