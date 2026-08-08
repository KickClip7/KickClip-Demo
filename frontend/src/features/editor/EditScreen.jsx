import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PersistentAgentPanel from "../../components/agent/PersistentAgentPanel.jsx";
import { eventColors, matchAgentPrompts, playerAgentPrompts, sessionAgentPrompts, sessionLabelMeta, sessionLabelOrder } from "../../data/mockData.js";
import { formatDuration } from "../../utils/format.js";
import { findPlayerKnowledge } from "../../utils/playerUtils.js";
import SessionVideoPlayer from "./SessionVideoPlayer.jsx";
import ShotBoundaryReviewPanel from "./ShotBoundaryReviewPanel.jsx";
import {
  clearShotBoundaryReviewScope,
  isShotBoundaryReady,
  loadShotBoundaryReviewScope,
} from "../../domain/shotBoundaryReview.js";
import { REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID } from "../../domain/candidateRecommendationPreparation.js";
import { completedTrackingVideoEntries } from "./completedTrackingVideos.js";
import {
  allowReplacementRetry,
  beginReplacementRequest,
  candidateReviewMatchesPending,
  isCrossShotConfirmation,
  normalizeCrossShotCandidates,
  crossShotWaitingContractViolation,
  isResolvedCrossShotAmbiguity,
  selectedTargetGalleryUrls,
  trackingAmbiguityDetails,
  trackingPendingActionValue,
  trackingScoreLabel,
  trackingJobProvenance,
} from "./trackingReplacement.js";
import {
  PROVENANCE_ERROR_CODE,
  canSelectCandidate,
  candidateReasonLabel,
  candidateMediaKeys,
  errorDisplayCode,
  isCandidateHardBlocked,
  splitCandidateRecommendations,
} from "./eventCandidateSelection.js";
import {
  candidateReviewTransition,
  chooseFreshTrackingJob,
  isR1TrackingJob,
  isTerminalTrackingStatus,
  normalizeTimelineFrames,
  terminalTrackingPresentation,
  trackingPollDelay,
} from "./trackingR1State.js";
import {
  loadTrackingRuns,
  saveTrackingRuns,
  trackingRunFromJob,
  upsertTrackingRun,
} from "./trackingR13Session.js";

// 5. 편집 화면을 이루는 작은 조각 컴포넌트

function EditorTopline({ mode, onClose, onBackToHighlights, onPreview, onSaveDraft, draftSaveBusy, draftUpdatedAt, isMockData }) {
  const title = mode === "match" ? "전체 경기 하이라이트" : "선수별 하이라이트";
  const savedLabel = draftUpdatedAt
    ? `${new Date(draftUpdatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 저장`
    : null;

  return (
    <div className={`editor-topline ${mode === "match" ? "match-editor-topline" : ""}`}>
      {mode !== "match" ? <button className="button ghost compact" type="button" onClick={onClose}>← 유형 다시 선택</button> : null}
      <div className="editor-heading-lockup">
        {mode === "match" ? <button className="page-back-button" type="button" onClick={onBackToHighlights}>← 하이라이트 목록</button> : null}
        {mode === "match" ? <p className="agent-label mini"><span></span> EDIT HIGHLIGHT</p> : null}
        <div className="editor-heading-copy"><strong>{title}</strong></div>
      </div>
      <div className="topline-actions">
        <div className="draft-save-control">
          <button
            className="button ghost compact draft-save-button"
            type="button"
            onClick={onSaveDraft}
            disabled={draftSaveBusy}
          >
            {draftSaveBusy ? "저장 중…" : "임시저장"}
          </button>
          {draftSaveBusy || savedLabel ? (
            <span className="draft-save-status" aria-live="polite">{draftSaveBusy ? "안전하게 저장하고 있어요" : savedLabel}</span>
          ) : null}
        </div>
        <button
          className="button primary compact"
          type="button"
          onClick={onPreview}
          disabled={isMockData}
          title={isMockData ? "개발용 목업 이벤트는 현재 테스트 영상 길이를 초과할 수 있어 렌더링할 수 없습니다." : undefined}
        >
          {isMockData ? "목업 모드 · 렌더링 불가" : "내보내기 →"}
        </button>
      </div>
    </div>
  );
}

function SourceMonitor({ uploadedVideo }) {
  return (
    <section className="source-monitor">
      <div className="field-monitor">
        <video id="editor-source-video" muted playsInline src={uploadedVideo || ""} className={uploadedVideo ? "has-source" : ""}></video>
        <div className="pitch-lines"><span className="midline"></span><span className="center-circle"></span><span className="box left"></span><span className="box right"></span></div>
        <span className="player-dot red p1"></span><span className="player-dot red p2"></span><span className="player-dot blue p3"></span><span className="player-dot blue p4"></span>
        <button className="monitor-play" type="button" aria-label="원본 영상 재생">▶</button>
      </div>
      <div className="monitor-controls"><button type="button">‹</button><button className="active" type="button">▶</button><button type="button">›</button><div className="scrub"><span></span></div><strong>00:67:32 / 01:30:00</strong></div>
    </section>
  );
}

function PlayerProfilePanel({ selectedPlayer, filteredEvents, profile }) {
  return (
    <section className="player-profile-panel">
      <div className="filter-label">TRACKED PLAYER</div>
      <div className="tracked-profile-card">
        <div className="tracked-capture"><span className="tracking-scan"></span><span className="tracked-capture-body"></span><span className="tracked-capture-number">{selectedPlayer.number}</span><span className="tracked-capture-label">CAM 02 · TRACK ID {selectedPlayer.id.toUpperCase()}</span></div>
        <div className="tracked-profile-info">
          <span className={`profile-state ${profile ? "resolved" : ""}`}>{profile ? "RAG PROFILE READY" : "IDENTITY UNKNOWN"}</span>
          <strong>{profile ? profile.displayName : "미확인 트래킹 선수"}</strong>
          {profile && <p>{profile.summary}</p>}
          <div className="profile-facts">
            <span><b>{filteredEvents.filter((event) => event.duration >= 5).length}</b><small>5초 이상 트래킹</small></span>
            <span><b>{profile ? profile.position : selectedPlayer.role}</b><small>포지션</small></span>
            <span><b>{profile ? profile.nationality : selectedPlayer.team}</b><small>{profile ? "국적" : "감지 팀"}</small></span>
          </div>
          {profile && <div className="profile-traits">{profile.traits.map((trait) => <em key={trait}>{trait}</em>)}</div>}
        </div>
      </div>
    </section>
  );
}

function FilterResultsPanel({ filteredEvents, focusedEventId, selectedIds, toggleEvent }) {
  return (
    <section className="event-timeline filter-results-panel">
      <div className="timeline-head"><span>필터 결과 목록</span></div>
      <div className="timeline-card-list">
        {filteredEvents.length ? filteredEvents.map((event) => (
          <button className={`filter-result-item ${event.id === focusedEventId ? "active" : ""} ${selectedIds.has(event.id) ? "selected" : ""}`} style={{ "--event-color": eventColors[event.category] }} type="button" key={event.id} onClick={() => toggleEvent(event.id)}>
            <b>{event.tag}</b><span>ID {String(event.id).padStart(2, "0")}</span><em>{event.start} - {event.end}</em>
          </button>
        )) : <div className="tl-empty">조건에 맞는 이벤트가 없습니다.</div>}
      </div>
    </section>
  );
}

function AgentSelectionPanel({ mode, filteredEvents, selectedEvents, focusedEventId, setFocusedEventId, agentDurations, totalDuration }) {
  const editEvents = selectedEvents.length ? selectedEvents : filteredEvents;
  const editDuration = selectedEvents.length ? totalDuration : editEvents.reduce((sum, event) => sum + event.duration, 0);

  return (
    <section className="event-timeline agent-selection-panel manual-editor-panel">
      <div className="manual-editor-head">
        <div>
          <span>직접 편집 타임라인</span>
          <em>{selectedEvents.length ? `Agent 구성안 · ${selectedEvents.length}개 클립 · ${formatDuration(editDuration)}` : `${editEvents.length}개 후보 클립 · 원하는 장면을 눌러 선택`}</em>
        </div>
        <div className="manual-tools" aria-label="편집 도구">
          <button type="button">분할</button>
          <button type="button">삭제</button>
          <button type="button">속도</button>
          <button type="button">자막</button>
        </div>
      </div>
      <div className="manual-timeline-scroll">
        <div className="manual-time-ruler" aria-hidden="true">
          {["00:00", "00:10", "00:20", "00:30", "00:40", "00:50", "01:00", "01:10", "01:20"].map((time) => <span key={time}>{time}</span>)}
        </div>
        <div className="manual-tracks">
          <span className="manual-playhead" aria-hidden="true"></span>
          <div className="track-label">V1</div>
          <div className="track-lane video-track">
            {editEvents.length ? editEvents.map((event, index) => (
              <button
                className={`manual-clip ${event.id === focusedEventId ? "active" : ""}`}
                style={{
                  "--event-color": eventColors[event.category],
                  left: `${Math.min(86, 4 + index * 12)}%`,
                  width: `${Math.max(7, Math.min(18, (agentDurations[event.id] ?? event.duration) * 1.3))}%`,
                }}
                type="button"
                key={event.id}
                onClick={() => setFocusedEventId(event.id)}
              >
                <b>{event.tag}</b>
                <span>{event.start}</span>
              </button>
            )) : <div className="manual-empty">편집할 이벤트가 없습니다.</div>}
          </div>
          <div className="track-label">A1</div>
          <div className="track-lane audio-track">
            <span className="audio-clip"><b>{selectedEvents.length ? "Agent Mix" : "Original Audio"}</b><i></i></span>
          </div>
          <div className="track-label">T</div>
          <div className="track-lane caption-track">
            {(mode === "player" ? editEvents.slice(0, 4) : editEvents.slice(0, 5)).map((event, index) => (
              <button
                className="caption-clip"
                style={{ left: `${6 + index * 17}%`, width: `${Math.max(10, Math.min(18, event.duration * 1.2))}%` }}
                type="button"
                key={`caption-${event.id}`}
                onClick={() => setFocusedEventId(event.id)}
              >
                {event.tag}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// 6. 세션 에이전트(챗봇 편집, 45개 목업 이벤트) 전용 패널들 — mode==="match"에서만 사용한다.

function SessionFilterPanel({ allEvents, labelFilter, setLabelFilter, teamOptions, teamScope, setTeamScope, teamCounts }) {
  const counts = useMemo(() => {
    const base = { all: allEvents.length };
    sessionLabelOrder.forEach((label) => { base[label] = 0; });
    allEvents.forEach((event) => { base[event.label] = (base[event.label] || 0) + 1; });
    return base;
  }, [allEvents]);

  return (
    <section className="match-filter-panel">
      <div className="filter-label">ACTION SPOTTING</div>
      <div className="team-scope-control">
        <div>
          {teamOptions.map((team) => (
            <button
              className={teamScope === team.id ? "active" : ""}
              type="button"
              key={team.id}
              onClick={() => setTeamScope(team.id)}
            >
              {team.label}
              <small>{teamCounts[team.id] || 0}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="event-filter-tabs">
        <button className={`event-tab ${labelFilter === "all" ? "active" : ""}`} type="button" onClick={() => setLabelFilter("all")}>
          전체 <span>{counts.all || 0}</span>
        </button>
        {sessionLabelOrder.map((label) => (
          <button
            className={`event-tab ${labelFilter === label ? "active" : ""}`}
            style={{ "--event-color": sessionLabelMeta[label].color }}
            type="button"
            key={label}
            onClick={() => setLabelFilter(label)}
          >
            {sessionLabelMeta[label].ko} <span>{counts[label] || 0}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SessionResultsPanel({ clips, focusedClipId, selectedIds, onSelect }) {
  return (
    <section className="event-timeline filter-results-panel">
      <div className="timeline-head"><span>필터 결과 목록</span></div>
      <div className="timeline-card-list">
        {clips.length ? clips.map((clip) => (
          <button
            className={`filter-result-item session-filter-result-item ${clip.id === focusedClipId ? "active" : ""} ${selectedIds?.has(clip.id) ? "selected" : ""}`}
            style={{ "--event-color": sessionLabelMeta[clip.label]?.color || "#d4ff00" }}
            type="button"
            key={clip.id}
            aria-pressed={selectedIds?.has(clip.id) || false}
            onClick={() => onSelect(clip)}
          >
            <b>{sessionLabelMeta[clip.label]?.ko || clip.label}</b>
            <em>{formatDuration(Math.round(clip.startSec))} – {formatDuration(Math.round(clip.endSec))}</em>
          </button>
        )) : <div className="tl-empty">조건에 맞는 클립이 없습니다.</div>}
      </div>
    </section>
  );
}

const ZOOM_MIN_PX_PER_SEC = 0.15;
const ZOOM_MAX_PX_PER_SEC = 320;
// 짧은 구성본도 처음부터 1초 눈금으로 과도하게 확대되지 않도록 초기 자동 맞춤 배율만 제한한다.
// 사용자가 직접 확대할 때는 ZOOM_MAX_PX_PER_SEC까지 계속 확대할 수 있다.
const INITIAL_ZOOM_MAX_PX_PER_SEC = 30;
const TIMELINE_ZOOM_STORAGE_KEY = "kickclip:manual-timeline-zoom";
const TIMELINE_MIN_CLIP_PX = 10;
// 세션 타임라인은 별도 트랙 라벨 열 없이 레일이 왼쪽부터 시작한다.
const TRACK_LABEL_OFFSET_PX = 0;

function clampZoom(value) {
  return Math.min(ZOOM_MAX_PX_PER_SEC, Math.max(ZOOM_MIN_PX_PER_SEC, value));
}

function readSavedTimelineZoom() {
  if (typeof window === "undefined") return null;
  try {
    const savedZoom = Number(window.localStorage.getItem(TIMELINE_ZOOM_STORAGE_KEY));
    return Number.isFinite(savedZoom) && savedZoom > 0 ? clampZoom(savedZoom) : null;
  } catch {
    return null;
  }
}

function rulerStepForZoom(pxPerSec) {
  if (pxPerSec >= 150) return 1;
  if (pxPerSec >= 60) return 2;
  if (pxPerSec >= 30) return 5;
  if (pxPerSec >= 12) return 10;
  if (pxPerSec >= 6) return 30;
  if (pxPerSec >= 1) return 60;
  if (pxPerSec >= 0.3) return 300;
  return 600;
}

// REORDER_DRAG_THRESHOLD_PX보다 적게 움직이면 클릭(선택)으로, 넘게 움직이면 재정렬 드래그로 취급한다.
const REORDER_DRAG_THRESHOLD_PX = 6;

// position 레이아웃(원본 전체 경기 탭)에서는 clip.startSec 기준 실제 위치에 배치하고,
// sequence 레이아웃(하이라이트 구성본 탭)에서는 부모가 계산한 renderStartSec(빈틈없이 이어붙인 좌표)을 쓴다.
function SessionTimelineClip({ clip, pxPerSec, focused, showDivider, onSelect, onResize, onReorderDrag, onDragActiveChange, clipRef }) {
  const renderStartSec = clip.renderStartSec ?? clip.startSec;
  // 재정렬 드래그 중에는 클립이 슬롯 위치가 아니라 마우스를 그대로 따라가도록 로컬 오프셋으로 렌더링한다.
  const [dragState, setDragState] = useState(null); // { frozenLeftPx, deltaPx } | null

  function startResizeDrag(edge, event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const frozenStart = clip.startSec;
    const frozenEnd = clip.endSec;

    // 여유 범위(minStartSec~maxEndSec) 안에서 늘리기/줄이기(트리밍) 모두 자유롭게 허용, 최소 길이 1초 보장.
    function onMove(moveEvent) {
      const deltaSec = (moveEvent.clientX - startX) / pxPerSec;
      if (edge === "start") {
        const next = Math.min(Math.max(clip.minStartSec, frozenStart + deltaSec), frozenEnd - 1);
        onResize(clip.id, { startSec: next, endSec: frozenEnd });
      } else {
        const next = Math.max(Math.min(clip.maxEndSec, frozenEnd + deltaSec), frozenStart + 1);
        onResize(clip.id, { startSec: frozenStart, endSec: next });
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startBodyDrag(event) {
    event.stopPropagation();
    if (!onReorderDrag) return;
    const startX = event.clientX;
    const frozenLeftPx = renderStartSec * pxPerSec;
    let dragging = false;

    // frozenLeftPx는 제스처 시작 시점의 슬롯 좌표로 고정한다 — 도중에 다른 클립들이 밀려서
    // renderStartSec이 바뀌어도 잡고 있는 클립 자체는 항상 마우스 이동량만큼만 움직여 커서를 그대로 따라간다.
    function onMove(moveEvent) {
      const deltaPx = moveEvent.clientX - startX;
      if (!dragging) {
        if (Math.abs(deltaPx) < REORDER_DRAG_THRESHOLD_PX) return;
        dragging = true;
        onDragActiveChange?.(true);
      }
      setDragState({ frozenLeftPx, deltaPx });
      const ghostSec = Math.max(0, (frozenLeftPx + deltaPx) / pxPerSec);
      onReorderDrag(clip.id, ghostSec);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragging) {
        setDragState(null);
        onDragActiveChange?.(false);
      } else {
        onSelect(clip);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const leftPx = dragState ? dragState.frozenLeftPx + dragState.deltaPx : renderStartSec * pxPerSec;

  return (
    <button
      ref={clipRef}
      className={`manual-clip session-clip ${focused ? "active" : ""} ${dragState ? "dragging" : ""} ${showDivider ? "clip-divider" : ""}`}
      style={{
        "--event-color": sessionLabelMeta[clip.label]?.color || "#d4ff00",
        left: `${leftPx}px`,
        width: `${Math.max(TIMELINE_MIN_CLIP_PX, clip.durationSec * pxPerSec)}px`,
      }}
      type="button"
      title={onReorderDrag ? "가장자리를 드래그해 길이 조절, 클립을 드래그해 순서 변경" : `원본 ${formatDuration(Math.round(clip.startSec))} 지점 · 가장자리를 드래그해 길이 조절`}
      onClick={() => { if (!onReorderDrag) onSelect(clip); }}
      onPointerDown={onReorderDrag ? startBodyDrag : (event) => event.stopPropagation()}
    >
      <span className="clip-handle clip-handle-start" onPointerDown={(event) => startResizeDrag("start", event)} aria-hidden="true"></span>
      <b>{sessionLabelMeta[clip.label]?.ko || clip.label}</b>
      <span>{formatDuration(Math.round(clip.startSec))}</span>
      <span className="clip-handle clip-handle-end" onPointerDown={(event) => startResizeDrag("end", event)} aria-hidden="true"></span>
    </button>
  );
}

function SessionTimelinePanel({ clips, focusedClipId, focusRequestKey, totalDuration, layout = "position", playbackSec, onSelect, onResize, onReorder, onScrub, onDeleteClip, onOpenTracking }) {
  const [pxPerSec, setPxPerSec] = useState(() => readSavedTimelineZoom() ?? ZOOM_MIN_PX_PER_SEC);
  const [hasFitted, setHasFitted] = useState(() => readSavedTimelineZoom() != null);
  const [scrubSec, setScrubSec] = useState(null);
  // 재정렬 드래그가 진행 중일 때만 클립들의 left 이동에 transition을 걸어 밀려나는 게 보이게 한다.
  // 확대/축소로 left가 바뀔 때는 이 클래스가 꺼져 있어야 앵커 확대 로직과 충돌하지 않는다.
  const [reorderActive, setReorderActive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef(null);
  const focusedClipRef = useRef(null);

  const clipDuration = clips.reduce((sum, clip) => sum + clip.durationSec, 0);
  const trackWidth = Math.max(200, Math.round(totalDuration * pxPerSec));
  const rulerStep = rulerStepForZoom(pxPerSec);
  const rulerMarks = useMemo(() => {
    const marks = [];
    for (let t = 0; t <= totalDuration; t += rulerStep) marks.push(t);
    return marks;
  }, [totalDuration, rulerStep]);
  const focusedClip = clips.find((clip) => clip.id === focusedClipId) || null;
  // 드래그로 직접 스크럽 중이면 그 위치, 아니면 실제 영상 재생 위치를 기준선으로 따라가고,
  // 재생이 아직 시작 안 됐으면 선택된 클립의 시작 지점을 보여준다.
  const markerSec = scrubSec ?? playbackSec ?? (focusedClip ? (focusedClip.renderStartSec ?? focusedClip.startSec) : null);
  const zoomAnchorRef = useRef(null); // { sec, clientOffset } — 확대 시 이 지점이 화면에서 안 움직이게 고정한다.

  // 처음 로드될 때 전체 타임라인이 스크롤 없이 한 화면에 들어오도록 배율을 자동 계산하되,
  // 짧은 구성본을 패널 너비까지 억지로 늘려 1초 눈금이 되는 것은 방지한다.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || hasFitted || totalDuration <= 0) return;
    const available = Math.max(100, container.clientWidth - TRACK_LABEL_OFFSET_PX - 16);
    setPxPerSec(clampZoom(Math.min(available / totalDuration, INITIAL_ZOOM_MAX_PX_PER_SEC)));
    setHasFitted(true);
  }, [totalDuration, hasFitted]);

  // 사용자가 맞춘 확대 수준을 다음 진입에서도 기본 눈금으로 그대로 복원한다.
  useEffect(() => {
    try {
      window.localStorage.setItem(TIMELINE_ZOOM_STORAGE_KEY, String(pxPerSec));
    } catch {
      // 저장소가 비활성화된 환경에서는 현재 세션의 확대/축소만 유지한다.
    }
  }, [pxPerSec]);

  // 다른 클립을 선택하면 이전에 열려 있던 삭제 확인 팝업은 닫는다.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [focusedClipId, focusRequestKey, clips.length]);

  async function handleConfirmDelete() {
    if (!focusedClip || !onDeleteClip) return;
    setDeleting(true);
    try {
      await onDeleteClip(focusedClip);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  // 클립을 선택했을 때만 그 클립이 보이도록 스크롤한다(확대/축소 자체로는 스크롤 위치를 안 건드림 — 그건 아래 앵커 확대 로직이 담당).
  useEffect(() => {
    const container = scrollRef.current;
    const clipEl = focusedClipRef.current;
    if (!container || !clipEl) return;
    const targetLeft = clipEl.offsetLeft - container.clientWidth / 2 + clipEl.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
  }, [focusedClipId]);

  function secondsFromClientX(clientX) {
    const container = scrollRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const xInTrack = clientX - rect.left + container.scrollLeft - TRACK_LABEL_OFFSET_PX;
    return Math.max(0, Math.min(totalDuration, xInTrack / pxPerSec));
  }

  // 확대/축소 후 방금 보고 있던 지점(anchor)이 화면상 같은 위치에 남도록 스크롤을 보정한다.
  // 이게 없으면 배율만 커지고 스크롤 위치는 그대로라 내용이 오른쪽으로 쭉 밀려나가는 것처럼 보인다.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const container = scrollRef.current;
    if (!anchor || !container) return;
    container.scrollLeft = Math.max(0, anchor.sec * pxPerSec - anchor.clientOffset + TRACK_LABEL_OFFSET_PX);
    zoomAnchorRef.current = null;
  }, [pxPerSec]);

  function zoomByFactor(factor, clientX) {
    const container = scrollRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const anchorClientX = clientX ?? rect.left + container.clientWidth / 2;
      zoomAnchorRef.current = {
        sec: secondsFromClientX(anchorClientX),
        clientOffset: anchorClientX - rect.left,
      };
    }
    setPxPerSec((prev) => clampZoom(prev * factor));
  }

  // React onWheel은 기본적으로 passive 리스너라 preventDefault가 브라우저의 Ctrl+휠(트랙패드 핀치)
  // 페이지 확대를 못 막는다. 네이티브 리스너를 passive:false로 직접 붙여서 타임라인만 확대/축소되게 한다.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;

    function onNativeWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomByFactor(event.deltaY < 0 ? 1.18 : 0.85, event.clientX);
    }

    container.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => container.removeEventListener("wheel", onNativeWheel);
  }, [pxPerSec, totalDuration]);

  // sequence 레이아웃에서는 눈금자 위치(누적 재생 시간)가 특정 클립+그 클립 내부 오프셋에 대응한다.
  function findClipAtSequenceTime(seconds) {
    if (!clips.length) return null;
    for (const clip of clips) {
      const start = clip.renderStartSec ?? 0;
      if (seconds < start + clip.durationSec) {
        return { clip, offsetSec: Math.max(0, seconds - start) };
      }
    }
    const last = clips[clips.length - 1];
    return { clip: last, offsetSec: last.durationSec };
  }

  function startScrub(event) {
    event.preventDefault();
    const seek = (clientX) => {
      const seconds = secondsFromClientX(clientX);
      setScrubSec(seconds);
      if (layout === "sequence") {
        const hit = findClipAtSequenceTime(seconds);
        if (hit) onScrub(hit);
      } else {
        onScrub(seconds);
      }
    };
    seek(event.clientX);

    function onMove(moveEvent) {
      seek(moveEvent.clientX);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // 드래그를 놓으면 다시 실제 재생 위치(playbackSec)가 기준선을 따라가도록 스크럽 고정을 푼다.
      setScrubSec(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleSelectClip(clip) {
    setScrubSec(null);
    onSelect(clip);
  }

  // 재정렬 드래그 중 계속 불려서, 드래그 중인 클립의 "유령 위치"가 형제 클립들 중간점을 넘어설 때만
  // 실제 순서 변경(onReorder)을 호출한다(불필요한 리렌더 방지).
  function handleReorderDrag(clipId, ghostSec) {
    if (!onReorder) return;
    const currentIndex = clips.findIndex((clip) => clip.id === clipId);
    if (currentIndex === -1) return;
    const dragged = clips[currentIndex];
    const others = clips.filter((clip) => clip.id !== clipId);
    const ghostMid = ghostSec + dragged.durationSec / 2;
    let targetIndex = others.findIndex((clip) => ghostMid < (clip.renderStartSec ?? 0) + clip.durationSec / 2);
    if (targetIndex === -1) targetIndex = others.length;
    if (targetIndex !== currentIndex) onReorder(clipId, targetIndex);
  }

  return (
    <section className="event-timeline agent-selection-panel manual-editor-panel">
      <div className="manual-editor-head">
        <div>
          <span>타임라인 수동 편집</span>
          <em>
            {clips.length}개 클립 · {formatDuration(Math.round(clipDuration))}
            {focusedClip ? ` · 선택한 클립은 원본 ${formatDuration(Math.round(focusedClip.startSec))} 지점` : ""}
            {layout === "sequence"
              ? " · 눈금자/재생헤드를 드래그해 구성본을 탐색, 가장자리를 드래그해 길이 조절, 클립을 드래그해 순서 변경"
              : " · 눈금자/재생헤드를 드래그해 원본을 탐색, 가장자리를 드래그해 길이 조절"}
          </em>
        </div>
        <div className="session-zoom-controls">
          {onOpenTracking ? (
            <button
              type="button"
              className="session-tracking-trigger"
              disabled={!focusedClip}
              onClick={() => onOpenTracking(focusedClip)}
            >
              ◎ 선수 트래킹
            </button>
          ) : null}
          <button type="button" onClick={() => zoomByFactor(1 / 1.6)} aria-label="타임라인 축소">－</button>
          <button type="button" onClick={() => zoomByFactor(1.6)} aria-label="타임라인 확대">＋</button>
          {onDeleteClip ? (
            <div className="session-delete-control">
              <button
                type="button"
                className="session-delete-trigger"
                aria-label="선택한 클립 삭제"
                title={focusedClip ? "선택한 클립 삭제" : "삭제하려면 먼저 클립을 선택하세요"}
                disabled={!focusedClip || deleting}
                onClick={() => setConfirmingDelete(true)}
              >
                🗑
              </button>
              {confirmingDelete ? (
                <div className="session-delete-confirm">
                  <span>이 클립을 삭제하시겠습니까?</span>
                  <div className="session-delete-confirm-actions">
                    <button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>아니오</button>
                    <button type="button" className="danger" onClick={handleConfirmDelete} disabled={deleting}>
                      {deleting ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="manual-timeline-scroll" ref={scrollRef}>
        <div
          className="manual-time-ruler session-ruler"
          style={{ width: `${trackWidth}px` }}
          onPointerDown={startScrub}
        >
          {rulerMarks.map((mark) => (
            <span key={mark} style={{ left: `${mark * pxPerSec}px` }} aria-hidden="true">{formatDuration(mark)}</span>
          ))}
        </div>
        <div className="manual-tracks session-tracks" style={{ width: `${trackWidth}px` }}>
          {markerSec != null ? (
            <span
              className="manual-playhead session-position-marker"
              style={{ left: `${markerSec * pxPerSec}px` }}
              onPointerDown={startScrub}
              role="slider"
              aria-label="재생 위치"
              aria-valuenow={Math.round(markerSec)}
              aria-valuemin={0}
              aria-valuemax={Math.round(totalDuration)}
              tabIndex={0}
            ></span>
          ) : null}
          <div className={`track-lane video-track ${reorderActive ? "reordering" : ""}`} onPointerDown={startScrub}>
            {clips.length ? clips.map((clip, index) => (
              <SessionTimelineClip
                key={clip.id}
                clip={clip}
                pxPerSec={pxPerSec}
                focused={clip.id === focusedClipId}
                showDivider={layout === "sequence" && index > 0}
                clipRef={clip.id === focusedClipId ? focusedClipRef : null}
                onDragActiveChange={layout === "sequence" && onReorder ? setReorderActive : null}
                onSelect={handleSelectClip}
                onResize={onResize}
                onReorderDrag={layout === "sequence" && onReorder ? handleReorderDrag : null}
              />
            )) : <div className="manual-empty">편집할 클립이 없습니다.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function CompletedTrackingVideos({ editState, getCompletedTrackingPreview }) {
  const entries = useMemo(
    () => completedTrackingVideoEntries(editState),
    [editState],
  );
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loadingJobId, setLoadingJobId] = useState(null);
  const [error, setError] = useState("");
  const objectUrlsRef = useRef([]);
  const requestRef = useRef(null);

  function releaseObjectUrls() {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }

  useEffect(() => {
    if (!entries.length) {
      setSelectedJobId(null);
      return;
    }
    if (!entries.some((entry) => entry.trackingJobId === selectedJobId)) {
      setSelectedJobId(entries[0].trackingJobId);
    }
  }, [entries, selectedJobId]);

  useEffect(() => () => {
    requestRef.current?.abort();
    releaseObjectUrls();
  }, []);

  async function loadPreview(entry) {
    if (!getCompletedTrackingPreview || loadingJobId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSelectedJobId(entry.trackingJobId);
    setLoadingJobId(entry.trackingJobId);
    setError("");
    try {
      const result = await getCompletedTrackingPreview(entry.trackingJobId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      releaseObjectUrls();
      const artifacts = (result.artifacts || []).map((artifact) => {
        const objectUrl = URL.createObjectURL(artifact.blob);
        objectUrlsRef.current.push(objectUrl);
        return { ...artifact, objectUrl };
      });
      setPreview({ ...result, artifacts });
      if (!artifacts.length) setError("완료된 트래킹 미리보기 파일이 없습니다.");
    } catch (loadError) {
      if (loadError?.name !== "AbortError") {
        setError(loadError?.detail || loadError?.message || "트래킹 영상을 불러오지 못했습니다.");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoadingJobId(null);
    }
  }

  if (!entries.length) return null;
  const selectedEntry = entries.find((entry) => entry.trackingJobId === selectedJobId) || entries[0];
  const artifactsByKey = Object.fromEntries(
    (preview?.artifacts || []).map((artifact) => [artifact.key, artifact]),
  );

  return (
    <section className="completed-tracking-videos" aria-labelledby="completed-tracking-title">
      <header>
        <div>
          <span>TRACKING OUTPUTS</span>
          <strong id="completed-tracking-title">완료된 트래킹 영상</strong>
          <small>새로고침 후에도 프로젝트에 연결된 결과를 다시 불러올 수 있습니다.</small>
        </div>
        <span>{entries.length}개</span>
      </header>
      <div className="completed-tracking-layout">
        <div className="completed-tracking-list">
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.trackingJobId}
              className={entry.trackingJobId === selectedEntry.trackingJobId ? "is-active" : ""}
              onClick={() => loadPreview(entry)}
            >
              <strong>{entry.durationSec.toFixed(1)}초 트래킹 하이라이트</strong>
              <span>{entry.trackingJobId}</span>
              <small>ClipPlan {entry.clipPlanId} · {entry.ratio || "비율 미지정"}</small>
              <em>{loadingJobId === entry.trackingJobId ? "영상 불러오는 중…" : "트래킹 영상 보기"}</em>
            </button>
          ))}
        </div>
        <div className="completed-tracking-viewer">
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          {preview && selectedEntry.trackingJobId === (preview.job?.tracking_job_id || preview.job?.job_id) ? (
            <>
              {artifactsByKey.target_centered_preview ? (
                <figure>
                  <video src={artifactsByKey.target_centered_preview.objectUrl} controls playsInline preload="metadata" />
                  <figcaption>선수 중심 트래킹 영상</figcaption>
                </figure>
              ) : null}
              {artifactsByKey.tracking_preview ? (
                <details>
                  <summary>전체 프레임 트래킹 영상 보기</summary>
                  <video src={artifactsByKey.tracking_preview.objectUrl} controls playsInline preload="metadata" />
                </details>
              ) : null}
            </>
          ) : (
            <div className="completed-tracking-empty">
              <strong>{selectedEntry.trackingJobId}</strong>
              <span>왼쪽의 “트래킹 영상 보기”를 눌러 미리보기를 불러오세요.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TrackingWorkbench({
  projectId,
  clip,
  open,
  onToggle,
  showToast,
  prepareTrackingCandidates,
  resumeTrackingCandidatesAfterBoundaryReview,
  getShotBoundaryReview,
  prepareNewShotBoundaryReview,
  saveShotBoundaryDraft,
  resetShotBoundaryDraft,
  confirmShotBoundaryReview,
  retryShotBoundaryDetections,
  downloadShotBoundaryMedia,
  downloadCandidateReviewMedia,
  prepareReplacementTrackingCandidates,
  retryCandidatePreparation,
  createCandidateSelection,
  createCandidateTracking,
  getTrackingJobState,
  getTrackingDiagnostics,
  getTrackingResult,
  getTrackingReview,
  submitTrackingReview,
  confirmTrackingAmbiguity,
  includeTrackingHighlightCandidate,
}) {
  const [stage, setStage] = useState("idle");
  const [selectedTrackingPlayerId, setSelectedTrackingPlayerId] = useState(null);
  const [detectedPlayers, setDetectedPlayers] = useState([]);
  const [trackingContext, setTrackingContext] = useState(null);
  const [trackingStatus, setTrackingStatus] = useState(null);
  const [trackingReview, setTrackingReview] = useState(null);
  const [trackingResult, setTrackingResult] = useState(null);
  const [highlightCandidate, setHighlightCandidate] = useState(null);
  const [highlightCandidateError, setHighlightCandidateError] = useState("");
  const [highlightCandidateBusy, setHighlightCandidateBusy] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState("");
  const [trackingSubmitting, setTrackingSubmitting] = useState(false);
  const [ambiguitySubmitting, setAmbiguitySubmitting] = useState(false);
  const [ambiguityCandidateIndex, setAmbiguityCandidateIndex] = useState(0);
  const [ambiguityImageLoaded, setAmbiguityImageLoaded] = useState({});
  const [ambiguityImageErrors, setAmbiguityImageErrors] = useState({});
  const [ambiguityFailedChoice, setAmbiguityFailedChoice] = useState(null);
  const [ambiguityLightbox, setAmbiguityLightbox] = useState(null);
  const [candidateVideoPreview, setCandidateVideoPreview] = useState(null);
  const [candidateImagePreview, setCandidateImagePreview] = useState(null);
  const [candidateMediaLoading, setCandidateMediaLoading] = useState({});
  const [candidateVideoPlaybackError, setCandidateVideoPlaybackError] = useState("");
  const [candidateReviewState, setCandidateReviewState] = useState("SAME_PLAYER");
  const [absentEvidenceOpened, setAbsentEvidenceOpened] = useState({ fullFrame: false, shotClip: false });
  const [failureAction, setFailureAction] = useState("");
  const [reviewPlaybackErrors, setReviewPlaybackErrors] = useState({});
  const [trackingError, setTrackingError] = useState("");
  const [selectedCandidateSnapshot, setSelectedCandidateSnapshot] = useState(null);
  const [selectionRecord, setSelectionRecord] = useState(null);
  const [trackingHandoff, setTrackingHandoff] = useState(null);
  const [ambiguityMediaTab, setAmbiguityMediaTab] = useState("bestCropDisplayUrl");
  const [candidateReviewHttpStatus, setCandidateReviewHttpStatus] = useState(null);
  const [reviewedCandidateIds, setReviewedCandidateIds] = useState([]);
  const [preparingNextCandidates, setPreparingNextCandidates] = useState(false);
  const [candidatePreparationState, setCandidatePreparationState] = useState(null);
  const [candidatePreparationFailure, setCandidatePreparationFailure] = useState(null);
  const [shotBoundaryReview, setShotBoundaryReview] = useState(null);
  const [boundaryReopenBusy, setBoundaryReopenBusy] = useState(false);
  const [trackingDiagnostics, setTrackingDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [trackingRuns, setTrackingRuns] = useState(() => loadTrackingRuns());
  const [restoringTrackingJobId, setRestoringTrackingJobId] = useState(null);
  const reviewObjectUrlsRef = useRef([]);
  const candidateObjectUrlsRef = useRef([]);
  const candidateLazyMediaCacheRef = useRef(new Map());
  const candidateLazyMediaPromiseRef = useRef(new Map());
  const latestTrackingJobRef = useRef(null);
  const replacementRequestRef = useRef(false);
  const rejectedTrackingRef = useRef(false);
  const activeRequestAbortRef = useRef(null);
  const discoveryRequestRef = useRef(null);
  const trackingSubmitRef = useRef(null);
  const reviewSubmitRef = useRef(null);
  const ambiguitySubmitRef = useRef(null);
  const restoredJobRef = useRef(null);
  const highlightCandidateJobRef = useRef(null);

  function persistTrackingRun(job, contextPatch = {}) {
    const context = {
      projectId,
      ...trackingContext,
      ...contextPatch,
    };
    setTrackingRuns((current) => {
      const jobId = job?.tracking_job_id || job?.job_id || context.jobId;
      if (isTerminalTrackingStatus(job?.status)) {
        return saveTrackingRuns(current.filter((run) => run.trackingJobId !== jobId));
      }
      const previous = current.find((run) => run.trackingJobId === jobId) || {};
      const nextRun = trackingRunFromJob({
        ...context,
        reviewedCandidateIds: contextPatch.reviewedCandidateIds || reviewedCandidateIds,
      }, job, previous);
      return saveTrackingRuns(upsertTrackingRun(current, nextRun));
    });
  }

  async function refreshTrackingDiagnostics(refresh = false) {
    if (!getTrackingDiagnostics || diagnosticsLoading) return null;
    setDiagnosticsLoading(true);
    try {
      const diagnostics = await getTrackingDiagnostics({ refresh });
      setTrackingDiagnostics(diagnostics);
      return diagnostics;
    } catch (error) {
      const diagnostics = {
        available: false,
        code: error?.code || "TRACKING_DIAGNOSTICS_UNAVAILABLE",
        message: error?.detail || error?.message || "Tracking runtime 진단을 불러오지 못했습니다.",
      };
      setTrackingDiagnostics(diagnostics);
      return diagnostics;
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  function beginTrackedRequest() {
    activeRequestAbortRef.current?.abort();
    const controller = new AbortController();
    activeRequestAbortRef.current = controller;
    return controller;
  }

  function finishTrackedRequest(controller) {
    if (activeRequestAbortRef.current === controller) {
      activeRequestAbortRef.current = null;
    }
  }

  function releaseReviewObjectUrls() {
    reviewObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    reviewObjectUrlsRef.current = [];
  }

  useEffect(() => {
    if (!open || !getShotBoundaryReview || shotBoundaryReview) return;
    const saved = loadShotBoundaryReviewScope();
    if (!saved || saved.projectId !== String(projectId) || (clip?.id && saved.sceneId !== String(clip.id))) return;
    let cancelled = false;
    getShotBoundaryReview(saved).then((reviewState) => {
      if (cancelled) return;
      if (isShotBoundaryReady(reviewState)) {
        clearShotBoundaryReviewScope();
        return;
      }
      setShotBoundaryReview({ scope: { ...saved, editorClipId: clip?.id }, state: reviewState });
      setStage("waiting-boundary-review");
    }).catch(() => {
      clearShotBoundaryReviewScope();
    });
    return () => { cancelled = true; };
  }, [open, projectId, clip?.id, getShotBoundaryReview, shotBoundaryReview]);

  useEffect(() => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    releaseReviewObjectUrls();
    releaseCandidateObjectUrls();
    latestTrackingJobRef.current = null;
    setStage("idle");
    setSelectedTrackingPlayerId(null);
    setDetectedPlayers([]);
    setTrackingContext(null);
    setTrackingStatus(null);
    setTrackingReview(null);
    setTrackingResult(null);
    setHighlightCandidate(null);
    setHighlightCandidateError("");
    setHighlightCandidateBusy(false);
    setReviewLoading(false);
    setReviewSubmitting("");
    setTrackingSubmitting(false);
    setAmbiguitySubmitting(false);
    setAmbiguityCandidateIndex(0);
    setAmbiguityImageLoaded({});
    setAmbiguityImageErrors({});
    setAmbiguityFailedChoice(null);
    setAmbiguityLightbox(null);
    setCandidateVideoPreview(null);
    setCandidateImagePreview(null);
    setCandidateMediaLoading({});
    setCandidateVideoPlaybackError("");
    setCandidateReviewState("SAME_PLAYER");
    setAbsentEvidenceOpened({ fullFrame: false, shotClip: false });
    setFailureAction("");
    setReviewPlaybackErrors({});
    setTrackingError("");
    setSelectedCandidateSnapshot(null);
    setSelectionRecord(null);
    setTrackingHandoff(null);
    setAmbiguityMediaTab("bestCropDisplayUrl");
    setCandidateReviewHttpStatus(null);
    setReviewedCandidateIds([]);
    setPreparingNextCandidates(false);
    setCandidatePreparationState(null);
    setCandidatePreparationFailure(null);
    replacementRequestRef.current = false;
    rejectedTrackingRef.current = false;
    discoveryRequestRef.current = null;
    trackingSubmitRef.current = null;
    reviewSubmitRef.current = null;
    ambiguitySubmitRef.current = null;
    restoredJobRef.current = null;
    highlightCandidateJobRef.current = null;
  }, [projectId, clip?.id]);

  useEffect(() => () => {
    activeRequestAbortRef.current?.abort();
    releaseReviewObjectUrls();
    releaseCandidateObjectUrls();
  }, []);

  useEffect(() => {
    // Defensive recovery for Fast Refresh or a previously aborted follow-up
    // poll that left only the visual submitting flag behind.
    if (ambiguitySubmitting && !ambiguitySubmitRef.current) {
      setAmbiguitySubmitting(false);
    }
  }, [
    ambiguitySubmitting,
    trackingReview?.job?.updated_at,
    trackingReview?.job?.pending_ambiguity_id,
  ]);

  useEffect(() => {
    if (open && !trackingDiagnostics && getTrackingDiagnostics) refreshTrackingDiagnostics(false);
  }, [open, getTrackingDiagnostics]);

  async function loadTrackingReview(
    sceneStatus,
    { preserveError = false, abortExisting = true } = {},
  ) {
    const jobId = sceneStatus?.tracking_job_id;
    if (!jobId || !getTrackingReview) {
      setTrackingError("검토할 트래킹 작업 정보를 찾지 못했습니다.");
      return;
    }
    setReviewLoading(true);
    setReviewPlaybackErrors({});
    if (!preserveError) setTrackingError("");
    const requestController = abortExisting ? beginTrackedRequest() : new AbortController();
    try {
      const review = await getTrackingReview(jobId, {
        signal: requestController.signal,
      });
      if (requestController.signal.aborted) return null;
      releaseReviewObjectUrls();
      const artifacts = (review.artifacts || []).map((artifact) => {
        const objectUrl = URL.createObjectURL(artifact.blob);
        reviewObjectUrlsRef.current.push(objectUrl);
        return { ...artifact, objectUrl };
      });
      const evidence = review.evidence ? {
        fullFrameContextUrl: URL.createObjectURL(review.evidence.fullFrameContext),
        fullShotClipUrl: URL.createObjectURL(review.evidence.fullShotClip),
      } : null;
      if (evidence) reviewObjectUrlsRef.current.push(evidence.fullFrameContextUrl, evidence.fullShotClipUrl);
      const candidateMediaUrls = Object.fromEntries(
        Object.entries(review.candidateMedia || {}).map(([candidateId, media]) => {
          const referenceGalleryUrl = media?.referenceGallery
            ? URL.createObjectURL(media.referenceGallery)
            : "";
          if (referenceGalleryUrl) reviewObjectUrlsRef.current.push(referenceGalleryUrl);
          return [candidateId, { referenceGalleryUrl }];
        }),
      );
      const hydrateCandidateMedia = (candidate) => {
        if (!candidate || typeof candidate === "string") return candidate;
        const candidateId = candidate.candidate_id || candidate.id;
        const referenceGalleryUrl = candidateMediaUrls[candidateId]?.referenceGalleryUrl || "";
        if (!referenceGalleryUrl) return candidate;
        return {
          ...candidate,
          frame_image_urls: Array.from(new Set([
            referenceGalleryUrl,
            ...(candidate.frame_image_urls || []),
          ])),
          review_bundle: {
            ...(candidate.review_bundle || {}),
            best_crop_display_url: referenceGalleryUrl,
            first_middle_last_url: referenceGalleryUrl,
          },
        };
      };
      const hydratedJob = {
        ...review.job,
        pending_candidates: (review.job?.pending_candidates || []).map(hydrateCandidateMedia),
        pending_action: review.job?.pending_action && typeof review.job.pending_action === "object"
          ? {
            ...review.job.pending_action,
            candidates: (review.job.pending_action.candidates || []).map(hydrateCandidateMedia),
          }
          : review.job?.pending_action,
        next_ambiguity: review.job?.next_ambiguity
          ? {
            ...review.job.next_ambiguity,
            candidates: (review.job.next_ambiguity.candidates || []).map(hydrateCandidateMedia),
          }
          : review.job?.next_ambiguity,
      };
      setTrackingReview({ ...review, job: hydratedJob, artifacts, evidence });
      const pendingAction = trackingPendingActionValue({}, hydratedJob);
      if (isR1TrackingJob(hydratedJob)) {
        if (
          trackingJobProvenance(hydratedJob).pendingAmbiguityId
          || isCrossShotConfirmation({}, hydratedJob)
          || String(hydratedJob?.status || "").toUpperCase() === "WAITING_CROSS_SHOT_CONFIRMATION"
          || pendingAction === "CROSS_SHOT_CONFIRMATION"
        ) {
          setStage("ambiguity");
        } else {
          // R1 product tracking must not expose frozen research visual-review
          // checkpoints to end users. Same-shot Stage 2-B/D/D1/D2 reviews are
          // handled inside the product runtime; only cross-shot ambiguity is a
          // user-facing confirmation step.
          setStage("tracking");
        }
      } else {
        setStage("review");
      }
      return review;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      setTrackingError(error?.detail || error?.message || "트래킹 검토 미리보기를 불러오지 못했습니다.");
      return null;
    } finally {
      if (!requestController.signal.aborted) setReviewLoading(false);
      if (abortExisting) finishTrackedRequest(requestController);
    }
  }

  function releaseCandidateObjectUrls() {
    candidateObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    candidateObjectUrlsRef.current = [];
    candidateLazyMediaCacheRef.current.clear();
    candidateLazyMediaPromiseRef.current.clear();
  }

  function materializeCandidateMedia(candidates = []) {
    setCandidateVideoPreview(null);
    setCandidateImagePreview(null);
    setCandidateMediaLoading({});
    setCandidateVideoPlaybackError("");
    releaseCandidateObjectUrls();
    return candidates.map((candidate) => ({
      ...candidate,
      media: Object.fromEntries(Object.entries(candidate.media || {}).map(([key, url]) => {
        const blob = candidate.media_blobs?.[key];
        if (!blob) return [key, url];
        let mediaBlob = blob;
        if (key === "tracklet_video_url" && !String(blob.type || "").startsWith("video/")) {
          const sourceUrl = String(url || "").split("?")[0].toLowerCase();
          const videoType = sourceUrl.endsWith(".webm")
            ? "video/webm"
            : sourceUrl.endsWith(".mov")
              ? "video/quicktime"
              : "video/mp4";
          mediaBlob = blob.slice(0, blob.size, videoType);
        }
        const objectUrl = URL.createObjectURL(mediaBlob);
        candidateObjectUrlsRef.current.push(objectUrl);
        return [key, objectUrl];
      })),
    }));
  }

  async function resolveCandidateReviewMedia(player, mediaKey) {
    const sourceUrl = String(player?.media?.[mediaKey] || "");
    if (!sourceUrl) throw new Error("후보 미디어 URL이 없습니다.");
    if (sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:")) return sourceUrl;
    if (!downloadCandidateReviewMedia) throw new Error("후보 미디어 로더가 연결되지 않았습니다.");

    const cacheKey = `${player.candidate_id}:${mediaKey}:${sourceUrl}`;
    const cached = candidateLazyMediaCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const pending = candidateLazyMediaPromiseRef.current.get(cacheKey);
    if (pending) return pending;

    setCandidateMediaLoading((current) => ({ ...current, [cacheKey]: true }));
    const request = (async () => {
      const blob = await downloadCandidateReviewMedia(sourceUrl);
      let mediaBlob = blob;
      if (mediaKey === "tracklet_video_url" && !String(blob.type || "").startsWith("video/")) {
        const lower = sourceUrl.split("?")[0].toLowerCase();
        const videoType = lower.endsWith(".webm")
          ? "video/webm"
          : lower.endsWith(".mov")
            ? "video/quicktime"
            : "video/mp4";
        mediaBlob = blob.slice(0, blob.size, videoType);
      }
      const objectUrl = URL.createObjectURL(mediaBlob);
      candidateObjectUrlsRef.current.push(objectUrl);
      candidateLazyMediaCacheRef.current.set(cacheKey, objectUrl);
      return objectUrl;
    })();

    candidateLazyMediaPromiseRef.current.set(cacheKey, request);
    try {
      return await request;
    } finally {
      candidateLazyMediaPromiseRef.current.delete(cacheKey);
      setCandidateMediaLoading((current) => {
        const next = { ...current };
        delete next[cacheKey];
        return next;
      });
    }
  }

  function isCandidateMediaLoading(player, mediaKey) {
    const sourceUrl = String(player?.media?.[mediaKey] || "");
    const cacheKey = `${player?.candidate_id || ""}:${mediaKey}:${sourceUrl}`;
    return Boolean(candidateMediaLoading[cacheKey]);
  }

  async function previewCandidateReviewMedia(player, mediaKey, label) {
    try {
      const url = await resolveCandidateReviewMedia(player, mediaKey);
      if (mediaKey === "tracklet_video_url") {
        setCandidateVideoPlaybackError("");
        setCandidateVideoPreview({
          url,
          candidateId: player.candidate_id,
          trackletId: player.tracklet_id,
        });
        return;
      }
      setCandidateImagePreview({
        url,
        label,
        candidateId: player.candidate_id,
      });
    } catch (error) {
      showToast(error?.detail || error?.message || "후보 미디어를 불러오지 못했습니다.");
    }
  }

  async function loadTerminalResult(jobId, job) {
    if (!getTrackingResult) return;
    const result = await getTrackingResult(jobId, job);
    const artifacts = (result.artifacts || []).map((artifact) => {
      const objectUrl = URL.createObjectURL(artifact.blob);
      reviewObjectUrlsRef.current.push(objectUrl);
      return { ...artifact, objectUrl };
    });
    setTrackingResult({ ...result, artifacts, frames: normalizeTimelineFrames(result.timeline) });
  }

  async function requestReplacementCandidates(context = trackingContext) {
    if (!prepareReplacementTrackingCandidates || !beginReplacementRequest(replacementRequestRef)) return;
    const sourceRevisionId = context?.revisionId;
    const sceneId = context?.sceneId;
    if (!sourceRevisionId || !sceneId) {
      allowReplacementRetry(replacementRequestRef);
      setStage("replacement-failed");
      setTrackingError("다른 선수를 찾기 위한 기존 revision 또는 장면 정보를 찾지 못했습니다.");
      return;
    }

    releaseReviewObjectUrls();
    setStage("reselecting");
    setTrackingError("");
    setSelectedTrackingPlayerId(null);
    setTrackingReview(null);
    setTrackingResult(null);
    setTrackingStatus(null);
    setFailureAction("");
    const requestController = beginTrackedRequest();
    try {
      const result = await prepareReplacementTrackingCandidates({
        sourceRevisionId,
        sceneId,
        clip,
        signal: requestController.signal,
        onPreparationState: setCandidatePreparationState,
      });
      if (requestController.signal.aborted) return;
      setDetectedPlayers(materializeCandidateMedia(result.candidates || []));
      setSelectedTrackingPlayerId(null);
      setTrackingReview(null);
      setTrackingStatus(null);
      setTrackingContext({
        ...context,
        revisionId: result.revisionId,
        sceneId: result.sceneId || sceneId,
        eventId: result.eventId || sceneId,
        editorClipId: result.editorClipId || context?.editorClipId || clip?.id,
        jobId: null,
      });
      rejectedTrackingRef.current = false;
      setStage("ready");
      setCandidatePreparationState(null);
      setCandidatePreparationFailure(null);
    } catch (error) {
      if (error?.name === "AbortError") return;
      allowReplacementRetry(replacementRequestRef);
      setStage("replacement-failed");
      setCandidatePreparationFailure(error?.name === "CandidatePreparationFailedError" ? error : null);
      setTrackingError(error?.detail || error?.message || "다른 선수 후보를 다시 찾지 못했습니다.");
    } finally {
      finishTrackedRequest(requestController);
    }
  }

  async function addTrackingToHighlight(jobId, status) {
    const value = String(status?.status || "").toUpperCase();
    if (
      !includeTrackingHighlightCandidate
      || !["COMPLETED", "COMPLETED_WITH_UNRESOLVED_GAPS"].includes(value)
      || highlightCandidateJobRef.current === jobId
    ) return null;
    highlightCandidateJobRef.current = jobId;
    setHighlightCandidateBusy(true);
    setHighlightCandidateError("");
    try {
      const candidate = await includeTrackingHighlightCandidate({ jobId });
      setHighlightCandidate(candidate);
      if (candidate?.eligible_for_clip_plan) {
        showToast("트래킹 장면을 하이라이트 후보에 담았습니다.");
      }
      return candidate;
    } catch (error) {
      highlightCandidateJobRef.current = null;
      setHighlightCandidateError(
        error?.detail || error?.message || "트래킹 장면을 하이라이트 후보에 담지 못했습니다.",
      );
      return null;
    } finally {
      setHighlightCandidateBusy(false);
    }
  }

  useEffect(() => {
    const jobId = trackingContext?.jobId;
    if (stage !== "tracking" || !jobId || !getTrackingJobState) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const incoming = await getTrackingJobState(jobId);
        if (cancelled) return;
        if (incoming?.tracking_job_id && incoming.tracking_job_id !== jobId) {
          setTrackingError(`${PROVENANCE_ERROR_CODE}: tracking_job_id mismatch`);
          return;
        }
        const status = chooseFreshTrackingJob(latestTrackingJobRef.current, incoming);
        if (status !== incoming) {
          timer = window.setTimeout(poll, trackingPollDelay(status) || 3000);
          return;
        }
        latestTrackingJobRef.current = status;
        setTrackingStatus(status);
        setRestoringTrackingJobId(null);
        persistTrackingRun(status);
        const value = String(status?.status || "").toUpperCase();
        const refreshedAmbiguity = trackingAmbiguityDetails(status);
        const refreshedCandidates = normalizeCrossShotCandidates(refreshedAmbiguity, []);
        if (crossShotWaitingContractViolation(status, refreshedCandidates)) {
          setPreparingNextCandidates(true);
          setStage("tracking");
          setTrackingError(
            "TRACKING_OUTPUT_CONTRACT_ERROR: 해소된 후보 묶음을 WAITING 상태로 다시 사용할 수 없습니다.",
          );
        } else if (
          isR1TrackingJob(status)
          && (value === "WAITING_CROSS_SHOT_CONFIRMATION" || trackingJobProvenance(status).pendingAmbiguityId)
        ) {
          setPreparingNextCandidates(false);
          setStage("ambiguity");
          await loadTrackingReview({ tracking_job_id: jobId });
        } else if (isTerminalTrackingStatus(value)) {
          setPreparingNextCandidates(false);
          setStage("terminal");
          await addTrackingToHighlight(jobId, status);
          await loadTerminalResult(jobId, status);
          showToast("선수 트래킹이 완료됐어요.");
        } else if (value === "FAILED") {
          setStage("failed");
          setFailureAction("tracking");
          setTrackingError(status?.error_message || "선수 트래킹에 실패했습니다.");
        } else if (
          ["WAITING_MEMORY_REVIEW", "WAITING_SEGMENT_REVIEW"].includes(value)
          || ["REVIEW_TRACKING_MEMORY", "REVIEW_TRACKING_SEGMENT"].includes(trackingPendingActionValue({}, status))
        ) {
          if (isR1TrackingJob(status)) {
            // Product R1 must continue same-shot tracking internally. If an
            // older runtime still leaks a research-only review checkpoint,
            // never turn it into a user approval loop.
            setStage("tracking");
            setTrackingError(
              "TRACKING_PRODUCT_CONTRACT_ERROR: same-shot research review was exposed by the runtime; user confirmation is reserved for cross-shot ambiguity.",
            );
          } else {
            setStage("review");
            await loadTrackingReview({ tracking_job_id: jobId });
          }
        }
        const delay = trackingPollDelay(status);
        if (!cancelled && delay !== null) timer = window.setTimeout(poll, delay);
      } catch (error) {
        if (!cancelled) setTrackingError(error?.detail || error?.message || "트래킹 상태를 확인하지 못했습니다.");
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [projectId, stage, getTrackingJobState, showToast, trackingContext?.jobId]);

  async function discoverPlayers(earlierAnchorSec = 0) {
    if (!clip || !prepareTrackingCandidates || discoveryRequestRef.current) return;
    const requestController = beginTrackedRequest();
    discoveryRequestRef.current = requestController;
    const adjustedStartSec = Math.max(0, Number(clip.startSec || 0) - earlierAnchorSec);
    const analysisClip = earlierAnchorSec > 0
      ? {
        ...clip,
        startSec: adjustedStartSec,
        durationSec: Math.max(0, Number(clip.endSec || adjustedStartSec) - adjustedStartSec),
      }
      : clip;
    setStage("detecting");
    setTrackingError("");
    setFailureAction("");
    setCandidatePreparationState(null);
    setCandidatePreparationFailure(null);
    try {
      const result = await prepareTrackingCandidates({
        clip: analysisClip,
        signal: requestController.signal,
        onPreparationState: setCandidatePreparationState,
      });
      if (requestController.signal.aborted) return;
      setTrackingContext({ ...result, editorClipId: result.editorClipId || clip?.id });
      setDetectedPlayers(materializeCandidateMedia(result.candidates || []));
      setSelectedTrackingPlayerId(null);
      setStage("ready");
      setCandidatePreparationState(null);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (error?.name === "ShotBoundaryReviewRequiredError") {
        setShotBoundaryReview({ scope: error.scope, state: error.reviewState });
        setStage("waiting-boundary-review");
        setFailureAction("");
        setTrackingError("");
        return;
      }
      setStage("failed");
      setFailureAction("discover");
      setCandidatePreparationFailure(error?.name === "CandidatePreparationFailedError" ? error : null);
      setTrackingError(error?.detail || error?.message || "선수 후보를 탐지하지 못했습니다.");
    } finally {
      if (discoveryRequestRef.current === requestController) discoveryRequestRef.current = null;
      finishTrackedRequest(requestController);
    }
  }

  async function continueAfterBoundaryConfirmation() {
    if (!shotBoundaryReview?.scope || !resumeTrackingCandidatesAfterBoundaryReview) return;
    const requestController = beginTrackedRequest();
    discoveryRequestRef.current = requestController;
    setStage("detecting");
    setTrackingError("");
    try {
      const result = await resumeTrackingCandidatesAfterBoundaryReview({
        scope: shotBoundaryReview.scope,
        signal: requestController.signal,
        onPreparationState: setCandidatePreparationState,
      });
      setTrackingContext({ ...result, editorClipId: result.editorClipId || clip?.id });
      setDetectedPlayers(materializeCandidateMedia(result.candidates || []));
      setSelectedTrackingPlayerId(null);
      setShotBoundaryReview(null);
      setCandidatePreparationState(null);
      setStage("ready");
    } catch (error) {
      if (error?.name === "AbortError") return;
      setStage("failed");
      setFailureAction("discover");
      setTrackingError(error?.detail || error?.message || "확정 후 선수 후보 준비에 실패했습니다.");
    } finally {
      if (discoveryRequestRef.current === requestController) discoveryRequestRef.current = null;
      finishTrackedRequest(requestController);
    }
  }

  async function reopenConfirmedBoundaryReview() {
    if (!prepareNewShotBoundaryReview || boundaryReopenBusy) return;
    const source = trackingContext || candidatePreparationFailure?.scope;
    if (!source?.revisionId || !source?.eventId || !source?.sceneId) return;
    const scope = {
      projectId: source.projectId || projectId,
      revisionId: source.revisionId,
      eventId: source.eventId,
      sceneId: source.sceneId,
      editorClipId: source.editorClipId || clip?.id,
    };
    setBoundaryReopenBusy(true);
    setTrackingError("");
    try {
      const reviewState = await prepareNewShotBoundaryReview(scope);
      setShotBoundaryReview({ scope, state: reviewState });
      setCandidatePreparationFailure(null);
      setCandidatePreparationState(null);
      setDetectedPlayers([]);
      setSelectedTrackingPlayerId(null);
      setStage("boundary-review");
    } catch (error) {
      setTrackingError(error?.detail || error?.message || "새 경계 검토 revision을 만들지 못했습니다.");
    } finally {
      setBoundaryReopenBusy(false);
    }
  }

  async function retryFailedCandidatePreparation() {
    if (!retryCandidatePreparation || !candidatePreparationFailure?.retryUrl || discoveryRequestRef.current) return;
    const requestController = beginTrackedRequest();
    discoveryRequestRef.current = requestController;
    setStage("detecting");
    setTrackingError("");
    setCandidatePreparationState(null);
    try {
      const result = await retryCandidatePreparation({
        failure: candidatePreparationFailure,
        signal: requestController.signal,
        onPreparationState: setCandidatePreparationState,
      });
      if (requestController.signal.aborted) return;
      setTrackingContext({ ...result, editorClipId: result.editorClipId || clip?.id });
      setDetectedPlayers(materializeCandidateMedia(result.candidates || []));
      setSelectedTrackingPlayerId(null);
      setCandidatePreparationFailure(null);
      setCandidatePreparationState(null);
      setStage("ready");
    } catch (error) {
      if (error?.name === "AbortError") return;
      setStage("failed");
      setFailureAction("discover");
      setCandidatePreparationFailure(error?.name === "CandidatePreparationFailedError" ? error : null);
      setTrackingError(error?.detail || error?.message || "선수 후보 준비에 실패했습니다.");
    } finally {
      if (discoveryRequestRef.current === requestController) discoveryRequestRef.current = null;
      finishTrackedRequest(requestController);
    }
  }

  async function startTracking() {
    if (!selectedTrackingPlayerId || trackingSubmitRef.current) return;
    const player = selectedCandidateSnapshot?.candidate_id === selectedTrackingPlayerId
      ? selectedCandidateSnapshot
      : detectedPlayers.find((item) => item.candidate_id === selectedTrackingPlayerId);
    if (!player || !createCandidateSelection || !createCandidateTracking) return;
    // A failed verifier result can become stale after the backend runtime or its
    // manifest is repaired. Re-check on the user's explicit start action instead
    // of permanently trapping the workflow behind the cached unavailable state.
    const diagnostics = trackingDiagnostics?.available
      ? trackingDiagnostics
      : await refreshTrackingDiagnostics(true);
    if (!diagnostics?.available) {
      setTrackingError(`${diagnostics?.code || "TRACKING_RUNTIME_UNAVAILABLE"}: ${diagnostics?.message || "Tracking runtime을 사용할 수 없습니다."}`);
      return;
    }
    const requestController = beginTrackedRequest();
    trackingSubmitRef.current = requestController;
    setTrackingSubmitting(true);
    setFailureAction("");
    setTrackingError("");
    const snapshot = Object.freeze({
      ...player,
      media: Object.freeze({ ...player.media }),
      reason_codes: Object.freeze([...(player.reason_codes || [])]),
      risk_codes: Object.freeze([...(player.risk_codes || [])]),
    });
    setSelectedCandidateSnapshot(snapshot);
    try {
      let immutableSelection = selectionRecord;
      if (!immutableSelection || immutableSelection.candidate_id !== snapshot.candidate_id) {
        immutableSelection = await createCandidateSelection({
        revisionId: trackingContext?.revisionId,
        eventId: trackingContext?.eventId,
        sceneId: trackingContext?.sceneId,
        candidate: snapshot,
        recommendationResponse: trackingContext?.recommendationResponse,
        sourceVideoAssetId: trackingContext?.sourceVideoAssetId,
        signal: requestController.signal,
      });
        setSelectionRecord(immutableSelection);
      }
      const handoff = await createCandidateTracking({
        selection: immutableSelection,
        candidate: snapshot,
        sourceVideoAssetId: trackingContext?.sourceVideoAssetId,
        signal: requestController.signal,
      });
      if (requestController.signal.aborted) return;
      setTrackingHandoff(handoff);
      latestTrackingJobRef.current = handoff;
      const runContext = {
        projectId,
        selectionId: immutableSelection.selection_id,
        selectedCandidateId: snapshot.candidate_id,
        jobId: handoff.tracking_job_id,
      };
      setTrackingContext((current) => ({ ...current, ...runContext }));
      setTrackingStatus(handoff);
      persistTrackingRun(handoff, runContext);
      setStage("tracking");
      showToast(`${snapshot.candidate_id} 트래킹을 시작했어요.`);
    } catch (error) {
      if (error?.name === "AbortError") return;
      setStage("failed");
      setFailureAction("start");
      const code = errorDisplayCode(error);
      setTrackingError(code || "선수 트래킹을 시작하지 못했습니다.");
    } finally {
      if (trackingSubmitRef.current === requestController) trackingSubmitRef.current = null;
      if (!requestController.signal.aborted) setTrackingSubmitting(false);
      finishTrackedRequest(requestController);
    }
  }

  async function reviewTracking(decision) {
    if (reviewSubmitRef.current) return;
    const job = trackingReview?.job;
    const jobId = job?.job_id || trackingContext?.jobId;
    const reviewStage = job?.pending_action?.review_stage;
    if (!jobId || !reviewStage || !submitTrackingReview) {
      setTrackingError("현재 검토 단계 정보를 찾지 못했습니다. 상태를 다시 불러와주세요.");
      return;
    }
    setReviewSubmitting(decision);
    setTrackingError("");
    const requestController = beginTrackedRequest();
    reviewSubmitRef.current = requestController;
    try {
      const status = await submitTrackingReview({
        jobId,
        stage: reviewStage,
        decision,
        signal: requestController.signal,
      });
      if (requestController.signal.aborted) return;
      releaseReviewObjectUrls();
      setTrackingReview(null);
      setTrackingStatus(status);
      persistTrackingRun(status);
      setStage("tracking");
      if (decision === "reject") {
        rejectedTrackingRef.current = true;
        showToast("잘못된 트래킹 결과를 제외했습니다. 다른 선수를 선택해주세요.");
      } else {
        showToast("세그먼트를 승인했습니다. 트래킹을 계속 진행합니다.");
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      setTrackingError(error?.detail || error?.message || "트래킹 검토 결과를 제출하지 못했습니다.");
    } finally {
      if (reviewSubmitRef.current === requestController) reviewSubmitRef.current = null;
      if (!requestController.signal.aborted) setReviewSubmitting("");
      finishTrackedRequest(requestController);
    }
  }

  function reloadTrackingReview() {
    const jobId = trackingContext?.jobId;
    if (!jobId || reviewLoading) return;
    loadTrackingReview({ tracking_job_id: jobId });
  }

  async function refreshFromTrackingJob(jobId, { preserveError = false, focusCandidateId = null } = {}) {
    const latest = await getTrackingJobState(jobId);
    const provenance = trackingJobProvenance(latest);
    if (provenance.trackingJobId !== jobId) {
      throw new Error(`${PROVENANCE_ERROR_CODE}: refreshed tracking_job_id mismatch`);
    }
    setTrackingStatus(latest);
    persistTrackingRun(latest);
    latestTrackingJobRef.current = latest;
    releaseReviewObjectUrls();
    setTrackingReview(null);
    if (provenance.pendingAmbiguityId) {
      const refreshedAmbiguity = trackingAmbiguityDetails(latest);
      const refreshedCandidates = normalizeCrossShotCandidates(refreshedAmbiguity, []);
      if (
        isResolvedCrossShotAmbiguity(refreshedAmbiguity)
        || crossShotWaitingContractViolation(latest, refreshedCandidates)
      ) {
        setPreparingNextCandidates(true);
        setStage("tracking");
        setTrackingError(
          "TRACKING_OUTPUT_CONTRACT_ERROR: 해소된 후보 묶음을 WAITING 상태로 다시 사용할 수 없습니다.",
        );
        return latest;
      }
      const candidateIds = latest?.next_ambiguity?.candidate_ids || [];
      const desiredCandidateId = focusCandidateId || trackingContext?.currentCandidateId;
      const desiredIndex = candidateIds.indexOf(desiredCandidateId);
      setAmbiguityCandidateIndex(desiredIndex >= 0 ? desiredIndex : 0);
      setAbsentEvidenceOpened({ fullFrame: false, shotClip: false });
      setStage("tracking");
      await loadTrackingReview(
        { tracking_job_id: jobId },
        { preserveError, abortExisting: false },
      );
      setPreparingNextCandidates(false);
    } else if (isTerminalTrackingStatus(provenance.backendStatus)) {
      setStage("terminal");
      await loadTerminalResult(jobId, latest);
    } else {
      setStage("tracking");
    }
    return latest;
  }

  async function confirmAmbiguityCandidate(state, candidateId = null) {
    if (ambiguitySubmitRef.current || !confirmTrackingAmbiguity) return;
    const fullShotStates = ["TARGET_ABSENT", "NONE_OF_THESE", "NONE_OF_THESE_NON_PLAYER_ROLE"];
    if (!fullShotStates.includes(state) && !candidateId) return;
    const job = trackingReview?.job;
    const ambiguity = trackingAmbiguityDetails(job);
    const jobProvenance = trackingJobProvenance(job);
    const jobId = trackingContext?.jobId;
    if (!isR1TrackingJob(job)) {
      setTrackingError("R1 candidate-review는 EVENT_CANDIDATE_HANDOFF_R1 작업에서만 사용할 수 있습니다.");
      return;
    }
    if (!jobId || !ambiguity.ambiguityId) {
      setTrackingError("확인할 후보 구간 정보를 찾지 못했습니다. 작업 상태를 다시 불러와주세요.");
      return;
    }
    if (
      jobProvenance.trackingJobId !== jobId
      || !candidateReviewMatchesPending(job, ambiguity.ambiguityId)
    ) {
      setTrackingError(`${PROVENANCE_ERROR_CODE}: candidate-review ambiguity does not match pending ambiguity`);
      return;
    }

    setAmbiguitySubmitting(true);
    setAmbiguityFailedChoice(null);
    setTrackingError("");
    const requestController = beginTrackedRequest();
    ambiguitySubmitRef.current = requestController;
    try {
      const result = await confirmTrackingAmbiguity({
        jobId,
        ambiguityId: ambiguity.ambiguityId,
        review: {
          state,
          candidateId,
          fullFrameContextSha256: fullFrameEvidenceSha,
          shotClipSha256: shotClipEvidenceSha,
        },
        signal: requestController.signal,
      });
      if (requestController.signal.aborted) return;
      setCandidateReviewHttpStatus(result.httpStatus);
      const response = result.data || {};
      const transition = candidateReviewTransition(response);
      const nextReviewedCandidateIds = candidateId
        ? Array.from(new Set([...reviewedCandidateIds, candidateId]))
        : reviewedCandidateIds;
      if (candidateId) setReviewedCandidateIds(nextReviewedCandidateIds);

      // A cross-shot ambiguity is one decision, not a per-candidate reject
      // loop. Never remove one card locally and page to another batch. The
      // canonical backend state decides whether tracking resumes or a later
      // shot creates a new ambiguity.
      setPreparingNextCandidates(false);
      setStage(transition.stage);
      setTrackingContext((current) => ({
        ...current,
        pendingAmbiguityId: response.next_ambiguity_id || null,
        currentCandidateId: response.next_candidate_id || null,
        reviewedCandidateIds: nextReviewedCandidateIds,
      }));
      persistTrackingRun(
        { ...trackingStatus, job_id: jobId, status: transition.stage === "terminal" ? "COMPLETED" : "RUNNING" },
        {
          pendingAmbiguityId: response.next_ambiguity_id || null,
          currentCandidateId: response.next_candidate_id || null,
          reviewedCandidateIds: nextReviewedCandidateIds,
        },
      );
      await refreshFromTrackingJob(jobId, {
        focusCandidateId: response.next_candidate_id || null,
      });

      if (transition.legacyPaginationSuppressed) {
        showToast("후보 검토를 반영했습니다. 추가 후보 묶음 없이 트래킹을 계속합니다.");
      } else if (state === "TARGET_ABSENT") {
        showToast("이 shot에는 대상 선수가 없는 것으로 반영했습니다. 트래킹을 계속합니다.");
      } else if (state === "NONE_OF_THESE" || state === "NONE_OF_THESE_NON_PLAYER_ROLE") {
        showToast("제시된 후보를 사용하지 않고 다음 shot 탐색을 계속합니다.");
      } else {
        showToast("같은 선수로 확인했습니다. 이 shot의 자동 트래킹을 계속합니다.");
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      const code = error?.code || error?.data?.detail?.code;
      const message = error?.data?.detail?.message || error?.detail || error?.message;
      setCandidateReviewHttpStatus(error?.status || null);
      setTrackingError([code, message].filter(Boolean).join(": ") || "추가 선수 확인을 반영하지 못했습니다.");
      if (error?.status === 409) {
        setAmbiguityFailedChoice(null);
        releaseReviewObjectUrls();
        setTrackingReview(null);
        try {
          await refreshFromTrackingJob(jobId, { preserveError: true });
        } catch (refreshError) {
          setStage("tracking");
          setTrackingError((current) => `${current} · state refresh failed: ${refreshError.message}`);
        }
      } else {
        setAmbiguityFailedChoice({ state, candidateId });
      }
    } finally {
      if (ambiguitySubmitRef.current === requestController) ambiguitySubmitRef.current = null;
      setAmbiguitySubmitting(false);
      finishTrackedRequest(requestController);
    }
  }

  const ambiguityDetails = trackingAmbiguityDetails(trackingReview?.job);
  const ambiguityCandidates = normalizeCrossShotCandidates(ambiguityDetails, detectedPlayers);
  const ambiguityCandidate = ambiguityCandidates[ambiguityCandidateIndex] || null;
  const reviewProgress = trackingReview?.job?.review_progress || trackingStatus?.review_progress || {};
  const currentReviewShot = reviewProgress.current_shot
    || trackingReview?.job?.current_shot
    || trackingStatus?.current_shot
    || "-";
  const pendingArtifactPrefix = ambiguityDetails.pendingAmbiguityId || "";
  const currentAmbiguityArtifacts = (trackingReview?.artifacts || []).filter((artifact) => (
    !pendingArtifactPrefix
    || String(artifact.key || "").includes(pendingArtifactPrefix)
    || (trackingReview?.job?.pending_action?.artifact_keys || []).includes(artifact.key)
  ));
  const fullFrameEvidenceArtifact = currentAmbiguityArtifacts.find((artifact) => (
    /full.?frame.?context/i.test(`${artifact.kind} ${artifact.key}`)
  ));
  const shotClipEvidenceArtifact = currentAmbiguityArtifacts.find((artifact) => (
    /shot.?clip/i.test(`${artifact.kind} ${artifact.key}`)
  ));
  const fullFrameEvidenceUrl = trackingReview?.evidence?.fullFrameContextUrl
    || ambiguityDetails.fullFrameContextUrl
    || fullFrameEvidenceArtifact?.objectUrl
    || "";
  const shotClipEvidenceUrl = trackingReview?.evidence?.fullShotClipUrl
    || ambiguityDetails.shotClipUrl
    || shotClipEvidenceArtifact?.objectUrl
    || "";
  const fullFrameEvidenceSha = ambiguityDetails.fullFrameContextSha256 || fullFrameEvidenceArtifact?.sha256 || "";
  const shotClipEvidenceSha = ambiguityDetails.shotClipSha256 || shotClipEvidenceArtifact?.sha256 || "";
  const fullShotEvidenceHashesReady = /^[a-f0-9]{64}$/i.test(fullFrameEvidenceSha)
    && /^[a-f0-9]{64}$/i.test(shotClipEvidenceSha);
  const absentEvidenceReady = absentEvidenceOpened.fullFrame
    && absentEvidenceOpened.shotClip
    && fullShotEvidenceHashesReady;
  const ambiguityFallbackArtifact = trackingReview?.artifacts?.find((artifact) => (
    artifact.kind === "review_contact_sheet"
    || String(artifact.mime_type || artifact.blob?.type || "").startsWith("image/")
  ));
  const crossShotConfirmation = isCrossShotConfirmation({}, trackingReview?.job)
    || isCrossShotConfirmation({ pending_action: trackingStatus?.pending_action });
  const candidateGroups = splitCandidateRecommendations(detectedPlayers);
  const activeJobProvenance = trackingJobProvenance(trackingReview?.job || trackingStatus || {});
  const targetGalleryUrls = [
    ...selectedTargetGalleryUrls(trackingReview?.job || trackingStatus || {}),
    ...(selectedCandidateSnapshot?.media?.reference_gallery_url
      ? [selectedCandidateSnapshot.media.reference_gallery_url]
      : []),
    ...currentAmbiguityArtifacts
      .filter((artifact) => /target.*reference.*gallery|reference.*target.*gallery/i.test(`${artifact.kind} ${artifact.key}`))
      .map((artifact) => artifact.objectUrl)
      .filter(Boolean),
  ].slice(0, 6);
  const reviewAmbiguityMatchesPending = candidateReviewMatchesPending(
    trackingReview?.job,
    ambiguityDetails.ambiguityId,
  );
  const ambiguityReviewTabs = [
    ["bestCropDisplayUrl", "대표 crop"],
    ["firstMiddleLastUrl", "처음 / 중간 / 끝"],
    ["trackletVideoUrl", "Tracklet 영상"],
  ];
  const candidateSpecificArtifacts = currentAmbiguityArtifacts.filter((artifact) => (
    ambiguityCandidate?.candidate_id
    && String(artifact.key || "").includes(ambiguityCandidate.candidate_id)
  ));
  const candidateArtifactMedia = {
    fullFrameContextUrl: candidateSpecificArtifacts.find((artifact) => /full.?frame/i.test(`${artifact.kind} ${artifact.key}`))?.objectUrl,
    bestCropDisplayUrl: candidateSpecificArtifacts.find((artifact) => /best.?crop.*display/i.test(`${artifact.kind} ${artifact.key}`))?.objectUrl,
    bestCropNativeUrl: candidateSpecificArtifacts.find((artifact) => /best.?crop.*native/i.test(`${artifact.kind} ${artifact.key}`))?.objectUrl,
    firstMiddleLastUrl: candidateSpecificArtifacts.find((artifact) => /first.*middle.*last/i.test(`${artifact.kind} ${artifact.key}`))?.objectUrl,
    trackletVideoUrl: candidateSpecificArtifacts.find((artifact) => /tracklet.*video/i.test(`${artifact.kind} ${artifact.key}`))?.objectUrl,
  };
  const activeCandidateReviewMedia = ambiguityCandidate?.reviewMedia?.[ambiguityMediaTab]
    || candidateArtifactMedia[ambiguityMediaTab]
    || "";
  const terminalPresentation = terminalTrackingPresentation(trackingStatus);
  const resultArtifactsByKey = Object.fromEntries(
    (trackingResult?.artifacts || []).map((artifact) => [artifact.key, artifact]),
  );
  const visibleTrackingRuns = trackingRuns.filter((run) => (
    (!projectId || run.projectId === projectId)
    && (!clip?.id || run.editorClipId === clip.id)
  ));

  function openStoredTrackingRun(run) {
    restoredJobRef.current = run.trackingJobId;
    setRestoringTrackingJobId(run.trackingJobId);
    setTrackingContext({
      projectId,
      editorClipId: clip?.id,
      ...run,
      jobId: run.trackingJobId,
    });
    setReviewedCandidateIds(run.reviewedCandidateIds || []);
    setSelectionRecord(null);
    setTrackingHandoff({
      tracking_job_id: run.trackingJobId,
    });
    setTrackingResult(null);
    setTrackingReview(null);
    setTrackingStatus({ job_id: run.trackingJobId, status: "RUNNING" });
    setStage("tracking");
  }

  function selectCandidateForTracking(candidate) {
    const snapshot = Object.freeze({
      ...candidate,
      media: Object.freeze({ ...candidate.media }),
      reason_codes: Object.freeze([...(candidate.reason_codes || [])]),
      risk_codes: Object.freeze([...(candidate.risk_codes || [])]),
    });
    setSelectedTrackingPlayerId(snapshot.candidate_id);
    setSelectedCandidateSnapshot(snapshot);
    if (selectionRecord?.candidate_id !== snapshot.candidate_id) {
      setSelectionRecord(null);
      setTrackingHandoff(null);
    }

    // Only the chosen player needs an eagerly available reference gallery for
    // later cross-shot comparison.  Load that one asset in the background
    // instead of prefetching reference galleries for every candidate card.
    void resolveCandidateReviewMedia(candidate, "reference_gallery_url")
      .then((referenceGalleryUrl) => {
        setSelectedCandidateSnapshot((current) => {
          if (!current || current.candidate_id !== candidate.candidate_id) return current;
          return Object.freeze({
            ...current,
            media: Object.freeze({
              ...current.media,
              reference_gallery_url: referenceGalleryUrl,
            }),
          });
        });
      })
      .catch(() => {
        // Selection remains valid; backend tracking uses immutable bundle
        // provenance and does not depend on this UI-only preview download.
      });
  }

  function renderRecommendationCard(player) {
    const selected = player.candidate_id === selectedTrackingPlayerId;
    const isHardBlocked = isCandidateHardBlocked(player);
    const canSelect = canSelectCandidate(player, stage !== "ready" || trackingSubmitting);
    const reasonCodes = player.reason_codes || [];
    const hasRoleUnverifiedCloseup = reasonCodes.includes("PRODUCT_CLOSEUP_ROLE_UNVERIFIED");
    return (
      <article
        className={`tracking-detected-player candidate-review-card ${selected ? "selected" : ""}`}
        key={player.candidate_id}
        data-candidate-id={player.candidate_id}
      >
        <img
          className="candidate-best-crop"
          src={player.media.best_crop_display_url}
          alt={`${player.candidate_id} 대표 crop`}
          loading="lazy"
          decoding="async"
        />
        <div className="candidate-card-copy">
          <strong>#{player.shortlist_rank} · {player.candidate_id}</strong>
          <small>global #{player.global_rank} · shot {player.shot_id}</small>
          <small>tracklet {player.tracklet_id} · best frame {player.best_frame}</small>
          <span className={`candidate-reviewability is-${String(player.reviewability || "").toLowerCase()}`}>
            {player.reviewability}
          </span>
          {reasonCodes.length ? (
            <div className="candidate-reason-badges" aria-label="후보 추천 근거">
              {reasonCodes.map((code) => (
                <span
                  className={`candidate-reason-badge ${code === "PRODUCT_FIELD_SUPPORTED_PRIORITY" ? "is-positive" : ""} ${code === "PRODUCT_CLOSEUP_ROLE_UNVERIFIED" ? "is-caution" : ""}`}
                  key={code}
                  title={code}
                >
                  {candidateReasonLabel(code)}
                </span>
              ))}
            </div>
          ) : null}
          {player.risk_codes?.length ? <small className="candidate-risks">Risks: {player.risk_codes.join(", ")}</small> : null}
        </div>
        {player.reviewability === "LOW_RESOLUTION" || isHardBlocked || hasRoleUnverifiedCloseup ? (
          <div className="candidate-warnings">
            {player.reviewability === "LOW_RESOLUTION" ? (
              <div className="candidate-evidence-warning" role="status">
                <strong>⚠ 저해상도 후보</strong>
                <span>해상도가 낮은 후보입니다. 원본 프레임과 tracklet 영상을 확인한 뒤 선택하세요.</span>
              </div>
            ) : null}
            {hasRoleUnverifiedCloseup ? (
              <div className="candidate-evidence-warning is-role-unverified" role="status">
                <strong>⚠ 역할 미확인 클로즈업</strong>
                <span>선수/스태프 오분류 가능성이 있으니 원본 영상을 확인하세요.</span>
              </div>
            ) : null}
            {isHardBlocked ? (
              <div className="candidate-evidence-warning is-hard-blocked" role="alert">
                <strong>선택할 수 없는 후보</strong>
                <span>판독할 수 없는 후보입니다. 다른 후보를 선택하세요.</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="candidate-review-bundle" aria-label={`${player.candidate_id} review bundle`}>
          {candidateMediaKeys.map((mediaKey) => {
            const labels = {
              best_crop_native_url: "원본 crop",
              best_crop_display_url: "대표 crop",
              full_frame_context_url: "full-frame + bbox",
              first_middle_last_url: "초·중·후 비교",
              reference_gallery_url: "reference gallery",
              tracklet_video_url: "tracklet video",
            };
            const loading = isCandidateMediaLoading(player, mediaKey);
            const isVideo = mediaKey === "tracklet_video_url";
            return (
              <button
                className={isVideo ? "candidate-media-video-button" : "candidate-media-link-button"}
                type="button"
                key={mediaKey}
                disabled={loading}
                onClick={() => previewCandidateReviewMedia(player, mediaKey, labels[mediaKey])}
              >
                {loading
                  ? `${labels[mediaKey]} 불러오는 중…`
                  : isVideo
                    ? `${labels[mediaKey]} 재생 ▶`
                    : `${labels[mediaKey]} 보기 ↗`}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={!canSelect}
          aria-pressed={selected}
          onClick={() => selectCandidateForTracking(player)}
        >
          {selected ? "선택됨" : "이 후보 선택"}
        </button>
      </article>
    );
  }

  useEffect(() => {
    setAmbiguityCandidateIndex((current) => (
      Math.min(current, Math.max(0, ambiguityCandidates.length - 1))
    ));
  }, [ambiguityCandidates.length]);

  useEffect(() => {
    if (!candidateVideoPreview && !candidateImagePreview) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setCandidateVideoPreview(null);
        setCandidateImagePreview(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [candidateVideoPreview, candidateImagePreview]);

  useEffect(() => {
    if (stage !== "ambiguity") return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && ambiguityLightbox) {
        setAmbiguityLightbox(null);
        return;
      }
      if (ambiguityLightbox || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setAmbiguityCandidateIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setAmbiguityCandidateIndex((current) => Math.min(ambiguityCandidates.length - 1, current + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stage, ambiguityCandidates.length, ambiguityLightbox]);

  return (
    <section
      className={`tracking-workbench ${open ? "open" : "collapsed"}`}
      aria-busy={["detecting", "reselecting"].includes(stage) || trackingSubmitting || ambiguitySubmitting}
    >
      <div className="tracking-workbench-head">
        <div className="tracking-workbench-title">
          <span className="tracking-kicker">OPTIONAL · PLAYER TRACKING</span>
          <strong>선택 장면 선수 트래킹</strong>
          <small>Action Spotting 결과 중 필요한 장면에만 선수 탐지와 개별 트래킹을 적용합니다.</small>
        </div>
        <div className="tracking-head-actions">
          <span className="tracking-default-badge">ACTION SPOTTING · 기본</span>
          <button type="button" onClick={onToggle}>{open ? "접기" : "열기"}</button>
        </div>
      </div>

      {open ? (
        <div className="tracking-workbench-body">
          <div className="tracking-flow" aria-label="트래킹 작업 단계">
            <span className={clip ? "done" : "active"}><b>1</b> 장면 선택</span>
            <i></i>
            <span className={stage !== "idle" && !["detecting", "reselecting"].includes(stage) ? "done" : clip ? "active" : ""}><b>2</b> 선수 탐지</span>
            <i></i>
            <span className={selectedTrackingPlayerId ? "done" : stage === "ready" ? "active" : ""}><b>3</b> 선수 선택</span>
            <i></i>
            <span className={stage === "completed" ? "done" : ["tracking", "review", "ambiguity"].includes(stage) ? "active" : ""}><b>4</b> 트래킹 적용</span>
          </div>

          <div className={`tracking-runtime-diagnostics ${trackingDiagnostics?.available ? "is-ready" : "is-blocked"}`}>
            <div>
              <span>TARGET-CENTRIC E2E RUNTIME</span>
              <strong>
                {diagnosticsLoading
                  ? "진단 확인 중…"
                  : trackingDiagnostics?.available
                    ? "Tracking runtime 사용 가능"
                    : "Tracking runtime 확인 필요"}
              </strong>
              {trackingDiagnostics ? (
                <small>{trackingDiagnostics.code} · {trackingDiagnostics.message}</small>
              ) : null}
            </div>
            <button type="button" disabled={diagnosticsLoading} onClick={() => refreshTrackingDiagnostics(true)}>
              {diagnosticsLoading ? "확인 중…" : "진단 새로고침"}
            </button>
          </div>

          {restoringTrackingJobId ? (
            <div className="tracking-restore-banner" role="status">
              저장된 작업 <code>{restoringTrackingJobId}</code>을 API에서 복구하고 있습니다.
            </div>
          ) : null}

          <div className="tracking-context-row">
            <div className="tracking-scene-card">
              <span>SELECTED SCENE</span>
              {clip ? (
                <>
                  <strong>{sessionLabelMeta[clip.label]?.ko || clip.label} · {clip.id}</strong>
                  <small>원본 {formatDuration(Math.round(clip.startSec))}–{formatDuration(Math.round(clip.endSec))} · {Math.round(clip.durationSec)}초</small>
                </>
              ) : (
                <>
                  <strong>타임라인에서 장면을 선택하세요</strong>
                  <small>클립을 선택하면 이 장면에만 트래킹이 적용됩니다.</small>
                </>
              )}
            </div>

            {stage === "idle" ? (
              <button className="tracking-detect-button" type="button" disabled={!clip || !prepareTrackingCandidates} onClick={() => discoverPlayers()}>
                <span>◎</span>
                <b>선수 탐지 시작</b>
                <small>선택 장면만 분석</small>
              </button>
            ) : null}

            {["detecting", "reselecting"].includes(stage) ? (
              <div className="tracking-detecting" role="status">
                <span className="tracking-scan-orbit"></span>
                <div>
                  <b>{candidatePreparationState?.phase === "loading" ? "선수 후보를 불러오고 있습니다." : "선수 후보를 분석하고 있습니다."}</b>
                  <small>후보 영상과 트래킹 미리보기를 준비하는 데 몇 분 정도 걸릴 수 있습니다.</small>
                  {candidatePreparationState?.task?.status ? (
                    <small>현재 단계: {candidatePreparationState.task.status} · 백그라운드에서 준비 중</small>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {stage === "waiting-boundary-review" && shotBoundaryReview ? (
            <div className="shot-boundary-review-cta" role="status">
              <div><strong>장면 경계를 먼저 검토해야 합니다.</strong><span>자동 경계의 구조 검증이 실패했습니다. 경계를 수정·확정한 뒤 후보 준비를 다시 시작합니다.</span></div>
              <button type="button" onClick={() => setStage("boundary-review")}>장면 경계 검토 시작</button>
            </div>
          ) : null}

          {stage === "boundary-review" && shotBoundaryReview ? (
            <ShotBoundaryReviewPanel
              scope={shotBoundaryReview.scope}
              initialState={shotBoundaryReview.state}
              loadState={getShotBoundaryReview}
              saveDraft={saveShotBoundaryDraft}
              resetDraft={resetShotBoundaryDraft}
              confirmDraft={confirmShotBoundaryReview}
              retryDetections={retryShotBoundaryDetections}
              downloadMedia={downloadShotBoundaryMedia}
              onConfirmed={continueAfterBoundaryConfirmation}
              onClose={() => setStage("waiting-boundary-review")}
            />
          ) : null}

          {stage === "failed"
            && candidatePreparationFailure?.code === REVIEWED_SHOT_BOUNDARY_CONTRACT_INVALID
            && candidatePreparationFailure?.scope?.revisionId ? (
              <div className="shot-boundary-reopen">
                <button type="button" onClick={reopenConfirmedBoundaryReview} disabled={boundaryReopenBusy}>
                  {boundaryReopenBusy ? "복구용 경계 revision 준비 중…" : "장면 경계 수동 복구"}
                </button>
                <small>자동 경계 구조 검증에 실패한 경우에만 사용하는 복구 기능입니다. 기존 artifact와 실패 task는 history로 유지됩니다.</small>
              </div>
            ) : null}

          {["idle", "ready", "failed"].includes(stage) && clip ? (
            <details className="tracking-anchor-fallback">
              <summary>고급 fallback · 더 이른 시점에서 선수 찾기</summary>
              <div>
                <p>현재 장면 시작보다 앞선 프레임을 포함해 전체 선수 후보를 다시 탐지합니다. 후보는 자동 선택되지 않습니다.</p>
                <button type="button" disabled={stage === "detecting"} onClick={() => discoverPlayers(3)}>3초 앞에서 다시 찾기</button>
                <button type="button" disabled={stage === "detecting"} onClick={() => discoverPlayers(5)}>5초 앞에서 다시 찾기</button>
              </div>
            </details>
          ) : null}

          {["ready", "tracking", "completed"].includes(stage) ? (
            <div className="tracking-detected-section" aria-live="polite">
              <div className="tracking-detected-head">
                <div><span>V1.2 EVENT CANDIDATES</span><strong>Top {candidateGroups.primary.length}</strong></div>
                <small>추천은 동일 선수 확정이 아닙니다. evidence를 검토해 직접 선택하세요.</small>
              </div>
              <div className="tracking-detected-grid candidate-recommendation-grid">
                {candidateGroups.primary.map(renderRecommendationCard)}
              </div>
              {candidateGroups.fragmentedDuplicates.length ? (
                <details className="candidate-duplicate-section">
                  <summary>가능한 fragmented duplicate ({candidateGroups.fragmentedDuplicates.length})</summary>
                  <p>자동 병합하지 않았으며 각 candidate ID를 그대로 유지합니다.</p>
                  <div className="tracking-detected-grid candidate-recommendation-grid">
                    {candidateGroups.fragmentedDuplicates.map(renderRecommendationCard)}
                  </div>
                </details>
              ) : null}
              <div className="tracking-apply-row">
                <p>
                  {stage === "completed"
                    ? "선택 선수의 트래킹이 완료됐습니다. 최종 렌더에서 선수 중심 화면을 사용할 수 있어요."
                    : stage === "tracking"
                      ? `선택 선수를 추적하고 있습니다. ${Math.round(Number(trackingStatus?.progress || 0))}% · ${trackingStatus?.current_stage || "작업 준비 중"}`
                    : "선택한 선수만 추적하며, 다른 선수는 기존 Action Spotting 결과에 영향을 주지 않습니다."}
                </p>
                <button
                  type="button"
                  disabled={!selectedTrackingPlayerId || stage !== "ready" || trackingSubmitting || diagnosticsLoading}
                  onClick={startTracking}
                >
                  {stage === "completed"
                    ? "트래킹 적용 완료 ✓"
                    : stage === "tracking"
                      ? "트래킹 진행 중…"
                      : trackingSubmitting
                        ? "트래킹 시작 중…"
                        : trackingDiagnostics?.available === false
                          ? "Runtime 다시 확인 후 시작"
                          : "선택 선수 트래킹 시작"}
                </button>
              </div>
              {import.meta.env.DEV ? (
                <pre className="candidate-diagnostics" aria-label="Candidate provenance diagnostics">
                  {[
                    `ranking version: ${trackingContext?.recommendationResponse?.ranking_version || "-"}`,
                    `ranking ID: ${trackingContext?.recommendationResponse?.ranking_id || "-"}`,
                    `shortlist patch ID: ${trackingContext?.recommendationResponse?.shortlist_patch_id || "-"}`,
                    `card candidate ID: ${selectedCandidateSnapshot?.candidate_id || selectedTrackingPlayerId || "-"}`,
                    `card shot ID: ${selectedCandidateSnapshot?.shot_id || "-"}`,
                    `card tracklet ID: ${selectedCandidateSnapshot?.tracklet_id || "-"}`,
                    `selection ID: ${selectionRecord?.selection_id || "-"}`,
                    `selection candidate ID: ${selectionRecord?.candidate_id || "-"}`,
                    `tracking job ID: ${trackingHandoff?.tracking_job_id || "-"}`,
                    `tracking selected candidate ID: ${trackingHandoff?.selected_candidate_id || "-"}`,
                    `selected reference frame: ${trackingHandoff?.selected_reference_frame ?? "-"}`,
                    `bbox: ${trackingHandoff?.selected_bbox ? JSON.stringify(trackingHandoff.selected_bbox) : "-"}`,
                    `anchor mode: ${trackingHandoff?.anchor_mode || "-"}`,
                  ].join("\n")}
                </pre>
              ) : null}
            </div>
          ) : null}
          {stage === "review" && !isR1TrackingJob(trackingReview?.job || trackingStatus) ? (
            <div className="tracking-review-section" aria-live="polite">
              <div className="tracking-review-head">
                <div>
                  <span>VISUAL REVIEW · {trackingReview?.job?.pending_action?.review_stage || trackingStatus?.current_stage || "SEGMENT"}</span>
                  <strong>트래킹 세그먼트를 확인해주세요</strong>
                  <small>선택한 선수가 프레임 사이에서 바뀌지 않고 안정적으로 추적되는지 확인한 뒤 승인하거나 거절하세요.</small>
                </div>
                <div className="tracking-review-head-actions">
                  <span className="tracking-review-job">{trackingReview?.job?.job_id || trackingContext?.jobId || "작업 정보 확인 중"}</span>
                  <button type="button" disabled={reviewLoading} onClick={reloadTrackingReview}>미리보기 새로고침</button>
                </div>
              </div>
              {reviewLoading ? (
                <div className="tracking-review-loading" role="status">
                  <span className="tracking-scan-orbit"></span>
                  <div><b>검토 미리보기를 불러오고 있어요</b><small>인증된 트래킹 산출물을 준비 중입니다.</small></div>
                </div>
              ) : null}
              {!reviewLoading && trackingReview?.artifacts?.length ? (
                <div className="tracking-review-grid">
                  {trackingReview.artifacts.map((artifact) => (
                    <figure className={`tracking-review-artifact ${reviewPlaybackErrors[artifact.key] ? "has-error" : ""}`} key={artifact.key}>
                      {String(artifact.mime_type || artifact.blob?.type || "").startsWith("video/")
                        ? (
                          <>
                            <video
                              src={artifact.objectUrl}
                              controls
                              muted
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={() => setReviewPlaybackErrors((current) => {
                                if (!current[artifact.key]) return current;
                                const next = { ...current };
                                delete next[artifact.key];
                                return next;
                              })}
                              onError={() => setReviewPlaybackErrors((current) => ({
                                ...current,
                                [artifact.key]: "브라우저가 이 미리보기 코덱을 재생하지 못했습니다.",
                              }))}
                            />
                            {reviewPlaybackErrors[artifact.key] ? (
                              <div className="tracking-preview-error" role="alert">
                                <strong>미리보기를 재생할 수 없습니다</strong>
                                <span>{reviewPlaybackErrors[artifact.key]}</span>
                                <button type="button" onClick={reloadTrackingReview}>다시 불러오기</button>
                              </div>
                            ) : null}
                          </>
                        )
                        : <img src={artifact.objectUrl} alt={`${artifact.key} 트래킹 검토 이미지`} />}
                      <figcaption>
                        <strong>{artifact.kind === "review_contact_sheet" ? "프레임 접촉 시트" : "트래킹 미리보기"}</strong>
                        <span>{artifact.key}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              {!reviewLoading && trackingReview && !trackingReview.artifacts?.length ? (
                <div className="tracking-review-empty">사용 가능한 검토 미리보기가 없습니다. 잠시 후 상태를 다시 확인해주세요.</div>
              ) : null}
              <div className="tracking-review-actions">
                <p>승인하면 다음 트래킹 단계가 계속 실행됩니다. 거절하면 현재 결과를 제외하고 다른 선수를 선택할 수 있습니다.</p>
                <button
                  className="tracking-review-reject"
                  type="button"
                  disabled={reviewLoading || Boolean(reviewSubmitting) || !trackingReview?.job?.pending_action?.review_stage}
                  onClick={() => reviewTracking("reject")}
                >
                  {reviewSubmitting === "reject" ? "거절 처리 중…" : "거절"}
                </button>
                <button
                  className="tracking-review-approve"
                  type="button"
                  disabled={reviewLoading || Boolean(reviewSubmitting) || !trackingReview?.job?.pending_action?.review_stage}
                  onClick={() => reviewTracking("approve")}
                >
                  {reviewSubmitting === "approve" ? "승인 처리 중…" : "세그먼트 승인"}
                </button>
              </div>
            </div>
          ) : null}
          {stage === "ambiguity" ? (
            <div className="tracking-ambiguity-section" aria-live="polite" aria-label="교차 장면 선수 후보 선택">
              <div className="tracking-review-head">
                <div>
                  <span>{crossShotConfirmation ? "CROSS SHOT CONFIRMATION" : "PLAYER CONFIRMATION"}</span>
                  <strong>이 shot에서 같은 선수인지 한 번만 확인해주세요</strong>
                  <small>
                    {ambiguityDetails.message
                      || "자동 안전 gate를 통과하지 못한 경우에만 최대 3개의 tracklet 후보를 보여줍니다. 후보 하나를 선택하면 같은 shot의 나머지 구간은 자동으로 추적합니다."}
                  </small>
                </div>
                <div className="tracking-review-head-actions">
                  <span className="tracking-review-job">{activeJobProvenance.trackingJobId || trackingContext?.jobId || "작업 정보 확인 중"}</span>
                  <button type="button" disabled={reviewLoading || ambiguitySubmitting} onClick={reloadTrackingReview}>후보 새로고침</button>
                </div>
              </div>

              <div className="tracking-review-progress">
                <span>현재 shot <strong>{currentReviewShot}</strong></span>
                <span>검토 후보 <strong>{ambiguityCandidates.length} / 최대 3</strong></span>
                <span>선택 후 <strong>같은 shot 자동 추적 재개</strong></span>
              </div>

              {!reviewAmbiguityMatchesPending && trackingReview?.job ? (
                <div className="provenance-error-banner" role="alert">
                  {PROVENANCE_ERROR_CODE}: displayed ambiguity does not match job.pending_ambiguity_id
                </div>
              ) : null}

              {import.meta.env.DEV ? (
                <pre className="candidate-diagnostics" aria-label="Cross-shot provenance diagnostics">
                  {[
                    `tracking_job_id: ${activeJobProvenance.trackingJobId || "-"}`,
                    `selection_id: ${activeJobProvenance.selectionId || selectionRecord?.selection_id || "-"}`,
                    `selected_candidate_id: ${activeJobProvenance.selectedCandidateId || trackingHandoff?.selected_candidate_id || "-"}`,
                    `current ambiguity_id: ${ambiguityDetails.currentAmbiguityId || "-"}`,
                    `pending ambiguity_id: ${activeJobProvenance.pendingAmbiguityId || "-"}`,
                    `anchor frame: ${activeJobProvenance.anchorFrame ?? trackingHandoff?.selected_reference_frame ?? "-"}`,
                    `backend status: ${activeJobProvenance.backendStatus || "-"}`,
                    `candidate-review HTTP: ${candidateReviewHttpStatus || "-"}`,
                  ].join("\n")}
                </pre>
              ) : null}

              {reviewLoading ? (
                <div className="tracking-review-loading" role="status">
                  <span className="tracking-scan-orbit"></span>
                  <div><b>후보 tracklet을 불러오고 있어요</b><small>한 shot에서 최대 3개 후보만 비교합니다.</small></div>
                </div>
              ) : null}

              {!reviewLoading && ambiguityCandidates.length ? (
                <>
                  <div className="tracking-candidate-strip" aria-label="Cross-shot 후보 목록">
                    {ambiguityCandidates.map((candidate, index) => {
                      const previewUrl = candidate.representativeImageUrl
                        || candidate.reviewMedia?.bestCropDisplayUrl
                        || candidate.frameImageUrls?.[0]
                        || "";
                      const lowResolution = String(candidate.reviewability || "").toUpperCase() === "LOW_RESOLUTION";
                      return (
                        <button
                          type="button"
                          key={candidate.candidate_id}
                          className={index === ambiguityCandidateIndex ? "is-active" : ""}
                          aria-pressed={index === ambiguityCandidateIndex}
                          disabled={String(candidate.status || "PENDING").toUpperCase() !== "PENDING" || ambiguitySubmitting}
                          onClick={() => {
                            setAmbiguityCandidateIndex(index);
                            setAmbiguityMediaTab("bestCropDisplayUrl");
                          }}
                        >
                          {previewUrl
                            ? <img src={previewUrl} alt={`${candidate.candidate_id} 대표 crop`} />
                            : <span className="tracking-candidate-placeholder">#{candidate.rank}</span>}
                          <small>#{candidate.rank} · {candidate.tracklet_id || candidate.candidate_id}</small>
                          {lowResolution ? <small>LOW RESOLUTION · 선택 가능</small> : null}
                        </button>
                      );
                    })}
                  </div>

                  {ambiguityCandidate ? (
                    <article className="tracking-cross-shot-card">
                      <header>
                        <div>
                          <span>후보 순위</span>
                          <strong>#{ambiguityCandidate.rank}</strong>
                        </div>
                        <div className="tracking-candidate-identity">
                          <span>TRACKLET</span>
                          <strong>{ambiguityCandidate.tracklet_id || ambiguityCandidate.candidate_id}</strong>
                        </div>
                        <div>
                          <span>매칭 점수</span>
                          <strong>{trackingScoreLabel(ambiguityCandidate)}</strong>
                        </div>
                      </header>

                      <div className="tracking-candidate-metadata">
                        {ambiguityCandidate.shot_id ? <span>shot {ambiguityCandidate.shot_id}</span> : null}
                        {ambiguityCandidate.reviewability ? <span>{ambiguityCandidate.reviewability}</span> : null}
                        {ambiguityCandidate.best_frame !== undefined ? <span>best frame {ambiguityCandidate.best_frame}</span> : null}
                        <span>status {ambiguityCandidate.status || "PENDING"}</span>
                      </div>

                      <div className="cross-shot-compare">
                        <section aria-label="현재 선택된 대상 reference gallery">
                          <h4>처음 선택한 선수</h4>
                          <small>{activeJobProvenance.selectedCandidateId || "selected target"}</small>
                          {targetGalleryUrls.length ? (
                            <div className="target-reference-gallery">
                              {targetGalleryUrls.map((url, index) => (
                                <a href={url} target="_blank" rel="noreferrer" key={url}>
                                  <img src={url} alt={`선택 대상 reference ${index + 1}`} />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="tracking-candidate-data-missing">
                              backend selected target reference gallery가 없습니다.
                            </div>
                          )}
                        </section>

                        <section aria-label={`${ambiguityCandidate.candidate_id} 후보 evidence`}>
                          <h4>현재 후보</h4>
                          <div className="candidate-review-tabs" role="tablist">
                            {ambiguityReviewTabs.map(([key, label]) => (
                              <button
                                type="button"
                                role="tab"
                                key={key}
                                aria-selected={ambiguityMediaTab === key}
                                disabled={!ambiguityCandidate.reviewMedia?.[key] && !candidateArtifactMedia[key]}
                                onClick={() => setAmbiguityMediaTab(key)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div className="candidate-review-media">
                            {!activeCandidateReviewMedia ? (
                              <span>이 evidence가 backend 응답에 없습니다.</span>
                            ) : ambiguityMediaTab === "trackletVideoUrl" ? (
                              <video src={activeCandidateReviewMedia} controls muted playsInline preload="metadata" />
                            ) : (
                              <a href={activeCandidateReviewMedia} target="_blank" rel="noreferrer">
                                <img src={activeCandidateReviewMedia} alt={`${ambiguityCandidate.candidate_id} ${ambiguityMediaTab}`} />
                              </a>
                            )}
                          </div>
                        </section>
                      </div>

                      {String(ambiguityCandidate.reviewability || "").toUpperCase() === "LOW_RESOLUTION" ? (
                        <div className="candidate-evidence-warning">
                          <p>와이드 샷의 작은 선수일 수 있으므로 LOW_RESOLUTION만으로 제외하지 않습니다. tracklet 흐름을 확인한 뒤 선택할 수 있습니다.</p>
                        </div>
                      ) : null}

                      <button
                        className="tracking-confirm-candidate"
                        type="button"
                        disabled={ambiguitySubmitting || !ambiguityDetails.ambiguityId || !reviewAmbiguityMatchesPending}
                        onClick={() => confirmAmbiguityCandidate("SAME_PLAYER", ambiguityCandidate.candidate_id)}
                      >
                        {ambiguitySubmitting ? "선택 제출 중…" : "이 선수가 맞음 · 자동 추적 계속"}
                      </button>
                    </article>
                  ) : null}
                </>
              ) : null}

              {!reviewLoading && !ambiguityCandidates.length ? (
                <div className="tracking-review-empty">
                  <strong>확인할 선수 후보가 없습니다.</strong>
                  <span>이 shot은 SEARCHING/ABSENT 상태로 남기고 다음 shot에서 다시 찾는 것이 안전합니다.</span>
                  <button type="button" onClick={reloadTrackingReview}>상태 다시 불러오기</button>
                </div>
              ) : null}

              <div className="tracking-no-target-panel">
                <div>
                  <strong>후보가 맞지 않는 경우</strong>
                  <span>후보를 한 명씩 거절하며 다음 묶음을 만들지 않습니다. 최대 3개 중 정답이 없으면 그대로 다음 shot 탐색으로 넘어갑니다.</span>
                  <div className="candidate-review-bundle">
                    {fullFrameEvidenceUrl ? (
                      <a
                        href={fullFrameEvidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setAbsentEvidenceOpened((current) => ({ ...current, fullFrame: true }))}
                      >
                        full-frame context 열기 ↗
                      </a>
                    ) : <span>full-frame context 없음</span>}
                    {shotClipEvidenceUrl ? (
                      <a
                        href={shotClipEvidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setAbsentEvidenceOpened((current) => ({ ...current, shotClip: true }))}
                      >
                        전체 shot clip 열기 ↗
                      </a>
                    ) : <span>전체 shot clip 없음</span>}
                  </div>
                </div>
                <div className="tracking-full-shot-decisions">
                  <button
                    type="button"
                    disabled={ambiguitySubmitting || !ambiguityDetails.ambiguityId || !fullShotEvidenceHashesReady || !reviewAmbiguityMatchesPending}
                    onClick={() => confirmAmbiguityCandidate("NONE_OF_THESE")}
                  >
                    {ambiguitySubmitting ? "제출 중…" : "제시된 후보 중 없음"}
                  </button>
                  <button
                    type="button"
                    disabled={ambiguitySubmitting || !ambiguityDetails.ambiguityId || !absentEvidenceReady || !reviewAmbiguityMatchesPending}
                    onClick={() => confirmAmbiguityCandidate("TARGET_ABSENT")}
                  >
                    {ambiguitySubmitting ? "제출 중…" : "이 shot에는 대상 선수가 없음"}
                  </button>
                </div>
                {!absentEvidenceReady ? (
                  <small>대상 선수 없음으로 확정하려면 full-frame context와 전체 shot clip을 모두 확인해주세요.</small>
                ) : null}
              </div>

              {ambiguityFailedChoice ? (
                <div className="tracking-ambiguity-retry" role="alert">
                  <span>서버에 선택을 반영하지 못했습니다.</span>
                  <button
                    type="button"
                    disabled={ambiguitySubmitting}
                    onClick={() => confirmAmbiguityCandidate(
                      ambiguityFailedChoice.state,
                      ambiguityFailedChoice.candidateId,
                    )}
                  >
                    같은 선택으로 재시도
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {stage === "replacement-required" ? (
            <div className="tracking-review-empty" role="status">
              <strong>잘못된 트래킹 결과는 제외되었습니다.</strong>
              <span>기존 revision에서는 다른 선수를 바로 선택할 수 없습니다. 새 후보 목록을 준비해주세요.</span>
              <button type="button" onClick={() => requestReplacementCandidates()}>다른 선수 선택</button>
            </div>
          ) : null}
          {trackingError ? (
            <div
              className={`inline-error ${String(trackingError).includes(PROVENANCE_ERROR_CODE) ? "provenance-error-banner" : ""}`}
              role="alert"
            >
              {trackingError}
              {candidatePreparationFailure?.scope ? (
                <small className="candidate-failure-scope">
                  project {candidatePreparationFailure.scope.projectId} · revision {candidatePreparationFailure.scope.revisionId} · event {candidatePreparationFailure.scope.eventId} · scene {candidatePreparationFailure.scope.sceneId}
                </small>
              ) : null}
            </div>
          ) : null}
          {stage === "terminal" && terminalPresentation ? (
            <div className={`tracking-terminal is-${terminalPresentation.tone}`} role="status">
              <strong>{terminalPresentation.title}</strong>
              {terminalPresentation.outcome ? <span>Outcome: {terminalPresentation.outcome}</span> : null}
              {terminalPresentation.detail ? <span>{terminalPresentation.detail}</span> : null}
              {trackingStatus?.timeline_url ? (
                <span>타임라인 {trackingResult ? `${trackingResult.frames.length} frames` : "불러오는 중…"}</span>
              ) : null}
              {trackingStatus?.artifact_readiness ? (
                <small>
                  준비된 artifact: {Object.entries(trackingStatus.artifact_readiness)
                    .filter(([, ready]) => ready === true)
                    .map(([key]) => key)
                    .join(", ") || "없음"}
                </small>
              ) : null}
              <div className={`tracking-highlight-candidate ${highlightCandidate?.eligible_for_clip_plan ? "is-ready" : ""}`}>
                {highlightCandidateBusy ? (
                  <span>트래킹 장면을 하이라이트 후보로 등록하는 중…</span>
                ) : highlightCandidate?.eligible_for_clip_plan ? (
                  <>
                    <strong>하이라이트 후보에 포함됨</strong>
                    <span>선수 중심 트래킹 구간이 ClipPlan에 연결되었습니다.</span>
                    {highlightCandidate.unresolved_gaps ? <small>추적이 확인된 구간만 안전하게 사용합니다.</small> : null}
                  </>
                ) : highlightCandidateError ? (
                  <>
                    <span role="alert">{highlightCandidateError}</span>
                    <button type="button" onClick={() => addTrackingToHighlight(trackingContext?.jobId, trackingStatus)}>
                      하이라이트 후보 등록 다시 시도
                    </button>
                  </>
                ) : null}
              </div>
              {trackingResult?.artifacts?.length ? (
                <div className="tracking-terminal-artifacts">
                  {[
                    ["tracking_preview", "Full-frame tracking preview"],
                    ["target_centered_preview", "Target-centered preview"],
                  ].map(([key, label]) => resultArtifactsByKey[key] ? (
                    <figure key={key}>
                      <video src={resultArtifactsByKey[key].objectUrl} controls muted playsInline preload="metadata" />
                      <figcaption>{label}</figcaption>
                    </figure>
                  ) : null)}
                  <div className="tracking-result-links">
                    {["target_timeline_json", "pipeline_summary"].map((key) => resultArtifactsByKey[key] ? (
                      <a key={key} href={resultArtifactsByKey[key].objectUrl} target="_blank" rel="noreferrer">
                        {key} 열기 ↗
                      </a>
                    ) : null)}
                  </div>
                </div>
              ) : null}
              {trackingResult?.frames?.length ? (
                <details className="tracking-timeline-summary">
                  <summary>Timeline {trackingResult.frames.length} frames 확인</summary>
                  <pre>{JSON.stringify(trackingResult.timeline, null, 2)}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
          <details className="tracking-generalization-panel" open={visibleTrackingRuns.length > 0}>
            <summary>일반화 테스트 실행 기록 ({visibleTrackingRuns.length})</summary>
            <p>브라우저에는 복구에 필요한 ID와 상태만 저장합니다. access token과 media Blob은 저장하지 않습니다.</p>
            <div className="tracking-generalization-runs">
              {visibleTrackingRuns.map((run) => (
                <article key={run.trackingJobId} className={run.trackingJobId === trackingContext?.jobId ? "is-active" : ""}>
                  <header>
                    <strong>{run.status || "UNKNOWN"}</strong>
                    <button type="button" onClick={() => openStoredTrackingRun(run)}>
                      {run.trackingJobId === trackingContext?.jobId ? "API 상태 다시 조회" : "이 실행 열기"}
                    </button>
                  </header>
                  <dl>
                    <div><dt>project ID</dt><dd>{run.projectId || "-"}</dd></div>
                    <div><dt>revision ID</dt><dd>{run.revisionId || "-"}</dd></div>
                    <div><dt>scene ID</dt><dd>{run.sceneId || "-"}</dd></div>
                    <div><dt>selection ID</dt><dd>{run.selectionId || "-"}</dd></div>
                    <div><dt>selected candidate ID</dt><dd>{run.selectedCandidateId || "-"}</dd></div>
                    <div><dt>tracking job ID</dt><dd>{run.trackingJobId}</dd></div>
                    <div><dt>outcome</dt><dd>{run.outcome || "-"}</dd></div>
                    <div><dt>user confirmations</dt><dd>{run.userDecisionCount || 0}</dd></div>
                    <div><dt>latest decision ID</dt><dd>{run.latestDecisionId || "-"}</dd></div>
                    <div><dt>memory revision ID</dt><dd>{run.memoryRevisionId || "-"}</dd></div>
                    <div><dt>pipeline decision</dt><dd>{run.finalPipelineDecision || "-"}</dd></div>
                    <div><dt>failure code</dt><dd>{run.failureCode || "-"}</dd></div>
                    <div><dt>full-frame preview</dt><dd>{run.trackingJobId === trackingContext?.jobId && resultArtifactsByKey.tracking_preview ? "READY" : "API 조회 필요"}</dd></div>
                    <div><dt>target-centered preview</dt><dd>{run.trackingJobId === trackingContext?.jobId && resultArtifactsByKey.target_centered_preview ? "READY" : "API 조회 필요"}</dd></div>
                    <div><dt>timeline</dt><dd>{run.trackingJobId === trackingContext?.jobId && trackingResult?.timeline ? `${trackingResult.frames.length} frames` : "API 조회 필요"}</dd></div>
                  </dl>
                </article>
              ))}
              {!visibleTrackingRuns.length ? <span>아직 시작한 tracking job이 없습니다.</span> : null}
            </div>
          </details>
          {stage === "failed" ? (
            <div className="tracking-failure-actions">
              {failureAction === "discover" ? (
                candidatePreparationFailure?.retryUrl ? (
                  <button type="button" onClick={retryFailedCandidatePreparation}>실패한 preparation task 재시도</button>
                ) : (
                  <button type="button" onClick={() => discoverPlayers()}>선수 후보 다시 찾기 (prepare 재호출)</button>
                )
              ) : null}
              {failureAction === "start" ? (
                <>
                  <button type="button" disabled={trackingSubmitting} onClick={startTracking}>같은 선수로 다시 시작</button>
                  <button className="secondary" type="button" onClick={() => {
                    setStage("ready");
                    setTrackingError("");
                    setFailureAction("");
                  }}>후보 목록으로 돌아가기</button>
                </>
              ) : null}
              {failureAction === "tracking" ? (
                <>
                  <button type="button" onClick={() => {
                    setTrackingError("");
                    setFailureAction("");
                    setStage("tracking");
                  }}>상태 다시 확인</button>
                  <button className="secondary" type="button" onClick={() => requestReplacementCandidates()}>다른 선수 후보 찾기</button>
                </>
              ) : null}
            </div>
          ) : null}
          {ambiguityLightbox ? createPortal((
            <div
              className="tracking-frame-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="후보 프레임 확대"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setAmbiguityLightbox(null);
              }}
            >
              <button type="button" onClick={() => setAmbiguityLightbox(null)} aria-label="확대 이미지 닫기">×</button>
              <img src={ambiguityLightbox.url} alt={ambiguityLightbox.alt} />
            </div>
          ), document.body) : null}
          {candidateImagePreview ? createPortal((
            <div
              className="tracking-frame-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={`${candidateImagePreview.candidateId} 후보 미디어`}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setCandidateImagePreview(null);
              }}
            >
              <button type="button" onClick={() => setCandidateImagePreview(null)} aria-label="후보 미디어 닫기">×</button>
              <img src={candidateImagePreview.url} alt={`${candidateImagePreview.candidateId} ${candidateImagePreview.label}`} />
            </div>
          ), document.body) : null}
          {candidateVideoPreview ? createPortal((
            <div
              className="candidate-video-preview-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="candidate-video-preview-title"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setCandidateVideoPreview(null);
              }}
            >
              <div className="candidate-video-preview-panel">
                <header>
                  <div>
                    <span>TRACKLET VIDEO</span>
                    <strong id="candidate-video-preview-title">
                      {candidateVideoPreview.trackletId || candidateVideoPreview.candidateId}
                    </strong>
                  </div>
                  <button type="button" onClick={() => setCandidateVideoPreview(null)} aria-label="트랙렛 영상 닫기">×</button>
                </header>
                <video
                  key={candidateVideoPreview.url}
                  src={candidateVideoPreview.url}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  onCanPlay={() => setCandidateVideoPlaybackError("")}
                  onError={() => setCandidateVideoPlaybackError("이 브라우저에서 영상을 재생할 수 없습니다.")}
                />
                {candidateVideoPlaybackError ? (
                  <div className="candidate-video-preview-error" role="alert">
                    <span>{candidateVideoPlaybackError}</span>
                    <a href={candidateVideoPreview.url} target="_blank" rel="noreferrer">원본 파일 열기 ↗</a>
                  </div>
                ) : null}
              </div>
            </div>
          ), document.body) : null}
          {stage === "replacement-failed" ? (
            <button
              className="tracking-detect-button"
              type="button"
              onClick={() => requestReplacementCandidates()}
            >
              다른 선수 다시 찾기
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Editor({
  mode, close, selectedPlayerId, setSelectedPlayerId, eventFilter, setEventFilter, focusedEventId, setFocusedEventId,
  agentSelectionIds, setAgentSelectionIds, agentDurations, setAgentDurations, agentSummary, setAgentSummary,
  resolvedProfiles, setResolvedProfiles, setScreen, selectedMusic, setSelectedMusic, captionsEnabled, setCaptionsEnabled, showToast, uploadedVideo,
  events, players, match, matchId, projectId, requestAgentClipPlan, resolvePlayerProfile,
  assistantInput, setAssistantInput, assistantMessages, setAssistantMessages,
  sessionVideoUrl, sessionAllEvents, sessionCurrentClips, onSessionDraftChange, onAddSessionClip, sendSessionChat, isMockData,
  prepareTrackingCandidates, resumeTrackingCandidatesAfterBoundaryReview, getShotBoundaryReview, prepareNewShotBoundaryReview, saveShotBoundaryDraft, resetShotBoundaryDraft, confirmShotBoundaryReview, retryShotBoundaryDetections, downloadShotBoundaryMedia, downloadCandidateReviewMedia, prepareReplacementTrackingCandidates, retryCandidatePreparation, createCandidateSelection, createCandidateTracking, getTrackingJobState, getTrackingDiagnostics, getTrackingResult, getCompletedTrackingPreview, getTrackingReview, submitTrackingReview, confirmTrackingAmbiguity, includeTrackingHighlightCandidate,
  editState,
  onSaveDraft, draftSaveBusy, draftUpdatedAt, hasUnsavedDraftChanges,
}) {
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) ?? players[0] ?? { id: "player_001", name: "미확인 선수", number: 1, team: "", role: "" };
  const filtered = useMemo(() => {
    if (mode === "player") return events.filter((event) => event.playerIds.includes(selectedPlayerId));
    if (eventFilter === "all") return events;
    return events.filter((event) => event.category === eventFilter);
  }, [mode, eventFilter, selectedPlayerId]);
  const selectedEvents = useMemo(() => (agentSelectionIds || []).map((id) => events.find((event) => event.id === id)).filter(Boolean), [agentSelectionIds]);
  const selectedIds = new Set(selectedEvents.map((event) => event.id));
  const totalDuration = selectedEvents.reduce((sum, event) => sum + (agentDurations[event.id] ?? event.duration), 0);
  const profile = resolvedProfiles[selectedPlayerId];

  const sessionPlayerRef = useRef(null);
  const [sessionPlayerTab, setSessionPlayerTab] = useState("highlight");
  const [sessionLabelFilter, setSessionLabelFilter] = useState("all");
  const [sessionTeamScope, setSessionTeamScope] = useState("all");
  const [clipOverrides, setClipOverrides] = useState({});
  const [trackingWorkbenchOpen, setTrackingWorkbenchOpen] = useState(false);
  const [leaveDraftDialogOpen, setLeaveDraftDialogOpen] = useState(false);
  // 하이라이트 구성본 탭에서 드래그로 바꾼 클립 순서(id 배열). 서버에는 동기화하지 않는 로컬 전용 상태.
  const [highlightClipOrder, setHighlightClipOrder] = useState([]);
  const [timelineFocusRequestKey, setTimelineFocusRequestKey] = useState(0);
  // 실제 영상 재생 위치를 타임라인 기준선에 실시간으로 반영하기 위한 상태(탭에 따라 절대 초/구성본 누적 초 의미가 다름).
  const [playbackMarkerSec, setPlaybackMarkerSec] = useState(null);

  // 탭을 바꾸면 이전 탭 기준의 값이 잠깐 잘못된 위치를 가리킬 수 있으므로 초기화하고,
  // 재생 중이면 다음 timeupdate에서 새 탭 기준값으로 금방 다시 채워진다.
  useEffect(() => {
    setPlaybackMarkerSec(null);
  }, [sessionPlayerTab]);

  // "원본 전체 경기" 탭에서는 45개 전체 후보를 기준으로 필터/타임라인을 보여주고,
  // "하이라이트 구성본" 탭에서는 챗봇이 현재 구성한 결과만 기준으로 보여준다.
  const sessionFilterBaseClips = sessionPlayerTab === "full" ? sessionAllEvents : sessionCurrentClips;
  const teamOptions = useMemo(() => [
    { id: "all", label: "전체" },
    { id: "home", label: match?.home_team || "대한민국" },
    { id: "away", label: match?.away_team || "일본" },
  ], [match?.home_team, match?.away_team]);
  const teamCounts = useMemo(() => ({
    all: sessionFilterBaseClips.length,
    home: sessionFilterBaseClips.filter((clip) => clip.teamSide === "home").length,
    away: sessionFilterBaseClips.filter((clip) => clip.teamSide === "away").length,
  }), [sessionFilterBaseClips]);
  const teamScopedSessionClips = useMemo(
    () => (sessionTeamScope === "all"
      ? sessionFilterBaseClips
      : sessionFilterBaseClips.filter((clip) => clip.teamSide === sessionTeamScope)),
    [sessionFilterBaseClips, sessionTeamScope],
  );
  const effectiveSessionClips = useMemo(
    () => teamScopedSessionClips.map((clip) => {
      const override = clipOverrides[clip.id];
      if (!override) return clip;
      return { ...clip, startSec: override.startSec, endSec: override.endSec, durationSec: override.endSec - override.startSec };
    }),
    [teamScopedSessionClips, clipOverrides],
  );
  const filteredSessionClips = useMemo(
    () => (sessionLabelFilter === "all" ? effectiveSessionClips : effectiveSessionClips.filter((clip) => clip.label === sessionLabelFilter)),
    [effectiveSessionClips, sessionLabelFilter],
  );
  // 실제 video duration을 아직 안 받아오므로 이벤트들의 최대 종료 시각으로 원본 전체 길이를 추정한다.
  const sessionTimelineTotalDuration = Math.max(60, ...sessionAllEvents.map((event) => event.maxEndSec), 0);

  // highlightClipOrder에 없는(새로 추가된) 클립은 뒤에 자연스럽게 붙고, 목록에서 사라진 클립의 순서 기록은 무시된다.
  const orderedHighlightClips = useMemo(() => {
    const byId = new Map(filteredSessionClips.map((clip) => [clip.id, clip]));
    const ordered = highlightClipOrder.map((id) => byId.get(id)).filter(Boolean);
    const orderedIds = new Set(ordered.map((clip) => clip.id));
    filteredSessionClips.forEach((clip) => { if (!orderedIds.has(clip.id)) ordered.push(clip); });
    return ordered;
  }, [filteredSessionClips, highlightClipOrder]);

  // 하이라이트 구성본 탭 전용: 클립을 빈틈없이 이어붙인 좌표(renderStartSec)로 배치한다.
  const sequenceClips = useMemo(() => {
    let cursor = 0;
    return orderedHighlightClips.map((clip) => {
      const positioned = { ...clip, renderStartSec: cursor };
      cursor += clip.durationSec;
      return positioned;
    });
  }, [orderedHighlightClips]);
  const sequenceTotalDuration = Math.max(1, sequenceClips.reduce((sum, clip) => sum + clip.durationSec, 0));
  const visibleSessionClips = sessionPlayerTab === "highlight" ? sequenceClips : filteredSessionClips;
  const sessionHighlightIds = useMemo(
    () => new Set(sessionCurrentClips.map((clip) => clip.id)),
    [sessionCurrentClips],
  );
  const focusedSessionClip = visibleSessionClips.find((clip) => clip.id === focusedEventId) || null;

  useEffect(() => {
    if (mode === "match" && sessionPlayerTab === "highlight") {
      onSessionDraftChange?.(sequenceClips);
    }
  }, [mode, sessionPlayerTab, sequenceClips, onSessionDraftChange]);

  useEffect(() => {
    if (mode === "match") return;
    if (!filtered.some((event) => event.id === focusedEventId) && !selectedEvents.some((event) => event.id === focusedEventId)) {
      setFocusedEventId(selectedEvents[0]?.id ?? filtered[0]?.id ?? events[0]?.id ?? null);
    }
  }, [mode, filtered, selectedEvents, focusedEventId]);

  function clearSelection(renderMessage = true) {
    setAgentSelectionIds(null);
    setAgentDurations({});
    setAgentSummary("");
    if (renderMessage) setAssistantMessages([]);
  }

  function toggleEvent(eventId) {
    const next = new Set(agentSelectionIds || []);
    next.has(eventId) ? next.delete(eventId) : next.add(eventId);
    setAgentSelectionIds(next.size ? [...next] : null);
    setAgentSummary(next.size ? "직접 선택한 숏츠 후보" : "");
    setFocusedEventId(eventId);
  }

  function pushMessage(role, message) {
    setAssistantMessages((items) => [...items, { role, message }]);
  }

  function handleSeekClip(clip) {
    setFocusedEventId(clip.id);
    setTimelineFocusRequestKey((current) => current + 1);
    sessionPlayerRef.current?.seekToClip(clip);
  }

  function handleSelectResultClip(clip) {
    handleSeekClip(clip);
    if (sessionPlayerTab === "full") {
      const alreadyIncluded = sessionHighlightIds.has(clip.id);
      onAddSessionClip?.(clip);
      if (!alreadyIncluded) showToast("하이라이트에 장면을 추가했어요.");
    }
  }

  function handleScrubTimeline(seconds) {
    setFocusedEventId(null);
    sessionPlayerRef.current?.seekAbsolute(seconds);
  }

  function handleResizeClip(clipId, next) {
    setClipOverrides((prev) => ({ ...prev, [clipId]: next }));
  }

  function handleReorderClip(clipId, targetIndex) {
    setHighlightClipOrder(() => {
      const currentOrder = orderedHighlightClips.map((clip) => clip.id);
      const from = currentOrder.indexOf(clipId);
      if (from === -1 || from === targetIndex) return currentOrder;
      const next = [...currentOrder];
      next.splice(from, 1);
      next.splice(targetIndex, 0, clipId);
      return next;
    });
  }

  function handleScrubSequence({ clip, offsetSec }) {
    setFocusedEventId(clip.id);
    sessionPlayerRef.current?.seekSequence(clip, offsetSec);
  }

  function requestBackToHighlights() {
    if (!hasUnsavedDraftChanges) {
      setScreen("match-projects");
      return;
    }
    setLeaveDraftDialogOpen(true);
  }

  async function saveDraftAndLeave() {
    const saved = await onSaveDraft?.();
    if (!saved) return;
    setLeaveDraftDialogOpen(false);
    setScreen("match-projects");
  }

  // 화면에 보이는 클립은 로컬 재정렬(highlightClipOrder)이 반영된 순서일 수 있으므로,
  // 실제 삭제는 챗봇의 remove 인텐트가 기준으로 삼는 백엔드 원래 순서(sessionCurrentClips)에서
  // 몇 번째인지 다시 찾아 "N번째 클립을 삭제해줘" 형태로 보낸다.
  async function handleDeleteClip(clip) {
    const backendIndex = sessionCurrentClips.findIndex((item) => item.id === clip.id) + 1;
    if (backendIndex <= 0) {
      showToast("이미 삭제된 클립이에요.");
      return;
    }
    try {
      await sendSessionChat(`${backendIndex}번째 클립을 삭제해줘`);
      if (focusedEventId === clip.id) setFocusedEventId(null);
      showToast("클립을 삭제했어요.");
    } catch (error) {
      showToast("클립 삭제에 실패했어요.");
    }
  }

  async function applySessionPrompt(prompt) {
    pushMessage("user", prompt);
    try {
      const result = await sendSessionChat(prompt);
      if (result.needsClarification) {
        setAssistantMessages((items) => [...items, {
          role: "ai",
          message: result.clarificationQuestion || "어떤 걸 원하시나요?",
          options: result.clarificationOptions || [],
        }]);
      } else {
        setAssistantMessages((items) => [...items, { role: "ai", message: result.replyText || "요청을 처리했어요." }]);
        showToast("편집안이 반영됐어요.");
      }
    } catch (error) {
      pushMessage("ai", "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
      showToast("세션 요청에 실패했어요.");
    }
  }

  function pickUntilDuration(candidates, targetSeconds, durations) {
    const picked = [];
    let total = 0;
    candidates.forEach((event) => {
      if (total < targetSeconds) {
        picked.push(event);
        total += durations[event.id] ?? event.duration;
      }
    });
    return picked.length ? picked : candidates.slice(0, 1);
  }

  async function applyPrompt(prompt) {
    pushMessage("user", prompt);
    const normalized = prompt.replace(/\s/g, "");
    const nextDurations = {};
    const resolvedProfile = mode === "player" ? findPlayerKnowledge(prompt) : null;
    const editingIntent = ["골", "슈팅", "파울", "전반", "후반", "전체", "30초", "쇼츠", "하이라이트", "장면", "빠르게"].some((keyword) => prompt.includes(keyword));

    if (resolvedProfile) {
      setResolvedProfiles((profiles) => ({ ...profiles, [selectedPlayerId]: resolvedProfile }));
    } else if (mode === "player" && matchId && resolvePlayerProfile) {
      try {
        const profileFromApi = await resolvePlayerProfile({ player_id: selectedPlayerId, user_message: prompt });
        if (profileFromApi) {
          setResolvedProfiles((profiles) => ({ ...profiles, [selectedPlayerId]: {
            displayName: profileFromApi.display_name || selectedPlayer.name,
            position: profileFromApi.position || selectedPlayer.role,
            nationality: profileFromApi.nationality || selectedPlayer.team,
            traits: profileFromApi.traits || [],
            summary: profileFromApi.summary || "백엔드가 보강한 선수 프로필입니다.",
          } }));
        }
      } catch (error) {
        // Local fallback below keeps the editor usable while the backend is offline.
      }
    }

    if (resolvedProfile && !editingIntent) {
      pushMessage("ai", `${resolvedProfile.displayName} 프로필을 RAG에서 불러왔어요. 이제 왼쪽 선수 프로필에 소속, 포지션, 플레이 특성이 채워졌습니다.`);
      showToast("선수 프로필이 완성됐어요.");
      return;
    }

    let candidates;
    let summary = "요청 기반 편집안을 만들었어요.";

    if (projectId && requestAgentClipPlan && editingIntent) {
      try {
        const clipPlan = await requestAgentClipPlan({
          mode: "AGENT_GENERATED",
          prompt,
          target_duration_sec: normalized.includes("30초") ? 30 : null,
          selected_player_id: mode === "player" ? selectedPlayerId : null,
          options: { mode },
        });
        const planIds = clipPlan.itemEventIds.filter((id) => events.some((event) => String(event.id) === String(id)));
        if (planIds.length) {
          setAgentSelectionIds(planIds);
          setFocusedEventId(planIds[0]);
          setAgentSummary(clipPlan.summary || "Agent 편집안");
          pushMessage("ai", `${clipPlan.summary || "백엔드 Agent가 편집안을 만들었습니다."} ${planIds.length}개 클립으로 구성했어요.`);
          showToast("백엔드 Agent 편집안이 반영됐어요.");
          return;
        }
        setAgentSelectionIds([]);
        setAgentSummary(clipPlan.summary || "Agent 편집안");
        pushMessage("ai", clipPlan.summary || "Agent가 빈 편집안을 반환했습니다.");
        return;
      } catch (error) {
        pushMessage("ai", `Agent 편집안을 만들지 못했습니다. ${error?.detail || error?.message || "잠시 후 다시 시도해주세요."}`);
        showToast("Agent ClipPlan 생성에 실패했습니다.");
        return;
      }
    }

    if (mode === "player") {
      candidates = filtered.filter((event) => event.duration >= 5).sort((a, b) => a.minute - b.minute);
      if (normalized.includes("전반")) candidates = candidates.filter((event) => event.minute <= 45);
      if (normalized.includes("후반")) candidates = candidates.filter((event) => event.minute > 45);
      if (!candidates.length) candidates = filtered.sort((a, b) => a.minute - b.minute);
      candidates = pickUntilDuration(candidates, normalized.includes("30초") ? 30 : 24, nextDurations);
      summary = `${resolvedProfile?.displayName ?? profile?.displayName ?? selectedPlayer.name} 트래킹 구간 중심 쇼츠 후보`;
    } else if (normalized.includes("손흥민") && normalized.includes("슈팅")) {
      const primaryPlayerId = players.find((player) => player.name.includes("손흥민"))?.id ?? selectedPlayerId;
      const primary = events.filter((event) => event.playerIds.includes(primaryPlayerId) && event.category === "shot");
      const support = events.filter((event) => event.playerIds.includes(primaryPlayerId) && event.category !== "shot").sort((a, b) => b.score - a.score);
      candidates = pickUntilDuration([...primary, ...support], normalized.includes("30초") ? 30 : 24, nextDurations);
      summary = "손흥민 슈팅 중심 30초 쇼츠 후보";
    } else if (normalized.includes("골")) {
      candidates = events.filter((event) => event.category === "goal").sort((a, b) => a.minute - b.minute);
      if (normalized.includes("세리머니") || normalized.includes("길게")) {
        candidates.forEach((event) => { nextDurations[event.id] = event.duration + 5; });
        summary = "골 장면만 선택하고 득점 이후 여운을 길게 잡았어요.";
      } else summary = "골 장면만 모은 쇼츠 후보";
    } else if (normalized.includes("슈팅")) {
      candidates = events.filter((event) => event.category === "shot").sort((a, b) => a.minute - b.minute);
      summary = "슈팅 장면만 타임라인에 모았어요.";
    } else if (normalized.includes("파울")) {
      candidates = events.filter((event) => event.category === "foul").sort((a, b) => a.minute - b.minute);
      summary = "파울 장면만 타임라인에 모았어요.";
    } else if (normalized.includes("전반전")) {
      candidates = events.filter((event) => event.minute <= 45).sort((a, b) => a.minute - b.minute);
      if (normalized.includes("빠르게")) {
        candidates.forEach((event) => { nextDurations[event.id] = Math.min(event.duration, 5); });
        summary = "전반전 이벤트를 빠른 컷 편집으로 구성했어요.";
      } else summary = "전반전 중심 쇼츠 후보";
    } else if (normalized.includes("후반전")) {
      candidates = events.filter((event) => event.minute > 45).sort((a, b) => a.minute - b.minute);
      summary = "후반전 장면만 타임라인에 모았어요.";
    } else if (normalized.includes("전체")) {
      candidates = events;
      summary = "전체 이벤트 타임라인으로 되돌렸어요.";
    } else {
      candidates = events.filter((event) => event.score >= 90).sort((a, b) => b.score - a.score);
    }

    setAgentDurations(nextDurations);
    setAgentSelectionIds(candidates.map((event) => event.id));
    setFocusedEventId(candidates[0]?.id ?? events[0]?.id ?? null);
    setAgentSummary(summary);
    pushMessage("ai", `${resolvedProfile ? `${resolvedProfile.displayName} 프로필을 함께 반영했습니다. ` : ""}${summary} ${candidates.length}개 클립으로 구성했어요.`);
    showToast("Agent 편집안이 타임라인에 반영됐어요.");
  }

  const isMatchSession = mode === "match";
  const prompts = (mode === "player" ? playerAgentPrompts : matchAgentPrompts).slice(0, 2);
  const quickPromptItems = isMatchSession
    ? sessionAgentPrompts.map((prompt) => ({ prompt, label: prompt }))
    : prompts.map((prompt) => ({ prompt, label: prompt.replace("이 선수 위주로 ", "").replace("이 선수가 오래 나온 구간 위주로 만들어줘", "긴 트래킹 구간") }));

  return (
    <section className="match-editor">
      <EditorTopline
        mode={mode}
        onClose={close}
        onBackToHighlights={requestBackToHighlights}
        onPreview={() => setScreen("preview")}
        onSaveDraft={onSaveDraft}
        draftSaveBusy={draftSaveBusy}
        draftUpdatedAt={draftUpdatedAt}
        isMockData={isMockData}
      />
      <div className="edit-workspace">
        <div className="edit-main">
          {isMatchSession ? (
            <>
              <SessionVideoPlayer
                ref={sessionPlayerRef}
                videoUrl={sessionVideoUrl}
                currentClips={sessionPlayerTab === "highlight" ? sequenceClips : filteredSessionClips}
                playerTab={sessionPlayerTab}
                onSwitchTab={setSessionPlayerTab}
                onProgress={setPlaybackMarkerSec}
                onSeekOutOfRange={showToast}
              />
              <SessionFilterPanel
                allEvents={teamScopedSessionClips}
                labelFilter={sessionLabelFilter}
                setLabelFilter={setSessionLabelFilter}
                teamOptions={teamOptions}
                teamScope={sessionTeamScope}
                setTeamScope={(next) => {
                  setSessionTeamScope(next);
                  setFocusedEventId(null);
                }}
                teamCounts={teamCounts}
              />
              <SessionResultsPanel
                clips={sessionPlayerTab === "highlight" ? sequenceClips : filteredSessionClips}
                focusedClipId={focusedEventId}
                selectedIds={sessionPlayerTab === "full" ? sessionHighlightIds : null}
                onSelect={handleSelectResultClip}
              />
              {sessionPlayerTab === "highlight" ? (
                <SessionTimelinePanel
                  clips={sequenceClips}
                  focusedClipId={focusedEventId}
                  focusRequestKey={timelineFocusRequestKey}
                  totalDuration={sequenceTotalDuration}
                  layout="sequence"
                  playbackSec={playbackMarkerSec}
                  onSelect={handleSeekClip}
                  onResize={handleResizeClip}
                  onReorder={handleReorderClip}
                  onScrub={handleScrubSequence}
                  onDeleteClip={handleDeleteClip}
                  onOpenTracking={() => setTrackingWorkbenchOpen(true)}
                />
              ) : (
                <SessionTimelinePanel
                  clips={filteredSessionClips}
                  focusedClipId={focusedEventId}
                  focusRequestKey={timelineFocusRequestKey}
                  totalDuration={sessionTimelineTotalDuration}
                  layout="position"
                  playbackSec={playbackMarkerSec}
                  onSelect={handleSeekClip}
                  onResize={handleResizeClip}
                  onScrub={handleScrubTimeline}
                  onOpenTracking={() => setTrackingWorkbenchOpen(true)}
                />
              )}
              <CompletedTrackingVideos
                editState={editState}
                getCompletedTrackingPreview={getCompletedTrackingPreview}
              />
              <TrackingWorkbench
                projectId={projectId}
                clip={focusedSessionClip}
                open={trackingWorkbenchOpen}
                onToggle={() => setTrackingWorkbenchOpen((value) => !value)}
                showToast={showToast}
                prepareTrackingCandidates={prepareTrackingCandidates}
                resumeTrackingCandidatesAfterBoundaryReview={resumeTrackingCandidatesAfterBoundaryReview}
                getShotBoundaryReview={getShotBoundaryReview}
                prepareNewShotBoundaryReview={prepareNewShotBoundaryReview}
                saveShotBoundaryDraft={saveShotBoundaryDraft}
                resetShotBoundaryDraft={resetShotBoundaryDraft}
                confirmShotBoundaryReview={confirmShotBoundaryReview}
                retryShotBoundaryDetections={retryShotBoundaryDetections}
                downloadShotBoundaryMedia={downloadShotBoundaryMedia}
                downloadCandidateReviewMedia={downloadCandidateReviewMedia}
                prepareReplacementTrackingCandidates={prepareReplacementTrackingCandidates}
                retryCandidatePreparation={retryCandidatePreparation}
                createCandidateSelection={createCandidateSelection}
                createCandidateTracking={createCandidateTracking}
                getTrackingJobState={getTrackingJobState}
                getTrackingDiagnostics={getTrackingDiagnostics}
                getTrackingResult={getTrackingResult}
                getTrackingReview={getTrackingReview}
                submitTrackingReview={submitTrackingReview}
                confirmTrackingAmbiguity={confirmTrackingAmbiguity}
                includeTrackingHighlightCandidate={includeTrackingHighlightCandidate}
              />
            </>
          ) : (
            <>
              <SourceMonitor uploadedVideo={uploadedVideo} />
              <PlayerProfilePanel selectedPlayer={selectedPlayer} filteredEvents={filtered} profile={profile} />
              <FilterResultsPanel filteredEvents={filtered} focusedEventId={focusedEventId} selectedIds={selectedIds} toggleEvent={toggleEvent} />
              <AgentSelectionPanel
                mode={mode}
                filteredEvents={filtered}
                selectedEvents={selectedEvents}
                focusedEventId={focusedEventId}
                setFocusedEventId={setFocusedEventId}
                agentDurations={agentDurations}
                totalDuration={totalDuration}
              />
            </>
          )}
        </div>

        <PersistentAgentPanel
          context="edit"
          mode={mode}
          selectedPlayer={selectedPlayer}
          messages={assistantMessages}
          input={assistantInput}
          setInput={setAssistantInput}
          onSubmit={isMatchSession ? applySessionPrompt : applyPrompt}
          quickPrompts={quickPromptItems}
          status={!isMatchSession && agentSelectionIds?.length > 0 ? { title: agentSummary, detail: `${agentSelectionIds.length}개 클립 · ${formatDuration(totalDuration)}` } : null}
          onReset={isMatchSession ? undefined : () => clearSelection()}
        />
      </div>
      {leaveDraftDialogOpen ? createPortal((
        <div className="draft-leave-backdrop" role="presentation" onMouseDown={() => setLeaveDraftDialogOpen(false)}>
          <section
            className="draft-leave-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-leave-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="section-kicker">UNSAVED CHANGES</span>
            <h2 id="draft-leave-title">편집 내용을 임시저장할까요?</h2>
            <p>저장하지 않고 목록으로 이동하면 마지막 임시저장 이후의 변경사항은 복원되지 않습니다.</p>
            <div className="draft-leave-actions">
              <button className="button primary" type="button" onClick={saveDraftAndLeave} disabled={draftSaveBusy}>
                {draftSaveBusy ? "저장 중…" : "임시저장 후 이동"}
              </button>
              <button className="button ghost" type="button" onClick={() => setScreen("match-projects")} disabled={draftSaveBusy}>
                저장하지 않고 이동
              </button>
              <button className="button ghost" type="button" onClick={() => setLeaveDraftDialogOpen(false)} disabled={draftSaveBusy}>
                취소
              </button>
            </div>
          </section>
        </div>
      ), document.body) : null}
    </section>
  );
}

export default function EditScreen(props) {
  return (
    <section className={`screen ${props.active ? "active" : ""}`} id="edit">
      <Editor {...props} close={() => {}} />
    </section>
  );
}
