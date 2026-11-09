// @ts-check
import { post } from "./channel.js";

const RECORD_OPTIONS = {
  inlineStylesheet: true,
  recordCanvas: false,
  slimDOMOptions: "all",
  // мышь без накопления — плееру нужен :hover; прокрутка — каждый кадр серверной анимации;
  // input "all" — значение поля на каждое нажатие
  sampling: { mousemove: 30, mousemoveCallback: 30, mouseInteraction: false, scroll: 16, input: "all" },
};

function record() {
  window.rrweb.record({ emit: (event) => post("emit", JSON.stringify(event)), ...RECORD_OPTIONS });
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
