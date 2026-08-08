import { buildEventCandidateRankingRequest } from "../domain/eventCandidateRanking.js";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const AUTH_SESSION_STORAGE_KEY = "kickclip-auth-session";

export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");

// Defense-in-depth for authenticated media.  Even if a component accidentally
// requests every evidence asset for every candidate, the browser may only have
// four authenticated media transfers in flight at once.
export const AUTHENTICATED_MEDIA_CONCURRENCY_POLICY = "P2_3_BOUNDED_4";
const AUTHENTICATED_MEDIA_MAX_CONCURRENT = 4;
let authenticatedMediaActive = 0;
const authenticatedMediaQueue = [];

function mediaAbortError() {
  return new DOMException("Media request cancelled.", "AbortError");
}

function drainAuthenticatedMediaQueue() {
  while (
    authenticatedMediaActive < AUTHENTICATED_MEDIA_MAX_CONCURRENT
    && authenticatedMediaQueue.length
  ) {
    const entry = authenticatedMediaQueue.shift();
    if (!entry || entry.cancelled || entry.signal?.aborted) {
      entry?.reject?.(mediaAbortError());
      continue;
    }
    entry.started = true;
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
    authenticatedMediaActive += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        authenticatedMediaActive = Math.max(0, authenticatedMediaActive - 1);
        drainAuthenticatedMediaQueue();
      });
  }
}

function runAuthenticatedMediaLimited(task, signal) {
  if (signal?.aborted) return Promise.reject(mediaAbortError());
  return new Promise((resolve, reject) => {
    const entry = { task, signal, resolve, reject, started: false, cancelled: false, onAbort: null };
    if (signal) {
      entry.onAbort = () => {
        if (entry.started || entry.cancelled) return;
        entry.cancelled = true;
        const index = authenticatedMediaQueue.indexOf(entry);
        if (index >= 0) authenticatedMediaQueue.splice(index, 1);
        reject(mediaAbortError());
      };
      signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    authenticatedMediaQueue.push(entry);
    drainAuthenticatedMediaQueue();
  });
}

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, detail?: string, code?: string, data?: unknown}} [context]
   */
  constructor(message, { status, detail, code, data } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.data = data;
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function normalizeErrorDetail(detail) {
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (typeof item === "object" && item ? item.msg || item.message : item))
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof detail === "object" && detail) return detail.message || JSON.stringify(detail);
  return detail ? String(detail) : "";
}

function readAuthSession() {
  try {
    const value = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function saveAuthSession(session) {
  if (!session?.access_token || !session?.refresh_token || !session?.user) {
    throw new Error("로그인 응답에 필요한 인증 정보가 없습니다.");
  }
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

function clearAuthSession() {
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

function notifyAuthExpired() {
  window.dispatchEvent(new CustomEvent("kickclip:auth-expired"));
}

async function responseError(response) {
  const data = response.status === 204 ? null : await parseResponse(response);
  const rawDetail = typeof data === "object" && data ? data.detail : data;
  const detail = normalizeErrorDetail(rawDetail);
  const code = typeof rawDetail === "object" && rawDetail ? rawDetail.code : undefined;
  if (response.status === 409 && code && import.meta.env?.DEV) {
    console.error("[KickClip API 409]", { code, detail: rawDetail });
  }
  return new ApiError(code || detail || `API request failed: ${response.status}`, {
    status: response.status,
    detail,
    code,
    data,
  });
}

function xhrUploadWithProgress(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    const accessToken = readAuthSession()?.access_token;
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      let data;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (error) {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const rawDetail = typeof data === "object" && data ? data.detail : data;
      const detail = normalizeErrorDetail(rawDetail);
      reject(new ApiError(detail || `API request failed: ${xhr.status}`, { status: xhr.status, detail }));
    };

    xhr.onerror = () => reject(new ApiError("네트워크 오류로 업로드에 실패했습니다.", { status: 0 }));

    xhr.send(form);
  });
}

let refreshPromise = null;

async function refreshAuthSession() {
  if (refreshPromise) return refreshPromise;

  const session = readAuthSession();
  if (!session?.refresh_token) throw new ApiError("로그인이 만료되었습니다.", { status: 401 });

  refreshPromise = (async () => {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!response.ok) throw await responseError(response);
    return saveAuthSession(await parseResponse(response));
  })();

  try {
    return await refreshPromise;
  } catch (error) {
    clearAuthSession();
    notifyAuthExpired();
    throw error;
  } finally {
    refreshPromise = null;
  }
}

async function uploadWithProgress(path, form, onProgress) {
  try {
    return await xhrUploadWithProgress(path, form, onProgress);
  } catch (error) {
    if (error.status === 401) {
      const session = readAuthSession();
      if (session?.refresh_token) {
        await refreshAuthSession();
        return xhrUploadWithProgress(path, form, onProgress);
      }
      clearAuthSession();
      notifyAuthExpired();
    }
    throw error;
  }
}

function buildHeaders(options, authenticated) {
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && options.body !== null && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authenticated) {
    const accessToken = readAuthSession()?.access_token;
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

async function fetchWithAuth(path, options = {}, { authenticated = true, retry = true } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: buildHeaders(options, authenticated),
  });

  if (response.status === 401 && authenticated && retry) {
    const session = readAuthSession();
    if (session?.refresh_token) {
      await refreshAuthSession();
      return fetchWithAuth(path, options, { authenticated, retry: false });
    }
    clearAuthSession();
    notifyAuthExpired();
  }

  return response;
}

async function request(path, options = {}, requestOptions = {}) {
  const response = await fetchWithAuth(path, options, requestOptions);
  const data = response.status === 204 ? null : await parseResponse(response);

  if (!response.ok) {
    const rawDetail = typeof data === "object" && data ? data.detail : data;
    const detail = normalizeErrorDetail(rawDetail);
    const code = typeof rawDetail === "object" && rawDetail ? rawDetail.code : undefined;
    if (response.status === 409 && code && import.meta.env?.DEV) {
      console.error("[KickClip API 409]", { code, detail: rawDetail });
    }
    throw new ApiError(code || detail || `API request failed: ${response.status}`, {
      status: response.status,
      detail,
      code,
      data,
    });
  }

  return data;
}

function withQuery(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function sceneAiTaskPath(url) {
  if (!url) throw new TypeError("SceneAITask URL is required");
  const apiBase = new URL(API_BASE_URL);
  const parsed = new URL(url, `${API_BASE_URL}/`);
  if (parsed.origin !== apiBase.origin || !parsed.pathname.startsWith("/api/v1/scene-ai-tasks/")) {
    throw new TypeError("Untrusted SceneAITask URL");
  }
  return `${parsed.pathname}${parsed.search}`;
}

function candidateRecommendationPreparePath(url) {
  if (!url) throw new TypeError("Candidate recommendation prepare URL is required");
  const apiBase = new URL(API_BASE_URL);
  const parsed = new URL(url, `${API_BASE_URL}/`);
  if (
    parsed.origin !== apiBase.origin
    || !parsed.pathname.startsWith("/api/v1/projects/")
    || !parsed.pathname.endsWith("/candidate-recommendations/prepare")
  ) {
    throw new TypeError("Untrusted candidate recommendation prepare URL");
  }
  return `${parsed.pathname}${parsed.search}`;
}

function authenticatedApiPath(url) {
  if (!url) throw new TypeError("Authenticated media URL is required");
  if (String(url).startsWith("data:")) return String(url);
  const apiBase = new URL(API_BASE_URL);
  const parsed = new URL(url, `${API_BASE_URL}/`);
  if (parsed.origin !== apiBase.origin) throw new TypeError("Untrusted authenticated media URL");
  return `${parsed.pathname}${parsed.search}`;
}

export function toApiUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("blob:") || path.startsWith("data:")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const kickclipApi = {
  getStoredUser() {
    return readAuthSession()?.user || null;
  },

  hasAuthSession() {
    return Boolean(readAuthSession()?.access_token && readAuthSession()?.refresh_token);
  },

  clearAuthSession() {
    clearAuthSession();
  },

  async signup(payload) {
    const response = await request(
      "/api/v1/auth/signup",
      { method: "POST", body: JSON.stringify(payload) },
      { authenticated: false },
    );
    return saveAuthSession(response);
  },

  async login(payload) {
    const response = await request(
      "/api/v1/auth/login",
      { method: "POST", body: JSON.stringify(payload) },
      { authenticated: false },
    );
    return saveAuthSession(response);
  },

  me() {
    return request("/api/v1/auth/me");
  },

  async logout() {
    const refreshToken = readAuthSession()?.refresh_token;
    try {
      if (refreshToken) {
        await request(
          "/api/v1/auth/logout",
          { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) },
          { authenticated: false },
        );
      }
    } finally {
      clearAuthSession();
    }
  },

  health() {
    return request("/api/v1/health", {}, { authenticated: false });
  },

  createProject(matchId, payload) {
    return request(`/api/v1/matches/${encodeURIComponent(matchId)}/projects`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getRecentProjects(limit = 10) {
    return request(withQuery("/api/v1/projects/recent", { limit }));
  },

  getMatches() {
    return request("/api/v1/matches");
  },

  getProject(projectId) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  },

  getMatch(matchId) {
    return request(`/api/v1/matches/${encodeURIComponent(matchId)}`);
  },

  getMatchProjects(matchId) {
    return request(`/api/v1/matches/${encodeURIComponent(matchId)}/projects`);
  },

  uploadMatchVideo({ file, metadata = {}, onProgress }) {
    return uploadWithProgress("/api/v1/matches", buildMatchUploadForm(file, metadata), onProgress);
  },

  getProjectEditState(projectId) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/edit-state`);
  },

  getTimelineEvents(matchId, params = {}) {
    return request(withQuery(`/api/v1/matches/${encodeURIComponent(matchId)}/timeline-events`, params));
  },

  getPlayers(matchId) {
    return request(`/api/v1/matches/${encodeURIComponent(matchId)}/players`);
  },

  resolvePlayerProfile(payload) {
    return request("/api/v1/agent/player-profile/resolve", { method: "POST", body: JSON.stringify(payload) });
  },

  createAnalysisJob(matchId, payload = {}, params = {}) {
    return request(withQuery(`/api/v1/matches/${encodeURIComponent(matchId)}/analysis-jobs`, params), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getMatchAnalysisJobs(matchId) {
    return request(`/api/v1/matches/${encodeURIComponent(matchId)}/analysis-jobs`);
  },

  getAnalysisJob(jobId) {
    return request(`/api/v1/analysis-jobs/${encodeURIComponent(jobId)}`);
  },

  startHighlightAnalysis(projectId, payload, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/analyze`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  getHighlightStatus(projectId, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/status`, {
      signal: options.signal,
    });
  },

  getHighlightScenes(projectId, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/scenes`, {
      signal: options.signal,
    });
  },

  getHighlightDraft(projectId) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/draft`);
  },

  saveHighlightDraft(projectId, payload) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/draft`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteHighlightDraft(projectId) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/draft`, {
      method: "DELETE",
    });
  },

  selectHighlightScenes(projectId, payload, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/scenes/select`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  startHighlightPlayerFocus(projectId, payload, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/player-focus`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  getHighlightPlayerCandidates(projectId, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/player-candidates`, {
      signal: options.signal,
    });
  },

  getEventCandidateRecommendations(projectId, revisionId, eventId, sceneId, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/candidate-recommendations`,
      { scene_id: sceneId },
    ), { signal: options.signal });
  },

  prepareEventCandidateRecommendations(projectId, revisionId, eventId, sceneId, options = {}) {
    const canonicalPath = withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/candidate-recommendations/prepare`,
      { scene_id: sceneId },
    );
    return request(options.prepareUrl ? candidateRecommendationPreparePath(options.prepareUrl) : canonicalPath, {
      method: "POST",
      body: JSON.stringify({ shortlist_size: options.shortlistSize ?? 5 }),
      signal: options.signal,
    });
  },

  getShotBoundaryReview(projectId, revisionId, eventId, sceneId, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/shot-boundaries`,
      { scene_id: sceneId },
    ), { signal: options.signal });
  },

  prepareShotBoundaryReview(projectId, revisionId, eventId, sceneId, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/shot-boundaries/prepare`,
      {
        scene_id: sceneId,
        new_review_revision: options.newReviewRevision ? true : undefined,
      },
    ), { method: "POST", signal: options.signal });
  },

  updateShotBoundaryDraft(projectId, revisionId, eventId, sceneId, payload, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/shot-boundaries/draft`,
      { scene_id: sceneId },
    ), { method: "PUT", body: JSON.stringify(payload), signal: options.signal });
  },

  resetShotBoundaryDraft(projectId, revisionId, eventId, sceneId, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/shot-boundaries/reset`,
      { scene_id: sceneId },
    ), { method: "POST", signal: options.signal });
  },

  confirmShotBoundaryReview(projectId, revisionId, eventId, sceneId, payload, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/shot-boundaries/confirm`,
      { scene_id: sceneId },
    ), { method: "POST", body: JSON.stringify(payload), signal: options.signal });
  },

  retryShotBoundaryDetections(projectId, revisionId, eventId, sceneId, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/shot-boundaries/detections/retry`,
      { scene_id: sceneId },
    ), { method: "POST", signal: options.signal });
  },

  createEventCandidateSelection(projectId, revisionId, eventId, sceneId, payload, options = {}) {
    return request(withQuery(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/events/${encodeURIComponent(eventId)}/candidate-selections`,
      { scene_id: sceneId },
    ), {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  createSelectionTrackingJob(selectionId, payload, options = {}) {
    return request(`/api/v1/event-candidate-selections/${encodeURIComponent(selectionId)}/tracking-jobs`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  selectHighlightFocusSubject(projectId, payload, options = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/player-focus/select`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  confirmHighlightScenePlayer(projectId, sceneId, payload) {
    return request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/scenes/${encodeURIComponent(sceneId)}/player-confirmation`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  createEventCandidateRanking(projectId, revisionId, payload, options = {}) {
    const body = buildEventCandidateRankingRequest(payload);
    return request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/revisions/${encodeURIComponent(revisionId)}/event-candidate-rankings/v1.1.2a`,
      {
        method: "POST",
        body: JSON.stringify(body),
        signal: options.signal,
      },
    );
  },

  getSceneAiTask(statusUrl, options = {}) {
    return request(sceneAiTaskPath(statusUrl), { signal: options.signal });
  },

  retrySceneAiTask(retryUrl, options = {}) {
    return request(sceneAiTaskPath(retryUrl), {
      method: "POST",
      signal: options.signal,
    });
  },

  async downloadArtifact(artifactId, options = {}) {
    const response = await fetchWithAuth(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`,
      { signal: options.signal },
    );
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },

  createTrackingJob(payload) {
    return request("/api/v1/tracking/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** @param {{refresh?: boolean, signal?: AbortSignal}} [options] */
  getTrackingDiagnostics(options = {}) {
    return request(withQuery("/api/v1/tracking/diagnostics/scene-target-r3", {
      refresh: options.refresh ? "true" : undefined,
    }), { signal: options.signal });
  },

  getTrackingJob(jobId, options = {}) {
    return request(`/api/v1/tracking/jobs/${encodeURIComponent(jobId)}`, {
      signal: options.signal,
    });
  },

  getTrackingTimeline(jobId, params = {}, options = {}) {
    return request(withQuery(`/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/timeline`, params), {
      signal: options.signal,
    });
  },

  getTrackingArtifacts(jobId, options = {}) {
    return request(`/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/artifacts`, {
      signal: options.signal,
    });
  },

  getTrackingArtifactUrl(jobId, artifactKey) {
    return toApiUrl(`/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactKey)}`);
  },

  async downloadTrackingArtifact(jobId, artifactKey, options = {}) {
    const response = await fetchWithAuth(
      `/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactKey)}`,
      { signal: options.signal },
    );
    if (!response.ok) throw await responseError(response);
    return response.blob();
  },

  async downloadAuthenticatedMedia(url, options = {}) {
    if (String(url || "").startsWith("data:")) return null;
    return runAuthenticatedMediaLimited(async () => {
      const response = await fetchWithAuth(authenticatedApiPath(url), { signal: options.signal });
      if (!response.ok) throw await responseError(response);
      return response.blob();
    }, options.signal);
  },

  async downloadTrackingAmbiguityEvidence(jobId, ambiguityId, evidenceKind, options = {}) {
    if (!["full-frame-context", "full-shot-clip"].includes(evidenceKind)) {
      throw new TypeError("Unsupported tracking ambiguity evidence kind");
    }
    return runAuthenticatedMediaLimited(async () => {
      const response = await fetchWithAuth(
        `/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/ambiguities/${encodeURIComponent(ambiguityId)}/evidence/${evidenceKind}`,
        { signal: options.signal },
      );
      if (!response.ok) throw await responseError(response);
      return response.blob();
    }, options.signal);
  },

  async downloadTrackingCandidateMedia(jobId, ambiguityId, candidateId, mediaName, options = {}) {
    if (!["reference-gallery", "full-frame-context"].includes(mediaName)) {
      throw new TypeError("Unsupported tracking candidate media kind");
    }
    return runAuthenticatedMediaLimited(async () => {
      const response = await fetchWithAuth(
        `/api/v1/tracking/jobs/${encodeURIComponent(jobId)}`
        + `/ambiguities/${encodeURIComponent(ambiguityId)}`
        + `/candidates/${encodeURIComponent(candidateId)}`
        + `/media/${encodeURIComponent(mediaName)}`,
        { signal: options.signal },
      );
      if (!response.ok) throw await responseError(response);
      return response.blob();
    }, options.signal);
  },

  submitTrackingReview(jobId, payload, options = {}) {
    return request(`/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/reviews`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  },

  async reviewTrackingAmbiguityCandidate(jobId, ambiguityId, payload, options = {}) {
    const response = await fetchWithAuth(
      `/api/v1/tracking/jobs/${encodeURIComponent(jobId)}/ambiguities/${encodeURIComponent(ambiguityId)}/candidate-review`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        signal: options.signal,
      },
    );
    if (!response.ok) throw await responseError(response);
    return {
      data: response.status === 204 ? null : await parseResponse(response),
      httpStatus: response.status,
    };
  },

  createHighlightClipPlan(projectId, payload = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/clip-plan`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  includeTrackingHighlightCandidate(projectId, jobId) {
    return request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/highlight/tracking-jobs/${encodeURIComponent(jobId)}/candidate`,
      { method: "POST" },
    );
  },

  createHighlightRender(projectId, payload = {}) {
    return request(`/api/v1/projects/${encodeURIComponent(projectId)}/highlight/render`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getMediaAsset(assetId) {
    return request(`/api/v1/media/${encodeURIComponent(assetId)}`);
  },

  getMediaStreamUrl(assetId) {
    return toApiUrl(`/api/v1/media/${encodeURIComponent(assetId)}/stream`);
  },

  async getSignedMediaUrl(assetId) {
    const result = await request(`/api/v1/media/${encodeURIComponent(assetId)}/signed-url`);
    return toApiUrl(result.url);
  },

  getMediaDownloadUrl(assetId) {
    return toApiUrl(`/api/v1/media/${encodeURIComponent(assetId)}/download`);
  },

  createClipPlan(payload) {
    return request("/api/v1/clip-plans", { method: "POST", body: JSON.stringify(payload) });
  },

  getClipPlan(clipPlanId) {
    return request(`/api/v1/clip-plans/${encodeURIComponent(clipPlanId)}`);
  },

  updateClipPlan(clipPlanId, payload) {
    return request(`/api/v1/clip-plans/${encodeURIComponent(clipPlanId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },

  createAgentClipPlan(payload) {
    return request("/api/v1/agent/clip-plan", { method: "POST", body: JSON.stringify(payload) });
  },

  startSession(payload) {
    return request("/api/v1/session/start", { method: "POST", body: JSON.stringify(payload) });
  },

  chatSession(payload) {
    return request("/api/v1/session/chat", { method: "POST", body: JSON.stringify(payload) });
  },

  getSessionState(sessionId) {
    return request(`/api/v1/session/${encodeURIComponent(sessionId)}/state`);
  },

  recommendExportMetadata(payload) {
    return request("/api/v1/agent/export-metadata/recommend", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  invokeExportAssistant(payload) {
    return request("/api/v1/agent/export-assistant/invoke", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateExportOptions(clipPlanId, payload) {
    return request(`/api/v1/clip-plans/${encodeURIComponent(clipPlanId)}/export-options`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  createRender(payload) {
    return request("/api/v1/renders", { method: "POST", body: JSON.stringify(payload) });
  },

  getRender(renderJobId) {
    return request(`/api/v1/renders/${encodeURIComponent(renderJobId)}`);
  },

  getRenderDownloadUrl(renderJobId) {
    return toApiUrl(`/api/v1/renders/${encodeURIComponent(renderJobId)}/download`);
  },

  async downloadRender(renderJobId) {
    const response = await fetchWithAuth(`/api/v1/renders/${encodeURIComponent(renderJobId)}/download`);
    if (!response.ok) throw await responseError(response);
    const disposition = response.headers.get("content-disposition") || "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    return {
      blob: await response.blob(),
      filename: encodedName ? decodeURIComponent(encodedName) : plainName || `${renderJobId}.mp4`,
    };
  },
};

export function buildMatchUploadForm(file, metadata = {}) {
  const form = new FormData();
  form.append("file", file);
  const allowedFields = [
    "home_team",
    "away_team",
    "home_score",
    "away_score",
    "match_date",
    "competition",
    "season",
    "duration_sec",
    "metadata",
  ];
  allowedFields.forEach((key) => {
    const value = metadata[key];
    if (value === undefined || value === null || value === "") return;
    form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  });
  return form;
}
