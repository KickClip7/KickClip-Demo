import test from "node:test";
import assert from "node:assert/strict";
import { completedTrackingVideoEntries } from "../src/features/editor/completedTrackingVideos.js";

test("project ClipPlan에서 새로고침 가능한 완료 트래킹 영상을 찾는다", () => {
  const entries = completedTrackingVideoEntries({
    clipPlans: [
      {
        clip_plan_id: "clip_tracking_new",
        actual_duration_sec: 2.2,
        created_at: "2026-08-06T02:00:00Z",
        options: {
          ratio: "16:9",
          render_provenance: {
            tracking_job_ids: ["trk_new"],
            source_scene_ids: ["scene_4"],
          },
        },
      },
      {
        clip_plan_id: "clip_manual",
        actual_duration_sec: 10,
        options: { ratio: "9:16" },
      },
      {
        clip_plan_id: "clip_tracking_old",
        actual_duration_sec: 3.5,
        options: {
          render_provenance: {
            tracking_job_ids: ["trk_old", "trk_new"],
            source_scene_ids: ["scene_1"],
          },
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      trackingJobId: "trk_new",
      clipPlanId: "clip_tracking_new",
      durationSec: 2.2,
      ratio: "16:9",
      sceneIds: ["scene_4"],
      createdAt: "2026-08-06T02:00:00Z",
    },
    {
      trackingJobId: "trk_old",
      clipPlanId: "clip_tracking_old",
      durationSec: 3.5,
      ratio: null,
      sceneIds: ["scene_1"],
      createdAt: null,
    },
  ]);
});

test("ClipPlan이 없으면 완료 트래킹 영상 목록도 비어 있다", () => {
  assert.deepEqual(completedTrackingVideoEntries(null), []);
  assert.deepEqual(completedTrackingVideoEntries({ clipPlans: [] }), []);
});
