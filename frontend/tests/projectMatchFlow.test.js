import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  adaptClipPlan,
  adaptEditState,
  adaptRecentProjects,
  adaptSessionClip,
  clipPlanItemsFromSessionClips,
} from "../src/api/adapters.js";
import { buildMatchUploadForm, kickclipApi } from "../src/api/kickclipApi.js";
import { isolateProjectResources } from "../src/domain/projectState.js";
import { buildAgentClipPlanPayload, buildManualClipPlanPayload, buildUntitledProjectPayload, defaultEditEntry, projectNotFoundMessage, routeAfterProjectCreate, routeAfterUpload } from "../src/domain/workflow.js";
import { buildHighlightDraftPayload, clipsFromHighlightDraft, highlightDraftFingerprint } from "../src/domain/highlightDraft.js";
import { buildExportPreviewClips } from "../src/domain/exportPreview.js";
import { parseRoute, routePath, routes } from "../src/routing.js";
import {
  clipPlanAFixture,
  clipPlanBFixture,
  completedRenderFixture,
  editStateAFixture,
  matchFixture,
  projectAFixture,
  projectBFixture,
} from "./fixtures/projectMatch.js";

function installWindow() {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    dispatchEvent: () => {},
  };
  return () => { globalThis.window = originalWindow; };
}

test("R1 ambiguity evidence uses authenticated dedicated endpoints", async () => {
  const restoreWindow = installWindow();
  globalThis.window.localStorage.getItem = () => JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    user: { user_id: "user-1" },
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  };
  try {
    await kickclipApi.downloadTrackingAmbiguityEvidence("job/1", "ambiguity/1", "full-frame-context");
    await kickclipApi.downloadTrackingAmbiguityEvidence("job/1", "ambiguity/1", "full-shot-clip");
    await kickclipApi.downloadTrackingCandidateMedia(
      "job/1",
      "ambiguity/1",
      "candidate/1",
      "reference-gallery",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
  assert.match(requests[0].url, /\/tracking\/jobs\/job%2F1\/ambiguities\/ambiguity%2F1\/evidence\/full-frame-context$/);
  assert.match(requests[1].url, /\/tracking\/jobs\/job%2F1\/ambiguities\/ambiguity%2F1\/evidence\/full-shot-clip$/);
  assert.match(
    requests[2].url,
    /\/tracking\/jobs\/job%2F1\/ambiguities\/ambiguity%2F1\/candidates\/candidate%2F1\/media\/reference-gallery$/,
  );
  assert.ok(requests.every(({ options }) => options.headers.get("Authorization") === "Bearer access-token"));
});

test("업로드 FormData는 Match 필드만 포함하고 Project 필드는 제거한다", () => {
  const file = new File(["video"], "match.mp4", { type: "video/mp4" });
  const form = buildMatchUploadForm(file, {
    home_team: "대한민국",
    home_score: 2,
    metadata: { source: "test" },
    project_title: "전송되면 안 됨",
    project_description: "전송되면 안 됨",
  });
  assert.equal(form.get("file").name, "match.mp4");
  assert.equal(form.get("home_team"), "대한민국");
  assert.equal(form.get("home_score"), "2");
  assert.equal(form.get("metadata"), '{"source":"test"}');
  assert.equal(form.has("project_title"), false);
  assert.equal(form.has("project_description"), false);
});

test("업로드 요청은 POST /api/v1/matches를 사용하고 match_id 응답을 읽는다", async () => {
  const restoreWindow = installWindow();
  const OriginalXhr = globalThis.XMLHttpRequest;
  let sentRequest = null;

  class FakeXhr {
    constructor() {
      this.upload = {};
      this.status = 200;
      this.responseText = JSON.stringify({ match_id: "match_123" });
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader() {}
    send(body) {
      sentRequest = { method: this.method, url: this.url, body };
      this.onload();
    }
  }

  globalThis.XMLHttpRequest = FakeXhr;
  try {
    const response = await kickclipApi.uploadMatchVideo({
      file: new File(["video"], "match.mp4", { type: "video/mp4" }),
      metadata: {},
    });
    assert.equal(response.match_id, "match_123");
    assert.equal(sentRequest.method, "POST");
    assert.match(sentRequest.url, /\/api\/v1\/matches$/);
    assert.doesNotMatch(sentRequest.url, /studio|upload-match-video/);
  } finally {
    globalThis.XMLHttpRequest = OriginalXhr;
    restoreWindow();
  }
});

test("Match 하위 Project 생성·목록과 Project edit-state 경로를 정확히 사용한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const payload = String(url).endsWith("/edit-state")
      ? editStateAFixture
      : options.method === "POST"
        ? projectAFixture
        : [projectAFixture, projectBFixture];
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await kickclipApi.createProject("match_123", { title: "전체 경기 1분 요약", description: null });
    await kickclipApi.getMatchProjects("match_123");
    await kickclipApi.getProjectEditState("proj_A");
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.match(requests[0].url, /\/matches\/match_123\/projects$/);
  assert.deepEqual(JSON.parse(requests[0].options.body), { title: "전체 경기 1분 요약", description: null });
  assert.match(requests[1].url, /\/matches\/match_123\/projects$/);
  assert.match(requests[2].url, /\/projects\/proj_A\/edit-state$/);
  assert.equal(requests.some(({ url }) => /studio\/matches/.test(url)), false);
});

test("내 작업의 경기 영상은 GET /api/v1/matches 목록 API로 조회한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([matchFixture]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const matches = await kickclipApi.getMatches();
    assert.equal(matches[0].match_id, "match_123");
    assert.match(requestedUrl, /\/api\/v1\/matches$/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test("수동·Agent ClipPlan 요청은 project_id를 전달하고 match_id를 전달하지 않는다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(clipPlanAFixture), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await kickclipApi.createClipPlan({ project_id: "proj_A", mode: "MANUAL", options: {}, items: [] });
    await kickclipApi.createAgentClipPlan({ project_id: "proj_A", mode: "AGENT_GENERATED", prompt: "골 장면", options: {} });
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
  const manual = JSON.parse(requests[0].options.body);
  const agent = JSON.parse(requests[1].options.body);
  assert.equal(manual.project_id, "proj_A");
  assert.equal(agent.project_id, "proj_A");
  assert.equal("match_id" in manual, false);
  assert.equal("match_id" in agent, false);
  assert.match(requests[1].url, /\/api\/v1\/agent\/clip-plan$/);
});

test("분석 요청에는 Match ID, 렌더 요청에는 현재 ClipPlan ID를 사용한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ analysis_job_id: "analysis_1", render_job_id: "render_A" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.createAnalysisJob("match_123", {}, { auto_start: true });
    await kickclipApi.createRender({ clip_plan_id: "clip_A", options: { ratio: "9:16" } });
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
  assert.match(requests[0].url, /\/matches\/match_123\/analysis-jobs\?auto_start=true$/);
  assert.equal(JSON.parse(requests[1].options.body).clip_plan_id, "clip_A");
});

test("세션에서 조정한 순서와 구간을 수동 ClipPlan item 계약으로 변환한다", () => {
  const items = clipPlanItemsFromSessionClips([
    {
      id: "event_2",
      label: "shot",
      startSec: 18.5,
      endSec: 25,
      raw: { description: "후반 슈팅" },
    },
    {
      id: "event_1",
      label: "goal",
      startSec: 4,
      endSec: 12,
      raw: {},
    },
  ]);
  assert.deepEqual(items, [
    {
      timeline_event_id: "event_2",
      start_sec: 18.5,
      end_sec: 25,
      order_index: 0,
      reason: "후반 슈팅",
      metadata: { source: "frontend_session" },
    },
    {
      timeline_event_id: "event_1",
      start_sec: 4,
      end_sec: 12,
      order_index: 1,
      reason: "goal session clip",
      metadata: { source: "frontend_session" },
    },
  ]);
});

test("세션 이벤트 taxonomy 라벨을 백엔드 표준 소문자로 정규화한다", () => {
  const clip = adaptSessionClip({
    timeline_event_id: "event_1",
    label: "Goal",
    start_sec: 4,
    end_sec: 12,
    timestamp_sec: 8,
    metadata: {},
  });

  assert.equal(clip.label, "goal");
});

test("신규 Highlight workflow API는 프로젝트 경로와 명세의 HTTP method를 사용한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.startHighlightAnalysis("proj/A", { request: "골 장면" });
    await kickclipApi.getHighlightStatus("proj/A");
    await kickclipApi.getHighlightScenes("proj/A");
    await kickclipApi.selectHighlightScenes("proj/A", { scene_ids: ["scene/1"] });
    await kickclipApi.startHighlightPlayerFocus("proj/A", { request: "10번 선수" });
    await kickclipApi.getHighlightPlayerCandidates("proj/A");
    await kickclipApi.selectHighlightFocusSubject("proj/A", { candidate_id: "candidate_1" });
    await kickclipApi.confirmHighlightScenePlayer("proj/A", "scene/1", { decision: "absent" });
    await kickclipApi.createHighlightClipPlan("proj/A", {});
    await kickclipApi.createHighlightRender("proj/A", { options: {} });
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.deepEqual(
    requests.map(({ options }) => options.method || "GET"),
    ["POST", "GET", "GET", "POST", "POST", "GET", "POST", "POST", "POST", "POST"],
  );
  assert.match(requests[0].url, /\/projects\/proj%2FA\/highlight\/analyze$/);
  assert.match(requests[3].url, /\/projects\/proj%2FA\/highlight\/scenes\/select$/);
  assert.match(requests[7].url, /\/projects\/proj%2FA\/highlight\/scenes\/scene%2F1\/player-confirmation$/);
  assert.match(requests[9].url, /\/projects\/proj%2FA\/highlight\/render$/);
});

test("완료된 트래킹 작업을 하이라이트 후보로 등록하는 프로젝트 API를 사용한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ eligible_for_clip_plan: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.includeTrackingHighlightCandidate("proj/A", "trk/1");
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.equal(requests[0].options.method, "POST");
  assert.match(
    requests[0].url,
    /\/projects\/proj%2FA\/highlight\/tracking-jobs\/trk%2F1\/candidate$/,
  );
});

test("Highlight 임시저장 API는 조회·저장·삭제 계약을 사용한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(options.method === "DELETE" ? null : JSON.stringify({ version: 1 }), {
      status: options.method === "DELETE" ? 204 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.getHighlightDraft("proj/A");
    await kickclipApi.saveHighlightDraft("proj/A", { expected_version: 0 });
    await kickclipApi.deleteHighlightDraft("proj/A");
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.deepEqual(requests.map(({ options }) => options.method || "GET"), ["GET", "PUT", "DELETE"]);
  assert.match(requests[0].url, /\/projects\/proj%2FA\/highlight\/draft$/);
  assert.deepEqual(JSON.parse(requests[1].options.body), { expected_version: 0 });
});

test("세션 편집 상태를 Highlight draft payload로 만들고 저장 순서대로 복원한다", () => {
  const payload = buildHighlightDraftPayload({
    mode: "match",
    sessionClips: [
      { id: "evt_2", startSec: 18, endSec: 24 },
      { id: "evt_1", startSec: 4, endSec: 12 },
    ],
    selectedEvents: [],
    agentDurations: {},
    agentSummary: "골 중심",
    exportRatio: "9:16",
    captionsEnabled: true,
    selectedMusic: "Hype Beat 01",
    focusedEventId: "evt_2",
    eventFilter: "goal",
    selectedPlayerId: null,
    clipPlanId: "clip_1",
    expectedVersion: 3,
  });

  assert.equal(payload.expected_version, 3);
  assert.deepEqual(payload.selected_scene_ids, ["evt_2", "evt_1"]);
  assert.equal(payload.timeline_items[0].order_index, 0);
  assert.equal(payload.export_options.ratio, "9:16");

  const restored = clipsFromHighlightDraft(
    { timeline_items: [...payload.timeline_items].reverse() },
    [
      { id: "evt_1", label: "goal", startSec: 3, endSec: 13 },
      { id: "evt_2", label: "shot", startSec: 17, endSec: 25 },
    ],
  );
  assert.deepEqual(restored.map((clip) => clip.id), ["evt_2", "evt_1"]);
  assert.equal(restored[0].startSec, 18);
  assert.equal(restored[0].endSec, 24);
  assert.equal(highlightDraftFingerprint(payload), highlightDraftFingerprint({
    ...payload,
    version: 99,
    updated_at: "2026-07-28T12:00:00Z",
  }));
  assert.notEqual(
    highlightDraftFingerprint(payload),
    highlightDraftFingerprint({ ...payload, export_options: { ...payload.export_options, ratio: "16:9" } }),
  );
});

test("내보내기 미리보기는 편집 순서와 잘라낸 구간을 그대로 사용한다", () => {
  const sessionPreview = buildExportPreviewClips({
    mode: "match",
    sessionClips: [
      { id: "evt_2", label: "shot", startSec: 18, endSec: 24 },
      { id: "evt_1", label: "goal", startSec: 4, endSec: 12 },
    ],
  });
  assert.deepEqual(sessionPreview.map((clip) => clip.id), ["evt_2", "evt_1"]);
  assert.deepEqual(sessionPreview.map((clip) => clip.renderStartSec), [0, 6]);
  assert.equal(sessionPreview[1].durationSec, 8);

  const playerPreview = buildExportPreviewClips({
    mode: "player",
    selectedEvents: [{ id: "evt_3", start: "01:10", end: "01:20", duration: 10 }],
    agentDurations: { evt_3: 4 },
  });
  assert.equal(playerPreview[0].startSec, 70);
  assert.equal(playerPreview[0].endSec, 74);
});

test("Target Tracking API는 작업·타임라인·산출물·검수 경로를 정확히 사용한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({}), {
      status: String(url).includes("/candidate-review") ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.createTrackingJob({ media_asset_id: "asset_1", initial_bbox_xyxy: [1, 2, 3, 4] });
    await kickclipApi.getTrackingJob("job/1");
    await kickclipApi.getTrackingTimeline("job/1", { start_frame: 10, end_frame: 20 });
    await kickclipApi.getTrackingArtifacts("job/1");
    await kickclipApi.downloadTrackingArtifact("job/1", "segment/preview");
    await kickclipApi.submitTrackingReview("job/1", { decision: "APPROVE" });
    const candidateReview = await kickclipApi.reviewTrackingAmbiguityCandidate("job/1", "ambiguity/1", {
      state: "SAME_PLAYER",
      candidate_id: "candidate_1",
    });
    assert.equal(candidateReview.httpStatus, 201);
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.deepEqual(
    requests.map(({ options }) => options.method || "GET"),
    ["POST", "GET", "GET", "GET", "GET", "POST", "POST"],
  );
  assert.match(requests[0].url, /\/api\/v1\/tracking\/jobs$/);
  assert.match(requests[1].url, /\/tracking\/jobs\/job%2F1$/);
  assert.match(requests[2].url, /\/tracking\/jobs\/job%2F1\/timeline\?start_frame=10&end_frame=20$/);
  assert.match(requests[3].url, /\/tracking\/jobs\/job%2F1\/artifacts$/);
  assert.match(requests[4].url, /\/tracking\/jobs\/job%2F1\/artifacts\/segment%2Fpreview$/);
  assert.match(requests[6].url, /\/tracking\/jobs\/job%2F1\/ambiguities\/ambiguity%2F1\/candidate-review$/);
});

test("R1 candidate recommendation → selection → tracking handoff 경로와 payload를 보존한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({}), {
      status: String(url).includes("/candidate-review") ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await kickclipApi.getEventCandidateRecommendations(
      "project/1",
      "revision/2",
      "event/3",
      "scene/4",
    );
    await kickclipApi.createEventCandidateSelection(
      "project/1",
      "revision/2",
      "event/3",
      "scene/4",
      {
        ranking_id: "ranking_1",
        shortlist_patch_id: "patch_1",
        candidate_id: "candidate-charlie",
        source_video_asset_id: "asset_1",
      },
    );
    await kickclipApi.createSelectionTrackingJob("selection/5", {
      source_video_asset_id: "asset_1",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }

  assert.match(requests[0].url, /\/projects\/project%2F1\/highlight\/revisions\/revision%2F2\/events\/event%2F3\/candidate-recommendations\?scene_id=scene%2F4$/);
  assert.match(requests[1].url, /\/projects\/project%2F1\/highlight\/revisions\/revision%2F2\/events\/event%2F3\/candidate-selections\?scene_id=scene%2F4$/);
  assert.match(requests[2].url, /\/event-candidate-selections\/selection%2F5\/tracking-jobs$/);
  assert.equal(JSON.parse(requests[1].options.body).candidate_id, "candidate-charlie");
  assert.deepEqual(JSON.parse(requests[2].options.body), { source_video_asset_id: "asset_1" });
});

test("R1 API 409의 detail.code를 ApiError에 보존한다", async () => {
  const restoreWindow = installWindow();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: {
      code: "CANDIDATE_SELECTION_PROVENANCE_MISMATCH",
      message: "selection does not match ranking",
    },
  }), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      kickclipApi.createSelectionTrackingJob("selection_1", {
        source_video_asset_id: "asset_1",
      }),
      (error) => (
        error.status === 409
        && error.code === "CANDIDATE_SELECTION_PROVENANCE_MISMATCH"
        && error.data.detail.message === "selection does not match ranking"
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreWindow();
  }
});

test("Project A edit-state에서 다른 Project의 ClipPlan과 RenderJob을 격리한다", () => {
  const mixed = {
    ...editStateAFixture,
    clip_plans: [clipPlanAFixture, clipPlanBFixture],
    render_jobs: [
      completedRenderFixture,
      { ...completedRenderFixture, render_job_id: "render_B", clip_plan_id: "clip_B" },
    ],
  };
  const isolated = isolateProjectResources(mixed);
  assert.deepEqual(isolated.clipPlans.map((plan) => plan.clip_plan_id), ["clip_A"]);
  assert.deepEqual(isolated.renderJobs.map((job) => job.render_job_id), ["render_A"]);

  const adapted = adaptEditState(mixed);
  assert.deepEqual(adapted.clipPlans.map((plan) => plan.clip_plan_id), ["clip_A"]);
  assert.deepEqual(adapted.renderJobs.map((job) => job.render_job_id), ["render_A"]);
  assert.equal(adaptClipPlan(clipPlanAFixture).projectId, "proj_A");
});

test("최근 Project와 URL 라우팅은 project_id를 편집 식별자로 사용한다", () => {
  const recent = adaptRecentProjects({
    projects: [{
      project_id: "proj_A",
      match_id: "match_123",
      title: "전체 경기 1분 요약",
      status: "active",
      thumbnail_url: null,
      duration_sec: 60,
      clip_count: 4,
      edit_mode: "AGENT",
      progress: 73,
      ratio: "16:9",
      last_opened_at: "2026-07-28T10:05:00Z",
    }],
  });
  assert.equal(recent[0].id, "proj_A");
  assert.equal(recent[0].matchId, "match_123");
  assert.equal(recent[0].clipCount, 4);
  assert.equal(recent[0].editMode, "AGENT");
  assert.equal(recent[0].progress, 73);
  assert.equal(recent[0].ratio, "16:9");
  assert.equal(recent[0].lastOpenedAt, "2026-07-28T10:05:00Z");
  assert.equal(routes.projectEdit(recent[0].id), "/projects/proj_A/edit");
  assert.deepEqual(parseRoute("/projects/proj_A/edit"), { name: "project-edit", projectId: "proj_A" });
  assert.deepEqual(parseRoute("/matches/match_123/projects"), { name: "match-projects", matchId: "match_123" });
  assert.equal(routePath(parseRoute("/projects/proj_A/edit")), "/projects/proj_A/edit");
});

test("업로드와 Project 생성 후 목적지는 각각 match_id와 project_id로 분리한다", () => {
  assert.deepEqual(routeAfterUpload({ match_id: "match_123" }), { name: "match-projects", matchId: "match_123" });
  assert.deepEqual(routeAfterProjectCreate(projectAFixture), { name: "project-edit", projectId: "proj_A" });
  assert.equal(routePath(routeAfterUpload({ match_id: "match_123" })), "/matches/match_123/projects");
  assert.equal(routePath(routeAfterProjectCreate(projectAFixture)), "/projects/proj_A/edit");
});

test("하이라이트 생성은 입력 단계 없이 untitled Project payload를 사용한다", () => {
  assert.deepEqual(buildUntitledProjectPayload(), {
    title: "untitled",
    description: null,
  });
});

test("Project 편집 진입은 모드 선택 없이 전체 경기 편집 화면을 연다", () => {
  assert.deepEqual(defaultEditEntry(), {
    editView: "editor",
    mode: "match",
  });
});

test("ClipPlan payload 생성기는 project_id를 필수로 하고 match_id를 만들지 않는다", () => {
  const manual = buildManualClipPlanPayload("proj_A", {
    summary: "골 장면 편집",
    targetDurationSec: 30,
    ratio: "9:16",
    items: [],
  });
  const agent = buildAgentClipPlanPayload("proj_A", {
    prompt: "골 장면 중심으로 30초 쇼츠를 만들어줘",
    target_duration_sec: 30,
    selected_player_id: null,
    options: {},
  });
  assert.equal(manual.project_id, "proj_A");
  assert.equal(agent.project_id, "proj_A");
  assert.equal("match_id" in manual, false);
  assert.equal("match_id" in agent, false);
  assert.throws(() => buildManualClipPlanPayload("", { summary: "", targetDurationSec: 0, ratio: "9:16", items: [] }));
});

test("Project 404는 리소스 소유권을 추측하지 않는 일반 메시지를 사용한다", () => {
  assert.equal(projectNotFoundMessage({ status: 404, detail: "hidden detail" }), "하이라이트를 찾을 수 없습니다.");
});

test("업로드한 경기 영상 목록과 완료 Render 다운로드 버튼을 렌더링한다", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { default: MatchProjectsScreen } = await vite.ssrLoadModule("/src/screens/MatchProjectsScreen.jsx");
    const { default: ProjectsScreen } = await vite.ssrLoadModule("/src/screens/ProjectsScreen.jsx");
    const { default: PreviewScreen } = await vite.ssrLoadModule("/src/screens/PreviewScreen.jsx");
    const matchHtml = renderToStaticMarkup(React.createElement(MatchProjectsScreen, {
      active: true,
      matchId: "match_123",
      match: { ...matchFixture, video_url: "/api/v1/media/asset_1/stream?token=signed" },
      projects: [],
      uploadContext: null,
      loading: false,
      error: "",
      analysisStatus: "",
      onReload: () => {},
      onOpenProject: () => {},
      onCreateProject: async () => ({ ok: true }),
    }));
    assert.match(matchHtml, /아직 이 경기로 만든 하이라이트가 없습니다/);
    assert.match(matchHtml, /첫 하이라이트 만들기/);
    assert.doesNotMatch(matchHtml, /하이라이트 제목/);
    assert.doesNotMatch(matchHtml, /NEW HIGHLIGHT/);
    assert.match(matchHtml, /\/api\/v1\/media\/asset_1\/stream\?token=signed/);

    const workspaceHtml = renderToStaticMarkup(React.createElement(ProjectsScreen, {
      active: true,
      projects: adaptRecentProjects({ projects: [{
        project_id: "proj_A",
        match_id: "match_123",
        title: "전체 경기 1분 요약",
        status: "active",
        thumbnail_url: null,
        duration_sec: 60,
        created_at: "2026-07-25T10:05:00Z",
      }] }),
      matches: [matchFixture],
      loading: false,
      error: "",
      openProject: () => {},
      startUpload: () => {},
      lastUploadedMatchId: "match_123",
      openMatch: () => {},
      onReload: () => {},
    }));
    assert.match(workspaceHtml, /MATCH VIDEOS/);
    assert.match(workspaceHtml, /내가 업로드한 경기 영상/);
    assert.match(workspaceHtml, /대한민국 vs 일본/);
    assert.match(workspaceHtml, /artifact_thumbnail\/download\?token=signed/);
    assert.doesNotMatch(workspaceHtml, /최근 하이라이트/);

    const previewHtml = renderToStaticMarkup(React.createElement(PreviewScreen, {
      active: true,
      selectedEvents: [],
      agentDurations: {},
      captionsEnabled: true,
      exportRatio: "9:16",
      setExportRatio: () => {},
      selectedMusic: "없음",
      setSelectedMusic: () => {},
      setCaptionsEnabled: () => {},
      uploadedVideo: "/video.mp4",
      showToast: () => {},
      onRunExportAssistant: async () => null,
      uploadedVideoDuration: 30,
      mode: "match",
      assistantInput: "",
      setAssistantInput: () => {},
      assistantMessages: [],
      setAssistantMessages: () => {},
      renderJobs: [completedRenderFixture],
      renderBusy: false,
      onCreateRender: async () => null,
      onDownloadRender: () => {},
    }));
    assert.match(previewHtml, /완료 영상 다운로드/);
    assert.match(previewHtml, /render_A/);
  } finally {
    await vite.close();
  }
});
