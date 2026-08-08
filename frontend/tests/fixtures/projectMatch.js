export const matchFixture = {
  match_id: "match_123",
  owner_id: "user_1",
  home_team: "대한민국",
  away_team: "일본",
  home_score: 2,
  away_score: 1,
  match_date: "2026-07-25T10:00:00Z",
  competition: "테스트 컵",
  season: "2026",
  duration_sec: 5400,
  metadata: {},
  thumbnail_artifact_id: "artifact_thumbnail",
  thumbnail_url: "/api/v1/artifacts/artifact_thumbnail/download?token=signed",
  created_at: "2026-07-25T10:00:00Z",
  updated_at: "2026-07-25T10:00:00Z",
};

export const projectAFixture = {
  project_id: "proj_A",
  match_id: "match_123",
  owner_id: "user_1",
  title: "전체 경기 1분 요약",
  description: null,
  status: "active",
  thumbnail_artifact_id: null,
  last_opened_at: null,
  created_at: "2026-07-25T10:05:00Z",
  updated_at: "2026-07-25T10:05:00Z",
};

export const projectBFixture = {
  ...projectAFixture,
  project_id: "proj_B",
  title: "골 장면 쇼츠",
  created_at: "2026-07-25T10:06:00Z",
  updated_at: "2026-07-25T10:06:00Z",
};

export const clipPlanAFixture = {
  clip_plan_id: "clip_A",
  project_id: "proj_A",
  mode: "MANUAL",
  summary: "골 장면",
  target_duration_sec: 30,
  actual_duration_sec: 28,
  created_by: "user_1",
  options: {},
  items: [],
  created_at: "2026-07-25T10:07:00Z",
  updated_at: "2026-07-25T10:07:00Z",
};

export const clipPlanBFixture = {
  ...clipPlanAFixture,
  clip_plan_id: "clip_B",
  project_id: "proj_B",
};

export const completedRenderFixture = {
  render_job_id: "render_A",
  clip_plan_id: "clip_A",
  status: "completed",
  progress: 100,
  download_url: "/api/v1/renders/render_A/download",
  error_message: null,
  options: { ratio: "9:16", quality: "1080p", captions_enabled: true },
  created_at: "2026-07-25T10:08:00Z",
};

export const editStateAFixture = {
  project: projectAFixture,
  match: {
    match_id: matchFixture.match_id,
    home_team: matchFixture.home_team,
    away_team: matchFixture.away_team,
    home_score: matchFixture.home_score,
    away_score: matchFixture.away_score,
    duration_sec: matchFixture.duration_sec,
  },
  video: {
    url: "/api/v1/media/asset_1/stream",
    asset_id: "asset_1",
    asset_type: "raw_video",
    duration_sec: 5400,
    width: 1920,
    height: 1080,
  },
  events: [],
  players: [],
  filters: { eventTypes: [], backendLabels: [] },
  clip_plans: [clipPlanAFixture],
  render_jobs: [completedRenderFixture],
};
