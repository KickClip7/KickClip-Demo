import http from "node:http";
import { editStateAFixture, matchFixture, projectAFixture, projectBFixture } from "./fixtures/projectMatch.js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Content-Type": "application/json",
};

const reviewImage = (label) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#172033"/><text x="50%" y="50%" fill="white" text-anchor="middle" font-size="24">${label}</text></svg>`,
)}`;
const candidateIds = [
  "candidate-alpha",
  "candidate-bravo",
  "candidate-charlie",
  "candidate-delta",
  "candidate-echo",
];
const candidateResponse = {
  ranking_version: "v1.2",
  ranking_id: "ranking_browser_r1",
  shortlist_patch_id: "patch_browser_r1",
  revision_id: "revision_browser_r1",
  event_id: "event_1",
  scene_id: "scene_browser_1",
  source_video_asset_id: "asset_browser_r1",
  candidates: candidateIds.map((candidateId, index) => ({
    ranking_version: "v1.2",
    ranking_id: "ranking_browser_r1",
    shortlist_patch_id: "patch_browser_r1",
    candidate_id: candidateId,
    shortlist_rank: index + 1,
    global_rank: index + 1,
    shot_id: `shot-${index + 1}`,
    tracklet_id: candidateId,
    reviewability: "CLEAR",
    best_frame: candidateId === "candidate-charlie" ? 342 : 300 + index,
    media: {
      full_frame_context_url: reviewImage(`${candidateId} full frame`),
      best_crop_native_url: reviewImage(`${candidateId} native crop`),
      best_crop_display_url: reviewImage(`${candidateId} display crop`),
      first_middle_last_url: reviewImage(`${candidateId} first middle last`),
      tracklet_video_url: "data:video/mp4;base64,",
      reference_gallery_url: reviewImage(`${candidateId} gallery`),
    },
    reason_codes: ["TRACKLET_QUALITY"],
    risk_codes: [],
    possible_fragment_duplicate: false,
    automatic_target_confirmation: false,
  })),
  automatic_target_confirmation: false,
  production_recommendation_ui: "BLOCKED",
};
let browserTrackingJob = null;
let conflictNextCandidateReview = false;
let candidatePreparationPollCount = 0;
let candidatePreparationCompleted = false;

function send(response, status, payload) {
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/__test/conflict-next-candidate-review") {
    conflictNextCandidateReview = true;
    send(response, 200, { armed: true });
    return;
  }
  if (request.method === "POST" && path === "/api/v1/projects/proj_A/highlight/analyze") {
    send(response, 200, { revision: { revision_id: "revision_browser_parent", status: "SCENES_READY" } });
    return;
  }
  if (path === "/api/v1/projects/proj_A/highlight/scenes") {
    send(response, 200, {
      revision: { revision_id: "revision_browser_parent" },
      scenes: [{
        scene_id: "scene_browser_1",
        start_time_sec: 4,
        end_time_sec: 12,
        representative_time_sec: 8,
      }],
    });
    return;
  }
  if (request.method === "POST" && path === "/api/v1/projects/proj_A/highlight/scenes/select") {
    candidatePreparationPollCount = 0;
    candidatePreparationCompleted = false;
    send(response, 200, {
      revision_id: "revision_browser_r1",
      candidate_discovery: {
        recommendation_preparation: [{
          scene_id: "scene_browser_1",
          task_id: "saitask_browser_1",
          status: "QUEUED",
          status_url: "/api/v1/scene-ai-tasks/saitask_browser_1",
        }],
      },
    });
    return;
  }
  if (path === "/api/v1/scene-ai-tasks/saitask_browser_1") {
    candidatePreparationPollCount += 1;
    candidatePreparationCompleted = candidatePreparationPollCount >= 2;
    send(response, 200, {
      task_id: "saitask_browser_1",
      task_type: "EVENT_CANDIDATE_RECOMMENDATION_PREPARE_R1",
      status: candidatePreparationCompleted ? "COMPLETED" : "RUNNING",
      result: candidatePreparationCompleted ? { ready: true } : {},
      status_url: "/api/v1/scene-ai-tasks/saitask_browser_1",
    });
    return;
  }
  if (path === "/api/v1/projects/proj_A/highlight/revisions/revision_browser_r1/events/event_1/candidate-recommendations") {
    if (!candidatePreparationCompleted) {
      send(response, 409, {
        detail: {
          code: "CANDIDATE_RECOMMENDATION_NOT_PREPARED",
          message: "Candidate recommendation preparation is running.",
          reason: "PREPARATION_RUNNING",
          preparation_task: {
            task_id: "saitask_browser_1",
            status: "RUNNING",
            status_url: "/api/v1/scene-ai-tasks/saitask_browser_1",
            error_message: null,
          },
        },
      });
      return;
    }
    send(response, 200, candidateResponse);
    return;
  }
  if (request.method === "POST" && path === "/api/v1/projects/proj_A/highlight/revisions/revision_browser_r1/events/event_1/candidate-selections") {
    send(response, 201, {
      selection_id: "ecselr1_browser",
      candidate_id: "candidate-charlie",
      ranking_id: "ranking_browser_r1",
      shortlist_patch_id: "patch_browser_r1",
      shot_id: "shot-3",
      tracklet_id: "candidate-charlie",
    });
    return;
  }
  if (request.method === "POST" && path === "/api/v1/event-candidate-selections/ecselr1_browser/tracking-jobs") {
    browserTrackingJob = {
      job_id: "trk_browser_r1",
      execution_kind: "EVENT_CANDIDATE_HANDOFF_R1",
      selection_id: "ecselr1_browser",
      selected_candidate_id: "candidate-charlie",
      selected_reference_frame: 342,
      status: "WAITING_CROSS_SHOT_CONFIRMATION",
      pending_ambiguity_id: "ambiguity_0001",
      selected_target_reference_gallery_urls: [
        reviewImage("selected target reference 1"),
        reviewImage("selected target reference 2"),
      ],
      pending_action: {
        type: "CROSS_SHOT_CONFIRMATION",
        ambiguity_id: "ambiguity_0001",
        candidate_ids: ["candidate-foxtrot"],
        candidates: [{
          candidate_id: "candidate-foxtrot",
          rank: 1,
          score: 0.82,
          frame_image_urls: [reviewImage("candidate frame")],
          media: {
            full_frame_context_url: reviewImage("candidate full frame"),
            best_crop_display_url: reviewImage("candidate display crop"),
            best_crop_native_url: reviewImage("candidate native crop"),
            first_middle_last_url: reviewImage("candidate first middle last"),
            tracklet_video_url: "data:video/mp4;base64,",
          },
        }],
        full_frame_context_url: reviewImage("absence full frame"),
        shot_clip_url: "data:video/mp4;base64,",
        full_frame_context_sha256: "a".repeat(64),
        shot_clip_sha256: "b".repeat(64),
        artifact_keys: [],
      },
    };
    send(response, 201, {
      tracking_job_id: "trk_browser_r1",
      selection_id: "ecselr1_browser",
      selected_candidate_id: "candidate-charlie",
      selected_shot_id: "shot-3",
      selected_reference_frame: 342,
      selected_bbox: [10, 20, 110, 220],
      anchor_mode: "SELECTED_CANDIDATE_BEST_REFERENCE",
      provenance_artifact_sha256: "c".repeat(64),
      status: "QUEUED",
    });
    return;
  }
  if (path === "/api/v1/tracking/jobs/trk_browser_r1") {
    send(response, 200, browserTrackingJob);
    return;
  }
  if (path === "/api/v1/tracking/jobs/trk_browser_r1/artifacts") {
    send(response, 200, { job_id: "trk_browser_r1", artifacts: [] });
    return;
  }
  if (path === "/api/v1/tracking/jobs/trk_browser_r1/ambiguities/ambiguity_0001/evidence/full-frame-context") {
    send(response, 200, { evidence: "full-frame-context" });
    return;
  }
  if (path === "/api/v1/tracking/jobs/trk_browser_r1/ambiguities/ambiguity_0001/evidence/full-shot-clip") {
    send(response, 200, { evidence: "full-shot-clip" });
    return;
  }
  if (request.method === "POST" && path === "/api/v1/tracking/jobs/trk_browser_r1/ambiguities/ambiguity_0001/candidate-review") {
    if (conflictNextCandidateReview) {
      conflictNextCandidateReview = false;
      browserTrackingJob = {
        ...browserTrackingJob,
        status: "RUNNING",
        current_stage: "MEMORY_REVISION",
        pending_ambiguity_id: null,
        pending_action: null,
      };
      send(response, 409, {
        detail: {
          code: "STALE_PENDING_AMBIGUITY",
          message: "The ambiguity was already resolved by another reviewer.",
        },
      });
      return;
    }
    browserTrackingJob = {
      ...browserTrackingJob,
      status: "RUNNING",
      current_stage: "MEMORY_REVISION",
      pending_ambiguity_id: null,
      pending_action: null,
    };
    send(response, 201, { state: "DIFFERENT_PLAYER", excluded_candidate_id: "candidate-foxtrot" });
    return;
  }
  if (path === "/api/v1/auth/login") {
    send(response, 200, {
      access_token: "local-test-access",
      refresh_token: "local-test-refresh",
      user: { user_id: "user_1", display_name: "로컬 테스터", email: "test@example.com", role: "user" },
    });
    return;
  }
  if (path === "/api/v1/auth/me") {
    send(response, 200, { user_id: "user_1", display_name: "로컬 테스터", email: "test@example.com", role: "user" });
    return;
  }
  if (path === "/api/v1/session/start") {
    send(response, 200, { session_id: "session_1", total_events: 1, video_url: null });
    return;
  }
  if (path === "/api/v1/session/session_1/state") {
    const event = {
      timeline_event_id: "event_1",
      label: "goal",
      half: 1,
      start_sec: 4,
      end_sec: 12,
      duration_sec: 8,
      timestamp_sec: 8,
      highlight_score: 0.95,
      confidence: 0.94,
      metadata: { min_start_sec: 0, max_end_sec: 16 },
    };
    send(response, 200, { all_events: [event], current_clips: [event] });
    return;
  }
  if (path === "/api/v1/projects/recent") {
    send(response, 200, {
      projects: [projectAFixture, projectBFixture].map((project) => ({
        project_id: project.project_id,
        match_id: project.match_id,
        title: project.title,
        status: project.status,
        thumbnail_url: null,
        duration_sec: 60,
        created_at: project.created_at,
      })),
    });
    return;
  }
  if (path === "/api/v1/matches") {
    send(response, 200, [matchFixture]);
    return;
  }
  if (path === "/api/v1/matches/match_123") {
    send(response, 200, matchFixture);
    return;
  }
  if (path === "/api/v1/matches/match_123/projects") {
    send(response, 200, [projectAFixture, projectBFixture]);
    return;
  }
  if (path === "/api/v1/projects/proj_A/edit-state") {
    send(response, 200, editStateAFixture);
    return;
  }
  if (path === "/api/v1/projects/missing/edit-state") {
    send(response, 404, { detail: "not found" });
    return;
  }
  send(response, 404, { detail: "mock route not found" });
});

server.listen(Number(process.env.MOCK_PORT || 8000), "127.0.0.1");
