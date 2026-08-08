export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return `${String(minutes).padStart(2, "0")}:${secs}`;
}
