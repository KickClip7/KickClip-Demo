/**
 * Runtime code stays JavaScript, while these JSDoc contracts are checked by the
 * TypeScript compiler. Keep API-facing shapes here so screens do not invent
 * partial backend models.
 */

/**
 * @typedef {Object} Match
 * @property {string} match_id
 * @property {string} owner_id
 * @property {string|null} home_team
 * @property {string|null} away_team
 * @property {number|null} home_score
 * @property {number|null} away_score
 * @property {string|null} match_date
 * @property {string|null} competition
 * @property {string|null} season
 * @property {number|null} duration_sec
 * @property {Record<string, unknown>} metadata
 * @property {string|null} raw_video_asset_id
 * @property {string|null} video_asset_id
 * @property {string|null} video_url
 * @property {string|null} preview_video_asset_id
 * @property {string|null} preview_url
 * @property {string|null} thumbnail_artifact_id
 * @property {string|null} thumbnail_url
 * @property {string|null} analysis_status
 * @property {number|null} analysis_progress
 * @property {string|null} analysis_job_id
 * @property {string|null} analysis_current_step
 * @property {string|null} analysis_error_message
 * @property {boolean} analysis_retryable
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} TrackingHighlightCandidateResponse
 * @property {string} tracking_job_id
 * @property {string} revision_id
 * @property {string} scene_id
 * @property {string} candidate_id
 * @property {string} binding_id
 * @property {string} binding_status
 * @property {string} tracking_status
 * @property {boolean} eligible_for_clip_plan
 * @property {string|null} clip_plan_id
 * @property {boolean} unresolved_gaps
 * @property {false} automatic_target_confirmation
 */

/**
 * @typedef {Object} Project
 * @property {string} project_id
 * @property {string} match_id
 * @property {string|null} owner_id
 * @property {string} title
 * @property {string|null} description
 * @property {string} status
 * @property {string|null} thumbnail_artifact_id
 * @property {string|null} last_opened_at
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} ProjectRecentItem
 * @property {string} project_id
 * @property {string} match_id
 * @property {string} title
 * @property {string} status
 * @property {string|null} thumbnail_url
 * @property {number|null} duration_sec
 * @property {number} clip_count
 * @property {string|null} edit_mode
 * @property {number} progress
 * @property {string} ratio
 * @property {string|null} last_opened_at
 * @property {string} created_at
 */

/**
 * @typedef {Object} UploadMatchVideoResponse
 * @property {string} match_id
 * @property {string} raw_video_asset_id
 * @property {string} video_asset_id
 * @property {string} video_url
 * @property {string|null|undefined} preview_video_asset_id
 * @property {string|null|undefined} preview_url
 * @property {"RAW_VIDEO_PLAYABLE"|"PREVIEW_READY"|"PREVIEW_FAILED_RAW_ONLY"} preview_status
 * @property {boolean} is_browser_playable
 * @property {string} browser_playability_reason
 * @property {{
 *   filename: string|null,
 *   content_type: string|null,
 *   duration_sec: number|null,
 *   fps: number|null,
 *   width: number|null,
 *   height: number|null,
 *   size_bytes: number|null,
 *   codec: {
 *     codec_name: string|null,
 *     codec_tag_string: string|null,
 *     pix_fmt: string|null,
 *     format_name: string|null
 *   }
 * }} upload
 */

/**
 * @typedef {Object} ClipPlanItem
 * @property {string|null|undefined} timeline_event_id
 * @property {number} start_sec
 * @property {number} end_sec
 * @property {number} order_index
 * @property {string|null|undefined} reason
 * @property {Record<string, unknown>|undefined} metadata
 */

/**
 * @typedef {Object} ClipPlan
 * @property {string} clip_plan_id
 * @property {string} project_id
 * @property {string} mode
 * @property {string|null} summary
 * @property {number|null} target_duration_sec
 * @property {number|null} actual_duration_sec
 * @property {string} created_by
 * @property {Record<string, unknown>} options
 * @property {ClipPlanItem[]} items
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} SessionTimelineEvent
 * @property {string} timeline_event_id
 * @property {"goal"|"shot"|"penalty"|"card"|"corner"} label
 * @property {number|null} half
 * @property {number} timestamp_sec
 * @property {number} start_sec
 * @property {number} end_sec
 * @property {number} duration_sec
 * @property {number|null} confidence
 * @property {number|null} highlight_score
 * @property {Record<string, unknown>} metadata
 */

/**
 * @typedef {Object} HighlightRevision
 * @property {string} revision_id
 * @property {string} project_id
 * @property {number} revision_number
 * @property {string|null} action_spotting_job_id
 * @property {string[]} selected_scene_ids
 * @property {string} focus_mode
 * @property {string|null} focus_subject_id
 * @property {string|null} clip_plan_id
 * @property {string|null} render_job_id
 * @property {string} status
 * @property {string|null} pending_action
 * @property {string|null} error_message
 */

/**
 * @typedef {Object} HighlightPlayerCandidate
 * @property {string} candidate_id
 * @property {string|null} player_id
 * @property {string|null} track_id
 * @property {string} scene_id
 * @property {string} display_label
 * @property {number|null} number
 * @property {number|null} jersey_number
 * @property {string|null} team
 * @property {number|null} confidence
 * @property {number|null} anchor_time_sec
 * @property {number[]|null} bbox_xyxy
 * @property {string|null} thumbnail_artifact_id
 * @property {string|null} thumbnail_url
 * @property {number|null} track_length_frames
 * @property {number|null} trackability_score
 * @property {string} status
 */

/**
 * @typedef {"QUEUED"|"RUNNING"|"WAITING_MEMORY_REVIEW"|"WAITING_CROSS_SHOT_CONFIRMATION"|"WAITING_SEGMENT_REVIEW"|"COMPLETED"|"COMPLETED_WITH_UNRESOLVED_GAPS"|"COMPLETED_SAFE_BLOCK"|"FAILED"|"CANCELLED"} TrackingStatus
 */

/**
 * @typedef {"SAME_PLAYER"|"DIFFERENT_PLAYER"|"UNREVIEWABLE_LOW_RESOLUTION"|"TARGET_ABSENT"|"NONE_OF_THESE"|"NONE_OF_THESE_NON_PLAYER_ROLE"} CandidateReviewState
 */

/**
 * @typedef {"REVIEW_NEXT_CANDIDATE"|"REVIEW_NEXT_BATCH"|"SEARCH_NEXT_SHOT"|"TRACKING_RESUMED"|"COMPLETED"} CandidateReviewContinuation
 */

/**
 * @typedef {Object} CandidateReviewResponse
 * @property {string} decision_id
 * @property {string} state
 * @property {string|null} candidate_id
 * @property {CandidateReviewContinuation} continuation
 * @property {number} remaining_candidate_count
 * @property {string|null} next_candidate_id
 * @property {string|null} next_ambiguity_id
 * @property {false} automatic_target_confirmation
 */

/**
 * @typedef {Object} TrackingJobResponse
 * @property {string} tracking_job_id
 * @property {"EVENT_CANDIDATE_HANDOFF_R1"|"LEGACY_TARGET_TRACKING"|string} execution_kind
 * @property {string|null} pipeline_stage
 * @property {string} processing_status
 * @property {TrackingStatus} status
 * @property {string} outcome
 * @property {number} progress
 * @property {string|null} pending_ambiguity_id
 * @property {Array<Record<string, unknown>>} pending_candidates
 * @property {Record<string, unknown>|null} pending_action
 * @property {Record<string, unknown>|null} next_ambiguity
 * @property {{reviewed_candidate_count:number,remaining_candidate_count:number,candidate_batch_generation:number,current_shot:string|null,preparing_next_candidates:boolean}} review_progress
 * @property {string|null} current_shot
 * @property {string|null} next_shot
 * @property {string|null} timeline_url
 * @property {Record<string, boolean>} artifact_readiness
 * @property {Record<string, boolean>} preview_readiness
 * @property {{type:string|null,message:string|null}|null} error
 * @property {string} updated_at
 */

/**
 * @typedef {Object} CandidateRecommendationMedia
 * @property {string} full_frame_context_url
 * @property {string} best_crop_native_url
 * @property {string} best_crop_display_url
 * @property {string} first_middle_last_url
 * @property {string} tracklet_video_url
 * @property {string} reference_gallery_url
 */

/**
 * @typedef {Object} CandidateRecommendation
 * @property {"v1.2"} ranking_version
 * @property {string} ranking_id
 * @property {string} shortlist_patch_id
 * @property {string} candidate_id
 * @property {number} shortlist_rank
 * @property {number} global_rank
 * @property {string} shot_id
 * @property {string} tracklet_id
 * @property {"CLEAR"|"USABLE"|"LOW_RESOLUTION"|"UNREVIEWABLE"} reviewability
 * @property {number} best_frame
 * @property {CandidateRecommendationMedia} media
 * @property {string[]} reason_codes
 * @property {string[]} risk_codes
 * @property {boolean} possible_fragment_duplicate
 * @property {false} automatic_target_confirmation
 */

/**
 * @typedef {Object} CandidateRecommendationResponse
 * @property {"v1.2"} ranking_version
 * @property {string} ranking_id
 * @property {string} shortlist_patch_id
 * @property {string} revision_id
 * @property {string} event_id
 * @property {string} scene_id
 * @property {CandidateRecommendation[]} candidates
 * @property {false} automatic_target_confirmation
 * @property {"BLOCKED"} production_recommendation_ui
 */

/**
 * @typedef {Object} TrackingHandoffResponse
 * @property {string} tracking_job_id
 * @property {string} selection_id
 * @property {string} selected_candidate_id
 * @property {string} selected_shot_id
 * @property {number} selected_reference_frame
 * @property {number[]} selected_bbox
 * @property {"SELECTED_CANDIDATE_BEST_REFERENCE"} anchor_mode
 * @property {string} provenance_artifact_sha256
 * @property {string} status
 */

/**
 * Forward-compatible candidate view model. V1.2 is shadow-only and has no
 * public endpoint; these fields must not be used to infer one.
 *
 * @typedef {Object} EventCandidateViewModel
 * @property {string} candidate_id
 * @property {number|null|undefined} rank
 * @property {number|null|undefined} shortlist_rank
 * @property {number|null|undefined} original_global_rank
 * @property {number|null|undefined} recommendation_score
 * @property {string[]|undefined} reason_codes
 * @property {string[]|undefined} risk_codes
 * @property {string[]|undefined} shortlist_patch_reason_codes
 * @property {string|null|undefined} shortlist_phase
 * @property {string|null|undefined} shot_id
 * @property {string|null|undefined} reliability_state
 */

/**
 * @typedef {Object} EventCandidateRankingRequest
 * @property {string} event_id
 * @property {string} scene_id
 * @property {3|4|5} shortlist_size
 */

/**
 * @typedef {Object} EventCandidateRankingResult
 * @property {string} ranking_id
 * @property {string|null} artifact_id
 * @property {string} ranking_status
 * @property {string} feature_completeness_state
 * @property {string[]} shortlist_candidate_ids
 * @property {string[]} full_gallery_fallback_candidate_ids
 * @property {string} output_sha256
 * @property {false} automatic_target_confirmation
 * @property {"BLOCKED"|string|undefined} production_recommendation_ui
 */

/**
 * @typedef {Object} SceneAITask
 * @property {string} task_id
 * @property {string} task_type
 * @property {"QUEUED"|"RUNNING"|"COMPLETED"|"FAILED"} status
 * @property {number} attempt_count
 * @property {number} max_attempts
 * @property {EventCandidateRankingResult|Record<string, unknown>} result
 * @property {string|null} error_message
 * @property {string} status_url
 * @property {string|null} retry_url
 */

/**
 * @typedef {Object} HighlightScene
 * @property {string} scene_id
 * @property {string} match_id
 * @property {string|null} media_asset_id
 * @property {number} start_time_sec
 * @property {number} end_time_sec
 * @property {number} representative_time_sec
 * @property {string} primary_label
 * @property {number|null} confidence
 * @property {string} selection_state
 * @property {string} render_strategy
 */

/**
 * @typedef {Object} RenderJob
 * @property {string} render_job_id
 * @property {string} clip_plan_id
 * @property {string} status
 * @property {number|null|undefined} progress
 * @property {string|null|undefined} download_url
 * @property {string|null|undefined} error_message
 * @property {Record<string, unknown>|undefined} options
 * @property {string|undefined} created_at
 */

/**
 * @typedef {Object} ProjectEditStateResponse
 * @property {Project} project
 * @property {{
 *   match_id: string,
 *   home_team: string|null,
 *   away_team: string|null,
 *   home_score: number|null,
 *   away_score: number|null,
 *   duration_sec: number|null
 * }} match
 * @property {{
 *   url: string|null,
 *   asset_id: string|null,
 *   asset_type: string|null,
 *   duration_sec: number|null,
 *   width: number|null,
 *   height: number|null
 * }} video
 * @property {Array<Record<string, unknown>>} events
 * @property {Array<Record<string, unknown>>} players
 * @property {{eventTypes: string[], backendLabels: string[]}} filters
 * @property {ClipPlan[]} clip_plans
 * @property {RenderJob[]} render_jobs
 */

export {};
