import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatDuration } from "../../utils/format.js";
import { sessionLabelMeta } from "../../data/mockData.js";
import { seekVideoSafely } from "./videoSeek.js";

const SessionVideoPlayer = forwardRef(function SessionVideoPlayer({ videoUrl, currentClips, playerTab, onSwitchTab, onProgress, onSeekOutOfRange }, ref) {
  const videoRef = useRef(null);
  const [activeClipIndex, setActiveClipIndex] = useState(null);
  const [muted, setMuted] = useState(false);
  // 자동으로 다음 클립으로 넘어가는 중이면 다음 클립 정보가 담기고(라벨 카드용), 평상시엔 null.
  // 카드는 videoHidden보다 좀 더 오래 떠 있어서 영상이 다시 보이기 시작한 뒤에도 잠깐 유지된다.
  const [transitionClip, setTransitionClip] = useState(null);
  // seek 순간(어두워졌다 다시 밝아지는 구간)에만 true — 이 값만 영상 opacity를 제어한다.
  const [videoHidden, setVideoHidden] = useState(false);
  // "하이라이트 구성본" 탭에서 구성본 기준 누적 재생 시간(하단 진행바용) — timeupdate/직접 탐색 시 즉시 갱신한다.
  const [sequenceElapsedSec, setSequenceElapsedSec] = useState(0);
  // triggerAutoTransition이 예약한 setTimeout id들 — 대기 중에 사용자가 직접 다른 곳으로 이동하면
  // 이 예약된 콜백들이 나중에 뒤늦게 실행되면서 방금 한 수동 이동을 덮어써버리는 걸 막기 위해 추적한다.
  const pendingTransitionTimeouts = useRef([]);

  function clearPendingTransition() {
    pendingTransitionTimeouts.current.forEach((id) => window.clearTimeout(id));
    pendingTransitionTimeouts.current = [];
    setTransitionClip(null);
    setVideoHidden(false);
  }

  // targetSeconds(구성본 전체 기준 누적 초)가 어느 클립의 어느 지점인지 찾아 그 위치로 이동한다.
  // 진행바를 드래그할 때 쓰이며, 재생 중이 아니면(=일시정지 상태) 재생을 강제로 시작하지 않는다.
  function seekBySequenceSeconds(targetSeconds) {
    const video = videoRef.current;
    if (!video || !currentClips.length) return;
    clearPendingTransition();
    let index = currentClips.findIndex((item) => targetSeconds < (item.renderStartSec ?? 0) + item.durationSec);
    if (index === -1) index = currentClips.length - 1;
    const clip = currentClips[index];
    const offsetSec = Math.max(0, targetSeconds - (clip.renderStartSec ?? 0));
    if (!seekVideoSafely(video, clip.startSec + offsetSec, onSeekOutOfRange)) return;
    setActiveClipIndex(index);
    setSequenceElapsedSec(targetSeconds);
  }

  useImperativeHandle(ref, () => ({
    // 타임라인/필터 목록에서 클립을 눌렀을 때 호출된다.
    // "원본 전체 경기" 탭에서는 탭을 안 바꾸고 그 지점으로만 이동하고,
    // "하이라이트 구성본" 탭에서는 그 클립 구간 안에서만 재생되도록 한다.
    seekToClip(clip) {
      const video = videoRef.current;
      if (!video) return;
      clearPendingTransition();

      if (playerTab === "full") {
        if (!seekVideoSafely(video, clip.startSec, onSeekOutOfRange)) return false;
        if (video.paused) video.play().catch(() => {});
        return true;
      }

      const index = currentClips.findIndex((item) => item.id === clip.id);
      if (index === -1) return false;
      if (!seekVideoSafely(video, clip.startSec, onSeekOutOfRange)) return false;
      setActiveClipIndex(index);
      setSequenceElapsedSec(clip.renderStartSec ?? 0);
      video.play().catch(() => {});
      return true;
    },
    // 재생헤드 드래그/눈금자 클릭 등 자유 탐색. 항상 "원본 전체 경기" 탭으로 전환한다.
    seekAbsolute(seconds) {
      const video = videoRef.current;
      if (!video) return;
      clearPendingTransition();
      if (!seekVideoSafely(video, seconds, onSeekOutOfRange)) return false;
      onSwitchTab("full");
      return true;
    },
    // "하이라이트 구성본" 탭의 순차 배치 타임라인에서 눈금자/재생헤드를 드래그할 때 호출된다.
    // offsetSec은 해당 클립 내부에서의 오프셋(그 클립의 원본 구간 기준)이다.
    seekSequence(clip, offsetSec) {
      const video = videoRef.current;
      if (!video) return;
      clearPendingTransition();
      const index = currentClips.findIndex((item) => item.id === clip.id);
      if (index === -1) return false;
      if (!seekVideoSafely(video, clip.startSec + offsetSec, onSeekOutOfRange)) return false;
      setActiveClipIndex(index);
      setSequenceElapsedSec((clip.renderStartSec ?? 0) + offsetSec);
      video.play().catch(() => {});
      return true;
    },
  }));

  useEffect(() => {
    return () => pendingTransitionTimeouts.current.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    if (activeClipIndex != null && !currentClips[activeClipIndex]) {
      setActiveClipIndex(null);
      setSequenceElapsedSec(0);
    }
  }, [currentClips, activeClipIndex]);

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;

    if (playerTab === "full") {
      onProgress?.(video.currentTime);
      return;
    }

    if (activeClipIndex == null) return;
    const clip = currentClips[activeClipIndex];
    if (!clip) return;

    const sequenceSec = (clip.renderStartSec ?? 0) + Math.max(0, video.currentTime - clip.startSec);
    setSequenceElapsedSec(sequenceSec);
    onProgress?.(sequenceSec);

    if (video.currentTime >= clip.endSec) {
      const nextIndex = activeClipIndex + 1;
      const nextClip = currentClips[nextIndex];
      if (nextClip) {
        triggerAutoTransition(nextIndex, nextClip);
      } else {
        video.pause();
      }
    }
  }

  // 자동 재생 중 다음 클립으로 넘어갈 때만 페이드아웃→seek→페이드인하면서 다음 장면 라벨 카드를 보여준다.
  // 사용자가 직접 클립을 클릭해서 이동하는 경우(seekToClip 등)는 즉시 이동이 자연스러워 이 효과를 안 쓴다.
  // videoHidden은 seek 전후(320ms)만 켜져 있어서 어두워졌다가 바로 다시 밝아지고,
  // 카드(transitionClip)는 그보다 더 오래 떠 있다가 사라진다 — 이 320ms는 CSS의
  // .session-video-player .field-monitor video { transition: opacity 320ms } 값과 맞춰뒀다.
  function triggerAutoTransition(nextIndex, nextClip) {
    setTransitionClip(nextClip);
    setVideoHidden(true);
    const seekTimeoutId = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video || !seekVideoSafely(video, nextClip.startSec, onSeekOutOfRange)) {
        video?.pause();
        setTransitionClip(null);
        setVideoHidden(false);
        return;
      }
      setActiveClipIndex(nextIndex);
      setVideoHidden(false);
      const clearTimeoutId = window.setTimeout(() => setTransitionClip(null), 380);
      pendingTransitionTimeouts.current.push(clearTimeoutId);
    }, 320);
    pendingTransitionTimeouts.current.push(seekTimeoutId);
  }

  function switchTab(tab) {
    videoRef.current?.pause();
    onSwitchTab(tab);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function handleProgressPointerDown(event) {
    event.preventDefault();
    const bar = event.currentTarget;
    const seekFromClientX = (clientX) => {
      const rect = bar.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      seekBySequenceSeconds(ratio * totalSequenceSec);
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

  const activeClip = activeClipIndex != null ? currentClips[activeClipIndex] : null;
  const hasVideo = Boolean(videoUrl);
  const totalSequenceSec = currentClips.reduce((sum, clip) => sum + clip.durationSec, 0);
  const progressPercent = totalSequenceSec > 0 ? Math.min(100, (sequenceElapsedSec / totalSequenceSec) * 100) : 0;
  // 챗봇과 아직 대화하지 않아 하이라이트 구성본에 담긴 클립이 하나도 없는 상태.
  const isHighlightEmpty = playerTab === "highlight" && currentClips.length === 0;

  return (
    <section className="source-monitor session-video-player">
      <div className="session-player-tabs">
        <button type="button" className={playerTab === "highlight" ? "active" : ""} onClick={() => switchTab("highlight")}>
          하이라이트 구성본
        </button>
        <button type="button" className={playerTab === "full" ? "active" : ""} onClick={() => switchTab("full")} disabled={!hasVideo}>
          원본 전체 경기
        </button>
      </div>
      <div className="field-monitor">
        {hasVideo ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls={playerTab === "full"}
            muted={muted}
            playsInline
            className={videoHidden ? "fading" : ""}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : (
          <div className="session-player-empty">영상을 아직 불러오지 못했어요.</div>
        )}
        {isHighlightEmpty && hasVideo ? (
          <div className="session-player-empty session-highlight-empty">
            아직 하이라이트가 구성되지 않았어요.
            <br />
            오른쪽 챗봇과 대화하며 원하는 클립을 담아보세요.
          </div>
        ) : null}
        {playerTab === "highlight" && transitionClip ? (
          <div className="session-transition-card" style={{ "--event-color": sessionLabelMeta[transitionClip.label]?.color }}>
            <span>{sessionLabelMeta[transitionClip.label]?.ko ?? transitionClip.label}</span>
          </div>
        ) : null}
        {playerTab === "highlight" && hasVideo && !isHighlightEmpty ? (
          <div className="session-player-overlay">
            <div className="session-player-status">
              {activeClip ? (
                <>
                  <button type="button" onClick={togglePlayback} aria-label="재생/일시정지">
                    ▶ / ⏸
                  </button>
                  <strong>
                    {activeClip.label} · {activeClipIndex + 1}/{currentClips.length}
                  </strong>
                </>
              ) : (
                <span>재생할 클립을 선택하세요.</span>
              )}
              <button type="button" className="session-mute-toggle" onClick={() => setMuted((value) => !value)} aria-label="음소거 전환">
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
            <div className="session-progress-bar" onPointerDown={handleProgressPointerDown}>
              <div className="session-progress-fill" style={{ width: `${progressPercent}%` }}></div>
            </div>
            <div className="session-progress-time">
              <span>{formatDuration(Math.round(sequenceElapsedSec))}</span>
              <span>{formatDuration(Math.round(totalSequenceSec))}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
});

export default SessionVideoPlayer;
