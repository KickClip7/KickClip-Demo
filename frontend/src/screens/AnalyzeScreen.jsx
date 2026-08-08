import { useEffect, useState } from "react";
import { analysisSteps } from "../data/mockData.js";
import GameInviteCard from "../components/game/GameInviteCard.jsx";
import HeadSoccerGame from "../components/game/HeadSoccerGame.jsx";

export default function AnalyzeScreen({ active, progress, setProgress, setScreen, analysisStatus, startAnalysis }) {
  const [gameOpen, setGameOpen] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    setProgress(0);
    startAnalysis?.();
    const timer = window.setInterval(() => setProgress((value) => Math.min(value + 7, 95)), 650);
    return () => window.clearInterval(timer);
  }, [active]);

  return (
    <section className={`screen ${active ? "active" : ""}`} id="analyze">
      <div className={`analyzing ${gameOpen ? "game-mode" : ""}`}>
        {gameOpen ? (
          <>
            <HeadSoccerGame active={active} progress={progress} onExit={() => setGameOpen(false)} />
            <button className="button primary" id="finish-analysis" type="button" onClick={() => { setProgress(100); setScreen("edit"); }}>분석 완료하고 편집하기</button>
          </>
        ) : (
          <>
            <GameInviteCard onStart={() => setGameOpen(true)} />
            <div className="analysis-copy">
              <p className="agent-label mini"><span></span> EVENT DETECTION RUNNING</p>
              <h2>경기 영상을 분석하고 있어요</h2>
              <p>장면 감지, 이벤트 분류, 하이라이트 스코어링을 순서대로 진행합니다.</p>
              <div className="progress"><span style={{ width: `${progress}%` }}></span></div>
              <div className="progress-text">{analysisStatus || (progress >= 95 ? "95% · 편집 화면에서 결과를 확인하세요" : `${progress}% · 약 ${Math.max(1, Math.floor((100 - progress) * 0.9))}초 남음`)}</div>
              <div className="analysis-steps">
                {analysisSteps.map((label, index) => {
                  const done = progress > index * 20 + 18;
                  const current = !done && progress >= index * 20;
                  return <span className={`analysis-step ${done ? "done" : ""} ${current ? "active" : ""}`} key={label}><b>{done ? "✓" : ""}</b><em>{label}</em></span>;
                })}
              </div>
            </div>
            <button className="button primary" id="finish-analysis" type="button" onClick={() => { setProgress(100); setScreen("edit"); }}>분석 완료하고 편집하기</button>
          </>
        )}
      </div>
    </section>
  );
}
