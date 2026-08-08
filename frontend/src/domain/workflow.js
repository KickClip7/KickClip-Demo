export function routeAfterUpload(response) {
  if (!response?.match_id) throw new Error("업로드 응답에 match_id가 없습니다.");
  return { name: "match-projects", matchId: response.match_id };
}

export function routeAfterProjectCreate(project) {
  if (!project?.project_id) throw new Error("하이라이트 응답에 project_id가 없습니다.");
  return { name: "project-edit", projectId: project.project_id };
}

export function buildUntitledProjectPayload() {
  return {
    title: "untitled",
    description: null,
  };
}

export function defaultEditEntry() {
  return {
    editView: "editor",
    mode: "match",
  };
}

export function buildAgentClipPlanPayload(projectId, payload) {
  if (!projectId) throw new Error("하이라이트 작업 ID가 없습니다.");
  return {
    project_id: projectId,
    mode: "AGENT_GENERATED",
    prompt: payload.prompt,
    target_duration_sec: payload.target_duration_sec ?? null,
    selected_player_id: payload.selected_player_id ?? null,
    options: payload.options || {},
  };
}

export function buildManualClipPlanPayload(projectId, {
  summary,
  targetDurationSec,
  ratio,
  items,
}) {
  if (!projectId) throw new Error("하이라이트 작업 ID가 없습니다.");
  return {
    project_id: projectId,
    mode: "MANUAL",
    summary,
    target_duration_sec: targetDurationSec,
    options: { ratio },
    items,
  };
}

export function projectNotFoundMessage(error) {
  if (error?.status === 404) return "하이라이트를 찾을 수 없습니다.";
  if (error?.status === 403) return "이 하이라이트에 접근할 수 없습니다.";
  return error?.detail || error?.message || "하이라이트를 불러오지 못했습니다.";
}
