import playerUrl from "../../../assets/player.png";
import soccerBallUrl from "../../../assets/soccer-ball.svg";

export default function GameInviteCard({ onStart }) {
  return (
    <button className="analysis-game-card" type="button" onClick={onStart}>
      <span className="game-card-badge">Waiting game</span>
      <span className="game-card-title">게임하며 분석기다리기</span>
      <span className="game-card-field" aria-hidden="true">
        <i className="mini-player left"></i>
        <i className="mini-ball" style={{ "--ball-image": `url(${soccerBallUrl})` }}></i>
        <img className="mini-player-image right" src={playerUrl} alt="" />
      </span>
      <span className="game-card-copy">분석은 계속 진행됩니다. 클릭하면 큰 게임 화면으로 전환됩니다.</span>
      <span className="game-card-action">게임 시작</span>
    </button>
  );
}
