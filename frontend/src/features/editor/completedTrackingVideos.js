export function completedTrackingVideoEntries(editState) {
  const byJobId = new Map();
  for (const plan of editState?.clipPlans || []) {
    const provenance = plan?.options?.render_provenance || {};
    for (const trackingJobId of provenance.tracking_job_ids || []) {
      if (!trackingJobId || byJobId.has(trackingJobId)) continue;
      byJobId.set(trackingJobId, {
        trackingJobId,
        clipPlanId: plan.clip_plan_id,
        durationSec: Number(plan.actual_duration_sec || 0),
        ratio: plan.options?.ratio || null,
        sceneIds: provenance.source_scene_ids || [],
        createdAt: plan.created_at || null,
      });
    }
  }
  return [...byJobId.values()];
}
