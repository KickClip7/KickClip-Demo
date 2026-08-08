import test from "node:test";
import assert from "node:assert/strict";
import { MOCK_EVENT_OUT_OF_RANGE_MESSAGE, seekVideoSafely } from "../src/features/editor/videoSeek.js";

test("영상 길이를 초과한 이벤트를 클릭해도 currentTime을 변경하지 않는다", () => {
  const video = { duration: 383, currentTime: 25 };
  const clickedEvent = { id: "mock_evt_opaque", startSec: 6202 };
  let notice = "";

  const changed = seekVideoSafely(video, clickedEvent.startSec, (message) => {
    notice = message;
  });

  assert.equal(changed, false);
  assert.equal(video.currentTime, 25);
  assert.equal(notice, MOCK_EVENT_OUT_OF_RANGE_MESSAGE);
});
