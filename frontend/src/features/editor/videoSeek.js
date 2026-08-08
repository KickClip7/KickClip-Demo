export const MOCK_EVENT_OUT_OF_RANGE_MESSAGE = "목업 이벤트가 현재 테스트 영상 범위를 벗어납니다";

export function seekVideoSafely(video, targetSeconds, onOutOfRange) {
  if (!video) return false;

  const target = Number(targetSeconds);
  const duration = Number(video.duration);
  if (!Number.isFinite(target) || target < 0) return false;

  if (Number.isFinite(duration) && duration > 0 && target > duration) {
    onOutOfRange?.(MOCK_EVENT_OUT_OF_RANGE_MESSAGE);
    return false;
  }

  video.currentTime = target;
  return true;
}
