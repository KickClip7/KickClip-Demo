export function isolateProjectResources(editState) {
  const projectId = editState?.project?.project_id;
  const clipPlans = (editState?.clip_plans || []).filter((plan) => plan.project_id === projectId);
  const clipPlanIds = new Set(clipPlans.map((plan) => plan.clip_plan_id));
  const renderJobs = (editState?.render_jobs || []).filter((job) => clipPlanIds.has(job.clip_plan_id));
  return { clipPlans, renderJobs };
}

export function latestClipPlan(clipPlans) {
  return [...(clipPlans || [])].sort((left, right) => {
    return String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || ""));
  })[0] || null;
}

export function isTerminalRenderStatus(status) {
  return ["completed", "failed", "cancelled"].includes(String(status || "").toLowerCase());
}
