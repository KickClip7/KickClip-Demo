export const events = [
  { id: 1, category: "goal", tag: "GOAL", title: "GOAL 1-0", time: "12:00", minute: 12, duration: 8, start: "00:04.5", end: "00:12.5", score: 97.4, highlightScore: 10, description: "박스 안 침투 후 첫 골로 연결된 핵심 득점 장면입니다.", playerIds: ["p7", "p10"], team: "프로메테우스" },
  { id: 2, category: "shot", tag: "SHOT · 유효", title: "박민호 유효슈팅", time: "18:22", minute: 18, duration: 6, start: "00:12.5", end: "00:18.5", score: 88.2, highlightScore: 6, description: "오른발 강슛이 골문 안쪽으로 향한 유효 슈팅입니다.", playerIds: ["p9"], team: "한빛 FC" },
  { id: 3, category: "foul", tag: "FOUL", title: "중원 태클 파울", time: "26:41", minute: 26, duration: 5, start: "00:18.5", end: "00:23.5", score: 83.5, highlightScore: 5, description: "중원 압박 과정에서 흐름을 끊은 태클 파울입니다.", playerIds: ["p5", "p11"], team: "프로메테우스" },
  { id: 4, category: "card", tag: "CARD · Yellow", title: "경고 카드", time: "31:08", minute: 31, duration: 5, start: "00:23.5", end: "00:28.5", score: 91.1, highlightScore: 7, description: "위험한 접촉 이후 주심이 경고 카드를 꺼낸 장면입니다.", playerIds: ["p11"], team: "한빛 FC" },
  { id: 5, category: "freekick", tag: "FREEKICK · 직접", title: "직접 프리킥 찬스", time: "38:50", minute: 38, duration: 9, start: "00:28.5", end: "00:37.5", score: 86.7, highlightScore: 6, description: "페널티 아크 근처에서 직접 슈팅으로 이어진 프리킥입니다.", playerIds: ["p10"], team: "프로메테우스" },
  { id: 6, category: "corner", tag: "CORNER", title: "왼쪽 코너킥", time: "44:00", minute: 44, duration: 7, start: "00:37.5", end: "00:44.5", score: 80.2, highlightScore: 4, description: "왼쪽 코너에서 박스 안으로 투입된 세트피스 장면입니다.", playerIds: ["p4", "p9"], team: "한빛 FC" },
  { id: 7, category: "goal", tag: "GOAL", title: "GOAL 2-0", time: "47:00", minute: 47, duration: 7, start: "00:44.5", end: "00:51.5", score: 96.8, highlightScore: 10, description: "빠른 전환 이후 두 번째 골로 연결된 결정적 장면입니다.", playerIds: ["p7"], team: "프로메테우스" },
  { id: 8, category: "shot", tag: "SHOT · 똥볼", title: "손흥민 슈팅 아웃", time: "53:18", minute: 53, duration: 5, start: "00:51.5", end: "00:56.5", score: 72.9, highlightScore: 3, description: "좋은 위치에서 시도했지만 크게 벗어난 슈팅 장면입니다.", playerIds: ["p7", "p10"], team: "프로메테우스" },
  { id: 9, category: "foul", tag: "FOUL", title: "페널티 박스 앞 파울", time: "61:33", minute: 61, duration: 6, start: "00:56.5", end: "01:02.5", score: 89.4, highlightScore: 7, description: "페널티 박스 앞에서 위험 지역 프리킥을 만든 파울입니다.", playerIds: ["p4", "p5"], team: "한빛 FC" },
  { id: 10, category: "goal", tag: "GOAL", title: "GOAL 2-1", time: "67:00", minute: 67, duration: 10, start: "01:02.5", end: "01:12.5", score: 98.1, highlightScore: 10, description: "추격 골로 경기 분위기가 바뀐 후반 핵심 득점 장면입니다.", playerIds: ["p9", "p4"], team: "한빛 FC" },
  { id: 11, category: "freekick", tag: "FREEKICK · 간접", title: "간접 프리킥 세트피스", time: "74:20", minute: 74, duration: 8, start: "01:12.5", end: "01:20.5", score: 84.8, highlightScore: 5, description: "간접 프리킥 이후 세컨드 볼 경합까지 이어진 장면입니다.", playerIds: ["p10", "p5"], team: "프로메테우스" },
  { id: 12, category: "card", tag: "CARD · Red", title: "퇴장 카드", time: "82:14", minute: 82, duration: 6, start: "01:20.5", end: "01:26.5", score: 95.3, highlightScore: 9, description: "경기 후반 판도에 영향을 준 퇴장 카드 장면입니다.", playerIds: ["p11"], team: "한빛 FC" },
  { id: 13, category: "corner", tag: "CORNER", title: "막판 코너킥", time: "87:00", minute: 87, duration: 8, start: "01:26.5", end: "01:34.5", score: 90.6, highlightScore: 6, description: "막판 공격을 위한 코너킥과 문전 혼전 장면입니다.", playerIds: ["p7", "p4"], team: "프로메테우스" },
];

export const players = [
  { id: "p7", name: "손흥민", number: 7, team: "프로메테우스", role: "FW" },
  { id: "p10", name: "노민호", number: 10, team: "프로메테우스", role: "AM" },
  { id: "p5", name: "박도윤", number: 5, team: "프로메테우스", role: "DM" },
  { id: "p9", name: "이현우", number: 9, team: "한빛 FC", role: "FW" },
  { id: "p4", name: "정서준", number: 4, team: "한빛 FC", role: "CB" },
  { id: "p11", name: "최지훈", number: 11, team: "한빛 FC", role: "LW" },
];

export const playerKnowledgeBase = {
  son: {
    aliases: ["손흥민", "son", "sonny", "heungmin", "heung-min"],
    displayName: "손흥민",
    position: "Forward / Left wing",
    nationality: "Korea Republic",
    traits: ["양발 슈팅", "스프린트 침투", "박스 안 결정력"],
    summary: "프리미어리그에서 활약한 한국 대표 공격수입니다. 빠른 전환, 양발 마무리, 뒷공간 침투 장면을 중심으로 숏폼 하이라이트를 구성하기 좋습니다.",
  },
};

export const eventLabels = { all: "전체", goal: "골", shot: "슈팅", foul: "파울", card: "카드", freekick: "프리킥", corner: "코너킥" };
export const eventColors = { goal: "#d4ff00", shot: "#00d4ff", foul: "#ff4d6d", card: "#ffd000", freekick: "#a66cff", corner: "#ff8a00" };
export const filterKeys = Object.keys(eventLabels);
export const musicOptions = ["없음", "Hype Beat 01", "Epic Stadium", "Fast Counter"];

// 2. 반복해서 그리는 UI 목록 데이터
export const workSteps = [
  { id: "upload", label: "업로드" },
  { id: "analyze", label: "AI 분석" },
  { id: "edit", label: "편집" },
  { id: "preview", label: "내보내기" },
];

export const analysisSteps = ["영상 업로드", "장면 감지", "이벤트 분류", "선수 인식", "스코어링"];

export const matchAgentPrompts = ["골 장면만 보여줘", "슈팅만 보여줘", "파울만 보여줘", "전반전만 보기", "후반전만 보기", "전체 보기"];

// 세션 에이전트(챗봇 편집) 전용 라벨 메타.
// 키는 백엔드 action spotting taxonomy와 동일한 소문자를 사용한다.
export const sessionLabelMeta = {
  goal: { ko: "골", color: "#d4ff00" },
  shot: { ko: "슈팅", color: "#00d4ff" },
  penalty: { ko: "페널티", color: "#ff4d6d" },
  card: { ko: "카드", color: "#ffd000" },
  corner: { ko: "코너킥", color: "#ff8a00" },
};
export const sessionLabelOrder = ["goal", "shot", "penalty", "card", "corner"];
export const sessionAgentPrompts = ["골 장면만 모아줘", "전반전만 보여줘", "게시 정보 전체로 하이라이트 60초 구성해줘", "그중에 두번째 빼줘"];
export const playerAgentPrompts = ["이 선수는 손흥민이야", "이 선수 위주로 30초 쇼츠 만들어줘", "이 선수가 오래 나온 구간 위주로 만들어줘", "전반전 위주로 빠르게 편집해줘", "후반전 위주로 편집해줘"];
