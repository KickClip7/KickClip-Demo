import { useEffect, useRef, useState } from "react";

function AgentIntro({ mode, selectedPlayer }) {
  if (mode === "player") {
    return (
      <div className="agent-message ai">
        <p>이 선수의 이름을 아시나요?</p>
        <ul>
          <li>“이 선수는 손흥민이야”라고 알려주면 선수 프로필을 채워드릴게요.</li>
          <li>이후 “이 선수 위주로 30초 쇼츠 만들어줘”처럼 편집을 요청할 수 있어요.</li>
          <li>타임라인의 흰 테두리는 {selectedPlayer?.number ?? "-"}번 선수가 5초 이상 트래킹된 구간입니다.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="agent-message ai">
      <p>전체 경기 하이라이트 편집을 도와드리겠습니다.</p>
      <ul>
        <li>“골 장면만 보여줘” → 타임라인 필터</li>
        <li>“전반전 위주로 빠르게 편집해줘” → Agent 편집안 생성</li>
      </ul>
    </div>
  );
}

export default function PersistentAgentPanel({
  context = "edit",
  mode = "match",
  selectedPlayer,
  messages = [],
  input,
  setInput,
  onSubmit,
  quickPrompts = [],
  status,
  onReset,
  busy = false,
}) {
  const scrollRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  // 챗봇 답변이 한번에 나오지 않고 타이핑되듯 나오게 하기 위한 상태.
  // typedIndex/typedLength는 지금 타이핑 중인 메시지의 위치와 몇 글자까지 보여줬는지를 담고,
  // typedDoneRef는 이미 타이핑을 끝낸(혹은 스킵한) 메시지 인덱스를 기억해서 재렌더링 때 다시 타이핑하지 않게 한다.
  const [typedIndex, setTypedIndex] = useState(-1);
  const [typedLength, setTypedLength] = useState(0);
  const typedDoneRef = useRef(new Set());
  const isExport = context === "export";
  const isBusy = busy || submitting;
  // 편집 패널에서는 빠른 요청 버튼을 노출하지 않는다. 내보내기 첫 화면에서만 추천 칩을 보여준다.
  const showQuickPrompts = isExport && quickPrompts.length > 0 && messages.length === 0;

  const thinkingDetails = isExport
    ? [
        "요청을 이해하고 필요한 작업을 판단하고 있어요.",
        "적절한 도구를 선택해 요청을 처리하고 있어요.",
        "결과를 확인하고 내보내기 설정에 반영하고 있어요.",
        "영상 분석은 조금 더 걸릴 수 있어요. 잠시만 기다려주세요.",
      ]
    : [
        "요청하신 편집 내용을 이해하고 있어요.",
        "타임라인에 적용할 편집안을 만들고 있어요.",
        "선택한 장면과 편집 결과를 확인하고 있어요.",
        "분석이 조금 더 걸리고 있어요. 잠시만 기다려주세요.",
      ];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, context, isBusy, thinkingStage, typedLength]);

  // 새로 추가된 마지막 메시지가 AI 답변이면 한 글자씩 늘려가며 보여준다. 이미 타이핑을 끝낸 메시지는
  // typedDoneRef에 기록해둬서, 다른 이유로 컴포넌트가 리렌더링돼도 다시 처음부터 타이핑하지 않는다.
  useEffect(() => {
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) return undefined;
    const lastMessage = messages[lastIndex];
    if (lastMessage.role !== "ai" || typedDoneRef.current.has(lastIndex)) return undefined;

    const fullText = String(lastMessage.message || "");
    setTypedIndex(lastIndex);
    setTypedLength(0);

    let revealed = 0;
    const timer = window.setInterval(() => {
      revealed += 2;
      if (revealed >= fullText.length) {
        setTypedLength(fullText.length);
        typedDoneRef.current.add(lastIndex);
        window.clearInterval(timer);
      } else {
        setTypedLength(revealed);
      }
    }, 16);

    return () => window.clearInterval(timer);
  }, [messages.length]);

  useEffect(() => {
    if (!isBusy) {
      setThinkingStage(0);
      return undefined;
    }

    const timers = [
      window.setTimeout(() => setThinkingStage(1), 2500),
      window.setTimeout(() => setThinkingStage(2), 7000),
      window.setTimeout(() => setThinkingStage(3), 15000),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [isBusy]);

  async function submitPrompt(value) {
    const prompt = String(value || "").trim();
    if (!prompt || isBusy || !onSubmit) return;
    setInput("");
    setSubmitting(true);
    try {
      await onSubmit(prompt);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className={`clip-inspector persistent-agent ${isExport ? "export-agent" : "edit-agent"}`} data-testid="persistent-agent-panel" data-agent-context={context} aria-busy={isBusy}>
      <section className="agent-card">
        <div className="agent-head">
          <span className="agent-avatar">AI</span>
          <div>
            <strong>KickClip Agent</strong>
            {!isExport && mode === "player" ? <small>선수 정보와 클립 구성을 보조합니다</small> : null}
          </div>
          {!isExport ? <span className="agent-context-pill">편집</span> : null}
        </div>

        <div className="agent-scroll" ref={scrollRef} aria-live="polite">
          <div className="agent-chat">
            {isExport && messages.length === 0 ? <div className="agent-empty-state"><strong>무엇을 준비할까요?</strong><span>게시 정보 추천이나 영상 설정을 요청하세요.</span></div> : null}
            {!isExport ? <AgentIntro mode={mode} selectedPlayer={selectedPlayer} /> : null}
            {messages.map((message, index) => {
              const isTyping = message.role === "ai" && index === typedIndex && !typedDoneRef.current.has(index);
              const displayText = isTyping ? String(message.message || "").slice(0, typedLength) : message.message;
              const showOptions = Boolean(message.options?.length) && index === messages.length - 1 && !isBusy && !isTyping;
              return (
                <div className={`agent-message ${message.role}`} key={message.id || `${message.role}-${index}`}>
                  {displayText}
                  {isTyping ? <span className="agent-typing-cursor" aria-hidden="true"></span> : null}
                  {showOptions ? (
                    <div className="agent-clarification-options">
                      {message.options.map((option) => (
                        <button type="button" key={option} onClick={() => submitPrompt(option)}>
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {isBusy ? (
              <div className="agent-message ai agent-thinking" role="status">
                <span className="agent-thinking-mark" aria-hidden="true">
                  <i></i><i></i><i></i>
                </span>
                <span className="agent-thinking-copy">
                  <strong>생각 중</strong>
                  <small>{thinkingDetails[thinkingStage]}</small>
                </span>
              </div>
            ) : null}
          </div>

          {showQuickPrompts ? <div className="agent-prompt-section export-prompts">
            <div className="agent-prompts">
              {quickPrompts.map((item) => {
                const prompt = typeof item === "string" ? item : item.prompt;
                const label = typeof item === "string" ? item : item.label;
                return <button type="button" key={prompt} disabled={isBusy} onClick={() => submitPrompt(prompt)}>{label}</button>;
              })}
            </div>
          </div> : null}

          {status ? <div className="agent-plan"><strong>{status.title}</strong><span>{status.detail}</span></div> : null}
          {onReset ? <button className="button ghost full compact" type="button" disabled={isBusy} onClick={onReset}>전체 타임라인으로 되돌리기</button> : null}
        </div>

        <div className="agent-input-row">
          <input
            type="text"
            placeholder={isBusy ? "AI가 답변을 준비하고 있어요" : isExport ? "내보내기 요청을 입력하세요" : mode === "player" ? "Agent에게 선수 정보나 편집 요청 입력" : "Agent에게 원하는 편집을 입력하세요"}
            value={input}
            disabled={isBusy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && input.trim()) {
                event.preventDefault();
                submitPrompt(input);
              }
            }}
          />
          <button className="button primary icon-only" type="button" aria-label={isBusy ? "AI가 답변을 준비하는 중" : "agent 요청 보내기"} disabled={isBusy || !input.trim()} onClick={() => submitPrompt(input)}>
            {isBusy ? <span className="agent-send-spinner" aria-hidden="true"></span> : "↑"}
          </button>
        </div>
      </section>
    </aside>
  );
}
