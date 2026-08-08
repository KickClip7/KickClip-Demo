function stampToSeconds(value) {
  if (typeof value === "number") return value;
  const [minutes, seconds] = String(value || "").split(":");
  if (seconds === undefined) return Number.parseFloat(minutes) || 0;
  return (Number.parseFloat(minutes) || 0) * 60 + (Number.parseFloat(seconds) || 0);
}

function timelineItemsFromClips(clips) {
  return clips.map((clip, index) => ({
    scene_id: String(clip.id),
    start_sec: Number(clip.startSec),
    end_sec: Number(clip.endSec),
    order_index: index,
    render_strategy: "FULL_FRAME",
    enabled: true,
  }));
}

function timelineItemsFromEvents(events, durations) {
  return events.map((event, index) => {
    const startSec = stampToSeconds(event.start);
    const eventEndSec = stampToSeconds(event.end);
    const requestedEndSec = startSec + Number(durations[event.id] ?? event.duration ?? eventEndSec - startSec);
    return {
      scene_id: String(event.id),
      start_sec: startSec,
      // Draft validation requires edits to remain inside the source scene.
      end_sec: Math.min(eventEndSec, requestedEndSec),
      order_index: index,
      render_strategy: "FULL_FRAME",
      enabled: true,
    };
  });
}

export function buildHighlightDraftPayload({
  mode,
  sessionClips,
  selectedEvents,
  agentDurations,
  agentSummary,
  exportRatio,
  captionsEnabled,
  selectedMusic,
  focusedEventId,
  eventFilter,
  selectedPlayerId,
  clipPlanId,
  expectedVersion,
}) {
  const timelineItems = mode === "match"
    ? timelineItemsFromClips(sessionClips)
    : timelineItemsFromEvents(selectedEvents, agentDurations);

  return {
    revision_id: null,
    clip_plan_id: clipPlanId || null,
    expected_version: expectedVersion ?? 0,
    selected_scene_ids: timelineItems.map((item) => item.scene_id),
    timeline_items: timelineItems,
    export_options: {
      ratio: exportRatio,
      captions_enabled: captionsEnabled,
      music: selectedMusic,
    },
    editor_state: {
      mode,
      focused_scene_id: focusedEventId == null ? null : String(focusedEventId),
      event_filter: eventFilter,
      selected_player_id: selectedPlayerId,
    },
    metadata: {
      agent_summary: agentSummary,
    },
  };
}

export function clipsFromHighlightDraft(draft, allClips) {
  if (!draft?.timeline_items?.length) return [];
  const clipsById = new Map(allClips.map((clip) => [String(clip.id), clip]));
  return [...draft.timeline_items]
    .sort((a, b) => a.order_index - b.order_index)
    .map((item) => {
      const clip = clipsById.get(String(item.scene_id));
      if (!clip || item.enabled === false) return null;
      return {
        ...clip,
        startSec: Number(item.start_sec),
        endSec: Number(item.end_sec),
        durationSec: Number(item.end_sec) - Number(item.start_sec),
      };
    })
    .filter(Boolean);
}

export function highlightDraftFingerprint(draft) {
  if (!draft) return null;
  return JSON.stringify({
    clip_plan_id: draft.clip_plan_id || null,
    selected_scene_ids: (draft.selected_scene_ids || []).map(String),
    timeline_items: (draft.timeline_items || []).map((item) => ({
      scene_id: String(item.scene_id),
      start_sec: Number(item.start_sec),
      end_sec: Number(item.end_sec),
      order_index: Number(item.order_index),
      render_strategy: item.render_strategy || "FULL_FRAME",
      enabled: item.enabled !== false,
    })),
    export_options: {
      ratio: draft.export_options?.ratio || "16:9",
      captions_enabled: draft.export_options?.captions_enabled ?? true,
      music: draft.export_options?.music || "Hype Beat 01",
    },
    editor_state: {
      mode: draft.editor_state?.mode || "match",
      focused_scene_id: draft.editor_state?.focused_scene_id == null
        ? null
        : String(draft.editor_state.focused_scene_id),
      event_filter: draft.editor_state?.event_filter || "all",
      selected_player_id: draft.editor_state?.selected_player_id || null,
    },
    metadata: {
      agent_summary: draft.metadata?.agent_summary || "",
    },
  });
}
