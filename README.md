# ⚽ KICKCLIP
### 축구 경기 하이라이트, 이젠 "해줘" 한마디로

> 축구 풀경기 영상에서 주요 장면을 자동으로 탐지하고,  
> 사용자가 원하는 경기·팀 중심의 하이라이트 영상과 숏폼 콘텐츠를 손쉽게 제작하도록 지원하는 **AI 기반 영상 편집 서비스**

<br>

## 🔍 문제 인식
기존 하이라이트 제작 과정은 긴 경기 영상을 직접 확인하고 **필요한 장면을 일일이 편집**해야 하므로 많은 시간과 노력이 필요함

<br>

## 🗂 사용 데이터셋 : SoccerNet
| 항목 | 내용 |
|------|------|
| 규모 | 유럽 6대 리그 550경기 풀영상 + 이벤트 라벨 |
| 클래스 | 17개 → 6개 통합 (Goal / Shot / Card / Corner / FreeKick / Save) |
| 활용 | 피처 추출, Action Spotting 모델 학습, Tracking 테스트셋 |

<br>

## 🛠 기술 스택
![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?style=flat-square&logo=pytorch&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-000000?style=flat-square)
![Qwen2.5](https://img.shields.io/badge/Qwen2.5-purple?style=flat-square)

<br>

## ⚙️ 핵심 기능 및 기술

### 1. 🎯 Action Spotting — 주요 이벤트 자동 탐지
90분 경기 영상에서 추출한 시각적 특징을 딥러닝 모델이 분석하여  
골·슛·카드·코너킥 등 주요 장면의 발생 시점을 자동으로 찾아 타임스탬프로 기록합니다.

```json
{
  "label": "Goal",
  "time_sec": 2616.6,
  "confidence": 0.926,
  "event_id": "E0016",
  "time_hms": "00:43:36.62"
}
```

`#SoccerNet` `#TCN Transformer` `#TimeStamp`

---

### 2. 🏃 Tracking — 선수 실시간 추적
파인튜닝된 RF-DETR로 선수·골키퍼·심판을 실시간 감지하고,  
ByteTrack으로 선수가 화면에서 사라졌다 재등장해도 동일 ID를 유지하며 추적합니다.

`#RF-DETR` `#ByteTrack` `#CVAT`

---

### 3. 🤖 Edit Agent — 하이라이트 바이브 편집
> "골 장면만 모아줘", "60초 이내로 줄여줘"

한 마디면 편집 에이전트가 클립을 선별·편집하고  
제목·해시태그·썸네일까지 자동 생성합니다.

**Agent Capabilities**
- 이벤트 유형 필터링 (골·슛·카드 등)
- 클립 길이 조정
- 클립 추가 / 제거

`#Agent` `#LangGraph` `#Qwen2.5-VL`

<br>

## 🔄 하이라이트 생성 파이프라인

```
Step 01        Step 02           Step 03              Step 04           Step 05
영상 업로드  →  Action Spotting  →  선수 탐지 및 추적  →  편집 에이전트  →  하이라이트 생성
Feature         Temporal CNN       RF-DETR               LangGraph +       OpenCV
extract         Transformer        Fine-tuning           gpt-4o-mini       + Qwen 2.5-VL
                                   using CVAT Labels                       + FFmpeg
```

<br>

## 🔀 에이전트 흐름

```
START
  └─ LoadSession (DB 편집안·클립 이력)
       └─ UnderstandRequest (의도 병합, EditIntent 생성)
            ├─ [모호] → AskUser (interrupt() 일시정지) → 유저 답변으로 재개
            └─ [명확] → PlanOrReviseEdit (오류 피드백 반영 수정)
                          └─ ValidatePlan (기계 검사, LLM 없음)
                               ├─ [실패 < 5회] → PlanOrReviseEdit
                               ├─ [실패 = 5회] → FailRespond (조건 완화 요청)
                               └─ [성공] → SaveAndRespond (DB 저장, version+1)
                                              └─ END
```

<br>

## 👥 팀원

| 이름 | 기수 | 담당 |
|------|------|------|
| 노은서 | 7기 | 트래킹 파이프라인, 점유율 분석, LangGraph 에이전트 설계 |
| 전해성 | 8기 | RF-DETR 파인튜닝, Tracking, 백엔드 |
| 박동준 | 8기 | 프론트엔드 (React), EDA |
| 김재현 | 9기 | Action Spotting 모델 |
