import { toApiUrl } from "../api/kickclipApi.js";
import { formatDuration } from "../utils/format.js";
import { matchPreviewImageFor } from "../data/matchPreviewImages.js";

function matchTitle(match) {
  if (match?.display_title) return match.display_title;
  if (!match?.home_team && !match?.away_team) return "팀 정보가 없는 경기";
  return `${match.home_team || "홈팀 미정"} vs ${match.away_team || "원정팀 미정"}`;
}

export default function ProjectsScreen({
  active,
  matches,
  loading,
  error,
  startUpload,
  lastUploadedMatchId,
  openMatch,
  openMiniGame,
  onReload,
}) {
  return (
    <section className={`screen workspace-dashboard match-videos-page ${active ? "active" : ""}`} id="projects">
      <div className="match-videos-titlebar">
        <div>
          <h1>MATCH VIDEOS</h1>
          <p>내가 업로드한 경기 영상을 확인하고 새로운 분석을 시작하세요.</p>
        </div>
        <button className="match-upload-button" type="button" onClick={startUpload}>
          <span aria-hidden="true">+</span>
          새 영상 업로드
        </button>
      </div>

      {loading ? (
        <div className="route-state compact">
          <span className="route-spinner" />
          <p>업로드한 경기 영상을 불러오는 중입니다.</p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="workspace-inline-error" role="alert">
          <div>
            <strong>경기 영상을 모두 불러오지 못했습니다.</strong>
            <p>{error}</p>
          </div>
          <button className="button ghost compact" type="button" onClick={onReload}>다시 시도</button>
        </div>
      ) : null}

      {!loading ? (
        <section className="match-videos-library" aria-label="업로드한 경기 영상">
          {matches.length ? (
            <div className="match-library-grid">
              {matches.map((match, index) => {
                const isLastUploaded = match.match_id === lastUploadedMatchId;
                const analysisStatus = String(match.analysis_status || "").toUpperCase();
                const analysisComplete = analysisStatus === "COMPLETED";
                const analysisFailed = analysisStatus === "FAILED";
                const hasAnalysis = Boolean(analysisStatus);
                const isMiniGamePromo = match.visual_variant === "mini-game";
                const analysisProgress = Math.max(0, Math.min(100, match.analysis_progress ?? 0));
                const previewImage = toApiUrl(match.thumbnail_url || "")
                  || matchPreviewImageFor(match.match_id, index);
                return (
                  <button
                    className="match-library-card"
                    type="button"
                    key={match.match_id}
                    aria-label={isMiniGamePromo ? "분석을 기다리며 미니게임 시작하기" : `${matchTitle(match)} 영상 열기`}
                    onClick={() => isMiniGamePromo && openMiniGame ? openMiniGame() : openMatch(match.match_id)}
                  >
                    <div className={`match-library-visual match-tone-${(index % 3) + 1} ${isMiniGamePromo ? "analysis-game-visual" : ""}`} aria-hidden="true">
                      {isMiniGamePromo ? (
                        <div className="analysis-game-preview">
                          <span className="analysis-game-kicker">ANALYZING · {analysisProgress}%</span>
                          <div className="analysis-mini-field">
                            <i className="analysis-player player-one">7</i>
                            <b className="analysis-ball">⚽</b>
                            <i className="analysis-player player-two">10</i>
                            <span className="analysis-goal" />
                          </div>
                          <div className="analysis-game-copy">
                            <strong>기다리는 동안<br />미니게임 한 판?</strong>
                            <small>게임 중에도 영상 분석은 계속돼요 · PLAY →</small>
                          </div>
                        </div>
                      ) : (
                        <>
                          <img className="match-library-image" src={previewImage} alt="" />
                          <span>MATCH VIDEO</span>
                          <strong>{match.home_score ?? "–"} : {match.away_score ?? "–"}</strong>
                          {isLastUploaded ? <em>LAST UPLOAD</em> : null}
                        </>
                      )}
                    </div>
                    <div className="match-library-copy">
                      <div className="match-library-status-row">
                        <small>{match.competition || "대회 정보 없음"}{match.season ? ` · ${match.season}` : ""}</small>
                        <span className={`match-analysis-tag ${analysisComplete ? "complete" : analysisFailed ? "failed" : "processing"}`}>
                          {analysisComplete ? "분석 완료" : analysisFailed ? "분석 실패" : hasAnalysis ? "분석 중" : "분석 대기"}
                        </span>
                      </div>
                      <h2>{matchTitle(match)}</h2>
                      <p>
                        {match.match_date ? new Date(match.match_date).toLocaleDateString("ko-KR") : "날짜 미입력"}
                        {" · "}
                        {match.duration_sec ? formatDuration(match.duration_sec) : "영상 길이 확인 중"}
                      </p>
                      {hasAnalysis && !analysisComplete && !analysisFailed ? (
                        <div className="match-analysis-progress">
                          <span><b>분석 진행률</b><strong>{analysisProgress}%</strong></span>
                          <span className="match-analysis-progress-track">
                            <i style={{ width: `${analysisProgress}%` }} />
                          </span>
                          {match.analysis_current_step ? <small>{match.analysis_current_step}</small> : null}
                        </div>
                      ) : analysisFailed && match.analysis_error_message ? <p className="match-analysis-error">{match.analysis_error_message}</p> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="workspace-section-empty">
              <strong>아직 업로드한 경기 영상이 없습니다.</strong>
              <p>영상을 업로드하면 이곳에서 바로 확인할 수 있습니다.</p>
              <button className="match-upload-button compact" type="button" onClick={startUpload}>첫 영상 업로드</button>
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
