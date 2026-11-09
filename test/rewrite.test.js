// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxied as proxiedIn, rewriteCss as rewriteCssIn, rewriteEvent as rewriteEventIn } from "../src/resources/rewrite.js";

const BASE = "https://site.test/dir/page.html";
const p = (url) => "/r?u=" + encodeURIComponent(url);
const ctx = (base) => ({ base, sign: p });
const proxied = (url, base) => proxiedIn(url, ctx(base));
const rewriteCss = (css, base) => rewriteCssIn(css, ctx(base));
const rewriteEvent = (event, base) => rewriteEventIn(event, ctx(base));

test("proxied: относительные и абсолютные http(s) адреса", () => {
  assert.equal(proxied("img/a.png", BASE), p("https://site.test/dir/img/a.png"));
  assert.equal(proxied("  //cdn.test/x.css ", BASE), p("https://cdn.test/x.css"));
});

test("proxied: не трогает data:, blob:, якоря, уже проксированные и чужие схемы", () => {
  for (const url of ["data:image/png;base64,AA", "blob:x", "#top", "javascript:void 0", "/r?u=abc", "mailto:a@b.c", "", null]) {
    assert.equal(proxied(url, BASE), url);
  }
});

test("rewriteCss: url() во всех формах и @import", () => {
  const css = `a{background:url(a.png)} b{background:url('b.png')} c{background:url( "c.png" )} @import "d.css";`;
  assert.equal(
    rewriteCss(css, BASE),
    `a{background:url(${p("https://site.test/dir/a.png")})} b{background:url('${p("https://site.test/dir/b.png")}')} ` +
      `c{background:url("${p("https://site.test/dir/c.png")}")} @import "${p("https://site.test/dir/d.css")}";`,
  );
});

test("rewriteEvent: полный снимок — атрибуты и текст <style>", () => {
  const event = {
    type: 2,
    data: {
      node: {
        type: 0,
        childNodes: [
          { type: 2, tagName: "img", attributes: { src: "a.png", srcset: "a.png 1x, b.png 2x", alt: "x" }, childNodes: [] },
          { type: 2, tagName: "link", attributes: { rel: "stylesheet", href: "s.css" }, childNodes: [] },
          { type: 2, tagName: "a", attributes: { href: "page2.html" }, childNodes: [] },
          { type: 2, tagName: "use", attributes: { href: "i.svg#x" }, childNodes: [] },
          { type: 2, tagName: "style", attributes: {}, childNodes: [{ type: 3, textContent: "x{background:url(bg.png)}" }] },
          { type: 2, tagName: "div", attributes: { style: "background:url(d.png)" }, childNodes: [] },
        ],
      },
    },
  };
  const [img, link, a, use, style, div] = rewriteEvent(event, BASE).data.node.childNodes;
  assert.deepEqual(img.attributes, {
    src: p("https://site.test/dir/a.png"),
    srcset: `${p("https://site.test/dir/a.png")} 1x, ${p("https://site.test/dir/b.png")} 2x`,
    alt: "x",
  });
  assert.equal(link.attributes.href, p("https://site.test/dir/s.css"));
  assert.equal(a.attributes.href, "page2.html");
  assert.equal(use.attributes.href, p("https://site.test/dir/i.svg#x"));
  assert.equal(style.childNodes[0].textContent, `x{background:url(${p("https://site.test/dir/bg.png")})}`);
  assert.equal(div.attributes.style, `background:url(${p("https://site.test/dir/d.png")})`);
});

test("rewriteEvent: мутации — добавленные узлы, атрибуты, правила стилей", () => {
  const event = {
    type: 3,
    data: {
      source: 0,
      adds: [{ node: { type: 2, tagName: "img", attributes: { src: "n.png" }, childNodes: [] } }],
      attributes: [{ id: 1, attributes: { href: "x.css", title: "t" } }, { id: 2, attributes: { href: "page.html" } }],
    },
  };
  const d = rewriteEvent(event, BASE).data;
  assert.equal(d.adds[0].node.attributes.src, p("https://site.test/dir/n.png"));
  assert.deepEqual(d.attributes[0].attributes, { href: p("https://site.test/dir/x.css"), title: "t" });
  assert.equal(d.attributes[1].attributes.href, "page.html");

  const rules = rewriteEvent({ type: 3, data: { source: 8, adds: [{ rule: "a{background:url(r.png)}" }] } }, BASE);
  assert.equal(rules.data.adds[0].rule, `a{background:url(${p("https://site.test/dir/r.png")})}`);
});

test("rewriteEvent: прочие события не меняются", () => {
  const meta = { type: 4, data: { href: BASE, width: 1, height: 1 } };
  assert.deepEqual(rewriteEvent(structuredClone(meta), BASE), meta);
});
