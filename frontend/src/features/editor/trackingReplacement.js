import { toApiUrl } from "../../api/kickclipApi.js";
import { MAX_CROSS_SHOT_REVIEW_CANDIDATES } from "./trackingR1State.js";

export const REPLACEMENT_PLAYER_REQUEST = "선택 장면에서 다른 선수 후보를 찾아줘";

export function highlightRevisionId(response) {
  return response?.revision_id || response?.revision?.revision_id || null;
}

export function trackingStatusValue(status, sceneStatus) {
  return String(
    sceneStatus?.tracking_status
      || sceneStatus?.status
      || status?.revision?.status
      || "",
  ).toUpperCase();
}

export function trackingPendingActionValue(status, job) {
  const action = job?.pending_action ?? status?.pending_action;
  if (typeof action === "string") return action.toUpperCase();
  return String(
    action?.action
      || action?.type
      || action?.kind
      || action?.status
      || "",
  ).toUpperCase();
}

export function isCrossShotConfirmation(status, job) {
  return trackingPendingActionValue(status, job) === "CROSS_SHOT_CONFIRMATION";
}

export function selectTrackingSceneStatus(sceneStatuses = [], { sceneId, eventId } = {}) {
  const exactScene = sceneId
    ? sceneStatuses.find((item) => item.scene_id === sceneId)
    : null;
  if (exactScene) return exactScene;

  const exactEvent = eventId
    ? sceneStatuses.find((item) => (
      item.event_id === eventId
      || item.timeline_event_id === eventId
    ))
    : null;
  if (exactEvent) return exactEvent;
  return sceneStatuses.length === 1 ? sceneStatuses[0] : null;
}

export function trackingAmbiguityDetails(job) {
  const pending = typeof job?.pending_action === "object" && job.pending_action
    ? job.pending_action
    : {};
  const pendingAmbiguityId = job?.pending_ambiguity_id
    || pending.ambiguity_id
    || job?.next_ambiguity?.ambiguity_id
    || null;
  const ambiguities = Array.isArray(job?.ambiguities) ? job.ambiguities : [];
  const active = pendingAmbiguityId
    ? ambiguities.find((item) => (
      (item.ambiguity_id || item.id) === pendingAmbiguityId
    )) || {}
    : {};
  const pendingMatches = !pending.ambiguity_id || pending.ambiguity_id === pendingAmbiguityId;
  const nextAmbiguity = job?.next_ambiguity?.ambiguity_id === pendingAmbiguityId
    ? job.next_ambiguity
    : {};
  const rawCandidates = nextAmbiguity.candidates
    || (pendingMatches ? pending.candidates : null)
    || job?.pending_candidates
    || active.candidates
    || [];
  const candidateIds = nextAmbiguity.candidate_ids
    || (pending.candidate_ids && pendingMatches ? pending.candidate_ids : active.candidate_ids)
    || rawCandidates.map((candidate) => (
      typeof candidate === "string" ? candidate : candidate.candidate_id || candidate.id
    )).filter(Boolean);

  return {
    ambiguityId: pendingAmbiguityId,
    pendingAmbiguityId,
    currentAmbiguityId: nextAmbiguity.ambiguity_id || active.ambiguity_id
      || active.id
      || (pending.ambiguity_id === pendingAmbiguityId ? pendingAmbiguityId : null),
    candidateIds,
    candidates: rawCandidates,
    status: nextAmbiguity.status || active.status || pending.status || null,
    message: pending.message || active.message || "",
    fullFrameContextUrl: toApiUrl(pending.full_frame_context_url || active.full_frame_context_url || ""),
    shotClipUrl: toApiUrl(pending.shot_clip_url || active.shot_clip_url || ""),
    fullFrameContextSha256: nextAmbiguity.full_frame_context_sha256 || pending.full_frame_context_sha256 || active.full_frame_context_sha256 || "",
    shotClipSha256: nextAmbiguity.shot_clip_sha256 || pending.shot_clip_sha256 || active.shot_clip_sha256 || "",
  };
}

export function isResolvedCrossShotAmbiguity(details = {}) {
  return new Set([
    "ALL_CANDIDATES_REJECTED",
    "RESOLVED_REJECTED_BATCH",
    "RESOLVED",
    "TARGET_ABSENT",
  ]).has(String(details.status || "").toUpperCase());
}

export function crossShotWaitingContractViolation(job, activeCandidates = []) {
  const status = String(job?.status || "").toUpperCase();
  if (status !== "WAITING_CROSS_SHOT_CONFIRMATION") return false;
  const details = trackingAmbiguityDetails(job);
  return Boolean(
    !details.pendingAmbiguityId
    || isResolvedCrossShotAmbiguity(details)
    || activeCandidates.length === 0,
  );
}

export function candidateReviewMatchesPending(job, ambiguityId) {
  const pendingAmbiguityId = job?.pending_ambiguity_id
    || (job?.pending_action && typeof job.pending_action === "object"
      ? job.pending_action.ambiguity_id
      : null);
  return Boolean(
    ambiguityId
    && pendingAmbiguityId
    && ambiguityId === pendingAmbiguityId,
  );
}

export function trackingJobProvenance(job = {}) {
  return {
    trackingJobId: job.tracking_job_id || job.job_id || null,
    selectionId: job.selection_id || null,
    selectedCandidateId: job.selected_candidate_id || null,
    anchorFrame: job.selected_reference_frame ?? job.anchor_frame ?? null,
    pendingAmbiguityId: job.pending_ambiguity_id
      || (job.pending_action && typeof job.pending_action === "object"
        ? job.pending_action.ambiguity_id
        : null)
      || null,
    backendStatus: job.status || null,
  };
}

export function selectedTargetGalleryUrls(job = {}) {
  const raw = job.selected_target_reference_gallery_urls
    || job.target_reference_gallery_urls
    || job.selected_target_reference_gallery_url
    || job.target_reference_gallery_url
    || job.selected_reference_gallery_url
    || job.selected_target?.media?.reference_gallery_url
    || job.selected_target?.reference_gallery_url
    || [];
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).slice(0, 3).map(toApiUrl);
}

function candidateFrameUrls(candidate) {
  const rawFrames = candidate?.frame_image_urls
    || candidate?.frame_urls
    || candidate?.image_urls
    || candidate?.frames
    || [];
  return (Array.isArray(rawFrames) ? rawFrames : [])
    .map((frame) => (
      typeof frame === "string"
        ? frame
        : frame?.image_url || frame?.url || frame?.thumbnail_url || ""
    ))
    .filter(Boolean)
    .map(toApiUrl);
}

export function normalizeCrossShotCandidates(details, fallbackCandidates = []) {
  const inactiveStatuses = new Set([
    "EXCLUDED",
    "CONFIRMED",
    "UNREVIEWABLE_LOW_RESOLUTION",
    "EXCLUDED_BY_USER_NONE_OF_THESE",
    "EXCLUDED_BY_USER_NON_PLAYER_ROLE",
  ]);
  const richCandidates = new Map();
  [...(fallbackCandidates || []), ...(details?.candidates || [])].forEach((candidate) => {
    if (!candidate || typeof candidate === "string") return;
    const candidateId = candidate.candidate_id || candidate.id;
    if (!candidateId) return;
    richCandidates.set(candidateId, {
      ...(richCandidates.get(candidateId) || {}),
      ...candidate,
    });
  });

  const orderedIds = details?.candidateIds?.length
    ? details.candidateIds
    : (details?.candidates || [])
      .map((candidate) => (
        typeof candidate === "string" ? candidate : candidate?.candidate_id || candidate?.id
      ))
      .filter(Boolean);

  const seenCandidateIds = new Set();
  const seenTracklets = new Set();
  const normalized = [];

  for (const candidateId of orderedIds) {
    if (seenCandidateIds.has(candidateId)) continue;
    seenCandidateIds.add(candidateId);

    const source = richCandidates.get(candidateId) || {};
    if (inactiveStatuses.has(String(source.status || "PENDING").toUpperCase())) continue;

    // One review card represents one tracklet. If the runtime accidentally
    // repeats the same tracklet under multiple candidate IDs, keep the first
    // ranked representative instead of asking the user to review duplicates.
    const trackletKey = source.tracklet_id || source.trackletId || null;
    if (trackletKey && seenTracklets.has(trackletKey)) continue;
    if (trackletKey) seenTracklets.add(trackletKey);

    const frameImageUrls = candidateFrameUrls(source).slice(0, 3);
    const representativeImage = toApiUrl(
      source.imageUrl
      || source.thumbnail_url
      || source.representative_image_url
      || source.media?.best_crop_display_url
      || source.review_bundle?.best_crop_display_url
      || "",
    );
    if (!frameImageUrls.length && representativeImage) frameImageUrls.push(representativeImage);

    const reviewMedia = {
      fullFrameContextUrl: toApiUrl(source.media?.full_frame_context_url || source.review_bundle?.full_frame_context_url || source.full_frame_context_url || ""),
      bestCropDisplayUrl: toApiUrl(source.media?.best_crop_display_url || source.review_bundle?.best_crop_display_url || source.best_crop_display_url || representativeImage),
      bestCropNativeUrl: toApiUrl(source.media?.best_crop_native_url || source.review_bundle?.best_crop_native_url || source.best_crop_native_url || ""),
      firstMiddleLastUrl: toApiUrl(source.media?.first_middle_last_url || source.review_bundle?.first_middle_last_url || source.first_middle_last_url || ""),
      trackletVideoUrl: toApiUrl(source.media?.tracklet_video_url || source.review_bundle?.tracklet_video_url || source.tracklet_video_url || ""),
    };

    normalized.push({
      ...source,
      id: candidateId,
      candidate_id: candidateId,
      rank: source.rank ?? normalized.length + 1,
      score: source.score ?? source.matching_score ?? source.match_score ?? source.confidence ?? null,
      frameImageUrls,
      representativeImageUrl: reviewMedia.bestCropDisplayUrl || frameImageUrls[0] || representativeImage,
      reviewMedia,
    });

    if (normalized.length >= MAX_CROSS_SHOT_REVIEW_CANDIDATES) break;
  }

  return normalized;
}

export function trackingScoreLabel(candidate) {
  const value = candidate?.score;
  if (value === undefined || value === null || value === "") return "매칭 점수 미제공";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "매칭 점수 미제공";
  return numeric <= 1 ? `${(numeric * 100).toFixed(1)}%` : String(numeric);
}

export function trackingConfidenceLabel(candidate) {
  const value = candidate?.confidence ?? candidate?.trackability_score;
  if (value === undefined || value === null || value === "") return "신뢰도 정보 없음";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "신뢰도 정보 없음";
  const percentage = Math.round(numeric <= 1 ? numeric * 100 : numeric);
  return `신뢰도 ${Math.max(0, Math.min(100, percentage))}%`;
}

export function shouldAutomaticallyPrepareReplacement(statusValue, locallyRejected) {
  void statusValue;
  void locallyRejected;
  return false;
}

export function beginReplacementRequest(requestRef) {
  if (requestRef.current) return false;
  requestRef.current = true;
  return true;
}

export function allowReplacementRetry(requestRef) {
  requestRef.current = false;
}

export function buildTrackingSelectionPayload({ revisionId, sceneId, candidate }) {
  return {
    revision_id: revisionId,
    display_name: candidate.displayName || candidate.display_label || "선택 선수",
    anchor_scene_id: sceneId || candidate.scene_id,
    candidate_id: candidate.candidate_id,
  };
}

export function normalizeTrackingCandidates(candidateResponse, sceneId) {
  return (candidateResponse?.candidates || [])
    .filter((candidate) => !candidate.scene_id || candidate.scene_id === sceneId)
    .map((candidate) => ({
      ...candidate,
      id: candidate.candidate_id,
      displayName: (candidate.display_label || candidate.number || candidate.jersey_number)
        ? (candidate.display_label || `${candidate.number ?? candidate.jersey_number}번 선수`)
        : "미확인 선수",
      imageUrl: toApiUrl(candidate.thumbnail_url || candidate.representative_image_url || ""),
    }));
}

export async function prepareReplacementTrackingCandidatesWorkflow({
  api,
  projectId,
  sourceRevisionId,
  sceneId,
  waitForHighlightStatus,
  signal,
}) {
  if (!projectId) throw new Error("하이라이트 작업 ID가 없습니다.");
  if (!sourceRevisionId) throw new Error("거절된 트래킹의 revision 정보를 찾을 수 없습니다.");
  if (!sceneId) throw new Error("다시 선수를 찾을 장면 정보를 찾을 수 없습니다.");

  const forkResponse = await api.startHighlightPlayerFocus(projectId, {
    revision_id: sourceRevisionId,
    request: REPLACEMENT_PLAYER_REQUEST,
  }, { signal });
  const forkRevisionId = highlightRevisionId(forkResponse);
  const readyStatus = await waitForHighlightStatus(
    (status) => (
      String(status?.revision?.status || "").toUpperCase() === "PLAYER_SELECTION_REQUIRED"
      && (!forkRevisionId || highlightRevisionId(status) === forkRevisionId)
    ),
  );
  const candidateResponse = await api.getHighlightPlayerCandidates(projectId, { signal });
  const candidates = normalizeTrackingCandidates(candidateResponse, sceneId);
  if (!candidates.length) throw new Error("이 장면에서 선택할 수 있는 다른 선수 후보를 찾지 못했습니다.");

  const revisionId = highlightRevisionId(candidateResponse)
    || highlightRevisionId(readyStatus)
    || forkRevisionId;
  if (!revisionId || revisionId === sourceRevisionId) {
    throw new Error("다른 선수를 선택할 새 revision을 확인하지 못했습니다.");
  }

  return { revisionId, sceneId, candidates };
}
