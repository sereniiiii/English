/* 必刷题库 · 前端逻辑（纯静态，数据全部本地） */
(() => {
"use strict";

const LIB = window.LIB;
const LS = {
  favs: "bs.v1.favs", notes: "bs.v1.notes", myans: "bs.v1.myans",
  edits: "bs.v1.edits", prefs: "bs.v1.prefs",
};
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

const store = {
  favs: read(LS.favs, {}),
  notes: read(LS.notes, {}),
  myans: read(LS.myans, {}),
  edits: read(LS.edits, {}),
  prefs: read(LS.prefs, { showAns: true, collapsed: {} }),
};
const save = (k) => write(LS[k], store[k]);

const ROMAN = { I: "Ⅰ", II: "Ⅱ", III: "Ⅲ" };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

/* ---------------- 索引 ---------------- */
const IDX = new Map();   // cardId -> {card, section, part, period, unit, book}
const BOOKBY = new Map();
let PARTLIST = new Map(); // `${bookId}|${partId}` -> {unit, period, part, book}

for (const book of LIB.books) {
  BOOKBY.set(book.id, book);
  for (const unit of book.units) {
    for (const period of unit.periods) {
      for (const part of period.parts) {
        PARTLIST.set(`${book.id}|${part.id}`, { book, unit, period, part });
        for (const section of part.sections) {
          for (const card of section.cards) {
            IDX.set(card.id, { card, section, part, period, unit, book });
          }
        }
      }
    }
  }
}

const state = {
  bookId: LIB.books[0].id,
  partId: null,
  query: "",
  drawer: null,
  favFilter: "all",
};

/* ---------------- 工具 ---------------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), 1600);
}
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  const d = Math.floor(s / 86400);
  return d < 30 ? d + " 天前" : fmtTime(ts).slice(0, 10);
}
function bookOf(cardId) { const r = IDX.get(cardId); return r ? r.book : null; }
function pathOf(cardId) {
  const r = IDX.get(cardId);
  if (!r) return "";
  const bits = [r.unit.title, r.period.title || "Period " + r.period.key, r.part.title, r.section.type];
  return bits.filter(Boolean).join(" · ");
}
function cardPath(cardId) {
  const r = IDX.get(cardId);
  if (!r) return { book: "", unit: "", period: "", part: "", type: "", label: "" };
  return {
    book: r.book.short, bookTitle: r.book.title,
    unit: r.unit.title, period: r.period.title || "Period " + r.period.key,
    part: r.part.title, type: r.section.type, label: r.card.label || "",
  };
}
function snipOf(card) {
  const first = card.items.find((i) => i.stem) || card.items[0];
  const s = first && first.stem ? first.stem : card.passage || "";
  if (!s) return "（" + (card.type || "") + "）";
  return s.length > 46 ? s.slice(0, 46) + "…" : s;
}
function effective(card) {
  const e = store.edits[card.id];
  if (!e) return card;
  return { ...card, passage: e.passage ?? card.passage, items: e.items || card.items, _edited: true };
}
function ansOf(card, item) {
  return (item.a || item.answer || "").trim();
}
function noteOf(cardId) { return store.notes[cardId] || null; }
function isFav(cardId) { return !!store.favs[cardId]; }

/* ---------------- 顶栏 ---------------- */
function renderBooks() {
  $("#bookSwitch").innerHTML = LIB.books.map((b) =>
    `<button data-book="${b.id}" class="${b.id === state.bookId ? "on" : ""}">${esc(b.short)}</button>`
  ).join("");
  $$("#bookSwitch button").forEach((el) =>
    el.addEventListener("click", () => {
      state.bookId = el.dataset.book;
      state.query = "";
      $("#search").value = "";
      const b = BOOKBY.get(state.bookId);
      const firstPart = (b.units[0]?.periods[0]?.parts[0]?.id) || null;
      go(state.bookId, firstPart);
    })
  );
  const total = Object.keys(store.favs).length;
  $("#favCount").textContent = total || "";
  $("#btnAns").textContent = store.prefs.showAns ? "答案：显示" : "答案：遮挡";
}

/* ---------------- 侧栏 ---------------- */
function sidebarNode(cards) {
  const nItems = cards.reduce((a, c) => a + c.items.length, 0);
  return `<span class="cnt">${cards.length}题组·${nItems}题</span>`;
}

function renderSidebar() {
  const book = BOOKBY.get(state.bookId);
  if (!book) return;
  const html = book.units.map((u, ui) => {
    const closed = store.prefs.collapsed[u.id] === true;
    const cards = u.periods.flatMap((p) => p.parts.flatMap((a) => a.sections.flatMap((s) => s.cards)));
    const body = u.periods.map((p) => `
      <div class="period">
        <div class="period-h">${esc(p.title || "Period " + p.key)}</div>
        ${p.parts.map((a) => {
          const ac = a.sections.flatMap((s) => s.cards);
          const on = state.partId === a.id ? "on" : "";
          return `<div class="part ${on}" data-part="${a.id}">
            <span class="roman">${a.roman === "小卷" || a.roman === "卷" ? esc(a.roman) : "Part " + esc(a.roman)}</span>
            <span class="pt">${esc(a.title || a.sections.map(s => s.type).join(" / ") || "题目")}</span>
            <span class="cnt">${ac.length}</span>
          </div>`;
        }).join("")}
      </div>`).join("");
    return `<div class="unit ${closed ? "closed" : ""}" data-unit="${u.id}">
      <div class="unit-h"><span class="caret">▾</span><span>${esc(u.title)}</span>${sidebarNode(cards)}</div>
      <div class="unit-body">${body}</div>
    </div>`;
  }).join("");
  $("#sidebar").innerHTML = html;

  $$("#sidebar .unit-h").forEach((el) => el.addEventListener("click", () => {
    const u = el.parentElement;
    u.classList.toggle("closed");
    const id = u.dataset.unit;
    store.prefs.collapsed[id] = u.classList.contains("closed");
    save("prefs");
  }));
  $$("#sidebar .part").forEach((el) => el.addEventListener("click", () => {
    go(state.bookId, el.dataset.part);
  }));
  const active = $("#sidebar .part.on");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/* ---------------- 卡片渲染 ---------------- */
function blanks(t, nums) {
  const keep = new Set(nums || []);
  return esc(t).replace(/(?<![\d.A-Za-z])(\d{1,2})(?![\d.])/g, (m) =>
    keep.has(Number(m)) ? `<b class="blank">${m}</b>` : m);
}
function renderPassage(card, type) {
  if (!card.passage) return "";
  const raw = card.type === "完形填空" || card.type === "7选5" || card.type === "课文改编填空" || card.type === "语法填空";
  const body = raw ? blanks(card.passage, card.items.map((i) => i.n)) : esc(card.passage);
  const long = card.passage.length > 420;
  return `<div class="passage ${long ? "clamp" : ""}">${body}</div>
    ${long ? `<button class="more" data-more="1">展开全文 ▾</button>` : ""}
    ${card.source ? `<div class="note-src">来源：${esc(card.source)}</div>` : ""}`;
}

function renderItems(card, editing) {
  const my = store.myans[card.id] || {};
  const showAns = store.prefs.showAns;
  return card.items.map((it) => {
    const ans = ansOf(card, it);
    const picked = my[it.n] || "";
    const st = picked && ans && showAns ? (picked === ans ? "ok" : "bad") : "";
    if (editing) {
      return `<div class="item" data-n="${it.n}">
        <div class="n">${it.n}</div>
        <div class="body">
          <textarea class="edit-area" data-edit="stem" data-n="${it.n}" rows="${Math.max(2, Math.ceil((it.stem || "").length / 46))}">${esc(it.stem || "")}</textarea>
          ${it.options.length ? `<textarea class="edit-area" data-edit="opts" data-n="${it.n}" rows="${it.options.length}">${esc(it.options.join("\n"))}</textarea>` : ""}
        </div>
      </div>`;
    }
    const opts = it.options.map((o) => {
      const k = (o.match(/^\s*([A-H])/) || [, ""])[1];
      let cls = "opt";
      if (picked === k) cls += " picked";
      if (showAns && ans && k) {
        if (k === ans) cls += " correct";
        else if (picked === k) cls += " wrong";
      }
      if (showAns) cls += " disabled";
      return `<button class="${cls}" data-pick="${it.n}:${k}"><span class="k">${esc(k)}</span><span>${esc(o.replace(/^\s*[A-H]\s*[.．、]\s*/, ""))}</span></button>`;
    }).join("");
    const fillInput = !it.options.length
      ? `<input class="edit-area" style="min-height:0;padding:5px 9px;margin-top:6px" data-pick-text="${it.n}" placeholder="先写下你的答案（可空）" value="${esc(picked)}">`
      : "";
    return `<div class="item ${st ? "pick-" + st : ""}" data-n="${it.n}">
      <div class="n">${it.n}</div>
      <div class="body">
        ${it.stem ? `<div class="stem">${esc(it.stem)}</div>` : ""}
        ${opts ? `<div class="opts">${opts}</div>` : ""}
        ${fillInput}
      </div>
    </div>`;
  }).join("");
}

function renderAnswerCol(card, rec) {
  const showAns = store.prefs.showAns;
  const my = store.myans[card.id] || {};
  const rows = card.items.map((it) => {
    const ans = ansOf(card, it);
    const picked = my[it.n] || "";
    const st = picked && ans && showAns ? (picked === ans ? "ok" : "bad") : "";
    return `<div class="ansrow">
      <div class="n">${it.n}</div>
      <div class="v ${st}">${ans ? esc(ans) : '<span class="empty">—</span>'}</div>
      ${it.at ? `<div class="txt">${esc(it.at)}</div>` : ""}
    </div>`;
  }).join("");
  let hint = "";
  const none = !card.items.some((i) => ansOf(card, i));
  if (none) {
    const t = rec.section.type;
    const why = /综合测试卷/.test(t)
      ? "综合测试卷的答案册未按篇编号，暂未做自动对齐，请用「原文」翻答案页。"
      : "填空/写作类答案在配套《答案及解析》册里，本文件夹未包含该册，仅有「快速对答案」的客观题字母。";
    hint = `<div class="anshint">${why}</div>`;
  } else if (card.ansPage) {
    hint = `<div class="anshint">答案册页码：P${card.ansPage} · 点右上「原文 → 答案页」可直接看原书答案。</div>`;
  }
  return `<div class="colhead">答案</div>
    <div class="${showAns ? "" : "hide"}">${rows}</div>${hint}`;
}

function renderCard(cardId) {
  const rec = IDX.get(cardId);
  if (!rec) return "";
  const card = effective(rec.card);
  const editing = !!card._editing;
  const fav = isFav(card.id);
  const note = noteOf(card.id);
  const mark = note && note.mark ? note.mark : 0;
  const badgeCls = rec.section.type === "阅读理解" ? "blue" : "";
  return `<article class="card ${fav ? "fav" : ""} mark-${mark}" id="c-${card.id}" data-card="${card.id}">
    <div class="card-h">
      <span class="badge ${badgeCls}">${esc(rec.section.type)}</span>
      ${card.label ? `<span class="chip">${esc(card.label)}篇</span>` : ""}
      <span class="meta">${esc(card.meta || "")}</span>
      <span class="ops">
        <button data-act="fav" class="${fav ? "on" : ""}" title="收藏">${fav ? "★" : "☆"}</button>
        <button data-act="note" class="${note ? "on" : ""}" title="批注">✎</button>
        <button data-act="edit" class="${editing ? "on" : ""}" title="编辑题目">⌨</button>
        <button data-act="src" title="原文对照">▤</button>
      </span>
    </div>
    <div class="split">
      <div class="col-q">
        <div class="colhead">题目 <span style="letter-spacing:0;text-transform:none;color:#a9a49a">P${card.page}</span></div>
        ${editing
          ? `<textarea class="edit-area" data-edit="passage" rows="${Math.max(3, Math.ceil((card.passage || "").length / 50))}">${esc(card.passage || "")}</textarea>`
          : renderPassage(card, rec.section.type)}
        ${renderItems(card, editing)}
        ${editing ? `<div style="margin-top:10px;display:flex;gap:8px">
            <button class="btn" data-act="save-edit">保存修改</button>
            <button class="btn ghost" data-act="reset-edit">还原原文</button>
            <span style="font-size:12px;color:#8a8f98;align-self:center">改动只存在本地，不写入原文件</span></div>` : ""}
        ${note ? `<div class="mybox"><div class="t">我的批注 · ${fmtTime(note.ts)}</div>${esc(note.text)}</div>` : ""}
      </div>
      <div class="col-a">${renderAnswerCol(card, rec)}</div>
    </div>
  </article>`;
}

/* ---------------- 主区 ---------------- */
function go(bookId, partId) {
  state.bookId = bookId;
  state.partId = partId;
  location.hash = `#/${bookId}/${partId || ""}`;
  renderBooks();
  renderSidebar();
  renderMain();
  window.scrollTo({ top: 0 });
}

function renderMain() {
  if (state.query) return renderSearch();
  const rec = PARTLIST.get(`${state.bookId}|${state.partId}`);
  if (!rec) { $("#main").innerHTML = `<div class="empty-tip">从左侧选择章节</div>`; return; }
  const { book, unit, period, part } = rec;
  const totalCards = part.sections.reduce((a, s) => a + s.cards.length, 0);
  const totalItems = part.sections.reduce((a, s) => a + s.cards.reduce((x, c) => x + c.items.length, 0), 0);
  let html = `<div class="crumb">
    <h1>${esc(part.title || part.sections.map(s => s.type).join(" / "))}</h1>
    <span class="path">${esc(book.short)} › ${esc(unit.title)} › ${esc(period.title || "Period " + period.key)} › Part ${esc(part.roman)}</span>
    <span class="stat">${totalCards} 个题组 · ${totalItems} 道题</span>
  </div>`;
  html += part.sections.map((s) => `
    <div class="sec-h" id="sec-${s.id}">${esc(s.type)} <span class="tag">${s.cards.length} 组</span></div>
    ${s.cards.map((c) => renderCard(c.id)).join("")}
  `).join("");
  $("#main").innerHTML = html;
  bindCards();
}

function renderSearch() {
  const q = state.query.trim().toLowerCase();
  const res = [];
  for (const [id, rec] of IDX) {
    const c = rec.card;
    const hay = (c.passage + " " + c.items.map((i) => i.stem + " " + i.options.join(" ")).join(" ")).toLowerCase();
    if (hay.includes(q)) res.push({ id, rec, c });
    if (res.length > 300) break;
  }
  $("#main").innerHTML = `<div class="crumb"><h1>搜索「${esc(state.query)}」</h1>
      <span class="path">命中 ${res.length} 个题组</span></div>` +
    (res.length ? res.map(({ id, rec, c }) => {
      const p = cardPath(id);
      return `<div class="favrow" data-jump="${id}">
        <div class="l">${esc(p.book)}<br>${esc(fmtTime(Date.now()).slice(0, 10))}</div>
        <div class="r">
          <div class="where">${esc(p.book)} › ${esc(p.unit)} › ${esc(p.period)} › ${esc(p.type)}${p.label ? " " + p.label + "篇" : ""}</div>
          <div class="snip">${esc(snipOf(c))}</div>
        </div>
      </div>`;
    }).join("") : `<div class="empty-tip">没有命中，换个关键词试试</div>`);
  $$("#main .favrow").forEach((el) => el.addEventListener("click", () => jumpTo(el.dataset.jump)));
}

function jumpTo(cardId, opts = {}) {
  const rec = IDX.get(cardId);
  if (!rec) return;
  closeDrawer();
  state.query = "";
  $("#search").value = "";
  state.bookId = rec.book.id;
  state.partId = rec.part.id;
  location.hash = `#/${rec.book.id}/${rec.part.id}/${cardId}`;
  renderBooks();
  renderSidebar();
  renderMain();
  const el = document.getElementById("c-" + cardId);
  if (el) {
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.style.transition = "box-shadow .3s";
    el.style.boxShadow = "0 0 0 3px rgba(180,71,46,.35)";
    setTimeout(() => (el.style.boxShadow = ""), 1400);
    if (opts.openNote) openNote(cardId);
  }
}

/* ---------------- 卡片交互 ---------------- */
function bindCards() {
  $$("#main .card").forEach((el) => {
    const cardId = el.dataset.card;

    el.addEventListener("click", (ev) => {
      const pick = ev.target.closest("[data-pick]");
      if (pick) {
        const [n, k] = pick.dataset.pick.split(":");
        const my = store.myans[cardId] || (store.myans[cardId] = {});
        my[n] = my[n] === k ? "" : k;
        save("myans");
        renderMain();
        return;
      }
      const more = ev.target.closest("[data-more]");
      if (more) {
        const p = more.previousElementSibling;
        p.classList.remove("clamp");
        more.remove();
        return;
      }
      const act = ev.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "fav") toggleFav(cardId);
      else if (a === "note") openNote(cardId);
      else if (a === "edit") toggleEdit(cardId);
      else if (a === "src") openSource(cardId);
      else if (a === "save-edit") saveEdit(cardId, el);
      else if (a === "reset-edit") {
        delete store.edits[cardId];
        save("edits");
        renderMain();
        toast("已还原为 OCR 原文");
      }
    });
    el.addEventListener("change", (ev) => {
      const t = ev.target.closest("[data-pick-text]");
      if (t) {
        const my = store.myans[cardId] || (store.myans[cardId] = {});
        my[t.dataset.pickText] = t.value.trim().toUpperCase();
        save("myans");
      }
    });
  });
}

function toggleFav(cardId) {
  if (store.favs[cardId]) delete store.favs[cardId];
  else {
    const rec = IDX.get(cardId);
    store.favs[cardId] = { ts: Date.now(), book: rec.book.id, snip: snipOf(rec.card) };
  }
  save("favs");
  renderBooks();
  renderMain();
  if (state.drawer === "fav") renderDrawer();
  toast(store.favs[cardId] ? "已收藏" : "已取消收藏");
}

function toggleEdit(cardId) {
  const rec = IDX.get(cardId);
  const el = document.getElementById("c-" + cardId);
  if (!el) return;
  rec.card._editing = !rec.card._editing;
  el.outerHTML = renderCard(cardId);
  bindCards();
}

function saveEdit(cardId, el) {
  const rec = IDX.get(cardId);
  const base = effective(rec.card);
  const passage = el.querySelector('[data-edit="passage"]')?.value ?? base.passage;
  const items = base.items.map((it) => {
    const stemEl = el.querySelector(`[data-edit="stem"][data-n="${it.n}"]`);
    const optEl = el.querySelector(`[data-edit="opts"][data-n="${it.n}"]`);
    return {
      ...it,
      stem: stemEl ? stemEl.value : it.stem,
      options: optEl ? optEl.value.split("\n").map((s) => s.trim()).filter(Boolean) : it.options,
    };
  });
  store.edits[cardId] = { passage, items, ts: Date.now() };
  save("edits");
  rec.card._editing = false;
  renderMain();
  toast("已保存（仅本地）");
}

/* 批注 */
function openNote(cardId) {
  const rec = IDX.get(cardId);
  const n = noteOf(cardId) || { text: "", mark: 0, ts: 0 };
  const html = `<div style="max-width:680px">
    <div class="crumb"><h1>批注</h1><span class="path">${esc(pathOf(cardId))}</span></div>
    <div style="font-family:Georgia,serif;font-size:14px;color:#4b5360;background:#faf8f3;border:1px solid var(--line2);border-radius:8px;padding:10px 12px;margin-bottom:14px">
      ${esc(snipOf(rec.card))}</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn ${n.mark === 1 ? "on" : ""}" data-mark="1" style="${n.mark === 1 ? "background:#e9f3ec;border-color:#b8d8c3" : ""}">会了</button>
      <button class="btn" data-mark="2" style="${n.mark === 2 ? "background:#fdf3dd;border-color:#e6cf9a" : ""}">模糊</button>
      <button class="btn" data-mark="3" style="${n.mark === 3 ? "background:#fbeceb;border-color:#e6b6b3" : ""}">不会</button>
      <span style="font-size:12px;color:#8a8f98;align-self:center;margin-left:6px">掌握度用于复习筛选</span>
    </div>
    <textarea id="noteText" class="edit-area" style="min-height:170px;font-family:inherit;font-size:14px">${esc(n.text)}</textarea>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn" id="noteSave" style="background:var(--ink);color:#fff;border-color:var(--ink)">保存批注</button>
      <button class="btn ghost" id="noteDel">删除</button>
    </div>
    <div style="font-size:12px;color:#8a8f98;margin-top:10px">批注存在本地，不改动原题文字；复习时可只看有批注的题。</div>
  </div>`;
  openDrawer("note", html);
  let mark = n.mark;
  $$("#drawerBody [data-mark]").forEach((b) => b.addEventListener("click", () => {
    mark = Number(b.dataset.mark);
    $$("#drawerBody [data-mark]").forEach((x) => (x.style.background = x.style.borderColor = ""));
    b.style.background = mark === 1 ? "#e9f3ec" : mark === 2 ? "#fdf3dd" : "#fbeceb";
    b.style.borderColor = mark === 1 ? "#b8d8c3" : mark === 2 ? "#e6cf9a" : "#e6b6b3";
  }));
  $("#noteSave").addEventListener("click", () => {
    const text = $("#noteText").value.trim();
    if (!text && !mark) { delete store.notes[cardId]; save("notes"); }
    else store.notes[cardId] = { text, mark, ts: Date.now() };
    save("notes");
    closeDrawer();
    renderMain();
    toast("批注已保存");
  });
  $("#noteDel").addEventListener("click", () => {
    delete store.notes[cardId];
    save("notes");
    closeDrawer();
    renderMain();
    toast("已删除批注");
  });
}

/* 原文对照 */
function openSource(cardId) {
  const rec = IDX.get(cardId);
  const card = effective(rec.card);
  const doc = rec.book.docs.main;
  const pages = card.pages && card.pages.length ? card.pages : [card.page];
  let cur = 0;
  function draw() {
    const pg = pages[cur];
    const segs = (card.src || []).filter((s) => s.p === pg);
    const y0 = segs.length ? Math.min(...segs.map((s) => s.y0)) : 0;
    const y1 = segs.length ? Math.max(...segs.map((s) => s.y1)) : 0;
    $("#modalTitle").textContent = `${rec.book.short} · ${rec.section.type} ${card.label ? card.label + "篇" : ""} · 原书 P${pg}`;
    $("#modalNav").innerHTML = `
      <button class="btn icon" data-pg="-1" ${cur === 0 ? "disabled" : ""}>◀</button>
      <span>${cur + 1}/${pages.length}</span>
      <button class="btn icon" data-pg="1" ${cur === pages.length - 1 ? "disabled" : ""}>▶</button>
      ${card.ansPage && rec.book.docs.ans ? `<button class="btn" data-ans="1" style="margin-left:10px">看答案原页 P${card.ansPage}</button>` : ""}`;
    $("#modalBody").innerHTML = `<div class="pagewrap" style="max-width:${rec.book.docs.main.pages ? "820px" : "820px"}">
      <img src="data/pages/${doc.id}/p${String(pg).padStart(4, "0")}.webp" alt="P${pg}"
           onerror="this.onerror=null;this.src=this.src.replace('.webp','.jpg')">
      ${segs.length ? `<div class="hl" style="top:${(y0 * 100).toFixed(2)}%;height:${((y1 - y0) * 100).toFixed(2)}%"></div>` : ""}
    </div>`;
    $$("#modalNav [data-pg]").forEach((b) => b.addEventListener("click", () => {
      cur = Math.max(0, Math.min(pages.length - 1, cur + Number(b.dataset.pg)));
      draw();
    }));
    const ab = $("#modalNav [data-ans]");
    if (ab) ab.addEventListener("click", () => {
      $("#modalTitle").textContent = `${rec.book.short} · 答案册 P${card.ansPage}`;
      $("#modalNav").innerHTML = `<button class="btn" data-back="1">返回题目页</button>`;
      $("#modalBody").innerHTML = `<div class="pagewrap"><img src="data/pages/${rec.book.docs.ans.id}/p${String(card.ansPage).padStart(4, "0")}.webp" alt="ans"
        onerror="this.onerror=null;this.src=this.src.replace('.webp','.jpg')"></div>`;
      $("#modalNav [data-back]").addEventListener("click", draw);
    });
  }
  draw();
  $("#modal").classList.add("on");
}

/* ---------------- 抽屉 ---------------- */
function openDrawer(tab, html) {
  state.drawer = tab;
  $("#drawer").classList.add("on");
  $("#mask").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  renderTabs();
  $("#drawerBody").innerHTML = html;
}
function closeDrawer() {
  state.drawer = null;
  $("#drawer").classList.remove("on");
  $("#mask").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true");
}
function renderTabs() {
  const tabs = [["fav", "收藏夹"], ["notes", "批注"], ["data", "数据"]];
  $("#drawerTabs").innerHTML = tabs.map(([k, t]) =>
    `<button data-tab="${k}" class="${state.drawer === k ? "on" : ""}">${t}</button>`).join("");
  $$("#drawerTabs button").forEach((b) => b.addEventListener("click", () => {
    state.drawer = b.dataset.tab;
    renderTabs();
    renderDrawer();
  }));
}
function renderDrawer() {
  if (state.drawer === "fav") return renderFavs();
  if (state.drawer === "notes") return renderNotes();
  if (state.drawer === "data") return renderData();
}

function favRows(entries) {
  if (!entries.length) return `<div class="empty-tip">还没有收藏。题卡右上角 ☆ 即可收藏，会自动记下书名、章节和时间。</div>`;
  return entries.map(([id, f]) => {
    const p = cardPath(id);
    const n = noteOf(id);
    const mark = n && n.mark ? `<span class="chip ${n.mark === 1 ? "g" : n.mark === 2 ? "y" : "r"}">${{ 1: "会了", 2: "模糊", 3: "不会" }[n.mark]}</span>` : "";
    return `<div class="favrow" data-jump="${id}">
      <div class="l">${esc(ago(f.ts))}<br><span style="color:#b6b0a4">${esc(fmtTime(f.ts).slice(5, 16))}</span></div>
      <div class="r">
        <div class="where">${esc(p.book)} › ${esc(p.unit)} › ${esc(p.period)} › ${esc(p.type)}${p.label ? " " + p.label + "篇" : ""}</div>
        <div class="snip">${esc(f.snip || "")}</div>
        <div class="tagline">${mark}${n && n.text ? `<span class="chip">有批注</span>` : ""}</div>
      </div>
    </div>`;
  }).join("");
}

function renderFavs() {
  let entries = Object.entries(store.favs).sort((a, b) => b[1].ts - a[1].ts);
  const f = state.favFilter;
  if (f !== "all") {
    entries = entries.filter(([id]) => {
      const n = noteOf(id);
      return n && String(n.mark) === f;
    });
  }
  const cnt = Object.keys(store.favs).length;
  const html = `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <strong style="font-size:14px">共 ${cnt} 道收藏</strong>
      <span style="flex:1"></span>
      ${[["all", "全部"], ["1", "会了"], ["2", "模糊"], ["3", "不会"]].map(([k, t]) =>
        `<button class="btn ${state.favFilter === k ? "on" : ""}" data-filter="${k}" style="${state.favFilter === k ? "background:var(--ink);color:#fff;border-color:var(--ink)" : ""}">${t}</button>`).join("")}
      <button class="btn ghost" data-export="1">导出备份</button>
    </div>` + favRows(entries);
  $("#drawerBody").innerHTML = html;
  $$("#drawerBody [data-jump]").forEach((el) => el.addEventListener("click", () => jumpTo(el.dataset.jump)));
  $$("#drawerBody [data-filter]").forEach((b) => b.addEventListener("click", () => {
    state.favFilter = b.dataset.filter;
    renderFavs();
  }));
  const ex = $("#drawerBody [data-export]");
  if (ex) ex.addEventListener("click", exportBackup);
}

function renderNotes() {
  const entries = Object.entries(store.notes).sort((a, b) => b[1].ts - a[1].ts);
  if (!entries.length) {
    $("#drawerBody").innerHTML = `<div class="empty-tip">还没有批注。题卡右上角 ✎ 可写批注、标掌握度。</div>`;
    return;
  }
  $("#drawerBody").innerHTML = entries.map(([id, n]) => {
    const p = cardPath(id);
    return `<div class="favrow" data-jump="${id}">
      <div class="l">${esc(ago(n.ts))}</div>
      <div class="r">
        <div class="where">${esc(p.book)} › ${esc(p.unit)} › ${esc(p.type)}</div>
        <div class="snip">${esc(n.text || "（仅标记掌握度）")}</div>
      </div>
    </div>`;
  }).join("");
  $$("#drawerBody [data-jump]").forEach((el) => el.addEventListener("click", () => jumpTo(el.dataset.jump)));
}

function renderData() {
  const nFav = Object.keys(store.favs).length;
  const nNote = Object.keys(store.notes).length;
  const nEdit = Object.keys(store.edits).length;
  const nAns = Object.keys(store.myans).length;
  const books = LIB.books.map((b) => {
    const cards = b.units.flatMap((u) => u.periods.flatMap((p) => p.parts.flatMap((a) => a.sections.flatMap((s) => s.cards))));
    const items = cards.reduce((x, c) => x + c.items.length, 0);
    const withAns = cards.reduce((x, c) => x + c.items.filter((i) => ansOf(c, i)).length, 0);
    const docs = Object.entries(b.docs).map(([k, v]) => `${({ main: "主书", ans: "答案", key: "狂K重点" })[k]} ${v.pages}页`).join(" · ");
    return `<tr><td>${esc(b.short)}</td><td>${cards.length} 题组 / ${items} 题<br>
      <span style="color:#8a8f98">已配答案 ${withAns} 题 · ${docs}</span></td></tr>`;
  }).join("");
  $("#drawerBody").innerHTML = `
    <table class="helptable">
      <tr><td>收藏</td><td>${nFav} 条</td></tr>
      <tr><td>批注</td><td>${nNote} 条</td></tr>
      <tr><td>我的作答</td><td>${nAns} 题</td></tr>
      <tr><td>题目改写</td><td>${nEdit} 处（本地覆盖 OCR 原文）</td></tr>
      ${books}
    </table>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn" data-export="1">导出备份 JSON</button>
      <label class="btn" style="display:inline-flex;align-items:center">导入备份<input type="file" id="impFile" accept="application/json" hidden></label>
      <button class="btn ghost" data-clear="1">清空本地数据</button>
    </div>
    <p style="font-size:12px;color:#8a8f98;margin-top:14px">数据全部保存在本机浏览器 localStorage，不上传任何服务器。</p>`;
  const ex = $("#drawerBody [data-export]");
  if (ex) ex.addEventListener("click", exportBackup);
  $("#impFile")?.addEventListener("change", importBackup);
  $("#drawerBody [data-clear]")?.addEventListener("click", () => {
    if (!confirm("确定清空收藏、批注、作答与改写？此操作不可撤销。")) return;
    Object.keys(LS).forEach((k) => localStorage.removeItem(LS[k]));
    location.reload();
  });
}

function exportBackup() {
  const data = { v: 1, ts: Date.now(), ...store };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `必刷题库备份-${fmtTime(Date.now()).replace(/[: ]/g, "-")}.json`;
  a.click();
  toast("备份已导出");
}
function importBackup(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      ["favs", "notes", "myans", "edits"].forEach((k) => {
        if (d[k]) { store[k] = d[k]; write(LS[k], d[k]); }
      });
      toast("已导入");
      renderBooks(); renderMain();
    } catch (e) { toast("文件无法解析"); }
  };
  r.readAsText(f);
}

/* ---------------- 事件绑定 ---------------- */
$("#search").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  if (state.query) renderSearch();
  else renderMain();
});
$("#btnAns").addEventListener("click", () => {
  store.prefs.showAns = !store.prefs.showAns;
  save("prefs");
  renderBooks();
  renderMain();
});
$("#btnFav").addEventListener("click", () => { state.drawer = "fav"; openDrawer("fav", ""); renderDrawer(); });
$("#btnReview").addEventListener("click", () => {
  const entries = Object.entries(store.favs).sort((a, b) => b[1].ts - a[1].ts);
  if (!entries.length) { state.drawer = "fav"; openDrawer("fav", ""); renderFavs(); return; }
  openDrawer("fav", `<div class="crumb"><h1>复习</h1><span class="path">按收藏时间排序 · 点条目跳到题目</span></div>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      ${[["all", "全部"], ["1", "只看会了"], ["2", "只看模糊"], ["3", "只看不会"]].map(([k, t]) =>
        `<button class="btn" data-filter="${k}">${t}</button>`).join("")}
    </div><div id="reviewList">${favRows(entries)}</div>`);
  state.drawer = "fav";
  renderTabs();
  $$("#drawerBody [data-jump]").forEach((el) => el.addEventListener("click", () => jumpTo(el.dataset.jump)));
  $$("#drawerBody [data-filter]").forEach((b) => b.addEventListener("click", () => {
    state.favFilter = b.dataset.filter;
    state.drawer = "fav";
    renderFavs();
  }));
});
$("#btnHelp").addEventListener("click", () => {
  openDrawer("notes", `<div class="crumb"><h1>怎么用</h1></div>
  <table class="helptable">
    <tr><td>找书</td><td>顶栏四个标签切换四本书；左侧是「单元 → 课时 → 板块」目录。</td></tr>
    <tr><td>刷题</td><td>左边是题目、右边是答案，同一行对齐。点选项可记下你的答案，答案区会对错变色。</td></tr>
    <tr><td>遮答案</td><td>顶栏「答案：显示/遮挡」全局切换，自测时先遮住。</td></tr>
    <tr><td>收藏</td><td>题卡右上 ☆。收藏夹里能看到「哪本书 · 哪一章 · 什么时候」收的。</td></tr>
    <tr><td>批注</td><td>右上 ✎ 写笔记、标「会了/模糊/不会」。批注不改进原题文字，复习时按掌握度筛。</td></tr>
    <tr><td>改题</td><td>右上 ⌨ 可改 OCR 识别错的地方（如漏字、错字），保存只在本地，可一键还原原文。</td></tr>
    <tr><td>原文</td><td>右上 ▤ 直接看扫描原页并高亮该题位置；有答案册的还能跳到答案原页。</td></tr>
    <tr><td>搜索</td><td>顶栏搜索对全书题干、选项、原文做全文匹配。</td></tr>
  </table>
  <p style="font-size:12px;color:#8a8f98;margin-top:14px">题目文字由本机 OCR 生成，可能有识别错误（英文基本准确，中文小标题偶有偏差），以「原文」为准。</p>`);
});
$("#drawerClose").addEventListener("click", closeDrawer);
$("#mask").addEventListener("click", closeDrawer);
$("#modalClose").addEventListener("click", () => $("#modal").classList.remove("on"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeDrawer(); $("#modal").classList.remove("on"); }
});

/* ---------------- 启动 ---------------- */
function parseHash() {
  const m = location.hash.match(/^#\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return null;
  return { bookId: m[1], partId: m[2] || null };
}
(function init() {
  const h = parseHash();
  const book = (h && BOOKBY.get(h.bookId)) || LIB.books[0];
  state.bookId = book.id;
  state.partId = (h && h.partId) || book.units[0].periods[0].parts[0].id;
  renderBooks();
  renderSidebar();
  renderMain();
  window.addEventListener("hashchange", () => {
    const hh = parseHash();
    if (!hh) return;
    state.bookId = hh.bookId;
    state.partId = hh.partId || state.partId;
    renderBooks(); renderSidebar(); renderMain();
  });
})();
})();
