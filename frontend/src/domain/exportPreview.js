function stampToSeconds(value) {
  if (typeof value === "number") return value;
  const [minutes, seconds] = String(value || "").split(":");
  if (seconds === undefined) return Number.parseFloat(minutes) || 0;
  return (Number.parseFloat(minutes) || 0) * 60 + (Number.parseFloat(seconds) || 0);
}

function normalizeSessionClip(clip) {
  return {
    id: String(clip.id),
    startSec: Number(clip.startSec),
    endSec: Number(clip.endSec),
    label: clip.label || "highlight",
  };
}

function normalizeSelectedEvent(event, durations) {
  const startSec = stampToSeconds(event.start);
  const sourceEndSec = stampToSeconds(event.end);
  const requestedEndSec = startSec + Number(durations[event.id] ?? event.duration ?? sourceEndSec - startSec);
  return {
    id: String(event.id),
    startSec,
    endSec: sourceEndSec > startSec ? Math.min(sourceEndSec, requestedEndSec) : requestedEndSec,
    label: event.tag || event.category || "highlight",
  };
}

export function buildExportPreviewClips({ mode, sessionClips = [], selectedEvents = [], agentDurations = {} }) {
  const source = mode === "match"
    ? sessionClips.map(normalizeSessionClip)
    : selectedEvents.map((event) => normalizeSelectedEvent(event, agentDurations));

  let renderStartSec = 0;
  return source
    .filter((clip) => Number.isFinite(clip.startSec) && Number.isFinite(clip.endSec) && clip.endSec > clip.startSec)
    .map((clip) => {
      const durationSec = clip.endSec - clip.startSec;
      const normalized = { ...clip, durationSec, renderStartSec };
      renderStartSec += durationSec;
      return normalized;
    });
}
