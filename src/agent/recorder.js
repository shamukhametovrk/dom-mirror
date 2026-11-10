// @ts-check
import { changeReporter, post } from "./channel.js";

const RECORD_OPTIONS = {
  inlineStylesheet: true,
  recordCanvas: false,
  slimDOMOptions: "all",
  // мышь без накопления — плееру нужен :hover; прокрутка — каждый кадр серверной анимации;
  // input "all" — значение поля на каждое нажатие
  sampling: { mousemove: 30, mousemoveCallback: 30, mouseInteraction: false, scroll: 16, input: "all" },
};

// Ошибка внутри rrweb теряет всю пачку изменений DOM: сообщаем серверу, чтобы было видно в логе.
const reportError = changeReporter("error");

function record() {
  const errorHandler = (/** @type {any} */ e) => {
    reportError(String(e?.stack ?? e).slice(0, 2000));
    return true;
  };
  window.rrweb.record({ emit: (event) => post("emit", JSON.stringify(event)), errorHandler, ...RECORD_OPTIONS });
}

/** @param {() => void} fn */
function whenRrwebReady(fn) {
  if (window.rrweb) fn();
  else setTimeout(() => whenRrwebReady(fn), 50);
}

export function startRecording() {
  const start = () => whenRrwebReady(record);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
