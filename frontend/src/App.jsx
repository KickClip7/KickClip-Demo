import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adaptClipPlan,
  adaptEditState,
  adaptRecentProjects,
  adaptSessionClips,
  clipPlanItemsFromEvents,
  clipPlanItemsFromSessionClips,
} from "./api/adapters.js";
import { kickclipApi, toApiUrl } from "./api/kickclipApi.js";
import AuthScreen from "./components/auth/AuthScreen.jsx";
import Steps from "./components/common/Steps.jsx";
import Toast from "./components/common/Toast.jsx";
import TopBar from "./components/common/TopBar.jsx";
import Landing from "./components/landing/Landing.jsx";
import { isTerminalRenderStatus, latestClipPlan } from "./domain/projectState.js";
import { loadCandidateRecommendations } from "./domain/candidateRecommendationPreparation.js";
import { buildHighlightDraftPayload, clipsFromHighlightDraft, highlightDraftFingerprint } from "./domain/highlightDraft.js";
import { buildAgentClipPlanPayload, buildManualClipPlanPayload, defaultEditEntry, projectNotFoundMessage, routeAfterProjectCreate, routeAfterUpload } from "./domain/workflow.js";
import EditScreen from "./features/editor/EditScreen.jsx";
import {
  buildCandidateReviewPayload,
  buildCandidateSelectionPayload,
  normalizeCandidateRecommendations,
  validateCandidateRecommendationResponse,
  validateSelectionResponse,
  validateTrackingHandoff,
} from "./features/editor/eventCandidateSelection.js";
import { isR1TrackingJob, stableReviewIdempotencyKey } from "./features/editor/trackingR1State.js";
import PreviewScreen from "./screens/PreviewScreen.jsx";
import MatchProjectsScreen from "./screens/MatchProjectsScreen.jsx";
import ProjectsScreen from "./screens/ProjectsScreen.jsx";
import UploadScreen from "./screens/UploadScreen.jsx";
import { parseRoute, routePath, screenForRoute } from "./routing.js";
import { readStorage, writeStorage } from "./utils/storage.js";

const R1_RECOMMENDATION_UI_ENABLED = import.meta.env.DEV
  || import.meta.env.VITE_EVENT_CANDIDATE_HANDOFF_R1 === "true";

const INITIAL_CANDIDATE_PREVIEW_CONCURRENCY = 4;
const INITIAL_CANDIDATE_PREVIEW_MEDIA_KEY = "best_crop_display_url";

function toFrontendUser(user) {
  if (!user) return null;
  return { id: user.user_id, name: user.display_name, email: user.email, role: user.role };
}

function authErrorMessage(error, fallback) {
  const message = String(error?.detail || error?.message || "");
  if (message.includes("Invalid email or password")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (message.includes("Email is already registered")) return "이미 가입된 이메일입니다.";
  if (message.includes("valid email address")) return "올바른 이메일 주소를 입력해주세요.";
  if (message.includes("at least 8 characters")) return "비밀번호는 8자 이상이어야 합니다.";
  if (message.includes("at least one letter")) return "비밀번호에 영문자를 1개 이상 포함해주세요.";
  if (message.includes("at least one number")) return "비밀번호에 숫자를 1개 이상 포함해주세요.";
  if (error?.status === 401) return "로그인이 만료되었거나 계정 정보가 올바르지 않습니다.";
  return message || fallback;
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length));

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function waitForDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Tracking request cancelled.", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Tracking request cancelled.", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const screen = screenForRoute(route);
  const [authMode, setAuthMode] = useState("login");
  const [currentUser, setCurrentUser] = useState(() => toFrontendUser(kickclipApi.getStoredUser()));
  const [theme, setTheme] = useState(() => readStorage("kickclip-theme", "light"));
  const [toast, setToast] = useState("");

  const [_recentProjects, setRecentProjects] = useState([]);
  const [workspaceMatches, setWorkspaceMatches] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");

  const [selectedMatch, setSelectedMatch] = useState(null);
  const [matchProjects, setMatchProjects] = useState([]);
  const [matchProjectsLoading, setMatchProjectsLoading] = useState(false);
  const [matchProjectsError, setMatchProjectsError] = useState("");
  const [uploadContexts, setUploadContexts] = useState({});
  const [lastUploadedMatchId, setLastUploadedMatchId] = useState(() => readStorage("kickclip-last-uploaded-match-id", null));
  const [analysisByMatch, setAnalysisByMatch] = useState({});
  const analysisStartedRef = useRef(new Set());

  const [projectEditState, setProjectEditState] = useState(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");

  const initialEditEntry = defaultEditEntry();
  const [editView, setEditView] = useState(initialEditEntry.editView);
  const [mode, setMode] = useState(initialEditEntry.mode);
  const [eventFilter, setEventFilter] = useState("all");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [focusedEventId, setFocusedEventId] = useState(null);
  const [agentSelectionIds, setAgentSelectionIds] = useState(null);
  const [agentDurations, setAgentDurations] = useState({});
  const [agentSummary, setAgentSummary] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [resolvedProfiles, setResolvedProfiles] = useState({});
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [exportRatio, setExportRatio] = useState("16:9");
  const [selectedMusic, setSelectedMusic] = useState("Hype Beat 01");
  const [currentClipPlanId, setCurrentClipPlanId] = useState(null);
  const trackingAwareClipPlanIdsRef = useRef(new Set());
  const [renderBusy, setRenderBusy] = useState(false);
  const [highlightDraft, setHighlightDraft] = useState(null);
  const [draftSaveBusy, setDraftSaveBusy] = useState(false);
  const draftBaselineRef = useRef({ projectId: null, fingerprint: null });

  const [sessionId, setSessionId] = useState(null);
  const [sessionVideoUrl, setSessionVideoUrl] = useState(null);
  const [sessionAllEvents, setSessionAllEvents] = useState([]);
  const [sessionCurrentClips, setSessionCurrentClips] = useState([]);
  const [sessionDraftClips, setSessionDraftClips] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  // Action Spotting이 아직 이벤트를 만들지 못한 상태(404)면 완료를 기다리며 재시도한다.
  const [sessionWaitingForAnalysis, setSessionWaitingForAnalysis] = useState(false);
  const analysisWaitToastRef = useRef(false);
  const sessionIdRef = useRef(null);
  const sessionStartPromiseRef = useRef(null);

  const projectId = projectEditState?.project?.project_id || route.projectId || null;
  const matchId = projectEditState?.match?.match_id || route.matchId || null;
  const apiEvents = projectEditState?.events || [];
  const apiPlayers = projectEditState?.players || [];
  const renderJobs = projectEditState?.renderJobs || [];
  const uploadedVideo = projectEditState?.videoUrl || "";
  const uploadedVideoDuration = Number(projectEditState?.video?.duration_sec || projectEditState?.match?.duration_sec || 0);
  const selectedEvents = useMemo(
    () => (agentSelectionIds || []).map((id) => apiEvents.find((event) => String(event.id) === String(id))).filter(Boolean),
    [agentSelectionIds, apiEvents],
  );

  const navigate = useCallback((next, { replace = false } = {}) => {
    const nextRoute = typeof next === "string" ? parseRoute(next) : next;
    const path = routePath(nextRoute);
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
    setRoute(nextRoute);
  }, []);

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 1800);
  }

  async function login(form) {
    const email = form.email.trim().toLowerCase();
    if (!email || !form.password) return { ok: false, message: "이메일과 비밀번호를 입력해주세요." };
    try {
      const session = await kickclipApi.login({ email, password: form.password });
      setCurrentUser(toFrontendUser(session.user));
      return { ok: true };
    } catch (error) {
      return { ok: false, message: authErrorMessage(error, "로그인하지 못했습니다."), error };
    }
  }

  async function signup(form) {
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name || !email || !form.password) return { ok: false, message: "이름, 이메일, 비밀번호를 모두 입력해주세요." };
    if (form.password.length < 8) return { ok: false, message: "비밀번호는 8자 이상이어야 합니다." };
    if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) return { ok: false, message: "비밀번호에 영문자와 숫자를 각각 1개 이상 포함해주세요." };
    try {
      const session = await kickclipApi.signup({ display_name: name, email, password: form.password });
      setCurrentUser(toFrontendUser(session.user));
      return { ok: true };
    } catch (error) {
      return { ok: false, message: authErrorMessage(error, "회원가입하지 못했습니다."), error };
    }
  }

  async function logout() {
    try {
      await kickclipApi.logout();
    } finally {
      setCurrentUser(null);
      setAuthMode("login");
      navigate({ name: "home" }, { replace: true });
    }
  }

  const refreshRecentProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError("");
    try {
      const [recentResponse, matches] = await Promise.all([
        kickclipApi.getRecentProjects(10),
        kickclipApi.getMatches(),
      ]);
      const projects = adaptRecentProjects(recentResponse);
      setRecentProjects(projects);
      setWorkspaceMatches(Array.isArray(matches) ? matches : []);
    } catch (error) {
      setRecentProjects([]);
      if (lastUploadedMatchId) {
        try {
          setWorkspaceMatches([await kickclipApi.getMatch(lastUploadedMatchId)]);
        } catch {
          setWorkspaceMatches([]);
        }
      } else {
        setWorkspaceMatches([]);
      }
      setProjectsError(error?.detail || error?.message || "최근 하이라이트를 불러오지 못했습니다.");
    } finally {
      setProjectsLoading(false);
    }
  }, [lastUploadedMatchId]);

  const loadMatchProjects = useCallback(async (targetMatchId) => {
    if (!targetMatchId) return;
    setMatchProjectsLoading(true);
    setMatchProjectsError("");
    try {
      const [match, projects] = await Promise.all([
        kickclipApi.getMatch(targetMatchId),
        kickclipApi.getMatchProjects(targetMatchId),
      ]);
      setSelectedMatch(match);
      setMatchProjects(Array.isArray(projects) ? projects : []);
    } catch (error) {
      setSelectedMatch(null);
      setMatchProjects([]);
      setMatchProjectsError(error?.status === 404 ? "경기를 찾을 수 없습니다." : error?.detail || error?.message || "경기 정보를 불러오지 못했습니다.");
    } finally {
      setMatchProjectsLoading(false);
    }
  }, []);

  const hydrateProjectEditState = useCallback(async (targetProjectId, { quiet = false } = {}) => {
    if (!targetProjectId) return false;
    if (!quiet) {
      setProjectLoading(true);
      setProjectEditState(null);
    }
    setProjectError("");
    try {
      const [response, savedDraft] = await Promise.all([
        kickclipApi.getProjectEditState(targetProjectId),
        quiet
          ? Promise.resolve(highlightDraft)
          : kickclipApi.getHighlightDraft(targetProjectId).catch((error) => {
            if (error?.status === 404) return null;
            throw error;
          }),
      ]);
      const editState = adaptEditState(response);
      if (!editState.project || !editState.match || editState.project.project_id !== targetProjectId) {
        throw new Error("하이라이트 편집 응답이 올바르지 않습니다.");
      }
      setProjectEditState(editState);
      setSelectedPlayerId((current) => editState.players.some((player) => player.id === current) ? current : editState.players[0]?.id || null);
      setFocusedEventId((current) => editState.events.some((event) => String(event.id) === String(current)) ? current : editState.events[0]?.id || null);
      const currentPlan = latestClipPlan(editState.clipPlans);
      setCurrentClipPlanId(savedDraft?.clip_plan_id || currentPlan?.clip_plan_id || null);
      if (!quiet) {
        setHighlightDraft(savedDraft);
        draftBaselineRef.current = {
          projectId: targetProjectId,
          fingerprint: highlightDraftFingerprint(savedDraft),
        };
        if (savedDraft) {
          const savedMode = savedDraft.editor_state?.mode;
          if (savedMode === "match" || savedMode === "player") setMode(savedMode);
          setAgentSelectionIds(savedDraft.selected_scene_ids?.length ? savedDraft.selected_scene_ids : null);
          setAgentDurations(Object.fromEntries((savedDraft.timeline_items || []).map((item) => [
            String(item.scene_id),
            Number(item.end_sec) - Number(item.start_sec),
          ])));
          setAgentSummary(savedDraft.metadata?.agent_summary || "");
          setFocusedEventId(savedDraft.editor_state?.focused_scene_id || null);
          setEventFilter(savedDraft.editor_state?.event_filter || "all");
          setSelectedPlayerId(savedDraft.editor_state?.selected_player_id || editState.players[0]?.id || null);
          setExportRatio(savedDraft.export_options?.ratio || "16:9");
          setCaptionsEnabled(savedDraft.export_options?.captions_enabled ?? true);
          setSelectedMusic(savedDraft.export_options?.music || "Hype Beat 01");
        }
      }
      return true;
    } catch (error) {
      setProjectEditState(null);
      setProjectError(projectNotFoundMessage(error));
      return false;
    } finally {
      if (!quiet) setProjectLoading(false);
    }
  }, [highlightDraft]);

  const startAnalysisForMatch = useCallback(async (targetMatchId) => {
    if (!targetMatchId || analysisStartedRef.current.has(targetMatchId)) return;
    analysisStartedRef.current.add(targetMatchId);
    setAnalysisByMatch((items) => ({ ...items, [targetMatchId]: { status: "분석 작업을 시작하는 중입니다.", jobId: null } }));
    try {
      const job = await kickclipApi.createAnalysisJob(targetMatchId, {
        job_type: "FULL_MATCH_ANALYSIS",
        options: {
          run_feature_extraction: true,
          run_highlight_spotting: true,
          run_player_tracking: true,
        },
      }, { auto_start: true });
      setAnalysisByMatch((items) => ({ ...items, [targetMatchId]: { status: "AI 경기 분석이 진행 중입니다.", jobId: job.analysis_job_id } }));
    } catch (error) {
      const duplicateLike = [409, 422].includes(error?.status);
      setAnalysisByMatch((items) => ({
        ...items,
        [targetMatchId]: {
          status: duplicateLike ? "이미 진행 중인 분석이 있을 수 있습니다." : "분석 자동 시작에 실패했습니다. 하이라이트 편집은 계속할 수 있습니다.",
          jobId: null,
        },
      }));
    }
  }, []);

  async function handleUpload({ file, source, metadata, onProgress }) {
    try {
      const result = await kickclipApi.uploadMatchVideo({ file, metadata, onProgress });
      setUploadContexts((items) => ({
        ...items,
        [result.match_id]: {
          video_url: toApiUrl(result.video_url) || source,
          preview_url: toApiUrl(result.preview_url) || null,
          preview_status: result.preview_status,
        },
      }));
      setLastUploadedMatchId(result.match_id);
      writeStorage("kickclip-last-uploaded-match-id", result.match_id);
      navigate(routeAfterUpload(result));
      startAnalysisForMatch(result.match_id);
      showToast("경기 영상이 등록되었습니다. 이제 하이라이트를 만드세요.");
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async function createProjectForMatch(payload) {
    if (!route.matchId) return { ok: false, error: new Error("경기 ID가 없습니다.") };
    try {
      const project = await kickclipApi.createProject(route.matchId, payload);
      setMatchProjects((items) => [...items, project]);
      refreshRecentProjects();
      navigate(routeAfterProjectCreate(project));
      showToast("새 하이라이트를 만들었습니다.");
      return { ok: true, project };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function resetEditorInteraction() {
    const nextEditEntry = defaultEditEntry();
    setEditView(nextEditEntry.editView);
    setMode(nextEditEntry.mode);
    setEventFilter("all");
    setAgentSelectionIds(null);
    setAgentDurations({});
    setAgentSummary("");
    setAssistantInput("");
    setAssistantMessages([]);
    setResolvedProfiles({});
    sessionIdRef.current = null;
    setSessionId(null);
    setSessionVideoUrl(null);
    setSessionAllEvents([]);
    setSessionCurrentClips([]);
    setSessionDraftClips([]);
    setSessionWaitingForAnalysis(false);
    analysisWaitToastRef.current = false;
    setHighlightDraft(null);
    setDraftSaveBusy(false);
    draftBaselineRef.current = { projectId: null, fingerprint: null };
  }

  function setStoredSessionId(nextSessionId) {
    sessionIdRef.current = nextSessionId;
    setSessionId(nextSessionId);
  }

  async function startEditSession({ force = false } = {}) {
    if (!matchId) {
      showToast("하이라이트의 경기 정보를 불러오지 못했습니다.");
      return null;
    }
    if (!force && sessionIdRef.current) return sessionIdRef.current;
    if (sessionStartPromiseRef.current) return sessionStartPromiseRef.current;
    if (force) setStoredSessionId(null);
    setSessionLoading(true);
    const promise = (async () => {
      try {
        const started = await kickclipApi.startSession({ match_id: matchId });
        const state = await kickclipApi.getSessionState(started.session_id);
        setStoredSessionId(started.session_id);
        setSessionVideoUrl(toApiUrl(started.video_url) || uploadedVideo || null);
        const allClips = adaptSessionClips(state.all_events);
        const currentClips = adaptSessionClips(state.current_clips);
        const restoredClips = clipsFromHighlightDraft(highlightDraft, allClips);
        if (!highlightDraft) {
          draftBaselineRef.current = {
            projectId,
            fingerprint: highlightDraftFingerprint(buildHighlightDraftPayload({
              mode: "match",
              sessionClips: currentClips,
              selectedEvents: [],
              agentDurations: {},
              agentSummary: "",
              exportRatio,
              captionsEnabled,
              selectedMusic,
              focusedEventId,
              eventFilter,
              selectedPlayerId,
              clipPlanId: currentClipPlanId,
              expectedVersion: 0,
            })),
          };
        }
        setSessionAllEvents(allClips);
        setSessionCurrentClips(highlightDraft ? restoredClips : currentClips);
        setSessionWaitingForAnalysis(false);
        analysisWaitToastRef.current = false;
        return started.session_id;
      } catch (error) {
        if (error?.status === 404) {
          // 타임라인 이벤트가 아직 없음 = AI 분석 진행 중. 완료를 기다리며 재시도한다.
          if (!analysisWaitToastRef.current) {
            analysisWaitToastRef.current = true;
            showToast("AI가 경기를 분석하고 있어요. 완료되면 장면이 자동으로 나타납니다.");
          }
          setSessionWaitingForAnalysis(true);
          return null;
        }
        showToast(error?.detail || "편집 세션을 시작하지 못했습니다.");
        return null;
      } finally {
        setSessionLoading(false);
        sessionStartPromiseRef.current = null;
      }
    })();
    sessionStartPromiseRef.current = promise;
    return promise;
  }

  async function sendSessionChat(message) {
    let activeSessionId = sessionIdRef.current || await startEditSession();
    if (!activeSessionId) throw new Error("편집 세션이 시작되지 않았습니다.");
    let result;
    try {
      result = await kickclipApi.chatSession({ session_id: activeSessionId, message });
    } catch (error) {
      if (error?.status !== 404) throw error;
      activeSessionId = await startEditSession({ force: true });
      if (!activeSessionId) throw error;
      result = await kickclipApi.chatSession({ session_id: activeSessionId, message });
    }
    setSessionCurrentClips(adaptSessionClips(result.current_clips));
    return {
      needsClarification: result.needs_clarification,
      replyText: result.reply_text,
      clarificationQuestion: result.clarification_question,
      clarificationOptions: result.clarification_options,
    };
  }

  function addSessionClipToHighlight(clip) {
    if (!clip?.id) return;
    const appendOnce = (current) => (
      current.some((item) => item.id === clip.id) ? current : [...current, clip]
    );
    setSessionCurrentClips(appendOnce);
    setSessionDraftClips(appendOnce);
  }

  async function saveHighlightDraft({ showSuccess = true } = {}) {
    if (!projectId || draftSaveBusy) return false;
    setDraftSaveBusy(true);
    try {
      const payload = buildHighlightDraftPayload({
        mode,
        sessionClips: sessionDraftClips,
        selectedEvents,
        agentDurations,
        agentSummary,
        exportRatio,
        captionsEnabled,
        selectedMusic,
        focusedEventId,
        eventFilter,
        selectedPlayerId,
        clipPlanId: currentClipPlanId,
        expectedVersion: highlightDraft?.version ?? 0,
      });
      const saved = await kickclipApi.saveHighlightDraft(projectId, payload);
      setHighlightDraft(saved);
      draftBaselineRef.current = {
        projectId,
        fingerprint: highlightDraftFingerprint(saved),
      };
      if (showSuccess) showToast("편집 내용을 임시저장했습니다.");
      return true;
    } catch (error) {
      if (error?.status === 409) {
        try {
          setHighlightDraft(await kickclipApi.getHighlightDraft(projectId));
        } catch {
          // Keep the existing version when refreshing the conflicting draft fails.
        }
        showToast("다른 곳에서 저장된 최신 임시본이 있습니다. 다시 눌러 덮어써주세요.");
      } else {
        showToast(error?.detail || "임시저장에 실패했습니다.");
      }
      return false;
    } finally {
      setDraftSaveBusy(false);
    }
  }

  const currentDraftFingerprint = highlightDraftFingerprint(buildHighlightDraftPayload({
    mode,
    sessionClips: sessionDraftClips,
    selectedEvents,
    agentDurations,
    agentSummary,
    exportRatio,
    captionsEnabled,
    selectedMusic,
    focusedEventId,
    eventFilter,
    selectedPlayerId,
    clipPlanId: currentClipPlanId,
    expectedVersion: highlightDraft?.version ?? 0,
  }));
  const hasUnsavedDraftChanges = draftBaselineRef.current.projectId === projectId
    && draftBaselineRef.current.fingerprint !== currentDraftFingerprint;

  async function openExport() {
    if (!projectId || draftSaveBusy) return;
    if (!highlightDraft || hasUnsavedDraftChanges) {
      const saved = await saveHighlightDraft({ showSuccess: false });
      if (!saved) return;
    }
    navigate({ name: "project-export", projectId });
  }

  async function openMode(nextMode) {
    setEventFilter("all");
    setAgentSelectionIds(null);
    setAgentDurations({});
    setAgentSummary("");
    setFocusedEventId(nextMode === "player"
      ? apiEvents.find((event) => event.playerIds.includes(selectedPlayerId))?.id ?? apiEvents[0]?.id
      : apiEvents[0]?.id);
    if (nextMode === "match") {
      setAssistantMessages([]);
      setAssistantInput("");
      const nextSessionId = await startEditSession();
      if (!nextSessionId) return;
    }
    setMode(nextMode);
    setEditView("editor");
  }

  async function requestAgentClipPlan(payload) {
    if (!projectId) throw new Error("하이라이트 작업 ID가 없습니다.");
    const plan = adaptClipPlan(await kickclipApi.createAgentClipPlan(buildAgentClipPlanPayload(projectId, payload)));
    if (plan.id) setCurrentClipPlanId(plan.id);
    await hydrateProjectEditState(projectId, { quiet: true });
    return plan;
  }

  async function resolvePlayerProfile(payload) {
    if (!matchId) throw new Error("경기 ID가 없습니다.");
    return kickclipApi.resolvePlayerProfile({ ...payload, match_id: matchId });
  }

  async function waitForHighlightStatus(predicate, attempts = 45, { signal } = {}) {
    if (!projectId) throw new Error("하이라이트 작업 ID가 없습니다.");
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Tracking request cancelled.", "AbortError");
      const latest = await kickclipApi.getHighlightStatus(projectId, { signal });
      if (predicate(latest)) return latest;
      const revisionStatus = String(latest?.revision?.status || "").toUpperCase();
      if (revisionStatus === "FAILED") {
        throw new Error(latest?.revision?.error_message || "하이라이트 분석에 실패했습니다.");
      }
      await waitForDelay(1200, signal);
    }
    throw new Error("선수 탐지 작업이 예상보다 오래 걸리고 있습니다. 잠시 후 다시 시도해주세요.");
  }

  async function resolvePreparedRecommendations({ revisionId, eventId, sceneId, selectionResponse, signal, onPreparationState }) {
    return loadCandidateRecommendations({
      api: kickclipApi,
      projectId,
      revisionId,
      eventId,
      sceneId,
      selectionResponse,
      signal,
      onState: onPreparationState,
    });
  }

  async function resolveCandidatesForReviewScope({ scope, selectionResponse, signal, onPreparationState }) {
    const candidateResponse = validateCandidateRecommendationResponse(
      await resolvePreparedRecommendations({
        revisionId: scope.revisionId,
        eventId: scope.eventId,
        sceneId: scope.sceneId,
        selectionResponse,
        signal,
        onPreparationState,
      }),
    );
    if (candidateResponse.production_recommendation_ui === "BLOCKED" && !R1_RECOMMENDATION_UI_ENABLED) {
      throw new Error("Event Candidate Handoff R1은 개발자 모드 또는 명시적 feature flag에서만 사용할 수 있습니다.");
    }
    const candidates = await hydrateRecommendationMedia(
      normalizeCandidateRecommendations(candidateResponse),
      signal,
    );
    if (!candidates.length) throw new Error("이 장면에서 선택할 수 있는 선수 후보를 찾지 못했습니다.");
    return {
      ...scope,
      sourceVideoAssetId: candidateResponse.source_video_asset_id,
      recommendationResponse: candidateResponse,
      candidates,
    };
  }

  async function prepareTrackingCandidates({ clip, signal, onPreparationState }) {
    if (!projectId || !matchId) throw new Error("하이라이트 작업 정보를 찾을 수 없습니다.");
    if (!clip) throw new Error("트래킹할 장면을 먼저 선택해주세요.");

    let workflow;
    try {
      workflow = await kickclipApi.startHighlightAnalysis(projectId, {
        request: `${clip.label || "선택"} 장면 ${Number(clip.startSec || 0).toFixed(1)}초부터 ${Number(clip.endSec || 0).toFixed(1)}초 구간에서 선수를 찾아줘`,
      }, { signal });
    } catch (error) {
      if (error?.status !== 409) throw error;
      workflow = await kickclipApi.getHighlightStatus(projectId, { signal });
    }

    const readyForScenes = (status) => {
      const value = String(status?.revision?.status || "").toUpperCase();
      return ["SCENES_READY", "SCENES_SELECTED", "PLAYER_DISCOVERY_RUNNING", "PLAYER_SELECTION_REQUIRED"].includes(value);
    };
    if (!readyForScenes(workflow)) {
      await waitForHighlightStatus(readyForScenes, 45, { signal });
    }

    const sceneResponse = await kickclipApi.getHighlightScenes(projectId, { signal });
    const scenes = Array.isArray(sceneResponse?.scenes) ? sceneResponse.scenes : [];
    if (!scenes.length) throw new Error("선수 탐지에 사용할 하이라이트 장면이 없습니다.");

    const clipStart = Number(clip.startSec || 0);
    const clipEnd = Number(clip.endSec || clipStart);
    const scene = [...scenes].sort((a, b) => {
      const overlapA = Math.max(0, Math.min(clipEnd, Number(a.end_time_sec)) - Math.max(clipStart, Number(a.start_time_sec)));
      const overlapB = Math.max(0, Math.min(clipEnd, Number(b.end_time_sec)) - Math.max(clipStart, Number(b.start_time_sec)));
      if (overlapA !== overlapB) return overlapB - overlapA;
      return Math.abs(Number(a.representative_time_sec) - (clipStart + clipEnd) / 2)
        - Math.abs(Number(b.representative_time_sec) - (clipStart + clipEnd) / 2);
    })[0];

    const selectedRevision = await kickclipApi.selectHighlightScenes(projectId, {
      scene_ids: [scene.scene_id],
      selection_source: "USER",
      render_strategies: { [scene.scene_id]: "TARGET_CENTERED" },
    }, { signal });
    const revisionId = selectedRevision?.revision_id || selectedRevision?.revision?.revision_id;
    if (!revisionId) throw new Error("장면 선택 응답에서 child revision_id를 찾지 못했습니다.");
    const scope = {
      projectId,
      revisionId,
      sceneId: scene.scene_id,
      eventId: scene.scene_id,
      editorClipId: clip.id,
    };
    return resolveCandidatesForReviewScope({ scope, selectionResponse: selectedRevision, signal, onPreparationState });
  }

  async function resumeTrackingCandidatesAfterBoundaryReview({ scope, signal, onPreparationState }) {
    return resolveCandidatesForReviewScope({ scope, signal, onPreparationState });
  }

  function getShotBoundaryReview(scope, options = {}) {
    return kickclipApi.getShotBoundaryReview(scope.projectId, scope.revisionId, scope.eventId, scope.sceneId, options);
  }

  function prepareNewShotBoundaryReview(scope, options = {}) {
    return kickclipApi.prepareShotBoundaryReview(
      scope.projectId,
      scope.revisionId,
      scope.eventId,
      scope.sceneId,
      { ...options, newReviewRevision: true },
    );
  }

  function saveShotBoundaryDraft(scope, payload, options = {}) {
    return kickclipApi.updateShotBoundaryDraft(scope.projectId, scope.revisionId, scope.eventId, scope.sceneId, payload, options);
  }

  function resetShotBoundaryDraft(scope, options = {}) {
    return kickclipApi.resetShotBoundaryDraft(scope.projectId, scope.revisionId, scope.eventId, scope.sceneId, options);
  }

  function confirmShotBoundaryReview(scope, payload, options = {}) {
    return kickclipApi.confirmShotBoundaryReview(scope.projectId, scope.revisionId, scope.eventId, scope.sceneId, payload, options);
  }

  function retryShotBoundaryDetections(scope, options = {}) {
    return kickclipApi.retryShotBoundaryDetections(scope.projectId, scope.revisionId, scope.eventId, scope.sceneId, options);
  }

  function downloadShotBoundaryMedia(url, options = {}) {
    return kickclipApi.downloadAuthenticatedMedia(url, options);
  }

  async function prepareReplacementTrackingCandidates({ sourceRevisionId, sceneId, clip, signal, onPreparationState }) {
    if (!clip) throw new Error("다시 선수를 찾을 장면을 먼저 선택해주세요.");
    const response = validateCandidateRecommendationResponse(
      await resolvePreparedRecommendations({
        revisionId: sourceRevisionId,
        eventId: sceneId,
        sceneId,
        signal,
        onPreparationState,
      }),
    );
    return {
      projectId,
      revisionId: sourceRevisionId,
      sceneId,
      eventId: response.event_id || sceneId,
      editorClipId: clip.id,
      sourceVideoAssetId: response.source_video_asset_id,
      recommendationResponse: response,
      candidates: await hydrateRecommendationMedia(normalizeCandidateRecommendations(response), signal),
    };
  }

  async function retryCandidatePreparation({ failure, signal, onPreparationState }) {
    if (!failure?.retryUrl || !failure?.scope) throw new Error("재시도할 preparation task 정보가 없습니다.");
    const task = await kickclipApi.retrySceneAiTask(failure.retryUrl, { signal });
    const { revisionId, eventId, sceneId } = failure.scope;
    const response = validateCandidateRecommendationResponse(await resolvePreparedRecommendations({
      revisionId,
      eventId,
      sceneId,
      selectionResponse: {
        candidate_discovery: { recommendation_preparation: [{ ...task, scene_id: sceneId }] },
      },
      signal,
      onPreparationState,
    }));
    return {
      projectId,
      revisionId,
      eventId,
      sceneId,
      sourceVideoAssetId: response.source_video_asset_id,
      recommendationResponse: response,
      candidates: await hydrateRecommendationMedia(normalizeCandidateRecommendations(response), signal),
    };
  }

  async function hydrateRecommendationMedia(candidates, signal) {
    // The initial gallery only needs one representative image per player.
    // Downloading all six review assets for 15 candidates created a 90-request
    // burst and exhausted the API SQLAlchemy pool.  Keep the complete media URL
    // contract, but eagerly hydrate only the card preview with bounded
    // concurrency.  All other evidence is fetched on demand from EditScreen.
    return mapWithConcurrency(
      candidates,
      INITIAL_CANDIDATE_PREVIEW_CONCURRENCY,
      async (candidate) => {
        if (signal?.aborted) {
          throw new DOMException("Tracking request cancelled.", "AbortError");
        }
        const previewUrl = candidate.media?.[INITIAL_CANDIDATE_PREVIEW_MEDIA_KEY];
        const previewBlob = !previewUrl || String(previewUrl).startsWith("data:")
          ? null
          : await kickclipApi.downloadAuthenticatedMedia(previewUrl, { signal });
        return {
          ...candidate,
          media_blobs: previewBlob
            ? { [INITIAL_CANDIDATE_PREVIEW_MEDIA_KEY]: previewBlob }
            : {},
        };
      },
    );
  }

  async function downloadCandidateReviewMedia(url, options = {}) {
    const blob = await kickclipApi.downloadAuthenticatedMedia(url, options);
    if (!blob) throw new Error("후보 미디어를 불러오지 못했습니다.");
    return blob;
  }

  async function createCandidateSelection({
    revisionId,
    eventId,
    sceneId,
    candidate,
    recommendationResponse,
    sourceVideoAssetId,
    signal,
  }) {
    if (!projectId) throw new Error("하이라이트 작업 ID가 없습니다.");
    const selection = await kickclipApi.createEventCandidateSelection(
      projectId,
      revisionId,
      eventId,
      sceneId,
      buildCandidateSelectionPayload(recommendationResponse, candidate, sourceVideoAssetId),
      { signal },
    );
    return validateSelectionResponse(selection, candidate, recommendationResponse);
  }

  async function createCandidateTracking({ selection, candidate, sourceVideoAssetId, signal }) {
    const handoff = await kickclipApi.createSelectionTrackingJob(
      selection.selection_id,
      { source_video_asset_id: sourceVideoAssetId },
      { signal },
    );
    return validateTrackingHandoff(handoff, selection, candidate);
  }

  async function getTrackingReview(jobId, { signal } = {}) {
    if (!jobId) throw new Error("검토할 트래킹 작업 ID가 없습니다.");
    const [job, artifactResponse] = await Promise.all([
      kickclipApi.getTrackingJob(jobId, { signal }),
      kickclipApi.getTrackingArtifacts(jobId, { signal }),
    ]);
    const returnedJobId = job?.tracking_job_id || job?.job_id;
    if (returnedJobId !== jobId) {
      throw new Error(`CANDIDATE_SELECTION_PROVENANCE_MISMATCH: tracking_job_id mismatch`);
    }
    const requestedKeys = new Set(job?.pending_action?.artifact_keys || []);
    const reviewArtifacts = (artifactResponse?.artifacts || []).filter((artifact) => (
      artifact.exists
      && (
        requestedKeys.has(artifact.key)
        || (!requestedKeys.size && ["review_contact_sheet", "review_preview"].includes(artifact.kind))
      )
    ));
    const reviewStage = String(job?.pending_action?.review_stage || "").toUpperCase();
    const stageArtifacts = reviewArtifacts.filter((artifact) => {
      const key = String(artifact.key || "").toUpperCase();
      return reviewStage === "MEMORY" ? key.startsWith("MEMORY_") : key.includes(`_${reviewStage}_`);
    });
    const artifacts = stageArtifacts.length ? stageArtifacts : reviewArtifacts;
    const artifactsWithBlobs = await Promise.all(artifacts
      .filter((artifact) => artifact.url)
      .map(async (artifact) => ({
        ...artifact,
        blob: await kickclipApi.downloadAuthenticatedMedia(artifact.url, { signal }),
      })));
    const ambiguityId = job?.pending_ambiguity_id || job?.next_ambiguity?.ambiguity_id;
    let evidence = null;
    let candidateMedia = {};
    if (ambiguityId && isR1TrackingJob(job)) {
      const candidates = job?.next_ambiguity?.candidates || job?.pending_candidates || [];
      const [fullFrameContext, fullShotClip, candidateMediaEntries] = await Promise.all([
        kickclipApi.downloadTrackingAmbiguityEvidence(jobId, ambiguityId, "full-frame-context", { signal }),
        kickclipApi.downloadTrackingAmbiguityEvidence(jobId, ambiguityId, "full-shot-clip", { signal }),
        Promise.all(candidates.map(async (candidate) => {
          const candidateId = candidate?.candidate_id || candidate?.id;
          if (!candidateId) return null;
          try {
            const referenceGallery = await kickclipApi.downloadTrackingCandidateMedia(
              jobId,
              ambiguityId,
              candidateId,
              "reference-gallery",
              { signal },
            );
            return [candidateId, { referenceGallery }];
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            return null;
          }
        })),
      ]);
      evidence = { fullFrameContext, fullShotClip };
      candidateMedia = Object.fromEntries(candidateMediaEntries.filter(Boolean));
    }
    return { job, artifacts: artifactsWithBlobs, evidence, candidateMedia };
  }

  async function submitTrackingReview({ jobId, stage, decision, signal }) {
    if (!jobId || !stage) throw new Error("트래킹 검토 정보를 찾을 수 없습니다.");
    return kickclipApi.submitTrackingReview(jobId, {
      stage,
      decision,
      note: decision === "approve"
        ? "프론트엔드 세그먼트 미리보기에서 선택 선수를 확인함"
        : "프론트엔드 세그먼트 미리보기에서 트래킹 결과를 거절함",
    }, { signal });
  }

  async function getTrackingJobState(jobId, { signal } = {}) {
    if (!jobId) throw new Error("조회할 트래킹 작업 ID가 없습니다.");
    return kickclipApi.getTrackingJob(jobId, { signal });
  }

  async function getTrackingDiagnostics({ refresh = false, signal } = {}) {
    return kickclipApi.getTrackingDiagnostics({ refresh, signal });
  }

  async function getTrackingResult(jobId, job, { signal } = {}) {
    const [timeline, artifactResponse] = await Promise.all([
      job?.timeline_url ? kickclipApi.getTrackingTimeline(jobId, {}, { signal }) : Promise.resolve(null),
      kickclipApi.getTrackingArtifacts(jobId, { signal }),
    ]);
    const resultKeys = new Set([
      "tracking_preview",
      "target_centered_preview",
      "target_timeline_json",
      "pipeline_summary",
    ]);
    const artifacts = (artifactResponse?.artifacts || []).filter((artifact) => (
      artifact.exists && artifact.url && resultKeys.has(artifact.key)
    ));
    const withBlobs = await Promise.all(artifacts.map(async (artifact) => ({
      ...artifact,
      blob: await kickclipApi.downloadAuthenticatedMedia(artifact.url, { signal }),
    })));
    return { timeline, artifacts: withBlobs };
  }

  async function getCompletedTrackingPreview(jobId, { signal } = {}) {
    if (!jobId) throw new Error("불러올 트래킹 작업 ID가 없습니다.");
    const [job, artifactResponse] = await Promise.all([
      kickclipApi.getTrackingJob(jobId, { signal }),
      kickclipApi.getTrackingArtifacts(jobId, { signal }),
    ]);
    const previewKeys = new Set(["target_centered_preview", "tracking_preview"]);
    const previewArtifacts = (artifactResponse?.artifacts || []).filter(
      (artifact) => artifact.exists && artifact.url && previewKeys.has(artifact.key),
    );
    const artifacts = await Promise.all(previewArtifacts.map(async (artifact) => ({
      ...artifact,
      blob: await kickclipApi.downloadAuthenticatedMedia(artifact.url, { signal }),
    })));
    return { job, artifacts };
  }

  async function confirmTrackingAmbiguity({ jobId, ambiguityId, review, signal }) {
    if (!jobId || !ambiguityId || !review?.state) {
      throw new Error("추가 선수 확인 정보를 찾을 수 없습니다.");
    }
    return kickclipApi.reviewTrackingAmbiguityCandidate(
      jobId,
      ambiguityId,
      {
        ...buildCandidateReviewPayload(review),
        idempotency_key: stableReviewIdempotencyKey({
          jobId,
          ambiguityId,
          state: review.state,
          candidateId: review.candidateId,
        }),
      },
      { signal },
    );
  }

  async function includeTrackingHighlightCandidate({ jobId }) {
    if (!projectId || !jobId) {
      throw new Error("하이라이트 후보로 등록할 트래킹 작업 정보가 없습니다.");
    }
    const candidate = await kickclipApi.includeTrackingHighlightCandidate(
      projectId,
      jobId,
    );
    if (!candidate.eligible_for_clip_plan) return candidate;

    let clipPlanId = candidate.clip_plan_id || null;
    if (!clipPlanId) {
      const plan = await kickclipApi.createHighlightClipPlan(projectId, {
        revision_id: candidate.revision_id,
        allow_absent_full_frame: false,
      });
      clipPlanId = plan.clip_plan_id;
    }
    if (clipPlanId) {
      trackingAwareClipPlanIdsRef.current.add(clipPlanId);
      setCurrentClipPlanId(clipPlanId);
    }
    await hydrateProjectEditState(projectId, { quiet: true });
    return { ...candidate, clip_plan_id: clipPlanId };
  }

  async function ensureClipPlan() {
    if (!projectId) return null;

    const playerEvents = mode === "player"
      ? apiEvents.filter((event) => event.playerIds.includes(selectedPlayerId))
      : apiEvents;
    const sourceEvents = selectedEvents.length ? selectedEvents : playerEvents.slice(0, 3);
    const items = mode === "match" && sessionDraftClips.length
      ? clipPlanItemsFromSessionClips(sessionDraftClips)
      : clipPlanItemsFromEvents(sourceEvents, agentDurations);
    const targetDurationSec = items.reduce(
      (sum, item) => sum + Math.max(0, item.end_sec - item.start_sec),
      0,
    );
    const summary = mode === "match" && sessionDraftClips.length
      ? "대화형 편집 세션에서 구성한 하이라이트"
      : agentSummary || "직접 선택한 하이라이트";
    const currentPlan = projectEditState?.clipPlans?.find(
      (plan) => plan.clip_plan_id === currentClipPlanId,
    );
    const trackingAwarePlan = trackingAwareClipPlanIdsRef.current.has(currentClipPlanId)
      || (currentPlan && (
        currentPlan.mode === "TRACKING_AWARE_AGENT"
        || currentPlan.options?.render_provenance?.tracking_job_ids?.length > 0
      ));

    // Server-generated tracking transforms must survive export option changes.
    if (currentClipPlanId && trackingAwarePlan) return currentClipPlanId;

    // 구성본이 비어 있는 채로 진행하면 아래 폴백(이벤트 앞 3개)이 구성본과 무관한
    // 렌더를 만들어버리므로, match 모드에서는 구성본 없이는 계획을 만들지 않는다.
    if (mode === "match" && !sessionDraftClips.length) {
      throw new Error("하이라이트 구성본이 비어 있어 렌더링할 수 없습니다. 편집 화면에서 클립을 담아주세요.");
    }

    if (currentClipPlanId && items.length) {
      await kickclipApi.updateClipPlan(currentClipPlanId, {
        mode: "MANUAL",
        summary,
        target_duration_sec: targetDurationSec,
        options: { ...(currentPlan?.options || {}), ratio: exportRatio },
        items,
      });
      await hydrateProjectEditState(projectId, { quiet: true });
      return currentClipPlanId;
    }
    if (currentClipPlanId) return currentClipPlanId;
    if (!items.length) throw new Error("렌더링할 하이라이트 장면이 없습니다.");

    const plan = await kickclipApi.createClipPlan(buildManualClipPlanPayload(projectId, {
      summary,
      targetDurationSec,
      ratio: exportRatio,
      items,
    }));
    setCurrentClipPlanId(plan.clip_plan_id);
    await hydrateProjectEditState(projectId, { quiet: true });
    return plan.clip_plan_id;
  }

  async function saveExportOptions(options) {
    const clipPlanId = await ensureClipPlan();
    if (!clipPlanId) throw new Error("렌더링할 ClipPlan을 만들 수 없습니다.");
    await kickclipApi.updateExportOptions(clipPlanId, options);
    return clipPlanId;
  }

  async function createRender(options) {
    if (renderBusy) return null;
    setRenderBusy(true);
    try {
      const clipPlanId = await saveExportOptions(options);
      const render = await kickclipApi.createRender({ clip_plan_id: clipPlanId, options });
      await hydrateProjectEditState(projectId, { quiet: true });
      pollRender(render.render_job_id, projectId);
      showToast("렌더링을 시작했습니다.");
      return render;
    } finally {
      setRenderBusy(false);
    }
  }

  async function pollRender(renderJobId, targetProjectId) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const job = await kickclipApi.getRender(renderJobId);
        await hydrateProjectEditState(targetProjectId, { quiet: true });
        if (isTerminalRenderStatus(job.status)) return;
      } catch (error) {
        return;
      }
    }
  }

  async function downloadRender(renderJobId) {
    try {
      const { blob, filename } = await kickclipApi.downloadRender(renderJobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showToast(error?.detail || "완료 영상을 다운로드하지 못했습니다.");
    }
  }

  async function runExportAssistant({ message, currentSettings, conversation }) {
    if (!projectId) throw new Error("하이라이트를 먼저 불러와주세요.");
    let clipPlanId = null;
    try {
      clipPlanId = await ensureClipPlan();
    } catch (error) {
      if (!matchId) throw error;
    }
    return kickclipApi.invokeExportAssistant({
      message,
      clip_plan_id: clipPlanId || null,
      match_id: clipPlanId ? null : matchId,
      language: "ko",
      current_settings: currentSettings,
      conversation,
    });
  }

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [route.name, route.matchId, route.projectId]);

  useEffect(() => {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    writeStorage("kickclip-theme", nextTheme);
  }, [theme]);

  useEffect(() => {
    if (route.name === "home" && currentUser) refreshRecentProjects();
    if (route.name === "recent-projects") refreshRecentProjects();
    if (route.name === "match-projects") loadMatchProjects(route.matchId);
    if (route.name === "project-edit" || route.name === "project-export") {
      const loadedProjectId = projectEditState?.project?.project_id;
      if (loadedProjectId !== route.projectId) {
        resetEditorInteraction();
        hydrateProjectEditState(route.projectId);
      }
    }
  }, [route.name, route.matchId, route.projectId, currentUser, refreshRecentProjects, loadMatchProjects, hydrateProjectEditState]);

  useEffect(() => {
    const isProjectWorkflowRoute = route.name === "project-edit" || route.name === "project-export";
    if (
      !isProjectWorkflowRoute
      || projectEditState?.project?.project_id !== route.projectId
      || sessionIdRef.current
      || sessionStartPromiseRef.current
    ) {
      return;
    }
    if (highlightDraft) {
      if (route.name === "project-edit") setEditView("editor");
      if (mode === "match") startEditSession();
      return;
    }
    if (route.name === "project-edit") openMode("match");
  }, [route.name, route.projectId, projectEditState?.project?.project_id, highlightDraft, mode]);

  // Action Spotting이 끝나면 편집 세션을 자동으로 다시 시작한다 (최대 5분 폴링).
  useEffect(() => {
    if (!sessionWaitingForAnalysis || route.name !== "project-edit" || mode !== "match") {
      return undefined;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (sessionIdRef.current) {
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      if (attempts > 60) {
        window.clearInterval(timer);
        setSessionWaitingForAnalysis(false);
        showToast("분석이 예상보다 오래 걸리고 있어요. 잠시 후 페이지를 새로고침해주세요.");
        return;
      }
      startEditSession();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [sessionWaitingForAnalysis, route.name, mode]);

  useEffect(() => {
    if (route.name !== "recent-projects") return undefined;
    const hasRunningAnalysis = workspaceMatches.some((match) => {
      const status = String(match.analysis_status || "").toUpperCase();
      return status && !["COMPLETED", "FAILED", "CANCELLED"].includes(status);
    });
    if (!hasRunningAnalysis) return undefined;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const matches = await kickclipApi.getMatches();
        if (!cancelled) setWorkspaceMatches(Array.isArray(matches) ? matches : []);
      } catch {
        // Keep the last persisted snapshot visible while a background refresh fails.
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [route.name, workspaceMatches]);

  useEffect(() => {
    const item = route.matchId ? analysisByMatch[route.matchId] : null;
    if (!item?.jobId) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const job = await kickclipApi.getAnalysisJob(item.jobId);
        if (cancelled) return;
        const progress = Number(job.progress || 0);
        const status = String(job.status || "").toLowerCase();
        setAnalysisByMatch((items) => ({
          ...items,
          [route.matchId]: { jobId: item.jobId, status: status === "failed" ? `분석 실패 · ${job.error_message || "다시 시도해주세요."}` : `경기 분석 ${progress}% · ${job.current_step || job.status}` },
        }));
        if (["completed", "failed"].includes(status) || progress >= 100) window.clearInterval(timer);
      } catch (error) {
        window.clearInterval(timer);
      }
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [route.matchId, analysisByMatch[route.matchId]?.jobId]);

  useEffect(() => {
    let cancelled = false;
    function expireSession() {
      if (cancelled) return;
      setCurrentUser(null);
      setAuthMode("login");
      navigate({ name: "home" }, { replace: true });
    }
    window.addEventListener("kickclip:auth-expired", expireSession);
    if (kickclipApi.hasAuthSession()) {
      kickclipApi.me().then((user) => {
        if (!cancelled) setCurrentUser(toFrontendUser(user));
      }).catch(() => {
        kickclipApi.clearAuthSession();
        expireSession();
      });
    }
    return () => {
      cancelled = true;
      window.removeEventListener("kickclip:auth-expired", expireSession);
    };
  }, [navigate]);

  if (!currentUser) return <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={login} onSignup={signup} />;
  if (route.name === "home") {
    return (
      <Landing
        user={currentUser}
        onOpenProjects={() => navigate({ name: "recent-projects" })}
        onLogout={logout}
      />
    );
  }

  const canRenderProject = !projectLoading && !projectError && projectEditState;
  const usesProjectsTheme = ["projects", "upload", "match-projects", "edit", "preview"].includes(screen);
  return (
    <>
      <div className={`app ${usesProjectsTheme ? "projects-app" : ""}`}>
        {usesProjectsTheme ? <div className="projects-neon-glow" aria-hidden="true" /> : null}
        <main className="main">
          <TopBar user={currentUser} onHome={() => navigate({ name: "home" })} onOpenProjects={() => navigate({ name: "recent-projects" })} onLogout={logout} theme={theme} setTheme={setTheme} variant={usesProjectsTheme ? "projects" : "default"} />
          {!usesProjectsTheme ? (
            <Steps
              screen={screen}
              hasProject={Boolean(projectId)}
              onUpload={() => navigate({ name: "upload" })}
              onProjects={() => matchId ? navigate({ name: "match-projects", matchId }) : navigate({ name: "recent-projects" })}
              onEdit={() => projectId && navigate({ name: "project-edit", projectId })}
              onExport={() => projectId && navigate({ name: "project-export", projectId })}
            />
          ) : null}
          <ProjectsScreen
            active={screen === "projects"}
            matches={workspaceMatches}
            loading={projectsLoading}
            error={projectsError}
            startUpload={() => navigate({ name: "upload" })}
            lastUploadedMatchId={lastUploadedMatchId}
            openMatch={(id) => navigate({ name: "match-projects", matchId: id })}
            onReload={refreshRecentProjects}
          />
          <UploadScreen active={screen === "upload"} onUpload={handleUpload} />
          <MatchProjectsScreen
            active={screen === "match-projects"}
            matchId={route.matchId}
            match={selectedMatch}
            projects={matchProjects}
            uploadContext={uploadContexts[route.matchId]}
            loading={matchProjectsLoading}
            error={matchProjectsError}
            analysisStatus={analysisByMatch[route.matchId]?.status || ""}
            onReload={() => loadMatchProjects(route.matchId)}
            onBack={() => navigate({ name: "recent-projects" })}
            onOpenProject={(id) => navigate({ name: "project-edit", projectId: id })}
            onCreateProject={createProjectForMatch}
          />
          {(screen === "edit" || screen === "preview") && projectLoading ? <div className="route-state"><span className="route-spinner"></span><h2>하이라이트 편집 상태를 불러오는 중입니다</h2></div> : null}
          {(screen === "edit" || screen === "preview") && !projectLoading && projectError ? (
            <div className="route-state error" role="alert"><span>!</span><h2>{projectError}</h2><p>URL을 확인하거나 최근 하이라이트에서 다시 선택해주세요.</p><button className="button primary" type="button" onClick={() => navigate({ name: "recent-projects" })}>내 작업</button></div>
          ) : null}
          {canRenderProject ? (
            <EditScreen
              active={screen === "edit"} editView={editView} setEditView={setEditView} mode={mode} openMode={openMode}
              selectedPlayerId={selectedPlayerId} setSelectedPlayerId={setSelectedPlayerId}
              eventFilter={eventFilter} setEventFilter={setEventFilter} focusedEventId={focusedEventId} setFocusedEventId={setFocusedEventId}
              agentSelectionIds={agentSelectionIds} setAgentSelectionIds={setAgentSelectionIds} agentDurations={agentDurations} setAgentDurations={setAgentDurations}
              agentSummary={agentSummary} setAgentSummary={setAgentSummary} resolvedProfiles={resolvedProfiles} setResolvedProfiles={setResolvedProfiles}
              setScreen={(next) => {
                if (next === "preview") openExport();
                if (next === "match-projects" && matchId) navigate({ name: "match-projects", matchId });
              }} selectedMusic={selectedMusic} setSelectedMusic={setSelectedMusic}
              captionsEnabled={captionsEnabled} setCaptionsEnabled={setCaptionsEnabled} showToast={showToast} uploadedVideo={uploadedVideo}
              events={apiEvents} players={apiPlayers} match={projectEditState?.match} matchId={matchId} projectId={projectId} requestAgentClipPlan={requestAgentClipPlan}
              resolvePlayerProfile={resolvePlayerProfile} assistantInput={assistantInput} setAssistantInput={setAssistantInput}
              assistantMessages={assistantMessages} setAssistantMessages={setAssistantMessages} sessionId={sessionId}
              sessionVideoUrl={sessionVideoUrl} sessionAllEvents={sessionAllEvents} sessionCurrentClips={sessionCurrentClips}
              onSessionDraftChange={setSessionDraftClips}
              onAddSessionClip={addSessionClipToHighlight}
              sessionLoading={sessionLoading} sendSessionChat={sendSessionChat} isMockData={false}
              prepareTrackingCandidates={prepareTrackingCandidates}
              resumeTrackingCandidatesAfterBoundaryReview={resumeTrackingCandidatesAfterBoundaryReview}
              getShotBoundaryReview={getShotBoundaryReview}
              prepareNewShotBoundaryReview={prepareNewShotBoundaryReview}
              saveShotBoundaryDraft={saveShotBoundaryDraft}
              resetShotBoundaryDraft={resetShotBoundaryDraft}
              confirmShotBoundaryReview={confirmShotBoundaryReview}
              retryShotBoundaryDetections={retryShotBoundaryDetections}
              downloadShotBoundaryMedia={downloadShotBoundaryMedia}
              downloadCandidateReviewMedia={downloadCandidateReviewMedia}
              prepareReplacementTrackingCandidates={prepareReplacementTrackingCandidates}
              retryCandidatePreparation={retryCandidatePreparation}
              createCandidateSelection={createCandidateSelection}
              createCandidateTracking={createCandidateTracking}
              getTrackingJobState={getTrackingJobState}
              getTrackingDiagnostics={getTrackingDiagnostics}
              getTrackingResult={getTrackingResult}
              getCompletedTrackingPreview={getCompletedTrackingPreview}
              getTrackingReview={getTrackingReview}
              submitTrackingReview={submitTrackingReview}
              confirmTrackingAmbiguity={confirmTrackingAmbiguity}
              includeTrackingHighlightCandidate={includeTrackingHighlightCandidate}
              editState={projectEditState}
              onSaveDraft={saveHighlightDraft}
              draftSaveBusy={draftSaveBusy}
              draftUpdatedAt={highlightDraft?.updated_at || null}
              hasUnsavedDraftChanges={hasUnsavedDraftChanges}
            />
          ) : null}
          {canRenderProject ? (
            <PreviewScreen
              active={screen === "preview"} selectedEvents={selectedEvents} agentDurations={agentDurations} captionsEnabled={captionsEnabled}
              exportRatio={exportRatio} setExportRatio={setExportRatio} selectedMusic={selectedMusic} setSelectedMusic={setSelectedMusic}
              setCaptionsEnabled={setCaptionsEnabled} uploadedVideo={sessionVideoUrl || uploadedVideo} showToast={showToast}
              onRunExportAssistant={runExportAssistant} uploadedVideoDuration={uploadedVideoDuration}
              draftDuration={sessionDraftClips.reduce((sum, clip) => sum + clip.durationSec, 0)}
              draftClips={sessionDraftClips}
              onBackToEdit={() => projectId && navigate({ name: "project-edit", projectId })}
              mode={mode || "match"} assistantInput={assistantInput} setAssistantInput={setAssistantInput}
              assistantMessages={assistantMessages} setAssistantMessages={setAssistantMessages}
              renderJobs={renderJobs} renderBusy={renderBusy} onCreateRender={createRender}
              onDownloadRender={downloadRender}
            />
          ) : null}
        </main>
      </div>
      <Toast message={toast} />
    </>
  );
}

export default App;
