// @ts-check
import { exposeQueue } from "./channel.js";
import { startRecording } from "./recorder.js";
import { watchFocus } from "./focus.js";
import { watchCursor } from "./cursor.js";

export function startAgent() {
  exposeQueue();
  startRecording();
  watchFocus();
  watchCursor();
}
