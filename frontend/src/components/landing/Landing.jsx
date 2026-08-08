import soccerBallUrl from "../../../assets/soccer-ball.svg";
import matchModeUrl from "../../../assets/mode-match.png";
import playerModeUrl from "../../../assets/mode-player.png";
import UserMenu from "../common/UserMenu.jsx";

export default function Landing({ user, onOpenProjects, onLogout }) {
  return (
    <section className="landing">
      <div className="landing-account">
        <UserMenu user={user} onOpenProjects={onOpenProjects} onLogout={onLogout} />
      </div>
      <div className="hero-stage" aria-hidden="true">
        <span className="hero-echo">HIGHLIGHT</span>
        <span className="flight-line line-one"></span>
        <span className="flight-line line-two"></span>
        {[1, 2, 3, 4].map((item) => (
          <span className={`soccer-ball ball-${["one", "two", "three", "four"][item - 1]}`} key={item}>
            <img src={soccerBallUrl} alt="" />
          </span>
        ))}
      </div>
      <div className="landing-content">
        <div className="hero-logo-lockup">
          <h1 className="hero-logo">KICKCLIP</h1>
          <div className="hero-logo-subtitle">축구 쇼츠 하이라이트 자동화 에이전트</div>
          <p className="hero-copy">
            대화로 편집하는 새로운 숏폼 제작 경험.<br /> AI 에이전트가 영상 속 모든 이벤트를 자동 분석하고 분류합니다.<br />복잡한 툴 없이, 채팅 한 줄로 고품질 하이라이트 클립을 추출해 보세요.
          </p>
          <div className="hero-actions landing-primary-action">
            <button className="hero-button primary" type="button" onClick={onOpenProjects}>지금 시작하기 →</button>
          </div>
        </div>
        <div className="landing-bottom-row">
          <section className="recent-projects landing-promo" aria-labelledby="landing-promo-title">
            <div className="recent-projects-head">
              <h2 id="landing-promo-title">AI HIGHLIGHT STUDIO</h2>
              <span className="landing-promo-status">
                <i aria-hidden="true" />
                FROM FULL MATCH TO SHORTS
              </span>
            </div>
            <div className="recent-project-list is-empty">
              <div className="recent-project-empty">
                <div className="empty-promo-visual player" aria-hidden="true">
                  <span className="empty-promo-mode-label">
                    <small>PLAYER FOCUS</small>
                  </span>
                  <img src={playerModeUrl} alt="" />
                </div>

                <div className="empty-promo-copy">
                  <span className="empty-promo-kicker">
                    <i aria-hidden="true" />
                    YOUR GAME, YOUR HIGHLIGHT
                  </span>
                  <strong>
                    원하는 장면만 골라,
                    <em>나만의 하이라이트 숏츠로.</em>
                  </strong>
                  <p>경기 전체 흐름부터 한 선수의 순간까지, AI가 찾아 숏츠로 완성해 드려요.</p>
                  <div className="empty-promo-features" aria-label="KickClip 주요 기능">
                    <span>경기 자동 분석</span>
                    <span>선수 포커스</span>
                    <span>숏폼 자동 편집</span>
                  </div>
                </div>

                <div className="empty-promo-visual match" aria-hidden="true">
                  <span className="empty-promo-mode-label">
                    <small>MATCH FOCUS</small>
                  </span>
                  <img src={matchModeUrl} alt="" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
