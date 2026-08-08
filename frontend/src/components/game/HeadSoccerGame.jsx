import { useEffect, useRef, useState } from "react";
import aiFaceUrl from "../../../assets/mode-player.png";
import soccerBallUrl from "../../../assets/soccer-ball.svg";

const WIN_SCORE = 11;
const DASH_TAP_MS = 260;
const STUN_TICKS = 25;
const PLAYER_MIN_DISTANCE = 8.5;
const BALL_PLAYER_MIN_DISTANCE = 10.5;

function createHeadSoccerWorld() {
  return {
    player: { x: 24, y: 0, vy: 0, face: 1, stun: 0, attack: 0 },
    cpu: { x: 76, y: 0, vy: 0, face: -1, stun: 0, attack: 0 },
    ball: { x: 50, y: 34, vx: 0.38, vy: 0.15 },
    score: { user: 0, cpu: 0 },
    notice: "방향키 이동, 방향키 연타 대시, Space 슛, Shift 공격",
    finished: false,
  };
}

export default function HeadSoccerGame({ active, progress, onExit }) {
  const keysRef = useRef({ left: false, right: false, jump: false, kick: false, attack: false, dashDir: 0 });
  const kickCooldownRef = useRef(0);
  const attackCooldownRef = useRef(0);
  const dashCooldownRef = useRef(0);
  const cpuAttackCooldownRef = useRef(0);
  const lastTapRef = useRef({ direction: null, time: 0 });
  const [world, setWorld] = useState(createHeadSoccerWorld);

  function resetRound(scoredBy, nextScore) {
    const winner = nextScore.user >= WIN_SCORE ? "user" : nextScore.cpu >= WIN_SCORE ? "cpu" : null;
    if (winner) {
      return {
        ...createHeadSoccerWorld(),
        score: nextScore,
        notice: winner === "user" ? "승리! 11점을 먼저 채웠어요." : "AI 승리! 재시작으로 다시 도전하세요.",
        finished: true,
      };
    }

    return {
      ...createHeadSoccerWorld(),
      score: nextScore,
      notice: scoredBy === "user" ? "골! 오른쪽 골망을 흔들었어요." : "실점! 다시 중앙에서 시작합니다.",
    };
  }

  function kickBall(actor, ball, strength = 1) {
    const dx = ball.x - actor.x;
    const dy = ball.y - (12 + actor.y);
    const distance = Math.hypot(dx, dy);
    if (distance > 13) return ball;
    const direction = dx >= 0 ? 1 : -1;
    return {
      ...ball,
      vx: direction * (1.65 + strength * 0.42),
      vy: Math.max(1.15, 1.1 + strength * 0.35),
    };
  }

  function tryAttack(attacker, defender) {
    const horizontalReach = Math.abs(attacker.x - defender.x) <= 15;
    const verticalReach = Math.abs(attacker.y - defender.y) <= 16;
    if (!horizontalReach || !verticalReach) return defender;
    return { ...defender, stun: STUN_TICKS };
  }

  function keepPlayersApart(player, cpu) {
    if (Math.abs(player.y - cpu.y) > 14) return { player, cpu };

    const dx = cpu.x - player.x;
    const distance = Math.abs(dx) || 0.01;
    if (distance >= PLAYER_MIN_DISTANCE) return { player, cpu };

    const push = (PLAYER_MIN_DISTANCE - distance) / 2;
    const direction = dx >= 0 ? 1 : -1;
    return {
      player: { ...player, x: Math.min(94, Math.max(6, player.x - direction * push)) },
      cpu: { ...cpu, x: Math.min(94, Math.max(6, cpu.x + direction * push)) },
    };
  }

  function collideBallWithActor(ball, actor) {
    const actorCenterY = 12 + actor.y;
    const dx = ball.x - actor.x;
    const dy = ball.y - actorCenterY;
    const distance = Math.hypot(dx, dy) || 0.01;
    if (distance >= BALL_PLAYER_MIN_DISTANCE) return ball;

    const nx = dx / distance;
    const ny = dy / distance;
    const speedTowardActor = ball.vx * nx + ball.vy * ny;
    return {
      ...ball,
      x: actor.x + nx * BALL_PLAYER_MIN_DISTANCE,
      y: actorCenterY + ny * BALL_PLAYER_MIN_DISTANCE,
      vx: speedTowardActor < 0 ? ball.vx - speedTowardActor * 1.55 * nx : ball.vx + nx * 0.34,
      vy: speedTowardActor < 0 ? ball.vy - speedTowardActor * 1.55 * ny : ball.vy + Math.max(0.24, ny * 0.36),
    };
  }

  useEffect(() => {
    if (!active) return undefined;

    function setKey(event, pressed) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "ShiftLeft", "ShiftRight"].includes(event.code)) event.preventDefault();
      if (pressed && !event.repeat && (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
        const direction = event.code === "ArrowLeft" ? "left" : "right";
        const now = window.performance.now();
        if (lastTapRef.current.direction === direction && now - lastTapRef.current.time <= DASH_TAP_MS) {
          keysRef.current.dashDir = direction === "left" ? -1 : 1;
        }
        lastTapRef.current = { direction, time: now };
      }
      if (event.code === "ArrowLeft") keysRef.current.left = pressed;
      if (event.code === "ArrowRight") keysRef.current.right = pressed;
      if (event.code === "ArrowUp") keysRef.current.jump = pressed;
      if (event.code === "Space") keysRef.current.kick = pressed;
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") keysRef.current.attack = pressed;
    }

    function handleKeyDown(event) {
      setKey(event, true);
    }

    function handleKeyUp(event) {
      setKey(event, false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;

    const timer = window.setInterval(() => {
      setWorld((current) => {
        const keys = keysRef.current;
        let player = { ...current.player, stun: Math.max(0, current.player.stun - 1), attack: Math.max(0, current.player.attack - 1) };
        let cpu = { ...current.cpu, stun: Math.max(0, current.cpu.stun - 1), attack: Math.max(0, current.cpu.attack - 1) };
        let ball = { ...current.ball };
        let notice = current.notice;
        if (current.finished) return current;

        if (player.stun <= 0 && keys.left) {
          player.x -= 2.2;
          player.face = -1;
        }
        if (player.stun <= 0 && keys.right) {
          player.x += 2.2;
          player.face = 1;
        }
        if (player.stun <= 0 && keys.jump && player.y <= 0.05) player.vy = 3.9;
        if (player.stun <= 0 && keys.dashDir && dashCooldownRef.current <= 0) {
          player.face = keys.dashDir;
          player.x += keys.dashDir * 8.4;
          ball = kickBall(player, ball, 2.6);
          dashCooldownRef.current = 14;
          notice = "대시 슛!";
        }
        keys.dashDir = 0;

        if (cpu.stun <= 0) {
          const cpuTargetX = Math.min(94, Math.max(6, ball.x + ball.vx * 8));
          const cpuTarget = cpuTargetX > cpu.x ? 1 : -1;
          if (Math.abs(cpuTargetX - cpu.x) > 4) {
            cpu.x += cpuTarget * 1.85;
            cpu.face = cpuTarget;
          }
          if (ball.y > 18 && Math.abs(ball.x - cpu.x) < 20 && cpu.y <= 0.05) cpu.vy = 3.75;
        }

        player.x = Math.min(94, Math.max(6, player.x));
        cpu.x = Math.min(94, Math.max(6, cpu.x));
        ({ player, cpu } = keepPlayersApart(player, cpu));

        player.y = Math.max(0, player.y + player.vy);
        cpu.y = Math.max(0, cpu.y + cpu.vy);
        player.vy = player.y <= 0 ? 0 : player.vy - 0.34;
        cpu.vy = cpu.y <= 0 ? 0 : cpu.vy - 0.34;

        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vy -= 0.18;
        ball.vx *= 0.992;

        if (ball.y <= 5) {
          ball.y = 5;
          ball.vy = Math.abs(ball.vy) * 0.72;
          ball.vx *= 0.92;
        }
        if (ball.y >= 78) {
          ball.y = 78;
          ball.vy = -Math.abs(ball.vy) * 0.72;
        }

        ball = collideBallWithActor(ball, player);
        ball = collideBallWithActor(ball, cpu);
        ball.x = Math.min(98, Math.max(2, ball.x));
        ball.y = Math.min(78, Math.max(5, ball.y));

        const inGoalHeight = ball.y < 34;
        if (ball.x <= 2 && inGoalHeight) {
          const nextScore = { ...current.score, cpu: current.score.cpu + 1 };
          return resetRound("cpu", nextScore);
        }
        if (ball.x >= 98 && inGoalHeight) {
          const nextScore = { ...current.score, user: current.score.user + 1 };
          return resetRound("user", nextScore);
        }

        if (ball.x <= 2 || ball.x >= 98) {
          ball.x = Math.min(98, Math.max(2, ball.x));
          ball.vx *= -0.76;
        }

        if (player.stun <= 0) ball = kickBall(player, ball, 0.35);
        if (cpu.stun <= 0) ball = kickBall(cpu, ball, 0.55);

        if (player.stun <= 0 && keys.kick && kickCooldownRef.current <= 0) {
          ball = kickBall(player, ball, 1.6);
          kickCooldownRef.current = 10;
          notice = "슛!";
        }
        if (player.stun <= 0 && keys.attack && attackCooldownRef.current <= 0) {
          player.face = cpu.x >= player.x ? 1 : -1;
          player.attack = 8;
          cpu = tryAttack(player, cpu);
          attackCooldownRef.current = 25;
          notice = cpu.stun > 0 ? "공격 성공! AI가 1초 동안 스턴됐어요." : "공격!";
        }
        if (cpu.stun <= 0 && Math.abs(ball.x - cpu.x) < 13 && ball.y < 30 && kickCooldownRef.current <= 2) {
          ball = kickBall(cpu, ball, 1.7);
        }
        if (cpu.stun <= 0 && Math.abs(player.x - cpu.x) <= 9 && cpuAttackCooldownRef.current <= 0) {
          cpu.face = player.x >= cpu.x ? 1 : -1;
          cpu.attack = 8;
          player = tryAttack(cpu, player);
          cpuAttackCooldownRef.current = 32;
          if (player.stun > 0) notice = "AI 공격! 1초 동안 스턴됐어요.";
        }
        kickCooldownRef.current = Math.max(0, kickCooldownRef.current - 1);
        attackCooldownRef.current = Math.max(0, attackCooldownRef.current - 1);
        dashCooldownRef.current = Math.max(0, dashCooldownRef.current - 1);
        cpuAttackCooldownRef.current = Math.max(0, cpuAttackCooldownRef.current - 1);

        ({ player, cpu } = keepPlayersApart(player, cpu));
        ball = collideBallWithActor(collideBallWithActor(ball, player), cpu);
        ball.x = Math.min(98, Math.max(2, ball.x));
        ball.y = Math.min(78, Math.max(5, ball.y));

        return { player, cpu, ball, score: current.score, notice, finished: false };
      });
    }, 40);

    return () => window.clearInterval(timer);
  }, [active]);

  function pressControl(key, pressed) {
    keysRef.current[key] = pressed;
  }

  function restartGame() {
    keysRef.current = { left: false, right: false, jump: false, kick: false, attack: false, dashDir: 0 };
    kickCooldownRef.current = 0;
    attackCooldownRef.current = 0;
    dashCooldownRef.current = 0;
    cpuAttackCooldownRef.current = 0;
    lastTapRef.current = { direction: null, time: 0 };
    setWorld(createHeadSoccerWorld());
  }

  return (
    <section className="head-soccer-game" aria-label="분석 대기 헤드사커 미니게임">
      <div className="head-game-top">
        <button className="button ghost compact" type="button" onClick={onExit}>분석 화면으로 돌아가기</button>
        <div className="head-score"><span>YOU {world.score.user}</span><b>:</b><span>AI {world.score.cpu}</span><small>11점 승리</small></div>
        <button className="button ghost compact" type="button" onClick={restartGame}>재시작</button>
      </div>
      <div className="head-field">
        <span className="side-goal left"></span>
        <span className="side-goal right"></span>
        <span className="midline"></span>
        <span className={`head-player user ${world.player.attack > 0 ? "attacking" : ""} ${world.player.stun > 0 ? "stunned" : ""}`} style={{ left: `${world.player.x}%`, bottom: `${8 + world.player.y}%`, "--face": world.player.face }}><i></i></span>
        <span className={`head-player cpu ${world.cpu.attack > 0 ? "attacking" : ""} ${world.cpu.stun > 0 ? "stunned" : ""}`} style={{ left: `${world.cpu.x}%`, bottom: `${8 + world.cpu.y}%`, "--face": world.cpu.face, "--ai-face": `url(${aiFaceUrl})` }}><i></i></span>
        <span className="head-ball" style={{ left: `${world.ball.x}%`, bottom: `${world.ball.y}%`, "--ball-image": `url(${soccerBallUrl})` }}></span>
      </div>
      <div className="head-game-bottom">
        <div className="head-controls">
          <button type="button" onPointerDown={() => pressControl("left", true)} onPointerUp={() => pressControl("left", false)} onPointerLeave={() => pressControl("left", false)}>←</button>
          <button type="button" onPointerDown={() => pressControl("jump", true)} onPointerUp={() => pressControl("jump", false)} onPointerLeave={() => pressControl("jump", false)}>점프</button>
          <button type="button" onPointerDown={() => pressControl("right", true)} onPointerUp={() => pressControl("right", false)} onPointerLeave={() => pressControl("right", false)}>→</button>
          <button className="kick" type="button" onPointerDown={() => pressControl("kick", true)} onPointerUp={() => pressControl("kick", false)} onPointerLeave={() => pressControl("kick", false)}>슛</button>
          <button className="attack" type="button" onPointerDown={() => pressControl("attack", true)} onPointerUp={() => pressControl("attack", false)} onPointerLeave={() => pressControl("attack", false)}>공격</button>
        </div>
        <div className="head-game-status">
          <span>{world.notice}</span>
          <b>분석 {progress}%</b>
        </div>
      </div>
    </section>
  );
}
