import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatDuration } from "../utils/format.js";
import { musicOptions, sessionLabelMeta } from "../data/mockData.js";
import { seekVideoSafely } from "../features/editor/videoSeek.js";
import PersistentAgentPanel from "../components/agent/PersistentAgentPanel.jsx";
import { buildExportPreviewClips } from "../domain/exportPreview.js";

const RATIO_OPTIONS = ["16:9", "9:16", "1:1"];
const QUALITY_OPTIONS = ["720p", "1080p", "4K"];

function clipLabelKo(clip) {
  return sessionLabelMeta[clip.label]?.ko || clip.label;
}

function clipColor(clip) {
  return sessionLabelMeta[clip.label]?.color || "#d4ff00";
}

// 편집 화면의 "하이라이트 구성본" 재생과 같은 방식으로, 원본 영상 안에서 구성본 클립들만
// 순서대로 이어 재생하는 플레이어. 진행바/시간 표시도 원본이 아니라 구성본 기준이다.
const ExportSequencePlayer = forwardRef(function ExportSequencePlayer({
  videoUrl, clips, ratio, thumbnail, showingThumbnail, onSeekOutOfRange, onBackToEdit,
}, ref) {
  const videoRef = useRef(null);
  const [activeClipIndex, setActiveClipIndex] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);

  const totalSec = clips.reduce((sum, clip) => sum + clip.durationSec, 0);
  const sequenceKey = clips.map((clip) => `${clip.id}:${clip.startSec}:${clip.endSec}`).join("|");

  // 구성본이 바뀌면 첫 클립 시작 지점에서 멈춘 상태로 되돌린다.
  // 첫 프레임부터 원본 0초가 아니라 구성본 첫 장면이 보여야 한다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setActiveClipIndex(null);
    setElapsedSec(0);
    if (clips.length && video.readyState >= 1) {
      seekVideoSafely(video, clips[0].startSec, onSeekOutOfRange);
    }
  }, [videoUrl, sequenceKey]);

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (video && clips.length && activeClipIndex == null) {
      seekVideoSafely(video, clips[0].startSec, onSeekOutOfRange);
    }
  }

  // targetSeconds(구성본 누적 초)가 어느 클립의 어느 지점인지 찾아 이동한다. 진행바 드래그용.
  function seekBySequenceSeconds(targetSeconds) {
    const video = videoRef.current;
    if (!video || !clips.length) return;
    let index = clips.findIndex((clip) => targetSeconds < clip.renderStartSec + clip.durationSec);
    if (index === -1) index = clips.length - 1;
    const clip = clips[index];
    const offsetSec = Math.max(0, targetSeconds - clip.renderStartSec);
    if (!seekVideoSafely(video, clip.startSec + offsetSec, onSeekOutOfRange)) return;
    setActiveClipIndex(index);
    setElapsedSec(clip.renderStartSec + offsetSec);
  }

  useImperativeHandle(ref, () => ({
    seekToClip(clip) {
      const video = videoRef.current;
      const index = clips.findIndex((item) => item.id === clip.id);
      if (!video || index === -1) return;
      if (!seekVideoSafely(video, clip.startSec, onSeekOutOfRange)) return;
      setActiveClipIndex(index);
      setElapsedSec(clip.renderStartSec);
      video.play().catch(() => {});
    },
    pause() {
      videoRef.current?.pause();
    },
  }));

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !clips.length) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (activeClipIndex == null) {
      if (!seekVideoSafely(video, clips[0].startSec, onSeekOutOfRange)) return;
      setActiveClipIndex(0);
      setElapsedSec(0);
    }
    video.play().catch(() => {});
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || activeClipIndex == null) return;
    const clip = clips[activeClipIndex];
    if (!clip) return;

    const sequenceSec = clip.renderStartSec + Math.max(0, video.currentTime - clip.startSec);
    setElapsedSec(Math.min(sequenceSec, totalSec));

    if (video.currentTime >= clip.endSec) {
      const nextIndex = activeClipIndex + 1;
      const nextClip = clips[nextIndex];
      if (nextClip && seekVideoSafely(video, nextClip.startSec, onSeekOutOfRange)) {
        setActiveClipIndex(nextIndex);
        return;
      }
      // 마지막 클립까지 재생 완료 — 처음으로 되감아 멈춘다.
      video.pause();
      setActiveClipIndex(null);
      setElapsedSec(totalSec);
      seekVideoSafely(video, clips[0].startSec, onSeekOutOfRange);
    }
  }

  function handleProgressPointerDown(event) {
    event.preventDefault();
    const bar = event.currentTarget;
    const seekFromClientX = (clientX) => {
      const rect = bar.getBoundingClientRect();
      const rectRatio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      seekBySequenceSeconds(rectRatio * totalSec);
    };
    seekFromClientX(event.clientX);

    function onMove(moveEvent) {
      seekFromClientX(moveEvent.clientX);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const activeClip = activeClipIndex != null ? clips[activeClipIndex] : null;
  const progressPercent = totalSec > 0 ? Math.min(100, (elapsedSec / totalSec) * 100) : 0;

  return (
    <div className="export-monitor">
      {videoUrl ? (
        // 실제 렌더(중앙 크롭)와 동일하게, 선택한 비율의 프레임만 보여준다.
        // 프레임 밖 영역은 최종 영상에 포함되지 않으므로 미리보기에서도 보이지 않는다.
        <div className={`export-ratio-frame ratio-${ratio.replace(":", "-")}`}>
          <video
            ref={videoRef}
            src={videoUrl}
            muted={muted}
            playsInline
            preload="metadata"
            className={showingThumbnail ? "surface-hidden" : ""}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
          />
          {showingThumbnail && thumbnail?.image_data_url ? (
            <img className="export-thumbnail-surface" src={thumbnail.image_data_url} alt={`AI 추천 썸네일 ${thumbnail.timestamp_label || ""}`} />
          ) : null}
          {clips.length && !showingThumbnail ? (
            <div className="session-player-overlay">
              <div className="session-player-status">
                <button type="button" onClick={togglePlayback} aria-label={playing ? "일시정지" : "재생"}>
                  {playing ? "⏸" : "▶"}
                </button>
                <strong>
                  {activeClip
                    ? `${clipLabelKo(activeClip)} · ${activeClipIndex + 1}/${clips.length}`
                    : `하이라이트 구성본 · ${clips.length}개 클립`}
                </strong>
                <button type="button" className="session-mute-toggle" onClick={() => setMuted((value) => !value)} aria-label="음소거 전환">
                  {muted ? "🔇" : "🔊"}
                </button>
              </div>
              <div className="session-progress-bar" onPointerDown={handleProgressPointerDown}>
                <div className="session-progress-fill" style={{ width: `${progressPercent}%` }}></div>
              </div>
              <div className="session-progress-time">
                <span>{formatDuration(Math.round(elapsedSec))}</span>
                <span>{formatDuration(Math.round(totalSec))}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="export-monitor-empty">영상을 아직 불러오지 못했어요.</div>
      )}
      {videoUrl && !clips.length ? (
        <div className="export-monitor-empty export-monitor-blocked">
          <strong>하이라이트 구성본이 비어 있어요.</strong>
          <p>편집 화면에서 클립을 담은 뒤 다시 내보내기를 눌러주세요.</p>
          {onBackToEdit ? (
            <button className="button primary compact" type="button" onClick={onBackToEdit}>← 편집 화면으로</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default function PreviewScreen({
  active,
  selectedEvents,
  agentDurations,
  captionsEnabled,
  exportRatio,
  setExportRatio,
  selectedMusic,
  setSelectedMusic,
  setCaptionsEnabled,
  uploadedVideo,
  showToast,
  onRunExportAssistant,
  uploadedVideoDuration,
  draftDuration,
  draftClips,
  mode,
  assistantInput,
  setAssistantInput,
  assistantMessages,
  setAssistantMessages,
  renderJobs,
  renderBusy,
  onCreateRender,
  onDownloadRender,
  onBackToEdit,
}) {
  const [quality, setQuality] = useState("1080p");
  const [title, setTitle] = useState("KickClip Highlight 01");
  const [hashtags, setHashtags] = useState([]);
  const [thumbnail, setThumbnail] = useState(null);
  const [recommendedFields, setRecommendedFields] = useState([]);
  const [previewSurface, setPreviewSurface] = useState("video");
  const [agentBusy, setAgentBusy] = useState(false);
  const playerRef = useRef(null);
  const previewClips = useMemo(() => buildExportPreviewClips({
    mode,
    sessionClips: draftClips,
    selectedEvents,
    agentDurations,
  }), [mode, draftClips, selectedEvents, agentDurations]);
  // 구성본이 비어 있으면 0으로 둔다 — 원본 전체 길이를 대신 보여주면
  // "전체 영상이 내보내기로 넘어왔다"는 오해를 다시 만들기 때문.
  const totalDuration = previewClips.reduce((sum, clip) => sum + clip.durationSec, 0);

  function pushAgentMessage(role, message) {
    setAssistantMessages((items) => [...items, { role, message }]);
  }

  async function applyExportPrompt(prompt) {
    if (agentBusy) return;
    setAgentBusy(true);
    pushAgentMessage("user", prompt);

    try {
      const result = await onRunExportAssistant?.({
        message: prompt,
        currentSettings: {
          title,
          ratio: exportRatio,
          captions_enabled: captionsEnabled,
          music: selectedMusic,
          quality,
        },
        conversation: assistantMessages.slice(-12).map((item) => ({
          role: item.role === "ai" ? "assistant" : "user",
          content: String(item.message || ""),
        })),
      });
      if (!result) throw new Error("Agent 응답이 없습니다.");

      const patch = result.settings_patch || {};
      if (patch.ratio) setExportRatio(patch.ratio);
      if (typeof patch.captions_enabled === "boolean") setCaptionsEnabled(patch.captions_enabled);
      if (patch.music) setSelectedMusic(patch.music);
      if (patch.quality) setQuality(patch.quality);
      if (patch.title) {
        setTitle(patch.title);
        setRecommendedFields((fields) => [...new Set([...fields, "title"])]);
      }

      if (result.recommendation) {
        const recommendation = result.recommendation;
        const receivedFields = recommendation.requested_fields?.length
          ? recommendation.requested_fields
          : [
              recommendation.title != null ? "title" : null,
              Array.isArray(recommendation.hashtags) ? "hashtags" : null,
              recommendation.thumbnail ? "thumbnail" : null,
            ].filter(Boolean);
        if (recommendation.title != null) setTitle(recommendation.title);
        if (Array.isArray(recommendation.hashtags)) setHashtags(recommendation.hashtags);
        if (recommendation.thumbnail) {
          setThumbnail(recommendation.thumbnail);
          setPreviewSurface(recommendation.thumbnail.image_data_url ? "thumbnail" : "video");
        }
        setRecommendedFields((fields) => [...new Set([...fields, ...receivedFields])]);
      }

      pushAgentMessage("ai", result.message || "요청을 처리했어요.");
      showToast("AI Agent가 요청을 처리했어요.");
    } catch (error) {
      const detail = error?.detail || error?.message || "Agent 요청을 처리하지 못했습니다.";
      pushAgentMessage("ai", `요청을 처리하지 못했어요.\n${detail}`);
      showToast("AI Agent 요청에 실패했어요.");
    } finally {
      setAgentBusy(false);
    }
  }

  function showVideoPreview() {
    setPreviewSurface("video");
  }

  function showThumbnailPreview() {
    playerRef.current?.pause();
    setPreviewSurface("thumbnail");
  }

  async function startRender() {
    try {
      await onCreateRender({
        ratio: exportRatio,
        quality,
        captions_enabled: captionsEnabled,
        music: selectedMusic,
      });
    } catch (error) {
      showToast(error?.detail || error?.message || "렌더링을 시작하지 못했습니다.");
    }
  }

  const showingThumbnail = previewSurface === "thumbnail" && Boolean(thumbnail?.image_data_url);
  const normalizedHashtags = hashtags.map((hashtag) => hashtag.startsWith("#") ? hashtag : `#${hashtag}`);
  const hasTitleRecommendation = recommendedFields.includes("title");
  const hasHashtagRecommendation = recommendedFields.includes("hashtags");
  const hasThumbnailRecommendation = recommendedFields.includes("thumbnail") && Boolean(thumbnail);
  const hasAnyRecommendation = hasTitleRecommendation || hasHashtagRecommendation || hasThumbnailRecommendation;
  const canRender = !renderBusy && Boolean(uploadedVideo) && previewClips.length > 0;

  return (
    <section className={`screen ${active ? "active" : ""}`} id="preview">
      <section className="match-editor export-editor">
        <div className="editor-topline match-editor-topline export-topline">
          <div className="editor-heading-lockup">
            <button className="page-back-button" type="button" onClick={onBackToEdit}>← 편집 화면</button>
            <p className="agent-label mini"><span></span> RENDER &amp; DOWNLOAD</p>
            <div className="editor-heading-copy"><strong>렌더 및 다운로드</strong></div>
          </div>
          <div className="topline-actions">
            <span className="export-summary-chip">
              하이라이트 구성본 · {previewClips.length}개 클립 · {formatDuration(Math.round(totalDuration || 0))}
            </span>
            <button
              className="button primary compact"
              type="button"
              disabled={!canRender}
              title={!previewClips.length ? "하이라이트 구성본이 비어 있으면 렌더링할 수 없습니다." : undefined}
              onClick={startRender}
            >
              {renderBusy ? "렌더 요청 중…" : "현재 설정으로 렌더 시작"}
            </button>
          </div>
        </div>

        <div className="edit-workspace export-workspace">
          <div className="export-main">
            <section className="export-panel export-player-panel">
              <div className="session-player-tabs export-player-tabs">
                <button type="button" className={showingThumbnail ? "" : "active"} onClick={showVideoPreview}>
                  하이라이트 구성본 미리보기
                </button>
                {hasThumbnailRecommendation && thumbnail?.image_data_url ? (
                  <button type="button" className={showingThumbnail ? "active" : ""} onClick={showThumbnailPreview}>
                    AI 추천 썸네일
                  </button>
                ) : null}
                <em>{exportRatio} · {quality} · 자막 {captionsEnabled ? "ON" : "OFF"} · {selectedMusic}</em>
              </div>
              <ExportSequencePlayer
                ref={playerRef}
                videoUrl={uploadedVideo}
                clips={previewClips}
                ratio={exportRatio}
                thumbnail={thumbnail}
                showingThumbnail={showingThumbnail}
                onSeekOutOfRange={() => showToast("편집 구간이 원본 영상 길이를 벗어났습니다.")}
                onBackToEdit={onBackToEdit}
              />
            </section>

            <section className="export-panel export-sequence-panel">
              <div className="export-sequence-head">
                <div className="filter-label">HIGHLIGHT SEQUENCE</div>
                <em>클립을 누르면 해당 장면부터 미리보기가 재생됩니다.</em>
              </div>
              {previewClips.length ? (
                <div className="export-sequence-strip">
                  {previewClips.map((clip, index) => (
                    <button
                      type="button"
                      key={clip.id}
                      className="export-sequence-chip"
                      style={{ "--event-color": clipColor(clip), flexGrow: Math.max(1, clip.durationSec) }}
                      onClick={() => {
                        showVideoPreview();
                        playerRef.current?.seekToClip(clip);
                      }}
                    >
                      <b>{index + 1}. {clipLabelKo(clip)}</b>
                      <span>{formatDuration(Math.round(clip.startSec))}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="tl-empty">편집 화면에서 구성한 클립이 여기에 표시됩니다.</div>
              )}
            </section>

            <div className="export-config-grid">
              <section className="export-panel export-settings-panel">
                <div className="filter-label">EXPORT SETTINGS</div>
                <div className="export-setting-row">
                  <span>화면 비율</span>
                  <div className="export-chip-group">
                    {RATIO_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option}
                        className={`export-chip ${exportRatio === option ? "active" : ""}`}
                        onClick={() => setExportRatio(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="export-setting-row">
                  <span>화질</span>
                  <div className="export-chip-group">
                    {QUALITY_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option}
                        className={`export-chip ${quality === option ? "active" : ""}`}
                        onClick={() => setQuality(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="export-setting-row">
                  <span>자막</span>
                  <div className="export-chip-group">
                    <button
                      type="button"
                      className={`export-chip ${captionsEnabled ? "active" : ""}`}
                      onClick={() => setCaptionsEnabled(true)}
                    >
                      ON
                    </button>
                    <button
                      type="button"
                      className={`export-chip ${captionsEnabled ? "" : "active"}`}
                      onClick={() => setCaptionsEnabled(false)}
                    >
                      OFF
                    </button>
                  </div>
                </div>
                <div className="export-setting-row">
                  <span>배경 음악</span>
                  <div className="export-chip-group">
                    {musicOptions.map((option) => (
                      <button
                        type="button"
                        key={option}
                        className={`export-chip ${selectedMusic === option ? "active" : ""}`}
                        onClick={() => setSelectedMusic(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="export-panel export-meta-panel">
                <div className="filter-label">AI 게시 정보</div>
                <label className="export-title-field">
                  <span>제목 {hasTitleRecommendation ? <em className="export-ai-badge">AI 추천</em> : null}</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="영상 제목을 입력하세요"
                  />
                </label>
                {hasHashtagRecommendation && normalizedHashtags.length ? (
                  <div className="export-hashtags">
                    {normalizedHashtags.map((hashtag, index) => <b key={`${hashtag}-${index}`}>{hashtag}</b>)}
                  </div>
                ) : null}
                {hasThumbnailRecommendation && thumbnail?.image_data_url ? (
                  <button type="button" className="export-thumbnail-row" onClick={showingThumbnail ? showVideoPreview : showThumbnailPreview}>
                    <img src={thumbnail.image_data_url} alt="AI 추천 썸네일" />
                    <span>
                      <b>AI 추천 썸네일 {thumbnail.timestamp_label || ""}</b>
                      <small>{showingThumbnail ? "영상 미리보기로 돌아가기" : "미리보기 화면에서 확인하기"}</small>
                    </span>
                  </button>
                ) : null}
                {!hasAnyRecommendation ? (
                  <p className="export-meta-hint">
                    오른쪽 KickClip Agent에게 “게시 정보 전체 추천”을 요청하면
                    제목·해시태그·썸네일을 채워드려요.
                  </p>
                ) : null}
              </section>
            </div>

            <section className="render-panel export-render-panel" aria-labelledby="render-panel-title">
              <div className="render-panel-head">
                <div>
                  <div className="filter-label">HIGHLIGHT OUTPUTS</div>
                  <h2 id="render-panel-title">렌더 및 다운로드</h2>
                  <p>현재 하이라이트 구성본의 편집 계획으로 생성된 렌더만 표시됩니다.</p>
                </div>
                <button className="button primary" type="button" disabled={!canRender} onClick={startRender}>
                  {renderBusy ? "렌더 요청 중…" : "현재 설정으로 렌더 시작"}
                </button>
              </div>
              {renderJobs.length ? (
                <div className="render-job-list">
                  {renderJobs.map((job) => {
                    const status = String(job.status || "").toLowerCase();
                    const completed = status === "completed";
                    const failed = status === "failed";
                    return (
                      <article className={`render-job-card ${status}`} key={job.render_job_id}>
                        <div><span className={`render-status ${status}`}>{job.status}</span><strong>{job.render_job_id}</strong><small>ClipPlan · {job.clip_plan_id}</small></div>
                        {!completed && !failed ? <div className="render-progress"><span style={{ width: `${Math.max(2, Number(job.progress || 0))}%` }}></span><em>{Number(job.progress || 0)}%</em></div> : null}
                        {failed ? <p className="render-error">{job.error_message || "렌더링에 실패했습니다."}</p> : null}
                        <div className="render-job-actions">
                          {completed && job.download_url ? <button className="button primary compact" type="button" onClick={() => onDownloadRender(job.render_job_id)}>완료 영상 다운로드</button> : null}
                          {failed ? <button className="button ghost compact" type="button" disabled={!canRender} onClick={startRender}>같은 설정으로 재시도</button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="render-empty"><span>RENDER</span><strong>아직 생성된 렌더가 없습니다.</strong><p>구성본을 확인한 뒤 현재 설정으로 첫 렌더를 시작하세요.</p></div>
              )}
            </section>
          </div>

          <PersistentAgentPanel
            context="export"
            mode={mode}
            messages={assistantMessages}
            input={assistantInput}
            setInput={setAssistantInput}
            onSubmit={applyExportPrompt}
            busy={agentBusy}
            quickPrompts={[
              { label: "게시 정보 전체 추천", prompt: "영상에 어울리는 제목, 해시태그, 썸네일을 모두 추천해줘" },
              { label: "쇼츠 설정 자동 적용", prompt: "9:16 비율에 자막 켜고 Hype Beat 01, 1080p로 설정해줘" },
            ]}
          />
        </div>
      </section>
    </section>
  );
}
