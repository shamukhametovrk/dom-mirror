// @ts-check
import { createConnection } from "./connection.js";
import { createClipboardSync } from "./clipboard.js";
import { createDownloads } from "./downloads.js";
import { createKeyboard } from "./keyboard.js";
import { bindMouse } from "./mouse.js";
import { createPlayer } from "./player.js";
import { createTabStrip } from "./tabs.js";
import { createToaster } from "./toasts.js";
import { createToolbar } from "./toolbar.js";
import { createFileTransfer } from "./uploads.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */

const VIEWPORT_DEBOUNCE_MS = 200;

const overlay = document.getElementById("overlay");
const stage = document.getElementById("stage");

/** @type {(msg: ClientMessage) => void} */
const send = (msg) => connection.send(msg);
const focusOverlay = () => overlay.focus();
const toolbar = createToolbar(send, focusOverlay);
const toast = createToaster(document.getElementById("toasts"));
const files = createFileTransfer({ stage, overlay, send, toast, pastePoint: () => player.focusedPoint() });
const keyboard = createKeyboard(send, files.paste);
const player = createPlayer({
  root: document.getElementById("player"),
  handlers: keyboard,
  onFill: (id, value) => send({ type: "fill", id, value }),
  onBlur: focusOverlay,
  send,
});

let viewportTimer = 0;
const sendViewport = () => {
  clearTimeout(viewportTimer);
  viewportTimer = window.setTimeout(() => send({ type: "viewport", w: stage.clientWidth, h: stage.clientHeight }), VIEWPORT_DEBOUNCE_MS);
};

const showTabs = createTabStrip(document.getElementById("tabs"), send, focusOverlay);
const replaced = document.getElementById("replaced");
const showDownload = createDownloads(toast);
const copyToClipboard = createClipboardSync(toast);

const MESSAGE_HANDLERS = {
  events: (msg) => msg.events.forEach(player.addEvent),
  focus: (msg) => player.setFocus(msg),
  cursor: (msg) => { overlay.style.cursor = msg.cursor; },
  fileChooser: (msg) => files.choose(msg),
  tabs: (msg) => showTabs(msg.tabs),
  download: (msg) => showDownload(msg),
  clipboard: (msg) => copyToClipboard(msg),
};

const connection = createConnection({
  onOpen: () => {
    replaced.classList.remove("shown");
    toolbar.setStatus("онлайн");
    player.reset();
    sendViewport();
    overlay.focus();
  },
  onClose: () => toolbar.setStatus("нет связи"),
  onReplaced: () => {
    toolbar.setStatus("на другом устройстве");
    replaced.classList.add("shown");
  },
  onMessage: (msg) => MESSAGE_HANDLERS[msg.type]?.(msg),
});
document.getElementById("take-over").addEventListener("click", () => connection.connect());

// перед кликом докручиваем локальную прокрутку и отправляем её остаток — клик попадёт туда же, что и в копии;
// каретку в поле копия ставит сразу, не дожидаясь сервера
const onPress = (/** @type {MouseEvent} */ e) => {
  player.flushScroll();
  focusOverlay();
  const r = overlay.getBoundingClientRect();
  if (e.button === 0) player.predictFocus(e.clientX - r.left, e.clientY - r.top);
};
bindMouse(overlay, send, { onPress, onWheel: player.scrollLocally });
for (const [type, handler] of Object.entries(keyboard)) overlay.addEventListener(type, handler);
window.addEventListener("resize", sendViewport);
