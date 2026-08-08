import test from "node:test";
import assert from "node:assert/strict";
import { kickclipApi } from "../src/api/kickclipApi.js";
import {
  buildEventCandidateRankingRequest,
  canRetryRankingTask,
  canShowEventCandidateRecommendations,
  createEventCandidateRankingController,
  debugRankingCodeLabels,
  eventCandidateRankingDisplayState,
  eventCandidateSections,
  normalizeEventCandidateRankingResult,
  normalizeEventCandidateViewModels,
  preserveExplicitTargetSelection,
  rankingRiskSummary,
} from "../src/domain/eventCandidateRanking.js";

function installWindow() {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    dispatchEvent: () => {},
  };
  return () => { globalThis.window = originalWindow; };
}

function sceneAiTask(status, overrides = {}) {
  return {
    task_id: "saitask_1",
    task_type: "EVENT_CANDIDATE_RANKING_V1_1_2A_SHADOW",
    status,
    attempt_count: 0,
    max_attempts: 3,
    result: {},
    error_message: null,
    status_url: "/api/v1/scene-ai-tasks/saitask_1",
    retry_url: null,
    ...overrides,
  };
}

test("V1.1.2a request에는 event_id, scene_id, shortlist_size만 포함한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(sceneAiTask("QUEUED")), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await kickclipApi.createEventCandidateRanking("project/1", "revision/2", {
      event_id: "event_3",
      scene_id: "scene_4",
      shortlist_size: 5,
      event_label: "goal",
      event_time_sec: 12,
      event_confidence: 0.98,
      scene_start_sec: 10,
      scene_end_sec: 15,
      shot_boundary: [10, 15],
      candidate_manifest_sha: "must-not-leak",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.match(
    requests[0].url,
    /\/projects\/project%2F1\/highlight\/revisions\/revision%2F2\/event-candidate-rankings\/v1\.1\.2a$/,
  );
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    event_id: "event_3",
    scene_id: "scene_4",
    shortlist_size: 5,
  });
});

test("shortlist_size는 기본값 5와 3~5 범위만 허용한다", () => {
  assert.deepEqual(buildEventCandidateRankingRequest({
    eventId: "event_1",
    sceneId: "scene_1",
  }), {
    event_id: "event_1",
    scene_id: "scene_1",
    shortlist_size: 5,
  });
  assert.throws(
    () => buildEventCandidateRankingRequest({
      eventId: "event_1",
      sceneId: "scene_1",
      shortlistSize: 2,
    }),
    /between 3 and 5/,
  );
});

test("202 QUEUED → RUNNING → COMPLETED SceneAITask를 status_url로 polling한다", async () => {
  const calls = [];
  const tasks = [
    sceneAiTask("RUNNING"),
    sceneAiTask("COMPLETED", {
      result: {
        ranking_id: "ranking_1",
        artifact_id: "artifact_1",
        ranking_status: "PROVISIONAL_SHADOW_ONLY",
        feature_completeness_state: "COMPLETE",
        shortlist_candidate_ids: ["candidate_2", "candidate_1"],
        full_gallery_fallback_candidate_ids: ["candidate_1", "candidate_2", "candidate_3"],
        output_sha256: "abc",
        automatic_target_confirmation: false,
        production_recommendation_ui: "BLOCKED",
      },
    }),
  ];
  const api = {
    async createEventCandidateRanking(projectId, revisionId, body) {
      calls.push({ type: "create", projectId, revisionId, body });
      return sceneAiTask("QUEUED");
    },
    async getSceneAiTask(statusUrl) {
      calls.push({ type: "poll", statusUrl });
      return tasks.shift();
    },
  };
  const statuses = [];
  const controller = createEventCandidateRankingController({
    api,
    pollDelay: async () => {},
    onTask: (task) => statuses.push(task.status),
  });

  const completed = await controller.submit({
    projectId: "project_1",
    revisionId: "revision_1",
    eventId: "event_1",
    sceneId: "scene_1",
  });

  assert.deepEqual(statuses, ["QUEUED", "RUNNING", "COMPLETED"]);
  assert.equal(calls.filter((call) => call.type === "create").length, 1);
  assert.deepEqual(
    calls.filter((call) => call.type === "poll").map((call) => call.statusUrl),
    [
      "/api/v1/scene-ai-tasks/saitask_1",
      "/api/v1/scene-ai-tasks/saitask_1",
    ],
  );
  assert.equal(completed.result.ranking_id, "ranking_1");
});

test("중복 submit은 같은 작업을 공유하고 진행 중에는 잠금 상태다", async () => {
  let createCount = 0;
  let releaseCreate;
  const api = {
    createEventCandidateRanking() {
      createCount += 1;
      return new Promise((resolve) => { releaseCreate = resolve; });
    },
    async getSceneAiTask() {
      throw new Error("terminal task should not poll");
    },
  };
  const controller = createEventCandidateRankingController({ api });
  const context = {
    projectId: "project_1",
    revisionId: "revision_1",
    eventId: "event_1",
    sceneId: "scene_1",
  };

  const first = controller.submit(context);
  const second = controller.submit(context);
  assert.equal(first, second);
  assert.equal(controller.isSubmitLocked(), true);
  assert.equal(createCount, 1);

  releaseCreate(sceneAiTask("COMPLETED"));
  await first;
  assert.equal(controller.isSubmitLocked(), false);
});

test("FAILED는 error_message를 표시하고 retry_url이 있을 때만 재시도한다", async () => {
  const retriedUrls = [];
  let pollCount = 0;
  const failed = sceneAiTask("FAILED", {
    error_message: "ranking worker failed",
    retry_url: "/api/v1/scene-ai-tasks/saitask_1/retry",
  });
  const api = {
    async createEventCandidateRanking() {
      return failed;
    },
    async retrySceneAiTask(retryUrl) {
      retriedUrls.push(retryUrl);
      return sceneAiTask("QUEUED");
    },
    async getSceneAiTask() {
      pollCount += 1;
      return sceneAiTask("COMPLETED");
    },
  };
  const controller = createEventCandidateRankingController({
    api,
    pollDelay: async () => {},
  });

  const task = await controller.submit({
    projectId: "project_1",
    revisionId: "revision_1",
    eventId: "event_1",
    sceneId: "scene_1",
  });
  const display = eventCandidateRankingDisplayState(task);
  assert.equal(display.key, "failed");
  assert.equal(display.detail, "ranking worker failed");
  assert.equal(display.canRetry, true);
  assert.equal(canRetryRankingTask({ ...failed, retry_url: null }), false);

  const completed = await controller.retry();
  assert.deepEqual(retriedUrls, ["/api/v1/scene-ai-tasks/saitask_1/retry"]);
  assert.equal(pollCount, 1);
  assert.equal(completed.status, "COMPLETED");
});

test("revision/event/scene 변경과 dispose는 기존 polling을 취소한다", async () => {
  let pollCount = 0;
  let controller;
  const api = {
    async createEventCandidateRanking() {
      return sceneAiTask("QUEUED");
    },
    async getSceneAiTask() {
      pollCount += 1;
      return sceneAiTask("RUNNING");
    },
  };
  controller = createEventCandidateRankingController({
    api,
    pollIntervalMs: 1,
    onTask: (task) => {
      if (task.status === "QUEUED") {
        controller.setContext({
          revisionId: "revision_changed",
          eventId: "event_changed",
          sceneId: "scene_1",
        });
      }
    },
  });

  const result = await controller.submit({
    projectId: "project_1",
    revisionId: "revision_1",
    eventId: "event_1",
    sceneId: "scene_1",
  });
  assert.equal(result, null);
  assert.equal(pollCount, 0);
  assert.equal(controller.isSubmitLocked(), false);
  controller.dispose();
});

test("ranking 완료는 기존 target을 교체하거나 tracking을 시작하지 않는다", () => {
  const normalized = normalizeEventCandidateRankingResult({
    shortlist_candidate_ids: ["candidate_top"],
    automatic_target_confirmation: true,
  });
  assert.equal(normalized.automaticTargetConfirmation, false);
  assert.deepEqual(preserveExplicitTargetSelection("candidate_existing"), {
    selectedCandidateId: "candidate_existing",
    targetConfirmed: false,
    startTracking: false,
  });
  assert.deepEqual(preserveExplicitTargetSelection(null), {
    selectedCandidateId: null,
    targetConfirmed: false,
    startTracking: false,
  });
});

test("empty shortlist와 unsupported event는 전체 gallery fallback을 유지한다", () => {
  const emptyResult = {
    ranking_status: "NO_RELIABLE_SHORTLIST",
    shortlist_candidate_ids: [],
    full_gallery_fallback_candidate_ids: ["candidate_3", "candidate_1"],
    production_recommendation_ui: "BLOCKED",
  };
  assert.deepEqual(eventCandidateSections(emptyResult), {
    recommendationCandidateIds: [],
    fullGalleryCandidateIds: ["candidate_3", "candidate_1"],
    showFullGalleryAction: true,
    showManualEarlierAnchor: true,
  });
  assert.equal(
    eventCandidateRankingDisplayState(sceneAiTask("COMPLETED", { result: emptyResult })).key,
    "unreliable",
  );
  assert.equal(
    eventCandidateRankingDisplayState(sceneAiTask("COMPLETED", {
      result: { ...emptyResult, ranking_status: "UNSUPPORTED_EVENT_CLASS" },
    })).key,
    "unsupported",
  );
});

test("shortlist_rank와 original_global_rank를 분리하고 서버 shortlist 순서를 보존한다", () => {
  const normalized = normalizeEventCandidateViewModels([
    {
      candidate_id: "candidate_b",
      rank: 8,
      shortlist_rank: 1,
      original_global_rank: 8,
      recommendation_score: 0.41,
    },
    {
      candidate_id: "candidate_a",
      rank: 1,
      shortlist_rank: 2,
      original_global_rank: 1,
      recommendation_score: 0.99,
    },
  ]);

  assert.deepEqual(normalized.map((candidate) => candidate.id), ["candidate_b", "candidate_a"]);
  assert.deepEqual(normalized.map((candidate) => candidate.shortlistRank), [1, 2]);
  assert.deepEqual(normalized.map((candidate) => candidate.originalGlobalRank), [8, 1]);
  assert.deepEqual(normalized.map((candidate) => candidate.serverShortlistIndex), [0, 1]);
});

test("production_recommendation_ui=BLOCKED이면 일반 사용자 추천 UI를 활성화하지 않는다", () => {
  const result = {
    ranking_status: "PROVISIONAL_SHADOW_ONLY",
    shortlist_candidate_ids: ["candidate_1"],
    full_gallery_fallback_candidate_ids: ["candidate_1", "candidate_2"],
    production_recommendation_ui: "BLOCKED",
  };
  assert.equal(canShowEventCandidateRecommendations(result), false);
  assert.equal(canShowEventCandidateRecommendations(result, { developerMode: true }), true);
  assert.equal(
    eventCandidateRankingDisplayState(sceneAiTask("COMPLETED", { result })).key,
    "blocked",
  );
  assert.equal(
    eventCandidateRankingDisplayState(
      sceneAiTask("COMPLETED", {
        result: { ...result, feature_completeness_state: "PARTIAL_FEATURES" },
      }),
      { developerMode: true },
    ).key,
    "partial",
  );
});

test("risk/reason code는 사용자용 요약과 debug용 번역을 사용한다", () => {
  assert.equal(
    rankingRiskSummary(["BALL_SIGNAL_UNAVAILABLE", "CRITICAL_FEATURES_MISSING"]),
    "일부 경기 정보가 부족합니다.",
  );
  assert.deepEqual(
    debugRankingCodeLabels([
      "CUT_ADJACENT_ACTION_CANDIDATE",
      "SHORTLIST_CAPACITY_REACHED",
      "FUTURE_UNKNOWN_CODE",
    ]),
    ["컷 인접 액션 후보", "추천 후보 수 제한 도달", "알 수 없는 내부 사유"],
  );
});

test("artifact는 file_path가 아니라 인증된 artifact download endpoint로 받는다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(new Blob(["artifact"]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  };

  try {
    const blob = await kickclipApi.downloadArtifact("artifact/path", {
      file_path: "C:\\server\\private\\ranking.json",
    });
    assert.equal(await blob.text(), "artifact");
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.match(requests[0].url, /\/api\/v1\/artifacts\/artifact%2Fpath\/download$/);
  assert.doesNotMatch(requests[0].url, /server|private|ranking\.json/i);
});
