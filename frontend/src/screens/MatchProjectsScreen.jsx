import { useEffect, useState } from "react";
import { toApiUrl } from "../api/kickclipApi.js";
import { highlightCovers } from "../data/highlightCovers.js";
import { matchPreviewImageFor } from "../data/matchPreviewImages.js";
import { buildUntitledProjectPayload } from "../domain/workflow.js";
import { formatDuration } from "../utils/format.js";

function matchTitle(match) {
  const home = match?.home_team || "홈팀 미정";
  const away = match?.away_team || "원정팀 미정";
  return `${home} vs ${away}`;
}

function uploadCompatibilityCopy(uploadContext) {
  if (!uploadContext) return "";
  if (uploadContext.preview_status === "PREVIEW_READY") return "브라우저용 preview가 준비되었습니다.";
  if (uploadContext.preview_status === "PREVIEW_FAILED_RAW_ONLY") return "preview 생성에 실패해 원본 영상만 사용합니다.";
  return "브라우저에서 재생 가능한 원본 영상을 사용합니다.";
}

export default function MatchProjectsScreen({
  active,
  matchId,
  match,
  projects,
  uploadContext,
  loading,
  error,
  analysisStatus,
  onReload,
  onBack,
  onOpenProject,
  onCreateProject,
}) {
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    setCreateBusy(false);
    setCreateError("");
  }, [matchId]);

  async function createProject() {
    if (createBusy) return;
    setCreateBusy(true);
    setCreateError("");
    const outcome = await onCreateProject(buildUntitledProjectPayload());
    if (!outcome?.ok) {
      const status = outcome?.error?.status;
      const fallback = status === 404
        ? "경기를 찾을 수 없습니다."
        : status === 403
          ? "이 경기 영상으로 하이라이트를 만들 권한이 없습니다."
          : "하이라이트를 만들지 못했습니다. 입력 내용을 확인하고 다시 시도해주세요.";
      setCreateError(outcome?.error?.detail || fallback);
      setCreateBusy(false);
    }
  }

  const previewUrl = toApiUrl(uploadContext?.preview_url
    || uploadContext?.video_url
    || match?.preview_url
    || match?.video_url
    || "");
  const previewImage = toApiUrl(match?.thumbnail_url || "")
    || matchPreviewImageFor(match?.match_id);

  return (
    <section className={`screen match-projects-screen ${active ? "active" : ""}`} id="match-projects">
      {loading ? <div className="route-state"><span className="route-spinner"></span><h2>경기 영상과 하이라이트를 불러오는 중입니다</h2></div> : null}
      {!loading && error ? (
        <div className="route-state error" role="alert">
          <span>!</span><h2>경기 정보를 불러오지 못했습니다</h2><p>{error}</p>
          <button className="button primary" type="button" onClick={onReload}>다시 시도</button>
        </div>
      ) : null}
      {!loading && !error && match ? (
        <div className="match-projects-shell">
          <section className="match-summary-card">
            <div className="match-summary-media">
              {previewUrl ? (
                <video controls muted playsInline preload="metadata" src={previewUrl}></video>
              ) : (
                <div className="match-video-unavailable">
                  <img className="match-summary-thumbnail" src={previewImage} alt="" />
                  <span>VIDEO</span>
                  <p>업로드한 경기 영상 미리보기</p>
                </div>
              )}
            </div>
            <div className="match-summary-copy">
              <span className="section-kicker">MATCH · {match.match_id}</span>
              <h2>{matchTitle(match)}</h2>
              <div className="match-score">{match.home_score ?? "–"} <span>:</span> {match.away_score ?? "–"}</div>
              <dl>
                <div><dt>경기 일시</dt><dd>{match.match_date ? new Date(match.match_date).toLocaleString("ko-KR") : "미입력"}</dd></div>
                <div><dt>대회</dt><dd>{match.competition || "미입력"}{match.season ? ` · ${match.season}` : ""}</dd></div>
                <div><dt>영상 길이</dt><dd>{match.duration_sec ? formatDuration(match.duration_sec) : "확인 중"}</dd></div>
              </dl>
              {uploadContext ? <div className={`preview-status ${uploadContext.preview_status === "PREVIEW_FAILED_RAW_ONLY" ? "warning" : ""}`}>{uploadCompatibilityCopy(uploadContext)}</div> : null}
              {analysisStatus ? <div className="analysis-inline-status">{analysisStatus}</div> : null}
            </div>
          </section>

          <section className="match-project-list">
            <div className="projects-head">
              <div className="projects-head-title-row">
                <button className="page-back-button" type="button" onClick={onBack}>← 내 작업</button>
                <div><span className="section-kicker">HIGHLIGHTS</span><h2>이 경기의 하이라이트</h2><p>같은 경기 영상으로 서로 다른 하이라이트를 만들 수 있습니다.</p></div>
              </div>
              <button className="button primary" type="button" onClick={createProject} disabled={createBusy}>
                {createBusy ? "생성 중…" : "+ 새 하이라이트 만들기"}
              </button>
            </div>
            {createError ? <div className="inline-error" role="alert">{createError}</div> : null}
            {projects.length ? (
              <div className="project-grid project-grid-large">
                {projects.map((project, index) => {
                  const cover = highlightCovers[index % highlightCovers.length];
                  return (
                    <button className="project project-large project-button" type="button" onClick={() => onOpenProject(project.project_id)} key={project.project_id}>
                      <span className={`project-thumb ${["green", "violet", "amber", "blue"][index % 4]}`}>
                        <img className="highlight-cover-backdrop" src={cover.src} alt="" aria-hidden="true" />
                        <img className="highlight-cover-image" src={cover.src} alt="" />
                        <span className={`badge highlight-status-badge status-${project.status.toLowerCase()}`}>{project.status}</span>
                        <span className="highlight-ratio-badge">{cover.ratio}</span>
                        <span className="play-mark">→</span>
                      </span>
                      <span className="project-info"><strong>{project.title}</strong><span>{project.description || "설명 없음"}</span><small>{new Date(project.created_at).toLocaleDateString("ko-KR")}</small></span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="project-empty-state">
                <span>＋</span><h3>아직 이 경기로 만든 하이라이트가 없습니다.</h3>
                <p>새 하이라이트를 만들어 편집을 시작해보세요.</p>
                <button className="button primary" type="button" onClick={createProject} disabled={createBusy}>
                  {createBusy ? "생성 중…" : "첫 하이라이트 만들기"}
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
