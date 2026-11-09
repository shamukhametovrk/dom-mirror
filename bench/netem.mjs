// TCP-прокси с задержкой и ограничением полосы — имитация далёкого клиента.
// node bench/netem.mjs --listen=8099 --target=8098 --delay=50 --mbit=10
// delay — в одну сторону (RTT = 2 × delay), mbit — полоса в каждую сторону (0 — без ограничения).
import http from "node:http";
import net from "node:net";
import { parseArgs } from "./lib.mjs";

// Счётчик байт на проводе (к клиенту): GET http://127.0.0.1:<listen+1>/ → {"down": n}, ?reset — обнулить.
const wire = { down: 0 };

const args = parseArgs(process.argv.slice(2));
const LISTEN = Number(args.listen ?? 8099);
const TARGET = Number(args.target ?? 8098);
const DELAY = Number(args.delay ?? 50);
const BYTES_PER_MS = Number(args.mbit ?? 0) * 1e6 / 8 / 1000;

// Каждое направление — очередь: кусок уходит через DELAY после прихода и не раньше, чем «пролез» предыдущий.
function shaped(from, to, count) {
  let busyUntil = 0;
  from.on("data", (chunk) => {
    if (count) wire.down += chunk.length;
    const now = performance.now();
    const transmit = BYTES_PER_MS ? chunk.length / BYTES_PER_MS : 0;
    const start = Math.max(now, busyUntil);
    busyUntil = start + transmit;
    setTimeout(() => to.writable && to.write(chunk), busyUntil + DELAY - now);
  });
  from.on("end", () => setTimeout(() => to.end(), DELAY));
  from.on("error", () => to.destroy());
}

net.createServer((client) => {
  const upstream = net.connect(TARGET, "127.0.0.1");
  client.setNoDelay(true);
  upstream.setNoDelay(true);
  shaped(client, upstream, false);
  shaped(upstream, client, true);
}).listen(LISTEN, () => console.log(`netem: :${LISTEN} → :${TARGET}, задержка ${DELAY} мс в одну сторону, полоса ${args.mbit ?? "∞"} Мбит/с`));

http.createServer((req, res) => {
  res.end(JSON.stringify(wire));
  if (req.url.includes("reset")) wire.down = 0;
}).listen(LISTEN + 1, "127.0.0.1");
