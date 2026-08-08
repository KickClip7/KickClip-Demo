import { useEffect, useMemo, useRef, useState } from "react";
import { clearShotBoundaryReviewScope, saveShotBoundaryReviewScope, shotsFromCuts, validateShotCoverage } from "../../domain/shotBoundaryReview.js";

function frameTime(frame, fps) {
  return `${frame}f · ${(frame / fps).toFixed(3)}s`;
}

export default function ShotBoundaryReviewPanel({
  scope,
  initialState,
  loadState,
  saveDraft,
  resetDraft,
  confirmDraft,
  retryDetections,
  downloadMedia,
  onConfirmed,
  onClose,
}) {
  const [state, setState] = useState(initialState);
  const [shots, setShots] = useState(initialState?.shots || []);
  const [activeCut, setActiveCut] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrls, setThumbnailUrls] = useState({});
  const videoRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const fps = Number(state?.fps || 0);
  const frameCount = Number(state?.frame_count || 0);
  const cuts = useMemo(() => shots.slice(1).map((shot) => Number(shot.start_frame)), [shots]);
  const cutsKey = cuts.join(",");
  const validationErrors = useMemo(() => validateShotCoverage(shots, frameCount), [shots, frameCount]);

  useEffect(() => {
    setState(initialState);
    setShots(initialState?.shots || []);
  }, [initialState]);

  useEffect(() => {
    saveShotBoundaryReviewScope(scope, state?.review_session_id);
  }, [scope, state?.review_session_id]);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      objectUrlsRef.current.forEach(URL.revokeObjectURL);
      objectUrlsRef.current = [];
      setVideoUrl("");
      setThumbnailUrls({});
      if (state?.scene_video_url) {
        const blob = await downloadMedia(state.scene_video_url);
        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.push(url);
          setVideoUrl(url);
        }
      }
      const automaticByFrame = new Map((state?.automatic_cuts || []).map((cut) => [Number(cut.cut_frame), cut]));
      const mediaRoot = `/api/v1/projects/${encodeURIComponent(scope.projectId)}/highlight/revisions/${encodeURIComponent(scope.revisionId)}/events/${encodeURIComponent(scope.eventId)}/shot-boundaries/media/cut`;
      const pairs = await Promise.all(cuts.flatMap((cut) => {
        const automatic = automaticByFrame.get(cut);
        return [
          [automatic?.before_thumbnail_url || `${mediaRoot}/${cut}/before?scene_id=${encodeURIComponent(scope.sceneId)}`, `before:${cut}`],
          [automatic?.after_thumbnail_url || `${mediaRoot}/${cut}/after?scene_id=${encodeURIComponent(scope.sceneId)}`, `after:${cut}`],
        ];
      }).map(async ([url, key]) => {
        const blob = await downloadMedia(url);
        return [key, URL.createObjectURL(blob)];
      }));
      if (!cancelled) {
        pairs.forEach(([, url]) => objectUrlsRef.current.push(url));
        setThumbnailUrls(Object.fromEntries(pairs));
      } else pairs.forEach(([, url]) => URL.revokeObjectURL(url));
    }
    hydrate().catch((reason) => { if (!cancelled) setError(reason?.detail || reason?.message || "검토 미디어를 불러오지 못했습니다."); });
    return () => {
      cancelled = true;
      objectUrlsRef.current.forEach(URL.revokeObjectURL);
      objectUrlsRef.current = [];
    };
  }, [state?.review_session_id, state?.scene_video_url, cutsKey, downloadMedia, scope]);

  function seekCut(index) {
    if (!cuts.length) return;
    const normalized = (index + cuts.length) % cuts.length;
    setActiveCut(normalized);
    if (videoRef.current) videoRef.current.currentTime = cuts[normalized] / fps;
  }

  function addCut() {
    const frame = Math.max(1, Math.min(frameCount - 1, Math.round(Number(videoRef.current?.currentTime || 0) * fps)));
    const next = shotsFromCuts([...cuts, frame], frameCount);
    setShots(next);
    setActiveCut(Math.max(0, next.slice(1).findIndex((shot) => shot.start_frame === frame)));
  }

  function deleteCut(index) {
    const nextCuts = cuts.filter((_, cutIndex) => cutIndex !== index);
    setShots(shotsFromCuts(nextCuts, frameCount));
    setActiveCut(Math.max(0, Math.min(index, nextCuts.length - 1)));
  }

  function moveCut(index, frame) {
    const nextCuts = [...cuts];
    nextCuts[index] = Number(frame);
    setShots(shotsFromCuts(nextCuts, frameCount));
    setActiveCut(index);
  }

  async function persist() {
    if (validationErrors.length) return null;
    setBusy("save");
    setError("");
    try {
      const saved = await saveDraft(scope, {
        draft_revision: state.draft_revision,
        scene_video_sha256: state.scene_video_sha256,
        shots,
        note: "Shot boundaries reviewed in the KickClip UI.",
      });
      setState(saved);
      setShots(saved.shots);
      return saved;
    } catch (reason) {
      if (reason?.status === 409) {
        const refreshed = await loadState(scope);
        setState(refreshed);
        setShots(refreshed.shots);
        setError("다른 변경을 감지해 서버 초안을 다시 불러왔습니다.");
      } else setError(reason?.detail || reason?.message || "초안을 저장하지 못했습니다.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function reset() {
    setBusy("reset");
    try {
      const refreshed = await resetDraft(scope);
      setState(refreshed);
      setShots(refreshed.shots);
      setError("");
    } catch (reason) {
      setError(reason?.detail || reason?.message || "자동 초안으로 초기화하지 못했습니다.");
    } finally { setBusy(""); }
  }

  async function confirm() {
    const saved = await persist();
    if (!saved) return;
    setBusy("confirm");
    try {
      const confirmed = await confirmDraft(scope, {
        draft_revision: saved.draft_revision,
        scene_video_sha256: saved.scene_video_sha256,
        reviewer_note: "Reviewed every shot boundary and complete frame coverage in the UI.",
        idempotency_key: crypto.randomUUID(),
      });
      if (confirmed.detections_status !== "READY") {
        const refreshed = await loadState(scope);
        setState(refreshed);
        setError("경계 artifact는 안전하게 확정됐지만 detection 생성에 실패했습니다. detection만 다시 시도할 수 있습니다.");
        return;
      }
      clearShotBoundaryReviewScope();
      await onConfirmed(confirmed);
    } catch (reason) {
      setError(reason?.detail || reason?.message || "최종 확정에 실패했습니다.");
    } finally { setBusy(""); }
  }

  async function retryDetectionMaterialization() {
    setBusy("detections");
    setError("");
    try {
      const refreshed = await retryDetections(scope);
      setState(refreshed);
      if (refreshed.detections_status === "READY") {
        clearShotBoundaryReviewScope();
        await onConfirmed({ detections_status: "READY", artifact_id: refreshed.confirmed_artifact_id });
      }
    } catch (reason) {
      setError(reason?.detail || reason?.message || "Detection 재시도에 실패했습니다.");
    } finally { setBusy(""); }
  }

  return (
    <section className="shot-boundary-review" aria-busy={Boolean(busy)}>
      <header>
        <div><span>HUMAN REVIEW REQUIRED</span><h3>장면 경계 검토</h3><p>frame이 기준입니다. 시간은 frame / fps로만 표시됩니다.</p></div>
        <button type="button" onClick={onClose}>나중에</button>
      </header>
      <div className="shot-review-player">
        {videoUrl ? <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" /> : <div className="shot-review-loading">scene video 불러오는 중…</div>}
        <div className="shot-review-summary"><b>{frameCount} frames</b><span>{fps.toFixed(3)} fps</span><span>SHA {String(state?.scene_video_sha256 || "").slice(0, 12)}…</span></div>
      </div>
      <div className="shot-review-timeline" aria-label="Shot boundary timeline">
        {shots.map((shot) => <span key={shot.shot_id} style={{ width: `${((shot.end_frame_inclusive - shot.start_frame + 1) / frameCount) * 100}%` }} title={`${shot.shot_id}: ${shot.start_frame}-${shot.end_frame_inclusive}`}>{shot.shot_id}</span>)}
      </div>
      <div className="shot-review-controls">
        <button type="button" onClick={() => seekCut(activeCut - 1)} disabled={!cuts.length}>← 이전 cut</button>
        <button type="button" onClick={addCut} disabled={!videoUrl}>현재 frame에 cut 추가</button>
        <button type="button" onClick={() => deleteCut(activeCut)} disabled={!cuts.length}>선택 cut 삭제</button>
        <button type="button" onClick={() => seekCut(activeCut + 1)} disabled={!cuts.length}>다음 cut →</button>
      </div>
      <div className="shot-cut-list">
        {cuts.map((cut, index) => {
          const automatic = (state?.automatic_cuts || []).find((item) => Number(item.cut_frame) === cut);
          return <article className={activeCut === index ? "active" : ""} key={`${cut}:${index}`} onClick={() => seekCut(index)}>
            <div className="shot-cut-thumbnails">
              {thumbnailUrls[`before:${cut}`] ? <img src={thumbnailUrls[`before:${cut}`]} alt={`cut ${cut} 이전`} /> : <span>BEFORE</span>}
              {thumbnailUrls[`after:${cut}`] ? <img src={thumbnailUrls[`after:${cut}`]} alt={`cut ${cut} 이후`} /> : <span>AFTER</span>}
            </div>
            <label>cut frame <input type="number" min="1" max={frameCount - 1} value={cut} onChange={(event) => moveCut(index, event.target.value)} /></label>
            <small>{frameTime(cut, fps)} · 자동 score {automatic ? automatic.score.toFixed(3) : "수동"}</small>
          </article>;
        })}
      </div>
      <div className="shot-range-table">
        {shots.map((shot) => <div key={shot.shot_id}><b>{shot.shot_id}</b><span>{frameTime(shot.start_frame, fps)}</span><span>→ {frameTime(shot.end_frame_inclusive, fps)}</span></div>)}
      </div>
      <div className={`shot-coverage ${validationErrors.length ? "invalid" : "valid"}`}>
        <strong>{validationErrors.length ? "Coverage 검증 필요" : `전체 frame 0–${frameCount - 1} coverage 완료`}</strong>
        {validationErrors.map((message) => <span key={message}>{message}</span>)}
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <footer>
        {state?.status === "CONFIRMED" && state?.detections_status !== "READY" ? <button className="primary" type="button" onClick={retryDetectionMaterialization} disabled={Boolean(busy)}>{busy === "detections" ? "Detection 재시도 중…" : "Detection만 다시 시도"}</button> : null}
        {state?.status !== "CONFIRMED" ? <button type="button" onClick={reset} disabled={Boolean(busy)}>자동 초안으로 초기화</button> : null}
        {state?.status !== "CONFIRMED" ? <button type="button" onClick={persist} disabled={Boolean(busy) || validationErrors.length > 0}>{busy === "save" ? "저장 중…" : "초안 저장"}</button> : null}
        {state?.status !== "CONFIRMED" ? <button className="primary" type="button" onClick={confirm} disabled={Boolean(busy) || validationErrors.length > 0}>{busy === "confirm" ? "detections 생성 중…" : "검토 완료 및 최종 확정"}</button> : null}
      </footer>
    </section>
  );
}
