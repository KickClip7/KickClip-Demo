import { toApiUrl } from "../../api/kickclipApi.js";

export const PROVENANCE_ERROR_CODE = "CANDIDATE_SELECTION_PROVENANCE_MISMATCH";
export const EXPECTED_RANKING_VERSION = "v1.2";
export const EXPECTED_ANCHOR_MODE = "SELECTED_CANDIDATE_BEST_REFERENCE";
export const CANDIDATE_REASON_LABELS = Object.freeze({
  PRODUCT_ACTION_ADJACENT_PRIORITY: "이벤트 직전 핵심 장면",
  PRODUCT_FIELD_SUPPORTED_PRIORITY: "경기 화면 후보",
  PRODUCT_PRE_EVENT_CONTEXT_PRIORITY: "이벤트 이전 후보",
  PRODUCT_EVENT_POST_CONTEXT_PRIORITY: "이벤트 이후 후보",
  // Legacy compatibility only. Under the P1.8 wide-only tracking contract,
  // CLOSEUP/MIXED candidates must not be selectable even if an old artifact
  // still contains this reason code.
  PRODUCT_CLOSEUP_ROLE_UNVERIFIED: "추적 제외 클로즈업",
});
export const CANDIDATE_REVIEW_STATES = Object.freeze([
  "SAME_PLAYER",
  "DIFFERENT_PLAYER",
  "UNREVIEWABLE_LOW_RESOLUTION",
  "TARGET_ABSENT",
  "NONE_OF_THESE",
  "NONE_OF_THESE_NON_PLAYER_ROLE",
]);

const MEDIA_KEYS = Object.freeze([
  "full_frame_context_url",
  "best_crop_native_url",
  "best_crop_display_url",
  "first_middle_last_url",
  "tracklet_video_url",
  "reference_gallery_url",
]);

const NON_WIDE_SCENE_MODES = new Set(["CLOSEUP", "MIXED"]);

export class CandidateProvenanceError extends Error {
  constructor(message = PROVENANCE_ERROR_CODE) {
    super(message);
    this.name = "CandidateProvenanceError";
    this.code = PROVENANCE_ERROR_CODE;
  }
}

function invariant(value, message) {
  if (!value) throw new CandidateProvenanceError(`${PROVENANCE_ERROR_CODE}: ${message}`);
}

function normalizedUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function candidateReasonCodes(candidate) {
  const direct = Array.isArray(candidate?.reason_codes) ? candidate.reason_codes : [];
  const shortlist = Array.isArray(candidate?.shortlist_patch_reason_codes)
    ? candidate.shortlist_patch_reason_codes
    : [];
  return [...new Set([...direct, ...shortlist].map((value) => String(value)))];
}

export function candidateSceneMode(candidate) {
  return normalizedUpper(
    candidate?.shot_mode
      || candidate?.scene_mode
      || candidate?.product_scene_context?.mode
      || candidate?.metadata?.product_scene_context?.mode
      || candidate?.context?.scene_mode,
  );
}

export function isNonWideCandidate(candidate) {
  const sceneMode = candidateSceneMode(candidate);
  if (NON_WIDE_SCENE_MODES.has(sceneMode)) return true;

  // Fail closed for legacy P1.7 artifacts that predate the explicit WIDE-only
  // candidate contract but still mark the candidate as a close-up role case.
  return candidateReasonCodes(candidate).includes("PRODUCT_CLOSEUP_ROLE_UNVERIFIED");
}

export function validateCandidateRecommendationResponse(response) {
  invariant(response && typeof response === "object", "response is missing");
  invariant(response.ranking_version === EXPECTED_RANKING_VERSION, "ranking_version must be v1.2");
  invariant(response.automatic_target_confirmation === false, "automatic_target_confirmation must be false");
  invariant(response.ranking_id, "ranking_id is missing");
  invariant(response.shortlist_patch_id, "shortlist_patch_id is missing");
  invariant(response.source_video_asset_id, "source_video_asset_id is missing");
  invariant(Array.isArray(response.candidates), "candidates must be an array");

  const ids = new Set();
  response.candidates.forEach((candidate) => {
    invariant(candidate?.ranking_version === EXPECTED_RANKING_VERSION, "candidate ranking_version mismatch");
    invariant(candidate.ranking_id === response.ranking_id, "candidate ranking_id mismatch");
    invariant(candidate.shortlist_patch_id === response.shortlist_patch_id, "candidate shortlist_patch_id mismatch");
    invariant(candidate.automatic_target_confirmation === false, "candidate automatic_target_confirmation must be false");
    invariant(candidate.candidate_id && !ids.has(candidate.candidate_id), "duplicate or missing candidate_id");
    ids.add(candidate.candidate_id);
    MEDIA_KEYS.forEach((key) => invariant(candidate.media?.[key], `${candidate.candidate_id} media.${key} is missing`));
  });
  return response;
}

export function normalizeCandidateRecommendations(response) {
  validateCandidateRecommendationResponse(response);
  return [...response.candidates]
    .sort((left, right) => left.shortlist_rank - right.shortlist_rank)
    .map((candidate) => ({
      ...candidate,
      id: candidate.candidate_id,
      media: Object.fromEntries(MEDIA_KEYS.map((key) => [key, toApiUrl(candidate.media[key])])),
    }));
}

export function splitCandidateRecommendations(candidates) {
  const ranked = [...candidates].sort((left, right) => left.shortlist_rank - right.shortlist_rank);
  return {
    primary: ranked.filter((candidate) => !candidate.possible_fragment_duplicate),
    fragmentedDuplicates: ranked.filter((candidate) => candidate.possible_fragment_duplicate),
  };
}

export function candidateReasonLabel(code) {
  return CANDIDATE_REASON_LABELS[code] || code;
}

export function isCandidateHardBlocked(candidate) {
  return normalizedUpper(candidate?.reviewability) === "UNREVIEWABLE"
    || isNonWideCandidate(candidate);
}

export function canSelectCandidate(candidate, isSubmitting = false) {
  return !isCandidateHardBlocked(candidate) && !isSubmitting;
}

export function buildCandidateSelectionPayload(response, candidate, sourceVideoAssetId) {
  const canonicalSourceVideoAssetId = response?.source_video_asset_id;
  invariant(canonicalSourceVideoAssetId, "source_video_asset_id is missing");
  if (sourceVideoAssetId) {
    invariant(sourceVideoAssetId === canonicalSourceVideoAssetId, "source_video_asset_id mismatch");
  }
  return {
    ranking_id: response.ranking_id,
    shortlist_patch_id: response.shortlist_patch_id,
    candidate_id: candidate.candidate_id,
    source_video_asset_id: canonicalSourceVideoAssetId,
  };
}

export function validateSelectionResponse(selection, candidate, response) {
  invariant(selection?.selection_id, "selection_id is missing");
  if (selection.candidate_id !== undefined) invariant(selection.candidate_id === candidate.candidate_id, "selection candidate_id mismatch");
  if (selection.ranking_id !== undefined) invariant(selection.ranking_id === response.ranking_id, "selection ranking_id mismatch");
  if (selection.shortlist_patch_id !== undefined) invariant(selection.shortlist_patch_id === response.shortlist_patch_id, "selection shortlist_patch_id mismatch");
  if (selection.shot_id !== undefined) invariant(selection.shot_id === candidate.shot_id, "selection shot_id mismatch");
  if (selection.tracklet_id !== undefined) invariant(selection.tracklet_id === candidate.tracklet_id, "selection tracklet_id mismatch");
  return {
    ...selection,
    candidate_id: candidate.candidate_id,
    ranking_id: response.ranking_id,
    shortlist_patch_id: response.shortlist_patch_id,
    shot_id: candidate.shot_id,
    tracklet_id: candidate.tracklet_id,
  };
}

export function validSelectedBbox(value) {
  return Array.isArray(value)
    && value.length === 4
    && value.every(Number.isFinite)
    && value[2] > value[0]
    && value[3] > value[1];
}

export function validateTrackingHandoff(handoff, selection, candidate) {
  invariant(handoff?.selection_id === selection.selection_id, "tracking selection_id mismatch");
  invariant(handoff.selected_candidate_id === candidate.candidate_id, "tracking candidate_id mismatch");
  invariant(handoff.selected_shot_id === candidate.shot_id, "tracking shot_id mismatch");
  invariant(handoff.selected_reference_frame === candidate.best_frame, "tracking reference frame mismatch");
  invariant(handoff.anchor_mode === EXPECTED_ANCHOR_MODE, "tracking anchor mode mismatch");
  invariant(validSelectedBbox(handoff.selected_bbox), "tracking selected_bbox is invalid");
  return handoff;
}

export function buildCandidateReviewPayload({
  state,
  candidateId,
  fullFrameContextSha256,
  shotClipSha256,
  note,
}) {
  invariant(CANDIDATE_REVIEW_STATES.includes(state), "unsupported candidate review state");
  const fullShotDecision = [
    "TARGET_ABSENT",
    "NONE_OF_THESE",
    "NONE_OF_THESE_NON_PLAYER_ROLE",
  ].includes(state);
  if (fullShotDecision) {
    invariant(!candidateId, `${state} cannot include candidate_id`);
    invariant(/^[a-f0-9]{64}$/i.test(fullFrameContextSha256 || ""), "full-frame evidence SHA is invalid");
    invariant(/^[a-f0-9]{64}$/i.test(shotClipSha256 || ""), "shot clip evidence SHA is invalid");
    return {
      state,
      candidate_id: null,
      full_frame_context_sha256: fullFrameContextSha256,
      shot_clip_sha256: shotClipSha256,
      note: note || {
        TARGET_ABSENT: "The selected target is absent from the full shot.",
        NONE_OF_THESE: "The target is not present in any proposed candidate.",
        NONE_OF_THESE_NON_PLAYER_ROLE: "All proposed candidates are non-player roles.",
      }[state],
    };
  }
  invariant(candidateId, `${state} requires candidate_id`);
  return { state, candidate_id: candidateId, note: note || "" };
}

export function errorDisplayCode(error) {
  return error?.code || (error?.status === 409 && error?.data?.detail?.code) || error?.detail || error?.message;
}

export const candidateMediaKeys = MEDIA_KEYS;
