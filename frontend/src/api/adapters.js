import { toApiUrl } from "./kickclipApi.js";

function secondsToStamp(value) {
  const seconds = Number(value || 0);
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function stampToSeconds(value) {
  if (typeof value === "number") return value;
  const text = String(value || "");
  const [minutes, seconds] = text.split(":");
  if (seconds === undefined) return Number.parseFloat(text) || 0;
  return (Number.parseFloat(minutes) || 0) * 60 + (Number.parseFloat(seconds) || 0);
}

function normalizeCategory(category) {
  if (category === "free_kick") return "freekick";
  return category || "goal";
}

function normalizeEvent(event, index = 0) {
  const startSec = Number(event.start_sec ?? event.start ?? index * 8);
  const endSec = Number(event.end_sec ?? event.end ?? startSec + (event.duration_sec ?? event.duration ?? 8));
  const duration = Number(event.duration_sec ?? event.duration ?? Math.max(1, endSec - startSec));
  const id = event.id ?? event.timeline_event_id ?? event.event_id ?? `event_${index + 1}`;
  const category = normalizeCategory(event.category ?? event.backend_label);

  return {
    id,
    category,
    tag: event.tag || category.toUpperCase(),
    title: event.title || event.description || `${category.toUpperCase()} scene`,
    time: event.time || secondsToStamp(startSec),
    minute: Number(event.minute ?? Math.floor(startSec / 60)),
    duration,
    start: typeof event.start === "string" ? event.start : secondsToStamp(startSec),
    end: typeof event.end === "string" ? event.end : secondsToStamp(endSec),
    score: Number(event.score ?? event.confidence ?? event.highlightScore ?? 0),
    highlightScore: Number(event.highlightScore ?? Math.round((event.score ?? 80) / 10)),
    description: event.description || "AI가 감지한 하이라이트 후보입니다.",
    playerIds: event.playerIds || event.player_ids || [],
    team: event.team || "",
  };
}

function normalizePlayer(player, index = 0) {
  return {
    id: player.id ?? player.player_id ?? `player_${index + 1}`,
    name: player.name ?? player.display_name ?? `No. ${player.number ?? index + 1}`,
    number: Number(player.number ?? index + 1),
    team: player.team || "",
    role: player.role || player.position || "",
    identityStatus: player.identityStatus ?? player.identity_status,
  };
}

export function adaptEditState(data) {
  const projectId = data.project?.project_id || null;
  const clipPlans = (data.clip_plans || []).filter((plan) => plan.project_id === projectId);
  const clipPlanIds = new Set(clipPlans.map((plan) => plan.clip_plan_id));
  return {
    project: data.project || null,
    match: data.match || null,
    video: data.video || null,
    videoUrl: toApiUrl(data.video?.url || ""),
    videoAssetId: data.video?.asset_id || null,
    events: (data.events || []).map(normalizeEvent),
    players: (data.players || []).map(normalizePlayer),
    filters: data.filters || null,
    clipPlans,
    renderJobs: (data.render_jobs || []).filter((job) => clipPlanIds.has(job.clip_plan_id)),
  };
}

export function adaptTimelineEvents(data) {
  return (data.events || data.timeline_events || data || []).map(normalizeEvent);
}

export function adaptPlayers(data) {
  return (data.players || data || []).map(normalizePlayer);
}

export function adaptRecentProjects(data) {
  const tones = ["green", "violet", "amber", "blue"];
  return (data.projects || []).map((project, index) => {
    const status = project.status || "CREATED";
    const isProcessing = /ANALYZ|PROCESS|RUNNING|QUEUED|UPLOADED/i.test(status);
    const clips = project.clips ?? project.clip_count ?? project.highlight_count ?? 0;
    return {
      id: project.project_id,
      matchId: project.match_id,
      tone: tones[index % tones.length],
      badge: isProcessing ? "처리중" : "완료",
      title: project.title || "Untitled project",
      detail: `${status}${project.duration_sec ? ` · ${Math.round(project.duration_sec / 60)}분` : ""}`,
      clips,
      clipCount: clips,
      editMode: project.edit_mode || null,
      progress: Math.max(0, Math.min(100, Number(project.progress ?? 0))),
      ratio: project.ratio || project.options?.ratio || "9:16",
      thumbnailUrl: toApiUrl(project.thumbnail_url || ""),
      lastOpenedAt: project.last_opened_at || null,
      raw: project,
    };
  });
}

export function clipPlanItemsFromEvents(events, durations = {}) {
  return events.map((event, index) => {
    const start = stampToSeconds(event.start) || index * 8;
    const duration = durations[event.id] ?? event.duration ?? 8;
    return {
      timeline_event_id: String(event.id),
      start_sec: start,
      end_sec: start + duration,
      order_index: index,
      reason: event.description || event.title,
      metadata: { source: "frontend" },
    };
  });
}

export function clipPlanItemsFromSessionClips(clips) {
  return clips.map((clip, index) => ({
    timeline_event_id: String(clip.id),
    start_sec: Number(clip.startSec),
    end_sec: Number(clip.endSec),
    order_index: index,
    reason: clip.raw?.description || `${clip.label || "highlight"} session clip`,
    metadata: { source: "frontend_session" },
  }));
}

// 세션 에이전트(챗봇 편집) 전용 어댑터. 백엔드 TimelineEventRead 필드명을 그대로 두고
// (구 taxonomy용 normalizeEvent와 억지로 매핑하지 않음) 프론트에서 자주 쓰는 숫자 필드만 얇게 노출한다.
export function adaptSessionClip(event) {
  const metadata = event.metadata || {};
  const startSec = Number(event.start_sec);
  const endSec = Number(event.end_sec);
  return {
    id: event.timeline_event_id,
    label: String(event.label || "").trim().toLowerCase(),
    half: event.half ?? null,
    startSec,
    endSec,
    durationSec: Number(event.duration_sec ?? endSec - startSec),
    timestampSec: Number(event.timestamp_sec),
    highlightScore: Number(event.highlight_score ?? 0),
    confidence: Number(event.confidence ?? 0),
    minStartSec: Number(metadata.min_start_sec ?? startSec),
    maxEndSec: Number(metadata.max_end_sec ?? endSec),
    raw: event,
  };
}

export function adaptSessionClips(events) {
  return (events || []).map(adaptSessionClip);
}

export function adaptClipPlan(data) {
  return {
    id: data.clip_plan_id,
    projectId: data.project_id,
    summary: data.summary || "",
    totalDuration: data.actual_duration_sec ?? data.target_duration_sec ?? 0,
    itemEventIds: (data.items || []).map((item) => item.timeline_event_id).filter(Boolean),
    items: data.items || [],
    options: data.options || {},
  };
}
