/* PDFScore — 벡터 PDF 밴드 스코어 해석기
 *
 * pdfvector.js가 뽑은 기호·선 목록에서
 *   1) 오선(5줄)·TAB(6줄/4줄)·단(system)·마디줄을 찾고
 *   2) 각 보표 안의 기호를 음표·쉼표·숫자 등으로 해석해
 *   3) 파트별 마디·박자·음높이·TAB·드럼으로 복원한다.
 * 좌표는 페이지 왼쪽 위 원점, pt 단위. */

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** 흰색(보표 줄을 가리는 바탕) 도형인가 */
export function isWhite(fill) {
  if (!fill || typeof fill !== "string" || fill[0] !== "#" || fill.length < 7) return false;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16));
  return r > 230 && g > 230 && b > 230;
}

/* ------------------------------------------------------------ 1) 오선 찾기 */

/** 가로로 긴 얇은 사각형 = 오선 줄. 같은 x 범위에서 일정한 간격으로 이어지는 줄을 묶는다 */
export function findStaves(page) {
  const raw = page.rects
    .filter(r => !isWhite(r.fill) && r.y1 - r.y0 < 0.9 && r.x1 - r.x0 > 40)
    .map(r => ({ x0: r.x0, x1: r.x1, y: (r.y0 + r.y1) / 2, gaps: [] }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  // 가운데가 비어 끊긴 보표 줄(코다 앞 빈칸 등)은 하나로 잇고 빈칸 위치를 기억한다
  // (끊긴 양쪽의 높이가 1pt 가까이 어긋나기도 하므로, 높이가 비슷한 조각끼리 모아 왼쪽부터 잇는다)
  const lines = [];
  for (let i = 0; i < raw.length;) {
    let j = i + 1;
    while (j < raw.length && raw[j].y - raw[j - 1].y < 1.2) j++;
    const grp = raw.slice(i, j).sort((a, b) => a.x0 - b.x0);
    const merged = [];
    for (const l of grp) {
      const last = merged[merged.length - 1];
      if (last && l.x0 > last.x1 - 1 && l.x0 - last.x1 < 30) { last.gaps.push([last.x1, l.x0]); last.x1 = l.x1; last.y = (last.y + l.y) / 2; }
      else merged.push({ ...l, gaps: [] });
    }
    lines.push(...merged);
    i = j;
  }
  lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const used = new Set();
  const staves = [];
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    let gap = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (used.has(j)) continue;
      const a = lines[group[group.length - 1]], b = lines[j];
      if (!near(a.x0, b.x0, 1) || !near(a.x1, b.x1, 1)) continue;
      const d = b.y - a.y;
      if (d < 1) continue;
      if (gap === null) { if (d > 8) break; gap = d; group.push(j); }
      else if (near(d, gap, 0.15)) group.push(j);
      else if (d > gap + 0.15) break;
    }
    if (group.length >= 4) {
      group.forEach(k => used.add(k));
      const ls = group.map(k => lines[k]);
      staves.push({
        x0: ls[0].x0, x1: ls[0].x1, lines: ls.map(l => l.y), gaps: ls[0].gaps,
        top: ls[0].y, bottom: ls[ls.length - 1].y,
        gap: (ls[ls.length - 1].y - ls[0].y) / (ls.length - 1),
        count: ls.length,
      });
    }
  }
  return staves;
}

/** 세로로 긴 얇은 사각형 = 마디줄/기둥/단 묶음선 */
export function verticalRects(page) {
  return page.rects.filter(r => !isWhite(r.fill) && r.x1 - r.x0 < 2.4 && r.y1 - r.y0 > 2) // 굵은 마디줄(약 1.8pt)까지
    .map(r => ({ x: (r.x0 + r.x1) / 2, w: r.x1 - r.x0, y0: r.y0, y1: r.y1 }));
}

/** 오선을 단(system)으로 묶는다: 왼쪽 끝 x가 같고, 맨 왼쪽 세로선이 위아래로 이어 주는 보표들 */
export function groupSystems(staves, verts) {
  const sorted = [...staves].sort((a, b) => a.top - b.top);
  const systems = [];
  for (const st of sorted) {
    const last = systems[systems.length - 1];
    const prev = last && last.staves[last.staves.length - 1];
    const joined = prev && near(prev.x0, st.x0, 1) && verts.some(v =>
      near(v.x, st.x0, 1.5) && v.y0 <= prev.top + 0.5 && v.y1 >= st.bottom - 0.5);
    if (joined) last.staves.push(st);
    else systems.push({ staves: [st] });
  }
  for (const s of systems) {
    s.top = s.staves[0].top;
    s.bottom = s.staves[s.staves.length - 1].bottom;
    s.x0 = s.staves[0].x0;
    s.x1 = s.staves[0].x1;
  }
  return systems;
}

/** 각 보표의 마디줄 x 좌표: 보표 높이 전체를 덮는 세로선 (기둥은 보표 일부만 덮음) */
export function findBarlines(staff, verts) {
  const xs = verts
    .filter(v => v.y0 <= staff.top + 0.3 && v.y1 >= staff.bottom - 0.3 && v.x > staff.x0 + 0.5)
    .map(v => ({ x: v.x, w: v.w }))
    .sort((a, b) => a.x - b.x);
  // 겹선(끝선·도돌이표)은 가까운 선을 하나로
  const out = [];
  for (const b of xs) {
    const last = out[out.length - 1];
    if (last && b.x - last.x < 4) { last.x1 = b.x; last.thick = last.thick || b.w > 1; last.double = true; }
    else out.push({ x: b.x, x1: b.x, thick: b.w > 1, double: false });
  }
  return out;
}

/* ------------------------------------------------- 2) 단 안의 마디 나누기 */

/** 단 전체에 공통인 마디줄 x: 보표 절반 이상에서 같은 x에 있는 세로선 */
export function systemBarlines(sys, verts) {
  const all = [];
  sys.staves.forEach((st, k) => findBarlines(st, verts).forEach(b => all.push({ ...b, k })));
  all.sort((a, b) => a.x - b.x);
  const clusters = [];
  for (const b of all) {
    const c = clusters[clusters.length - 1];
    if (c && b.x - c.x < 1.2) { c.staves.add(b.k); c.thick ||= b.thick; c.double ||= b.double; c.x1 = Math.max(c.x1, b.x1); }
    else clusters.push({ x: b.x, x1: b.x1, staves: new Set([b.k]), thick: b.thick, double: b.double });
  }
  const need = Math.ceil(sys.staves.length / 2);
  return clusters.filter(c => c.staves.size >= need);
}

/** 마디 경계 x 목록: 보표 왼쪽 끝(음자리표 포함)부터 마디줄들 */
export function measureEdges(staff, bars) {
  const xs = [staff.x0];
  // 보표가 끊긴 빈칸(코다 앞 등): 빈칸 바로 앞 마디줄과 빈칸 뒤 음자리표 자리의 마디줄은 버리고,
  // 빈칸 시작 하나만 경계로 둔다 (가짜 빈 마디가 생기지 않게)
  const gaps = staff.gaps || [];
  bars = bars.filter(b => !gaps.some(([a, c]) => b.x > a - 8 && b.x <= c + 45));
  bars = [...bars, ...gaps.map(([a]) => ({ x: a, x1: a }))].sort((a, b) => a.x - b.x);
  for (const b of bars) {
    if (b.x <= staff.x0 + 3) continue;
    // 음자리표·조표·박자표 바로 뒤의 마디줄(도돌이표 시작 등)은 마디 끝이 아니라 시작
    if (xs.length === 1 && b.x < staff.x0 + 45) { xs[0] = b.x1 ?? b.x; continue; }
    xs.push(b.x1 ?? b.x);
  }
  return xs;
}

/* ------------------------------------------------- 3) TAB 보표 해석 */

const DUR = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd" };
export { DUR };

/** 보표 범위 안의 기호 */
function inBand(g, staff, above, below) {
  const cy = (g.bbox[1] + g.bbox[3]) / 2;
  return cy >= staff.top - above && cy <= staff.bottom + below && g.x >= staff.x0 - 2 && g.x <= staff.x1 + 2;
}

/** 기둥: 가는 세로선. 보표 바깥(위/아래)으로 뻗은 것 */
function stemsNear(staff, verts, barXs, side) {
  const g = staff.gap;
  return verts.filter(v => v.w < 0.8 && (v.y1 - v.y0) > 2 && !barXs.some(x => Math.abs(x - v.x) < 0.8) &&
    v.x > staff.x0 && v.x < staff.x1 &&
    (side === "above"
      // 위에서 내려와 보표 위쪽 또는 보표 안(가장 높은 숫자 바로 위)에서 끝남
      ? v.y0 < staff.top - 0.3 && v.y1 >= staff.top - g * 1.2 && v.y1 < staff.bottom - 0.3
      : v.y1 > staff.bottom + 0.3 && v.y0 <= staff.bottom + g * 1.2 && v.y0 > staff.top + 0.3));
}

/** 빔: 가로로 긴 두꺼운 사각형(수평 빔). 기울어진 빔은 polys에 있으므로 함께 본다 */
function beamsOf(page) {
  // 짧은 빔 조각(점8분+16분의 16분 꼬리 빔)도 포함하도록 폭 1.2pt부터
  const out = page.rects.filter(r => !isWhite(r.fill) && r.y1 - r.y0 >= 0.9 && r.y1 - r.y0 <= 2.4 && r.x1 - r.x0 > 1.2)
    .map(r => ({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 }));
  // 빔은 평행사변형(점 4~6개). 하모닉스 마름모 테두리(점이 많은 다각형)는 빔이 아니다
  for (const p of page.polys) if (!isWhite(p.fill) && !p.curved && p.pts.length >= 4 && p.pts.length <= 6 && p.bbox[2] - p.bbox[0] > 2 && p.bbox[3] - p.bbox[1] < 12)
    out.push({ x0: p.bbox[0], x1: p.bbox[2], y0: p.bbox[1], y1: p.bbox[3], poly: p });
  // 기울어진 빔은 기호처럼 "이동 + 평행사변형"으로 그려지기도 한다
  for (const g of page.glyphs) {
    if (g.cls) continue;
    const ops = g.segs.map(q => q.op).join("");
    if (!/^0111(3)?$/.test(ops)) continue;
    const w = g.bbox[2] - g.bbox[0], h = g.bbox[3] - g.bbox[1];
    if (w < 2.2 || h > 12) continue; // 16분 꼬리 빔 조각은 폭이 2.8pt 정도
    // 세로로 평행한 두 변(같은 x 위에 두 점씩)이어야 빔
    const pts = g.segs.filter(q => q.op <= 1).map(q => q.pts[0]);
    const xs = [...new Set(pts.map(v => Math.round(v * 10)))];
    if (xs.length !== 2) continue;
    out.push({ x0: g.bbox[0], x1: g.bbox[2], y0: g.bbox[1], y1: g.bbox[3], sloped: true });
  }
  return out;
}
export { beamsOf };

/** 기둥 끝에 걸린 빔 개수 (빔 사이 간격 이상 떨어진 것은 따로 셈) */
function beamCount(stem, beams, tipY) {
  // 빔은 기둥에 닿아 있어야 한다 (바로 위 보표의 빔을 세지 않도록)
  const hits = beams.filter(b => stem.x >= b.x0 - 0.4 && stem.x <= b.x1 + 0.4 && b.y1 >= stem.y0 - 1.2 && b.y0 <= stem.y1 + 1.2 && Math.min(Math.abs(b.y0 - tipY), Math.abs(b.y1 - tipY), (b.y0 <= tipY && b.y1 >= tipY) ? 0 : 99) < 7.5)
    .map(b => (b.y0 + b.y1) / 2).sort((a, b) => a - b);
  let n = 0, last = -99;
  for (const y of hits) { if (y - last > 0.8) n++; last = y; }
  return n;
}

/**
 * TAB 보표 한 줄을 마디별 사건 목록으로
 * 사건: { x, dur(1,2,4,8,16,32), dots, notes:[{string, fret, dead, tie}], rest, tuplet, repeatPrev }
 */
export function parseTabStaff(page, staff, glyphs, verts, beams, bars, fulls = [], graceXs = []) {
  const g = staff.gap, lines = staff.lines;
  const barXs = bars.map(b => b.x);
  const mine = glyphs.filter(q => q.cls && inBand(q, staff, g * 2.5, g * 2.5));
  // 프렛 숫자 (두 자리는 붙여서)
  const digits = [];
  for (const q of mine) {
    if (!/^d\d$/.test(q.cls) && q.cls !== "tab_x" && q.cls !== "head_x") continue;
    // TAB 줄 위의 X 머리도 데드 노트. 단 기둥이 닿은 것만 (코드 다이어그램의 뮤트 표시 X 제외)
    if (q.cls === "head_x" && !verts.some(v => v.w < 0.8 && Math.abs(v.x - (q.bbox[0] + q.bbox[2]) / 2) < 1 &&
      (Math.abs(v.y1 - q.bbox[1]) < 2.5 || Math.abs(v.y0 - q.bbox[3]) < 2.5))) continue;
    const cy = (q.bbox[1] + q.bbox[3]) / 2;
    let best = -1, bd = 1e9;
    lines.forEach((y, i) => { const d = Math.abs(y - cy); if (d < bd) { bd = d; best = i; } });
    if (bd > g * 0.45) continue;
    digits.push({ x0: q.bbox[0], x1: q.bbox[2], string: best + 1, ch: q.cls === "tab_x" || q.cls === "head_x" ? "x" : q.cls.slice(1) });
  }
  digits.sort((a, b) => a.string - b.string || a.x0 - b.x0);
  const frets = [];
  for (const d of digits) {
    const last = frets[frets.length - 1];
    if (last && last.string === d.string && d.x0 - last.x1 < 1.8 && last.ch.length < 2 && last.ch !== "x" && d.ch !== "x" &&
      (last.ch === "1" || last.ch === "2") && +(last.ch + d.ch) <= 24) { last.ch += d.ch; last.x1 = d.x1; } // 프렛은 24 이하
    else frets.push({ ...d });
  }
  for (const f of frets) { f.x = (f.x0 + f.x1) / 2; f.fret = f.ch === "x" ? 0 : +f.ch; f.dead = f.ch === "x"; }
  // 괄호 안 숫자 = 붙임줄로 이어지는 음
  const parens = mine.filter(q => q.cls === "paren");
  for (const f of frets) {
    const l = parens.some(p => p.bbox[2] <= f.x0 + 0.5 && f.x0 - p.bbox[2] < 2.5 && Math.abs((p.bbox[1] + p.bbox[3]) / 2 - lines[f.string - 1]) < g);
    if (l) f.tie = true;
  }
  // 동그라미 숫자. 여러 줄 화음을 감싼 긴 타원은 기호가 아니라 곡선 도형으로 그려진다
  const circles = mine.filter(q => q.cls === "tab_circle").concat(page.polys.filter(p => p.curved && !isWhite(p.fill) &&
    p.bbox[2] - p.bbox[0] < g * 4 && p.bbox[3] - p.bbox[1] > g * 1.5 && p.bbox[3] - p.bbox[1] < g * 7 &&
    p.bbox[1] > staff.top - g * 2 && p.bbox[3] < staff.bottom + g * 2 && p.bbox[0] > staff.x0 && p.bbox[2] < staff.x1 &&
    frets.some(f => f.x > p.bbox[0] && f.x < p.bbox[2] && lines[f.string - 1] > p.bbox[1] && lines[f.string - 1] < p.bbox[3])));
  // 기둥 (TAB은 보표 위쪽에 짧은 기둥)
  // 기둥: 보표 근처의 가는 세로선(마디줄 제외). 숫자와 짝이 맞으면 숫자에서 먼 쪽 끝이 빔이 달리는 끝.
  // 숫자 없는 기둥(앞 화음 반복)은 옆 보표 기둥과 헷갈리지 않도록 TAB 맨 윗줄/아랫줄에 딱 붙어 끝나는 것만.
  const stems = [];
  const cands = verts.filter(v => {
    const h = v.y1 - v.y0;
    return v.w < 0.8 && h > 2 && h < staff.bottom - staff.top + g * 3 && v.x > staff.x0 && v.x < staff.x1 &&
      !barXs.some(x => Math.abs(x - v.x) < 0.8) && v.y1 >= staff.top - g * 1.2 && v.y0 <= staff.bottom + g * 1.2;
  });
  const headless = [];
  for (const v of cands) {
    // 기둥 끝이 숫자에 거의 닿아야 그 숫자의 기둥 (옆 보표 기둥 배제)
    let col = frets.filter(f => Math.abs(f.x - v.x) < 4.2 &&
      Math.min(Math.abs(v.y0 - lines[f.string - 1]), Math.abs(v.y1 - lines[f.string - 1])) < g * 1.1);
    // 동그라미 화음은 기둥이 동그라미 가장자리에 붙어 끝난다
    if (!col.length) {
      const c = circles.find(c => v.x >= c.bbox[0] - 0.6 && v.x <= c.bbox[2] + 0.6 &&
        ((v.y0 < c.bbox[1] && v.y1 > c.bbox[1] - 1 && v.y1 < c.bbox[3]) || (v.y1 > c.bbox[3] && v.y0 < c.bbox[3] + 1 && v.y0 > c.bbox[1])));
      if (c) col = frets.filter(f => f.x > c.bbox[0] && f.x < c.bbox[2] && lines[f.string - 1] > c.bbox[1] && lines[f.string - 1] < c.bbox[3]);
    }
    // 맨 위 줄 숫자에서 TAB 아래 빔까지 내려가는 긴 기둥은 숫자에 붙은 것만 (나머지는 마디줄 등)
    if (v.y1 - v.y0 >= staff.bottom - staff.top - 1 && !col.length) continue;
    if (col.length) {
      const cy = col.reduce((a, f) => a + lines[f.string - 1], 0) / col.length;
      const up = Math.abs(v.y0 - cy) > Math.abs(v.y1 - cy);
      stems.push({ ...v, side: up ? "above" : "below" });
    } else headless.push(v);
  }
  // 숫자 없는 기둥: 같은 보표의 숫자 있는 기둥들과 끝(빔 쪽) 높이가 같거나, TAB 줄에 딱 붙어 끝나는 것
  const topTips = stems.filter(v => v.side === "above").map(v => v.y0);
  const botTips = stems.filter(v => v.side === "below").map(v => v.y1);
  // 빗금 머리(리듬 빗금)는 TAB 안에 그려지고 기둥이 그 끝에 닿는다
  const slashHeads = mine.filter(q => q.cls === "repeat2" || (q.cls === "slash" && q.bbox[3] - q.bbox[1] > q.bbox[2] - q.bbox[0]));
  for (const v of headless) {
    const onSlash = slashHeads.some(q => v.x > q.bbox[0] && v.x < q.bbox[2] && Math.abs(v.y1 - q.bbox[1]) < 1.5);
    const upOk = v.y0 < staff.top + 1.5 && v.y1 >= staff.top - 1.5 &&
      (topTips.some(t => Math.abs(t - v.y0) < 0.8) || beamCount(v, beams, v.y0) > 0 || onSlash ||
       (v.y0 < staff.top - 0.3 && v.y1 <= staff.top + 1.0));
    const underSlash = slashHeads.some(q => v.x > q.bbox[0] && v.x < q.bbox[2] && Math.abs(v.y0 - q.bbox[3]) < 1.5);
    const downOk = v.y1 > staff.bottom - 1.5 && v.y0 <= staff.bottom + 1.5 &&
      (botTips.some(t => Math.abs(t - v.y1) < 0.8) || beamCount(v, beams, v.y1) > 0 || underSlash ||
       (v.y1 > staff.bottom + 0.3 && v.y0 >= staff.bottom - 1.0));
    if (upOk) stems.push({ ...v, side: "above" });
    else if (downOk) stems.push({ ...v, side: "below" });
  }
  const flags = mine.filter(q => q.cls === "flag" || q.cls === "flag16");
  const dots = glyphs.filter(q => q.cls === "dot" && q.x > staff.x0 && q.x < staff.x1 &&
    q.y > staff.top - g * 2.2 && q.y < staff.bottom + g * 2.2);
  const tuplets = glyphs.filter(q => (q.cls === "tuplet3" || q.cls === "tuplet6") && q.x > staff.x0 && q.x < staff.x1 &&
    ((q.bbox[1] < staff.top && q.y > staff.top - g * 4) || (q.bbox[3] > staff.bottom && q.y < staff.bottom + g * 4))); // 맨 줄에 걸쳐 찍히기도 한다
  const events = [];
  const usedFrets = new Set();
  // 각 숫자는 가장 가까운 기둥 하나에만 붙인다 (엇갈려 찍힌 화음 숫자가 옆 기둥에 붙지 않도록)
  const owner = new Map();
  for (const f of frets) {
    let best = null, bd = 4.2;
    for (const s of stems) { const d = Math.abs(f.x - s.x); if (d < bd) { bd = d; best = s; } }
    if (best) owner.set(f, best);
  }
  // 하모닉스 마름모 안 숫자는 화음이 좌우로 엇갈려 찍혀 기둥에서 조금 더 멀다
  const diamonds = page.polys.filter(p => !p.curved && !isWhite(p.fill) && p.pts.length > 8 &&
    Math.abs((p.bbox[2] - p.bbox[0]) - (p.bbox[3] - p.bbox[1])) < 1.5 && p.bbox[3] - p.bbox[1] > g * 1.8 && p.bbox[3] - p.bbox[1] < g * 3.5 &&
    p.bbox[1] > staff.top - g * 2 && p.bbox[3] < staff.bottom + g * 2 && p.bbox[0] > staff.x0 && p.bbox[2] < staff.x1);
  for (const f of frets) {
    if (!diamonds.some(d => f.x > d.bbox[0] && f.x < d.bbox[2] && lines[f.string - 1] > d.bbox[1] && lines[f.string - 1] < d.bbox[3])) continue;
    f.harmonic = true; // 마름모 = 자연 하모닉스
    if (owner.has(f)) continue;
    let best = null, bd = 6.5;
    for (const s of stems) { const d = Math.abs(f.x - s.x); if (d < bd) { bd = d; best = s; } }
    if (best) owner.set(f, best);
  }
  // 동그라미(긴 음) 안의 화음 숫자는 지그재그로 찍히므로, 하나가 기둥에 붙으면 같은 동그라미 안 숫자도 함께
  const inCircle = (f, c) => f.x >= c.bbox[0] - 0.5 && f.x <= c.bbox[2] + 0.5 &&
    lines[f.string - 1] >= c.bbox[1] - 0.5 && lines[f.string - 1] <= c.bbox[3] + 0.5;
  for (const c of circles) {
    const inside = frets.filter(f => inCircle(f, c));
    const s = inside.map(f => owner.get(f)).find(Boolean);
    if (s) for (const f of inside) owner.set(f, s);
  }
  // 꾸밈음: 기둥을 가로지르는 납작한 사선(리듬 빗금은 세로로 길다)
  const graceSlashes = mine.filter(q => q.cls === "slash" && q.bbox[2] - q.bbox[0] > (q.bbox[3] - q.bbox[1]) * 1.5);
  for (const s of stems) {
    const tip = s.side === "above" ? s.y0 : s.y1;
    // 꾸밈음: 사선이 기둥을 가로지르거나, 같은 파트 오선보의 같은 위치에 작은 머리가 있음
    const isGrace = graceSlashes.some(q => q.bbox[0] < s.x && q.bbox[2] > s.x && q.bbox[3] > s.y0 - 1 && q.bbox[1] < s.y1 + 1) ||
      frets.some(f => owner.get(f) === s && graceXs.some(x => Math.abs(x - f.x) < 2));
    if (isGrace) {
      frets.filter(f => owner.get(f) === s).forEach(f => usedFrets.add(f));
      continue;
    }
    let n = beamCount(s, beams, tip);
    n += flags.filter(f => Math.abs(f.bbox[0] - s.x) < 1.2 && f.bbox[1] < tip + 6 && f.bbox[3] > tip - 6).reduce((k, f) => k + (f.cls === "flag16" ? 2 : 1), 0);
    let col = frets.filter(f => owner.get(f) === s);
    col.forEach(f => usedFrets.add(f));
    // 같은 줄에 숫자가 둘이면 앞(왼쪽)의 것은 꾸밈음 → 뺀다
    col = col.filter(f => !col.some(o => o !== f && o.string === f.string && o.x > f.x));
    const circled = col.some(f => circles.some(c => f.x >= c.bbox[0] && f.x <= c.bbox[2]));
    const dur = n > 0 ? 4 * 2 ** n : circled ? 2 : 4;
    const x1 = Math.max(s.x, ...col.map(f => f.x1));
    events.push({ x: s.x, x1, dur, dots: 0, notes: col.map(f => ({ string: f.string, fret: f.fret, dead: f.dead, tie: !!f.tie, harmonic: !!f.harmonic })), stem: s });
  }
  // 기둥 없는 숫자 = 온음표(동그라미)
  const loose = frets.filter(f => !usedFrets.has(f));
  const looseCols = [];
  for (const f of loose.sort((a, b) => a.x - b.x)) {
    const c = looseCols[looseCols.length - 1];
    if (c && Math.abs(c.x - f.x) < 4.2) c.notes.push(f); else looseCols.push({ x: f.x, notes: [f] });
  }
  for (const c of looseCols) events.push({ x: c.x, x1: Math.max(...c.notes.map(f => f.x1)), dur: 1, dots: 0, notes: c.notes.map(f => ({ string: f.string, fret: f.fret, dead: f.dead, tie: !!f.tie })) });
  // 쉼표
  for (const q of mine) {
    const d = { rest4: 4, rest8: 8, rest16: 16 }[q.cls];
    if (d) events.push({ x: (q.bbox[0] + q.bbox[2]) / 2, dur: d, dots: 0, rest: true, notes: [] });
  }
  events.push(...rectRests(page, staff, verts).filter(r => !r.voice)); // 오선 바깥 쉼표는 일반 보표에만
  // 점: 사건 오른쪽 가까이
  events.sort((a, b) => a.x - b.x);
  // 속 빈 빗금 머리(2분음표 리듬 빗금): 기둥이 "//"를 꿰뚫지 않고 그 끝에 붙어 있다. 기둥을 꿰뚫으면 트레몰로
  const hollowSlash = new Set();
  for (const q of mine.filter(q => q.cls === "repeat2")) {
    const cy = (q.bbox[1] + q.bbox[3]) / 2;
    const ev = events.find(e => e.stem && !e.notes.length && e.stem.x > q.bbox[0] && e.stem.x < q.bbox[2] && !(e.stem.y0 < cy - 1 && e.stem.y1 > cy + 1) &&
      Math.abs(e.stem.y1 - q.bbox[1]) < 1.5); // 아래로 기둥이 달린 "//"는 박 반복 기호
    if (ev) { if (ev.dur === 4) ev.dur = 2; ev.x1 = Math.max(ev.x1 ?? ev.x, q.bbox[2] + 1); hollowSlash.add(q); } // 기울어진 빗금이라 점은 조금 더 떨어져 찍힌다
  }
  // 겹점의 두 번째 열은 첫 열 바로 오른쪽에 같은 높이로 찍힌다
  const dotOwner = new Map();
  for (const d of [...dots].sort((a, b) => a.bbox[0] - b.bbox[0])) {
    const dx = (d.bbox[0] + d.bbox[2]) / 2, dy = (d.bbox[1] + d.bbox[3]) / 2;
    let best = null;
    for (const e of events) if ((e.x1 ?? e.x) + 0.2 < dx && dx - (e.x1 ?? e.x) < 5) best = e;
    const left = [...dotOwner].find(([o]) => Math.abs((o.bbox[1] + o.bbox[3]) / 2 - dy) < 0.6 && dx - (o.bbox[0] + o.bbox[2]) / 2 > 1 && dx - (o.bbox[0] + o.bbox[2]) / 2 < 3.5);
    if (left) best = left[1];
    if (best) { (best.dotXs ||= []).push(dx); dotOwner.set(d, best); }
  }
  // 점이 가로로 두 열이면 겹점
  for (const e of events) if (e.dotXs) {
    const xs = e.dotXs.sort((a, b) => a - b);
    e.dots = xs.some((x, i) => i && x - xs[i - 1] > 0.8) ? 2 : 1;
    delete e.dotXs;
  }
  // 셋잇단: '3' 아래(위)의 빔으로 묶인 기둥들
  for (const t of tuplets) markTuplet(events, t, glyphs);
  // 마디별로 나누고, 숫자 없는 기둥은 앞 화음 반복
  const measures = [];
  const edges = measureEdges(staff, bars);
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    const m = events.filter(e => e.x > a + 0.5 && e.x < b - 0.5);
    m.x0 = a; m.x1 = b;
    measures.push(m);
  }
  let prev = null;
  for (const m of measures) for (const e of m) {
    if (!e.rest && e.notes.length === 0) { e.notes = prev ? prev.map(n => ({ ...n, tie: false })) : []; e.repeatPrev = true; }
    if (e.notes.length) prev = e.notes;
  }
  // 기둥에 겹친 "//" = 트레몰로(그 음 길이 동안 16분음표로 연타). 그 밖의 "//"는 박 반복 기호
  const signs = [];
  for (const q of mine.filter(q => (q.cls === "repeat1" || q.cls === "repeat2") && !hollowSlash.has(q))) {
    const cx = (q.bbox[0] + q.bbox[2]) / 2;
    const ev = q.cls === "repeat2" && events.find(e => e.stem && Math.abs(e.stem.x - cx) < 2.5);
    if (ev) ev.tremolo = 16; else signs.push(q);
  }
  applyRepeatSigns(measures, edges, signs);
  const bigParens = mine.filter(q => q.cls === "paren" && q.bbox[3] - q.bbox[1] > g * 2);
  // 마디 길이는 박자표대로 (2/4 마디 등)
  measures.forEach((m, i) => fixOverfull(m, bigParens, fulls[i] ?? 1));
  measures.forEach((m, i) => fillAmbiguous(m, edges[i + 1], fulls[i] ?? 1));
  return measures;
}

/** 2/4·3/4 마디의 온쉼표는 "마디 쉼표"(그 마디 전체를 쉼) — 혼자 있는 성부·보표면 마디 길이로 바꾼다 */
function barRest(m, full) {
  if (!(full < 1)) return m;
  const fit = { 0.25: [4, 0], 0.5: [2, 0], 0.75: [2, 1] }[full];
  if (!fit) return m;
  for (const e of m) {
    if (!e.rest || e.dur !== 1) continue;
    const same = m.filter(o => (o.voice || 1) === (e.voice || 1) && (o.staff || 0) === (e.staff || 0));
    if (same.length === 1) { e.dur = fit[0]; e.dots = fit[1]; }
  }
  return m;
}

/** 오선보의 작은 음표머리(꾸밈음) 가로 위치. 작은 X 머리는 보통 X 머리와 모양이 같고 크기만 작아 분류되지 않는다 */
function smallHeadXs(staff, glyphs) {
  const g = staff.gap;
  return glyphs.filter(q => {
    const cy = (q.bbox[1] + q.bbox[3]) / 2, w = q.bbox[2] - q.bbox[0];
    if (q.x < staff.x0 || q.x > staff.x1 || cy < staff.top - g * 3 || cy > staff.bottom + g * 3) return false;
    return q.cls === "head_small" || (!q.cls && w < 2.1 && w > 1 && q.segs.map(z => z.op).join("") === "011111111111");
  }).map(q => (q.bbox[0] + q.bbox[2]) / 2);
}

/**
 * 마디가 넘칠 때의 보정
 *  1) "( … ) 2×" 괄호: 반복할 때만 바꿔 치는 부분이므로 괄호 안 음을 뺀다
 *  2) 기둥 없는 긴 음(동그라미 TAB 등)이 하나면 마디 남은 길이에 맞춘다 (온음표/점2분/2분/4분)
 *  3) 4/4에서 점온음표는 있을 수 없으므로(도돌이표 점 오인) 점을 뗀다
 */
export function fixOverfull(m, parens, full = 1) {
  if (measureLength(m) <= full + 1e-6) return;
  // 점8분 바로 옆의 8분은 16분 (짧은 빔 조각을 놓친 경우): 점8분+16분 / 16분+점8분
  const seq = [...m].filter(e => !e.rest).sort((a, b) => a.x - b.x);
  for (let i = 0; i + 1 < seq.length && measureLength(m) > full + 1e-6; i++) {
    const a = seq[i], b = seq[i + 1];
    if (!a.stem || !b.stem || a.dur !== 8 || b.dur !== 8) continue;
    if (a.dots && !b.dots) b.dur = 16;
    else if (b.dots && !a.dots) a.dur = 16;
  }
  if (measureLength(m) <= full + 1e-6) return;
  for (const e of m) if (e.dur === 1 && e.dots && full <= 1) e.dots = 0;
  if (measureLength(m) <= full + 1e-6) return;
  if (dropParenAlt(m, parens, full)) return;
  const open = parens.filter(q => q.x > (m.x0 ?? -1e9) && q.x < (m.x1 ?? 1e9)).sort((a, b) => a.x - b.x)[0];
  if (open) {
    const keep = m.filter(e => e.x < open.bbox[0]);
    if (keep.length && measureLength(keep) <= full + 1e-6) m.splice(0, m.length, ...keep);
  }
  const loose = m.filter(e => !e.stem && !e.rest && e.dur === 1);
  if (loose.length === 1 && measureLength(m) > full + 1e-6) {
    const others = measureLength(m.filter(e => e !== loose[0]));
    const left = full - others;
    const opts = [[1, 0], [2, 1], [2, 0], [4, 1], [4, 0], [8, 0]];
    const hit = opts.find(([d, dot]) => Math.abs((1 / d) * (dot ? 1.5 : 1) - left) < 1e-6);
    if (hit) { loose[0].dur = hit[0]; loose[0].dots = hit[1]; }
  }
}

/**
 * "2× ( … )": 괄호 쌍이 마디 안에 있으면 그 사이(반복할 때만 바꾸는 부분)를 뺀다.
 * 빼고 나서 마디 길이가 정확히 맞을 때만 (괄호 안이 꼭 필요한 음이면 둔다)
 */
function dropParenAlt(m, parens, full) {
  if (measureLength(m) <= full + 1e-6) return false;
  const inM = parens.filter(q => q.x > (m.x0 ?? -1e9) && q.x < (m.x1 ?? 1e9)).sort((a, b) => a.x - b.x);
  if (inM.length < 2) return false;
  const [o, c] = inM;
  // 괄호의 세로 범위 안에 있는 음만 (바로 위아래의 다른 음은 괄호 밖)
  const y0 = Math.min(o.bbox[1], c.bbox[1]) - 0.5, y1 = Math.max(o.bbox[3], c.bbox[3]) + 0.5;
  const yOf = e => e.notes?.length ? e.notes.reduce((a, n) => a + (n.cy ?? (y0 + y1) / 2), 0) / e.notes.length : e.cy ?? (y0 + y1) / 2;
  const inside = e => !(e.x < o.bbox[0] || e.x > c.bbox[2] || yOf(e) < y0 || yOf(e) > y1);
  const fits = k => k.length < m.length && Math.abs(measureLength(k) - full) < 1e-6;
  let keep = m.filter(e => !inside(e));
  // 괄호 안에 두 성부(같은 머리를 두 번 그린 대안)가 있으면 한 성부만 빼 본다 — 괄호 밖에도 음이 있는 마디만
  const inX = e => e.x >= o.bbox[0] && e.x <= c.bbox[2];
  if (!fits(keep) && m.some(e => !e.rest && !inX(e))) {
    // 괄호(대안)는 대안 성부 쪽 높이에 그려지므로, 괄호에 가까운 성부부터 뺀다
    const pc = (y0 + y1) / 2;
    const near = v => { const es = m.filter(e => inX(e) && (e.voice || 1) === v); return es.length ? es.reduce((a, e) => a + Math.abs(yOf(e) - pc), 0) / es.length : 1e9; };
    keep = [1, 2].sort((a, b) => near(a) - near(b)).map(v => m.filter(e => !inX(e) || (e.voice || 1) !== v)).find(fits);
  }
  if (!keep || !fits(keep)) return false;
  for (const e of keep) e.voice = 1;
  m.splice(0, m.length, ...keep);
  return true;
}

/**
 * 머리 없는 기둥(앞 화음 반복)은 4분음표인지 2분음표인지 모양으로 알 수 없다.
 * 마디가 모자라면 다음 음까지 간격이 가장 넓은 것부터 2분음표로 늘린다.
 */
export function fillAmbiguous(m, endX, full = 1) {
  let len = measureLength(m);
  if (len >= full - 1e-6) return;
  const sorted = [...m].sort((a, b) => a.x - b.x);
  const cands = sorted.filter(e => e.stem && e.dur === 4 && !e.dots && !e.tuplet)
    .map(e => { const i = sorted.indexOf(e); return { e, gap: (i + 1 < sorted.length ? sorted[i + 1].x : endX) - e.x }; })
    .sort((a, b) => b.gap - a.gap);
  for (const c of cands) {
    if (len + 0.25 > full + 1e-6) break;
    c.e.dur = 2; c.e.inferred = true;
    len += 0.25;
  }
}

/**
 * 반복 기호 처리
 *  %  (repeat1): 앞 마디 전체를 그대로
 *  // (repeat2): 같은 마디 안에서 그 앞의 박들을 마디가 찰 때까지 되풀이
 */
export function applyRepeatSigns(measures, edges, signs, full = 1) {
  const copy = e => ({ ...e, notes: e.notes.map(n => ({ ...n })), stem: undefined, copied: true });
  for (const sg of signs) {
    const cx = (sg.bbox[0] + sg.bbox[2]) / 2;
    // 마디줄 위에 걸쳐 있으면 두 마디 반복: 그 앞뒤 두 마디 = 바로 앞의 두 마디
    const onBar = edges.findIndex((x, k) => k > 0 && k < edges.length - 1 && Math.abs(cx - x) < 3);
    if (onBar > 0) {
      const a = onBar - 1, b = onBar;
      if (measures[a].length === 0 && measures[b].length === 0) measures[a].repeatOf2 = true;
      continue;
    }
    const i = edges.findIndex((x, k) => k < edges.length - 1 && cx > x && cx < edges[k + 1]);
    if (i < 0) continue;
    const m = measures[i];
    if (sg.cls === "repeat1" && m.length === 0 && i > 0) {
      measures[i] = measures[i - 1].map(copy);
      measures[i].forEach(e => (e.x = (edges[i] + edges[i + 1]) / 2));
      measures[i].repeatOf = i - 1;
    } else if (sg.cls === "repeat2") {
      // 같은 마디 안에서: 앞 경계(마디 시작 또는 앞 "//")부터 이 기호까지의 박을 한 번 되풀이
      const prevSign = signs.filter(o => o !== sg && o.cls === "repeat2")
        .map(o => (o.bbox[0] + o.bbox[2]) / 2).filter(x => x < cx && x > edges[i]).sort((a, b) => b - a)[0] ?? edges[i];
      const group = m.filter(e => e.x > prevSign && e.x < cx && !e.copied);
      if (!group.length) continue;
      const glen = measureLength(group);
      if (measureLength(m) + glen <= full + 1e-6) m.push(...group.map(e => ({ ...copy(e), x: cx })));
      sg.group = group; sg.m = m; sg.cx = cx;
    }
  }
  // 마지막 "//" 뒤로 마디가 아직 비면 그 묶음을 더 되풀이
  for (const sg of signs) {
    if (!sg.group || !sg.group.length) continue;
    const later = signs.some(o => o !== sg && o.m === sg.m && o.cx > sg.cx);
    if (later) continue;
    const glen = measureLength(sg.group);
    while (measureLength(sg.m) + glen <= full + 1e-6) sg.m.push(...sg.group.map(e => ({ ...copy(e), x: sg.cx + 0.1 })));
  }
}

/**
 * 온쉼표/2분쉼표: 보표 줄에 매달리거나(온쉼표) 올라앉은(2분쉼표) 작은 굵은 사각형.
 * 빔 조각과 헷갈리지 않도록 줄에 딱 붙어 있고 기둥과 닿지 않는 것만.
 */
export function rectRests(page, staff, verts) {
  const out = [], g = staff.gap, lines = staff.lines;
  const mid = lines[Math.floor((lines.length - 1) / 2)];
  for (const r of page.rects) {
    if (isWhite(r.fill)) continue;
    const h = r.y1 - r.y0, w = r.x1 - r.x0;
    if (h < 1.2 || h > g * 0.75 || w < 3 || w > 9 || r.x0 < staff.x0 + 10 || r.x1 > staff.x1) continue;
    // 2성부 마디의 쉼표는 오선 바깥에 붙는다: 위 성부는 맨 윗줄에 앉은 2분쉼표, 아래 성부는 맨 아랫줄에 매달린 온쉼표
    const above = Math.abs(r.y1 - staff.top) < 0.45 && r.y0 < staff.top - 0.3;
    const below = Math.abs(r.y0 - staff.bottom) < 0.45 && r.y1 > staff.bottom + 0.3;
    if (!above && !below && (r.y0 < staff.top - 0.3 || r.y1 > staff.bottom + 0.3)) continue;
    const hang = lines.find(y => Math.abs(r.y0 - y) < 0.45);   // 줄 아래에 매달림 = 온쉼표
    const sit = lines.find(y => Math.abs(r.y1 - y) < 0.45);    // 줄 위에 앉음 = 2분쉼표
    if (hang === undefined && sit === undefined) continue;
    if (verts.some(v => v.w < 0.8 && v.x > r.x0 - 0.6 && v.x < r.x1 + 0.6 && v.y0 < r.y1 && v.y1 > r.y0)) continue;
    const whole = below || (!above && hang !== undefined && hang <= mid + 0.5);
    out.push({ x: (r.x0 + r.x1) / 2, dur: whole ? 1 : 2, dots: 0, rest: true, notes: [], whole, voice: above ? 1 : below ? 2 : 0 });
  }
  return out;
}

/**
 * 셋잇단 "3": 숫자 가운데에 가장 가까운, 길이가 같은 연속 3개 음에 표시한다
 * (8분 셋잇단은 좁고 4분 셋잇단은 넓게 퍼져 있으므로 거리 대신 순서로 고른다)
 */
function markTuplet(events, t, glyphs = []) {
  const cx = (t.bbox[0] + t.bbox[2]) / 2;
  const n = t.cls === "tuplet6" ? 6 : 3; // 6잇단(16분 6개 = 8분 셋잇단 길이)도 길이 비율은 2/3
  // 숫자 양옆에 괄호선(브래킷)이 있으면 그 범위 안의 음 전부 (4분+8분처럼 길이가 섞인 셋잇단)
  const br = glyphs.find(q => !q.cls && q.bbox[0] < cx - 3 && q.bbox[2] > cx + 3 && q.bbox[2] - q.bbox[0] > 8 &&
    q.bbox[3] - q.bbox[1] < 6 && q.bbox[1] < t.bbox[3] + 1 && q.bbox[3] > t.bbox[1] - 1);
  if (br) {
    const all = events.filter(e => !e.tuplet && e.x > br.bbox[0] - 1.5 && e.x < br.bbox[2] + 1.5);
    // 2성부(드럼 등)는 성부마다 따로 묶여 있으므로 길이가 맞는 성부 하나만
    const ok = g => g.length >= 2 && [1 / 8, 1 / 4, 1 / 2].some(v => Math.abs(measureLength(g) * 2 / 3 - v) < 1e-6);
    const by = (br.bbox[1] + br.bbox[3]) / 2;
    const yOf = e => e.notes.length ? e.notes.reduce((a, n) => a + (n.cy ?? by), 0) / e.notes.length : e.cy ?? by;
    const dist = v => { const es = all.filter(e => (e.voice || 1) === v); return es.length ? Math.abs(es.reduce((a, e) => a + yOf(e), 0) / es.length - by) : 1e9; };
    const voices = [1, 2].sort((a, b) => dist(a) - dist(b)); // 브래킷에 가까운 성부부터
    const grp = [all, ...voices.map(v => all.filter(e => (e.voice || 1) === v))].find(ok);
    if (grp) { grp.forEach(e => (e.tuplet = n)); return; }
  }
  const evs = events.filter(e => !e.tuplet).sort((a, b) => a.x - b.x);
  let best = null, bd = Infinity;
  for (let i = 0; i + n - 1 < evs.length; i++) {
    const grp = evs.slice(i, i + n), last = grp[n - 1];
    if (!grp.every(e => e.dur === grp[0].dur)) continue;
    const mid = (grp[0].x + (last.x1 ?? last.x)) / 2;
    const span = (last.x1 ?? last.x) - grp[0].x;
    const d = Math.abs(mid - cx);
    if (d < bd && d < Math.max(8, span * 0.6)) { bd = d; best = grp; }
  }
  if (best) best.forEach(e => (e.tuplet = n));
}

/** 사건 길이 합 (온음표 = 1) */
export function measureLength(events) {
  let sum = 0;
  for (const e of events) {
    let v = 1 / e.dur;
    if (e.dots) v *= e.dots === 2 ? 1.75 : 1.5;
    if (e.tuplet) v *= 2 / 3;
    sum += v;
  }
  return sum;
}

/* ------------------------------------------------- 4) 오선보(보컬·건반) 해석 */

const HEADS = new Set(["head_black", "head_half", "head_whole", "head_x", "head_xo", "slash"]);
const STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"];

/** 보표 맨 앞의 음자리표 */
export function clefOf(staff, glyphs) {
  const c = glyphs.filter(q => (q.cls === "clef_g" || q.cls === "clef_f" || q.cls === "clef_g8") && q.x < staff.x0 + 30 &&
    (q.bbox[1] + q.bbox[3]) / 2 > staff.top - staff.gap && (q.bbox[1] + q.bbox[3]) / 2 < staff.bottom + staff.gap)
    .sort((a, b) => a.x - b.x)[0];
  return c ? (c.cls === "clef_f" ? "F" : c.cls === "clef_g8" ? "G8" : "G") : null;
}

/** 보표 맨 앞(음자리표 바로 뒤)의 조표: 샵/플랫 개수 (+는 샵, -는 플랫) */
export function keyOf(staff, glyphs, firstNoteX) {
  const acc = glyphs.filter(q => (q.cls === "sharp" || q.cls === "flat") && q.x > staff.x0 + 6 && q.x < Math.min(firstNoteX - 3, staff.x0 + 60) &&
    (q.bbox[1] + q.bbox[3]) / 2 > staff.top - staff.gap * 1.5 && (q.bbox[1] + q.bbox[3]) / 2 < staff.bottom + staff.gap);
  const sharps = acc.filter(q => q.cls === "sharp").length, flats = acc.filter(q => q.cls === "flat").length;
  return sharps ? sharps : -flats;
}

const KEY_SHARPS = ["F", "C", "G", "D", "A", "E", "B"], KEY_FLATS = ["B", "E", "A", "D", "G", "C", "F"];
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 음 위치(맨 아랫줄 기준 반칸 단위) → 음이름·옥타브 */
function pitchAt(staff, cy, clef) {
  const half = staff.gap / 2;
  const n = Math.round((staff.bottom - cy) / half); // 맨 아랫줄 = 0
  // 높은음자리표 맨 아랫줄 = E4, 낮은음자리표 = G2
  // 8 아래 높은음자리표(남성 보컬 등)는 한 옥타브 낮게 소리 난다
  const base = clef === "F" ? { step: 4, oct: 2 } : clef === "G8" ? { step: 2, oct: 3 } : { step: 2, oct: 4 };
  const idx = base.step + n + base.oct * 7;
  return { step: STEP_NAMES[((idx % 7) + 7) % 7], oct: Math.floor(idx / 7), pos: n };
}

/**
 * 오선보 한 줄 → 마디별 사건
 * 사건: { x, dur, dots, notes:[{step, oct, alter, x?}], rest, tuplet, voice(1/2), tie }
 */
export function parseStdStaff(page, staff, glyphs, verts, beams, bars, opts = {}) {
  const g = staff.gap;
  const barXs = bars.map(b => b.x);
  const clef = opts.clef || clefOf(staff, glyphs) || "G";
  const near = glyphs.filter(q => q.cls && q.x > staff.x0 - 2 && q.x < staff.x1 + 2 &&
    (q.bbox[1] + q.bbox[3]) / 2 > staff.top - g * 5 && (q.bbox[1] + q.bbox[3]) / 2 < staff.bottom + g * 5);
  // 음표머리는 가장 가까운 보표의 것 (위아래 보표의 덧줄 음과 헷갈리지 않게)
  const distTo = (st, cy) => cy < st.top ? st.top - cy : cy > st.bottom ? cy - st.bottom : 0;
  const allStaves = [staff, ...(opts.others || []).filter(o => o !== staff)];
  const ownerOf = cy => allStaves.reduce((b, o) => distTo(o, cy) < distTo(b, cy) ? o : b, staff);
  // 화음은 한 덩어리로: 같은 x에 세로로 이어진 머리들 중 보표에 가장 붙어 있는 머리가 정한 보표의 것
  // (오른손 화음의 덧줄 아래 머리가 왼손 보표에 더 가까워도 오른손 것)
  const allHeads = glyphs.filter(q => HEADS.has(q.cls));
  const cyOf = q => (q.bbox[1] + q.bbox[3]) / 2;
  const mineHead = q => {
    const cl = [q];
    for (let grow = true; grow;) {
      grow = false;
      for (const h of allHeads) if (!cl.includes(h) && Math.abs(h.bbox[0] - q.bbox[0]) < 1 && cl.some(c => Math.abs(cyOf(c) - cyOf(h)) < g * 1.6)) { cl.push(h); grow = true; }
    }
    const anchor = cl.reduce((b, h) => distTo(ownerOf(cyOf(h)), cyOf(h)) < distTo(ownerOf(cyOf(b)), cyOf(b)) ? h : b);
    return ownerOf(cyOf(anchor)) === staff;
  };
  const heads = near.filter(q => HEADS.has(q.cls) && q.x > staff.x0 + 8 && mineHead(q));
  const firstX = Math.min(...heads.map(h => h.bbox[0]), staff.x1);
  const key = opts.key ?? keyOf(staff, glyphs, firstX);
  const stems = verts.filter(v => v.w < 0.8 && v.y1 - v.y0 > g * 1.5 && v.x > staff.x0 && v.x < staff.x1 &&
    !barXs.some(x => Math.abs(x - v.x) < 0.8) && v.y1 > staff.top - g * 6 && v.y0 < staff.bottom + g * 6);
  const flags = near.filter(q => q.cls === "flag" || q.cls === "flag16");
  // 머리 → 기둥 연결: 머리 오른쪽 끝(위로 뻗은 기둥) 또는 왼쪽 끝(아래로 뻗은 기둥)에 닿고 세로로 겹침
  const stemOf = new Map();
  for (const h of heads) {
    if (h.cls === "head_whole") continue;
    const cy = (h.bbox[1] + h.bbox[3]) / 2;
    let best = null, bd = 1.3;
    // 두 성부가 같은 음을 공유하면 같은 머리가 두 번 그려진다 — 겹친 쌍은 서로 다른 기둥에
    const twin = heads.find(o => o !== h && stemOf.has(o) && o.bbox.every((v, i) => Math.abs(v - h.bbox[i]) < 0.1));
    for (const s of stems) {
      if (twin && stemOf.get(twin) === s) continue;
      // 보통 머리는 가장자리에, X 머리는 가운데에 기둥이 붙는다
      const dx = h.cls === "head_x" || h.cls === "head_xo" ? Math.abs(s.x - (h.bbox[0] + h.bbox[2]) / 2)
        : Math.min(Math.abs(s.x - h.bbox[2]), Math.abs(s.x - h.bbox[0]));
      if (dx < bd && s.y0 <= cy + g * 0.8 && s.y1 >= cy - g * 0.8) { bd = dx; best = s; }
    }
    if (best) stemOf.set(h, best);
  }
  const groups = new Map();
  for (const [h, s] of stemOf) { if (!groups.has(s)) groups.set(s, []); groups.get(s).push(h); }
  const events = [];
  const mkNotes = hs => hs.map(h => {
    const cy = (h.bbox[1] + h.bbox[3]) / 2;
    const p = pitchAt(staff, cy, clef);
    return { ...p, x0: h.bbox[0], x1: h.bbox[2], cy, xhead: h.cls === "head_x" || h.cls === "head_xo", ring: h.cls === "head_xo", slash: h.cls === "slash" };
  });
  for (const [s, hs] of groups) {
    const cyAvg = hs.reduce((a, h) => a + (h.bbox[1] + h.bbox[3]) / 2, 0) / hs.length;
    const up = Math.abs(s.y0 - cyAvg) > Math.abs(s.y1 - cyAvg);
    const tip = up ? s.y0 : s.y1;
    let n = beamCount(s, beams, tip);
    n += flags.filter(f => Math.abs(f.bbox[0] - s.x) < 1.2 && f.bbox[1] < tip + 7 && f.bbox[3] > tip - 7).reduce((k, f) => k + (f.cls === "flag16" ? 2 : 1), 0);
    const hollow = hs.some(h => h.cls === "head_half" || h.cls === "head_xo");
    const dur = n > 0 ? 4 * 2 ** n : hollow ? 2 : 4;
    events.push({ x: Math.min(...hs.map(h => h.bbox[0])), x1: Math.max(...hs.map(h => h.bbox[2])), dur, dots: 0,
      notes: mkNotes(hs), stem: s, voice: up ? 1 : 2 });
  }
  // 기둥 없는 머리 = 온음표 (가로 위치가 같으면 화음)
  const loose = heads.filter(h => !stemOf.has(h)).sort((a, b) => a.bbox[0] - b.bbox[0]);
  const lcols = [];
  for (const h of loose) {
    const c = lcols[lcols.length - 1];
    if (c && Math.abs(c.x - h.bbox[0]) < 2.5) c.hs.push(h); else lcols.push({ x: h.bbox[0], hs: [h] });
  }
  for (const c of lcols) events.push({ x: c.x, x1: Math.max(...c.hs.map(h => h.bbox[2])), dur: 1, dots: 0, notes: mkNotes(c.hs), voice: 1 });
  // 머리 없는 기둥(앞 화음 반복, 기타 보표 등)
  const used = new Set(groups.keys());
  for (const s of stems) {
    if (used.has(s)) continue;
    const touchesTop = s.y1 >= staff.top - 1.5 && s.y1 <= staff.top + g * 2.5 && s.y0 < staff.top - g;
    if (touchesTop && beamCount(s, beams, s.y0) > 0)
      events.push({ x: s.x - 2, x1: s.x, dur: 4 * 2 ** beamCount(s, beams, s.y0), dots: 0, notes: [], stem: s, voice: 1, repeatPrev: true });
  }
  // 쉼표
  for (const q of near) {
    const d = { rest4: 4, rest8: 8, rest16: 16 }[q.cls];
    const cy = (q.bbox[1] + q.bbox[3]) / 2;
    // 높은 음 빔 묶음 사이의 쉼표는 오선 위로 올라가 찍힌다 — 오선 밖으로 1칸 넘게 벗어난 쉼표는 빔 묶음 사이에 있을 때만
    const inBeams = beams.some(b => b.x0 < q.bbox[0] && b.x1 > q.bbox[2] && b.y0 > staff.top - g * 6 && b.y1 < staff.bottom + g * 6);
    const reach = inBeams ? 3 : 1;
    if (d && cy > staff.top - g * reach && cy < staff.bottom + g * reach && ownerOf(cy) === staff)
      events.push({ x: q.bbox[0], x1: q.bbox[2], cy, dur: d, dots: 0, rest: true, notes: [], voice: cy < (staff.top + staff.bottom) / 2 - g ? 1 : cy > (staff.top + staff.bottom) / 2 + g ? 2 : 0 });
  }
  for (const r of rectRests(page, staff, verts)) events.push({ ...r, x1: r.x + 2 });
  // 점
  const dots = near.filter(q => q.cls === "dot");
  events.sort((a, b) => a.x - b.x);
  for (const d of dots) {
    const dx = (d.bbox[0] + d.bbox[2]) / 2, dy = (d.bbox[1] + d.bbox[3]) / 2;
    let best = null;
    // 점은 높이가 맞는 음(또는 쉼표) 오른쪽에만 붙는다
    for (const e of events) if (e.x1 + 0.2 < dx && dx - e.x1 < 6 &&
      (e.rest ? e.cy !== undefined && Math.abs(e.cy - dy) < g * 1.5 : e.notes.some(n => Math.abs(n.cy - dy) < g * 0.9))) best = e;
    // 화음의 점은 같은 x에 여러 개. 가로로 다른 위치에 두 번째 점이 있으면 겹점
    if (best) (best.dotXs ||= []).push(dx);
  }
  for (const e of events) if (e.dotXs) {
    const xs = e.dotXs.sort((a, b) => a - b);
    e.dots = xs.some((x, i) => i && x - xs[i - 1] > 0.8) ? 2 : 1;
    delete e.dotXs;
  }
  // 셋잇단
  // 드럼 아래 성부의 셋잇단 숫자는 오선에서 조금 더 멀리 찍힌다 (건반은 보표 간격이 좁아 이웃 보표 것을 잡으므로 드럼만)
  const tupReach = opts.drums ? 9 : 5;
  for (const t of glyphs.filter(q => (q.cls === "tuplet3" || q.cls === "tuplet6") && q.x > staff.x0 - 2 && q.x < staff.x1 + 2 &&
    (q.bbox[1] + q.bbox[3]) / 2 > staff.top - g * tupReach && (q.bbox[1] + q.bbox[3]) / 2 < staff.bottom + g * tupReach)) markTuplet(events, t, glyphs);
  // 임시표(마디 안에서 같은 음에 계속 적용) + 조표
  const accs = near.filter(q => q.cls === "sharp" || q.cls === "flat" || q.cls === "natural");
  const keyAlter = {};
  (key > 0 ? KEY_SHARPS.slice(0, key) : KEY_FLATS.slice(0, -key)).forEach(s => (keyAlter[s] = key > 0 ? 1 : -1));
  const edges = measureEdges(staff, bars);
  const measures = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const m = events.filter(e => e.x > edges[i] + 0.5 && e.x < edges[i + 1] - 0.5);
    const local = {};
    for (const e of m) for (const n of e.notes) {
      const a = accs.find(q => q.bbox[2] < n.x0 + 0.3 && n.x0 - q.bbox[2] < 7 && Math.abs((q.bbox[1] + q.bbox[3]) / 2 - n.cy) < g * 0.6 && q.x > edges[i]);
      const k = n.step + n.oct;
      if (a) local[k] = a.cls === "sharp" ? 1 : a.cls === "flat" ? -1 : 0;
      n.alter = local[k] ?? keyAlter[n.step] ?? 0;
    }
    m.x0 = edges[i]; m.x1 = edges[i + 1];
    // 진짜 2성부는 같은 박에 위·아래 기둥이 함께 있을 때뿐. 아니면 기둥 방향과 관계없이 한 성부
    const poly = m.some(a => !a.rest && a.voice === 1 && m.some(b => !b.rest && b.voice === 2 && Math.abs(a.x - b.x) < 2.5));
    for (const e of m) e.stemVoice = e.voice; // 기둥 방향은 나중에 성부 나누기에 다시 쓴다
    if (!poly && !opts.drums) for (const e of m) e.voice = 1;
    // 드럼도 한 방향 기둥만 있는 마디(한 줄 타악기 등)는 가운데 쉼표까지 한 성부로
    if (!poly && opts.drums && new Set(m.map(e => e.voice).filter(Boolean)).size <= 1) for (const e of m) e.voice = 1;
    // 위 성부가 오선 위 쉼표로 따로 적힌 마디: 가운데 쉼표는 길이가 모자란 쪽 성부 것
    else if (!poly && opts.drums) {
      const short = measureLength(m.filter(e => e.voice === 1)) <= measureLength(m.filter(e => e.voice === 2)) ? 1 : 2;
      for (const e of m) if (!e.voice) e.voice = short;
    }
    measures.push(m);
  }
  // 머리 없는 기둥은 앞 화음 반복
  let prev = null;
  for (const m of measures) for (const e of m) {
    if (e.repeatPrev) e.notes = prev ? prev.map(n => ({ ...n })) : [];
    if (e.notes.length && !e.repeatPrev) prev = e.notes;
  }
  // 붙임줄: 다음 사건에 같은 음이 있고, 그 사이에 둥근 곡선(사전에 없는 납작한 기호)이 있으면
  // 마디를 넘는 긴 붙임줄은 곡선이 조금 더 높다
  const arcs = glyphs.filter(q => !q.cls && q.bbox[2] - q.bbox[0] > 3 && q.bbox[3] - q.bbox[1] < (q.bbox[2] - q.bbox[0] > 40 ? g * 2 : g * 1.3) &&
    q.x > staff.x0 && q.x < staff.x1 && q.bbox[1] > staff.top - g * 4 && q.bbox[3] < staff.bottom + g * 4);
  const flat = measures.flat().filter(e => !e.rest).sort((a, b) => a.x - b.x);
  for (let i = 0; i + 1 < flat.length; i++) {
    const a = flat[i], b = flat.slice(i + 1).find(e => e.voice === a.voice || !e.voice || !a.voice);
    if (!b) continue;
    for (const n of b.notes) {
      const src = a.notes.find(o => o.step === n.step && o.oct === n.oct);
      if (!src) continue;
      const arc = arcs.find(q => q.bbox[0] > a.x1 - 2 && q.bbox[2] < b.x + 3 && Math.abs((q.bbox[1] + q.bbox[3]) / 2 - n.cy) < (q.bbox[2] - q.bbox[0] > 40 ? g * 2 : g * 1.6));
      if (arc) { n.tie = true; n.alter = src.alter; } // 붙임줄로 이어진 음은 마디를 넘어도 앞 음의 임시표 그대로
    }
  }
  const signs = near.filter(q => q.cls === "repeat1" || q.cls === "repeat2").filter(q => !events.some(e => e.stem && Math.abs(e.stem.x - (q.bbox[0] + q.bbox[2]) / 2) < 2.5));
  applyRepeatSigns(measures, edges, signs);
  const bigParens = near.filter(q => q.cls === "paren" && q.bbox[3] - q.bbox[1] > g * 2);
  // 2성부로 나눌 수 있는 마디는 길이가 넘치는 게 정상이므로 건드리지 않는다
  const fullOf = i => opts.fulls?.[i] ?? 1;
  measures.forEach((m, i) => { if (!opts.drums && !dropParenAlt(m, bigParens, fullOf(i)) && !m.some(e => e.voice === 2) && !splitVoices(m, fullOf(i))) fixOverfull(m, bigParens, fullOf(i)); });
  measures.forEach((m, i) => fillAmbiguous(m, edges[i + 1], fullOf(i)));
  measures.clef = clef; measures.key = key;
  return measures;
}

/* ------------------------------------------------- 5) 드럼 */

// 일본 밴드 스코어의 일반적인 드럼 표기: 맨 아랫줄 = 0, 반칸 단위 위치
const DRUM_MAP = [
  { pos: -2, x: true, art: "PedalHiHatHit" },
  { pos: 1, art: "KickHit" }, { pos: 0, art: "KickHit" }, { pos: -1, art: "KickHit2" },
  { pos: 3, art: "LowFloorTomHit" }, { pos: 2, art: "HighFloorTomHit" },
  { pos: 5, art: "SnareHit" }, { pos: 5, x: true, art: "SnareSideStick" },
  { pos: 6, art: "MidTomHit" }, { pos: 7, art: "HighTomHit" },
  { pos: 8, x: true, art: "RideMiddle" }, { pos: 8, art: "HighTomHit" },
  { pos: 9, x: true, art: "HiHatClosed" }, { pos: 9, art: "HighTomHit" },
  { pos: 10, x: true, art: "CrashMediumHit" }, { pos: 11, x: true, art: "CrashHighHit" }, { pos: 12, x: true, art: "ChinaHit" },
];
export function drumArticulation(pos, xhead) {
  const exact = DRUM_MAP.find(d => d.pos === pos && !!d.x === !!xhead);
  if (exact) return exact.art;
  if (xhead) return pos >= 10 ? "CrashMediumHit" : pos >= 8 ? "HiHatClosed" : "PedalHiHatHit";
  return pos <= 1 ? "KickHit" : pos <= 4 ? "LowFloorTomHit" : pos <= 5 ? "SnareHit" : "HighTomHit";
}

/* ------------------------------------------------- 6) 파트 구성 */

/** 단 안의 보표들을 파트로 묶는다 */
export function partsOfSystem(sys, glyphs) {
  const stdGap = Math.min(...sys.staves.map(s => s.gap));
  const isTab = sys.staves.map(s => s.gap / stdGap > 1.15);
  const parts = [];
  const used = new Set();
  sys.staves.forEach((st, k) => {
    if (isTab[k]) {
      const std = k > 0 && !isTab[k - 1] && !used.has(k - 1) ? k - 1 : null;
      if (std !== null) { used.add(std); parts.pop(); }
      parts.push({ kind: st.count >= 6 ? "guitar" : "bass", tab: k, std, strings: st.count });
      used.add(k);
    } else {
      parts.push({ kind: "std", std: k });
    }
  });
  // 드럼: X 머리가 많은 오선, 대보표: 높은음자리표 + 바로 아래 낮은음자리표
  for (const p of parts) {
    if (p.kind !== "std") continue;
    const st = sys.staves[p.std];
    const hs = glyphs.filter(q => (q.cls === "head_black" || q.cls === "head_x") && q.x > st.x0 && q.x < st.x1 &&
      q.y > st.top - st.gap * 3 && q.y < st.bottom + st.gap * 3);
    const xs = hs.filter(q => q.cls === "head_x").length;
    if (hs.length >= 4 && xs / hs.length > 0.2) p.kind = "drums";
    p.clef = clefOf(st, glyphs);
  }
  // 보표 왼쪽의 파트 이름 (Vo, Gt-I, Syn, Ba, Dr …)
  for (const p of parts) {
    const ks = [p.std, p.tab, p.lower].filter(k => k !== undefined && k !== null).map(k => sys.staves[k]);
    const top = Math.min(...ks.map(s => s.top)) - 8, bot = Math.max(...ks.map(s => s.bottom)) + 8;
    const x0 = Math.min(...ks.map(s => s.x0));
    const chars = glyphs.filter(q => q.cls && q.cls.startsWith("ch_") && q.bbox[2] < x0 + 0.5 && q.bbox[0] > x0 - 45 &&
      (q.bbox[1] + q.bbox[3]) / 2 > top && (q.bbox[1] + q.bbox[3]) / 2 < bot).sort((a, b) => a.x - b.x);
    if (chars.length) p.label = chars.map(q => q.cls.slice(3)).join("");
  }
  for (let i = 0; i + 1 < parts.length; i++) {
    const a = parts[i], b = parts[i + 1];
    if (a.kind === "std" && b.kind === "std" && a.clef === "G" && b.clef === "F" && !a.label?.match(/^(Vo|Cho)/)) {
      a.kind = "piano"; a.lower = b.std; parts.splice(i + 1, 1);
    }
  }
  return parts;
}

/** 박자표: 보표 앞쪽의 C 또는 위아래 숫자 */
export function timeSigAt(staff, glyphs, x0, x1) {
  // 박자표 숫자는 1·2번 괄호 숫자, 긴 쉼표 숫자와 같은 글자일 수 있다(v2, n4 등). 오선 안에 위아래로 겹쳐 있으면 박자표
  const num = q => +(/^(?:ts|n|v)(\d+)$/.exec(q.cls) || [])[1];
  const ts = glyphs.filter(q => q.cls && (q.cls === "tsC" || num(q)) && q.x > x0 - 1 && q.x < x1 &&
    (q.bbox[1] + q.bbox[3]) / 2 > staff.top - 1 && (q.bbox[1] + q.bbox[3]) / 2 < staff.bottom + 1);
  const mid = (staff.top + staff.bottom) / 2;
  // 짧은 마디에는 박자표와 마디 끝 예고 박자표가 함께 들어올 수 있으므로 왼쪽 것부터
  for (const top of ts.sort((a, b) => a.bbox[0] - b.bbox[0])) {
    if (top.cls === "tsC") return [4, 4];
    if ((top.bbox[1] + top.bbox[3]) / 2 > mid) continue;
    const bot = ts.find(q => (q.bbox[1] + q.bbox[3]) / 2 > mid && Math.abs(q.bbox[0] + q.bbox[2] - top.bbox[0] - top.bbox[2]) < 4);
    if (bot) return [num(top), num(bot)];
  }
  return null;
}

/* ------------------------------------------------- 7) 악보 전체 조립 */

/**
 * 페이지들(기호 분류가 끝난 extractPage 결과)을 파트별 마디 목록으로
 * @returns {{ parts, bars: [{ts:[n,d]}], report: string[] }}
 */
/**
 * 1번 괄호는 여러 단·페이지에 걸쳐 이어질 수 있다(다음 단에는 숫자 없이 선만 계속됨).
 * 1번 괄호가 시작된 마디부터 도돌이표 끝 마디까지를 모두 1번 괄호로 본다
 * (그 바로 다음에 2번 괄호가 올 때만).
 */
function extendVoltas(bars) {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].nav?.volta !== 1) continue;
    let j = i;
    while (j < bars.length && !bars[j].nav?.repeatEnd && !(j > i && bars[j].nav?.volta === 2)) j++;
    if (j < bars.length && bars[j].nav?.repeatEnd && bars[j + 1]?.nav?.volta === 2)
      for (let k = i; k <= j; k++) bars[k].nav.volta = 1;
    i = j;
  }
}

/**
 * 여러 마디 쉼표: 가운데 줄 위의 굵은 가로 막대 + 그 위의 숫자(쉬는 마디 수).
 * @returns 마디마다 쉬는 마디 수 (여러 마디 쉼표가 아니면 1)
 */
function multiRestCounts(sys, page, glyphs, edges) {
  const st = sys.staves[0];
  const mid = st.lines[Math.floor(st.lines.length / 2)];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const bar = page.rects.find(r => !isWhite(r.fill) && r.x1 - r.x0 > 12 && r.x0 > edges[i] && r.x1 < edges[i + 1] &&
      Math.abs((r.y0 + r.y1) / 2 - mid) < 0.6 && r.y1 - r.y0 > st.gap * 0.35);
    let n = 1;
    if (bar) {
      const num = glyphs.filter(q => q.cls && /^(n|v|d)\d$/.test(q.cls) && q.bbox[1] < st.top && q.bbox[3] < st.top + 2 && q.bbox[3] > st.top - 4 &&
        q.bbox[0] > bar.x0 - 2 && q.bbox[2] < bar.x1 + 2).sort((a, b) => a.x - b.x);
      const v = +num.map(q => q.cls.slice(1)).join("");
      if (v > 1 && v < 200) n = v;
    }
    out.push(n);
  }
  return out;
}

/** 단의 보표 구성 문자열 (S5 = 5줄 오선, T6 = 6줄 TAB …) */
function systemSig(sys) {
  const stdGap = Math.min(...sys.staves.map(s => s.gap));
  return sys.staves.map(s => (s.gap / stdGap > 1.15 ? "T" : "S") + s.count).join("");
}

/**
 * 페이지들(기호 분류가 끝난 extractPage 결과)을 파트별 마디 목록으로.
 * 가장 많이 나오는 보표 구성의 단들을 본편으로 보고, 구성이 다른 단(키보드 파트 부록 등)은
 * 따로 해석해서 마디 수가 본편과 같으면 함께 연주되는 추가 파트로 붙인다.
 */
/**
 * 부록 마디를 본편 마디에 맞춘다.
 * 마디 수가 같으면 그대로, 다르면 연습 기호 상자([A] [B] …)를 기준점으로 구간마다 앞에서부터 맞추고
 * 구간이 짧은 쪽은 남는 마디를 비워 둔다(-1).
 * @returns 본편 마디 번호 → 부록 마디 번호(-1은 없음), 맞출 수 없으면 null
 */
export function alignSections(mainBars, extraBars) {
  if (mainBars.length === extraBars.length) return mainBars.map((_, i) => i);
  const lm = mainBars.map((b, i) => (b.rehearsal ? i : -1)).filter(i => i >= 0);
  const la = extraBars.map((b, i) => (b.rehearsal ? i : -1)).filter(i => i >= 0);
  if (!lm.length || lm.length !== la.length) return null;
  const map = new Array(mainBars.length).fill(-1);
  const ms = [0, ...lm, mainBars.length], as = [0, ...la, extraBars.length];
  for (let k = 0; k + 1 < ms.length; k++) {
    const n = Math.min(ms[k + 1] - ms[k], as[k + 1] - as[k]);
    for (let j = 0; j < n; j++) map[ms[k] + j] = as[k] + j;
  }
  return map;
}

/** 개발용: 본편과 부록을 각각 해석한 결과 */
export function parseBandScoreSections(pages) {
  const all = [];
  pages.forEach((pg, pi) => {
    const verts = verticalRects(pg);
    for (const sys of groupSystems(findStaves(pg), verts).filter(s => s.staves.length > 3)) all.push({ pg, pi, sys, sig: systemSig(sys) });
  });
  const out = {};
  for (const sig of new Set(all.map(e => e.sig))) out[sig] = parseSystems(all.filter(e => e.sig === sig));
  return out;
}

export function parseBandScore(pages) {
  const all = [];
  pages.forEach((pg, pi) => {
    const verts = verticalRects(pg);
    for (const sys of groupSystems(findStaves(pg), verts).filter(s => s.staves.length > 3)) all.push({ pg, pi, sys, sig: systemSig(sys) });
  });
  const count = {};
  for (const e of all) count[e.sig] = (count[e.sig] || 0) + 1;
  const mainSig = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  const main = parseSystems(all.filter(e => e.sig === mainSig));
  extendVoltas(main.bars);
  const rest = all.filter(e => e.sig !== mainSig);
  if (rest.length) {
    const extra = parseSystems(rest);
    const map = alignSections(main.bars, extra.bars);
    if (map) {
      for (const p of extra.parts) {
        const ms = main.bars.map((_, i) => (map[i] >= 0 ? p.measures[map[i]] : null) || []);
        main.parts.push({ ...p, measures: ms, extra: true });
      }
      const missing = map.filter(v => v < 0).length;
      main.report.push(`16쪽부터의 부록 ${extra.parts.length}파트를 본편에 맞춰 붙였습니다` +
        (missing ? ` (부록에 없는 ${missing}마디는 쉼표로 둠)` : "") + ".");
    } else {
      main.report.push(`보표 구성이 다른 부분(${rest.length}단, ${extra.bars.length}마디)은 본편(${main.bars.length}마디)과 맞출 기준점이 없어 뺐습니다.`);
    }
  }
  return main;
}

function parseSystems(list) {
  const parts = [];      // 파트 순서는 첫 단 기준
  const bars = [];
  const report = [];
  const layoutCache = new Map();
  let ts = [4, 4];
  const beamCache = new Map();
  const multiRepeats = [], sysStart = [];
  let sysNo = -1;
  for (const { pg, pi, sys, sig } of list) {
    sysNo++;
    {
      const verts = verticalRects(pg);
      if (!beamCache.has(pg)) beamCache.set(pg, beamsOf(pg));
      const beams = beamCache.get(pg);
      const sb = systemBarlines(sys, verts);
      // 보표 구성이 같은 단은 처음 판정한 파트 구성을 그대로 쓴다 (단마다 음자리표 인식 차이로 흔들리지 않게)
      const layout = layoutCache.get(sig) || partsOfSystem(sys, pg.glyphs);
      layoutCache.set(sig, layout);
      const edges = measureEdges(sys.staves[0], sb);
      const nMeasures = edges.length - 1;
      // 박자표 (첫 보표의 각 마디 앞부분)
      const tsList = [];
      let courtesy = null;
      for (let i = 0; i < nMeasures; i++) {
        // 마디 끝 겹세로줄 바로 앞의 박자표는 다음 마디부터 (예고 박자표)
        const t = timeSigAt(sys.staves[0], pg.glyphs, edges[i], Math.min(edges[i] + 40, edges[i + 1] - 9)) || courtesy;
        if (t) ts = t;
        tsList.push(ts.slice());
        courtesy = timeSigAt(sys.staves[0], pg.glyphs, edges[i + 1] - 9, edges[i + 1]);
      }
      const fulls = tsList.map(t => t[0] / t[1]);
      // 도돌이표 점을 먼저 골라내야 점음표의 점으로 잘못 붙지 않는다
      const rdots = markRepeatDots(sys, pg.glyphs, verts);
      const nav = navigationMarks(sys, pg.glyphs, edges, rdots);
      const parsed = layout.map(p => {
        if (p.kind === "guitar" || p.kind === "bass") return parseTabStaff(pg, sys.staves[p.tab], pg.glyphs, verts, beams, sb, fulls, p.std != null ? smallHeadXs(sys.staves[p.std], pg.glyphs) : []);
        if (p.kind === "piano") {
          const up = parseStdStaff(pg, sys.staves[p.std], pg.glyphs, verts, beams, sb, { others: sys.staves, fulls });
          const lo = parseStdStaff(pg, sys.staves[p.lower], pg.glyphs, verts, beams, sb, { others: sys.staves, fulls });
          return up.map((m, i) => { const r = [...m.map(e => ({ ...e, staff: 0 })), ...(lo[i] || []).map(e => ({ ...e, staff: 1 }))]; r.repeatOf2 = m.repeatOf2; return r; });
        }
        return parseStdStaff(pg, sys.staves[p.std], pg.glyphs, verts, beams, sb, { drums: p.kind === "drums", others: sys.staves, fulls });
      });
      // 이 단의 파트 → 전체 파트: 종류와 그 종류 안의 순번으로 맞춘다 (단마다 보표 수가 달라도 섞이지 않게)
      const ord = {};
      const targets = layout.map(p => {
        const n = ord[p.kind] = (ord[p.kind] || 0) + 1;
        let t = parts.filter(q => q.kind === p.kind)[n - 1];
        if (!t) { t = { ...p, index: parts.length, measures: [] }; parts.push(t); while (t.measures.length < bars.length) t.measures.push([]); }
        return t;
      });
      // 여러 마디 반복 기호: 숫자(4 등) 아래 "///"가 마디줄 위에 걸쳐 있다. 그 마디줄을 가운데로 하는 n마디가 앞 n마디의 반복
      for (const [k, p] of layout.entries()) {
        const st = sys.staves[p.std ?? p.tab], g = st.gap;
        for (const d of pg.glyphs) {
          const n = +(/^(?:n|v|ts)(\d)$/.exec(d.cls || "") || [])[1];
          if (!(n >= 2) || d.bbox[3] > st.top + 1 || d.bbox[3] < st.top - g * 3) continue;
          const cx = (d.bbox[0] + d.bbox[2]) / 2;
          const slashes = pg.glyphs.filter(q => (q.cls === "slash" || q.cls === "repeat1" || q.cls === "repeat2") && Math.abs((q.bbox[0] + q.bbox[2]) / 2 - cx) < 6 &&
            q.bbox[1] > st.top - 1 && q.bbox[3] < st.bottom + 1);
          const j = edges.findIndex(x => Math.abs(x - cx) < 5);
          if (slashes.length >= 2 && j > 0 && n >= 3) multiRepeats.push({ part: targets[k], n, sys: sysNo, j });
          // 2마디 반복이 줄바꿈에 걸리면 단 끝과 다음 단 시작에 반쪽(빗금 하나)씩 그린다. 가운데는 줄바꿈 마디줄
          else if (n === 2 && slashes.length === 1) {
            if (cx > edges[edges.length - 1] - 10) multiRepeats.push({ part: targets[k], n, sys: sysNo, at: "end" });
            else if (cx < edges[0] + 25) multiRepeats.push({ part: targets[k], n, sys: sysNo, at: "start" });
          }
        }
      }
      const restN = multiRestCounts(sys, pg, pg.glyphs, edges);
      sysStart.push([]);
      for (let i = 0; i < nMeasures; i++) {
        sysStart[sysNo][i] = bars.length;
        // 여러 마디 쉼표는 그 수만큼 빈 마디로 펼친다
        for (let r = 0; r < restN[i]; r++) {
          // 마디 앞의 조표 변경(샵/플랫 2개 이상) — 본편과 부록을 맞출 때 기준점으로 쓴다
          const keyMark = r === 0 && i > 0 ? pg.glyphs.filter(q => (q.cls === "flat" || q.cls === "sharp" || q.cls === "natural") && q.x > edges[i] && q.x < edges[i] + 14 &&
            q.y > sys.staves[0].top - 8 && q.y < sys.staves[0].bottom + 8).length : 0;
          // 연습 기호 상자([A] [B] …): 본편과 부록을 맞추는 기준점
          const rehearsal = r === 0 && pg.glyphs.some(q => q.cls === "rbox" && q.bbox[3] < sys.staves[0].top && q.bbox[3] > sys.staves[0].top - 32 &&
            (q.bbox[0] + q.bbox[2]) / 2 > edges[i] - 4 && (q.bbox[0] + q.bbox[2]) / 2 < edges[i + 1] - 4);
          bars.push({ ts: tsList[i], page: pi, x: edges[i], nav: r === 0 ? nav[i] || {} : {}, multiRest: restN[i] > 1, keyChange: keyMark >= 2, rehearsal });
          layout.forEach((p, k) => targets[k].measures.push(r === 0 ? barRest(parsed[k][i] || [], fulls[i]) : []));
          parts.forEach(pp => { while (pp.measures.length < bars.length) pp.measures.push([]); });
        }
        continue;
        // 이 단에 없는 파트는 빈 마디
        parts.forEach(pp => { while (pp.measures.length < bars.length) pp.measures.push([]); });
      }
    }
  }
  const cp = src => { const r = (src || []).map(e => ({ ...e, notes: e.notes.map(n => ({ ...n })) })); r.x0 = src?.x0; r.x1 = src?.x1; return r; };
  // 여러 마디 반복: 가운데 마디줄 앞뒤로 n/2마디씩 (줄이 바뀌어도 이어진다)
  for (const { part, n, sys, j, at } of multiRepeats) {
    const center = at === "end" ? sysStart[sys][sysStart[sys].length - 1] + 1 : at === "start" ? sysStart[sys][0] : sysStart[sys][j];
    for (let c = center - Math.floor(n / 2); c < center + Math.ceil(n / 2); c++)
      if (c - n >= 0 && c < part.measures.length) part.measures[c] = cp(part.measures[c - n]);
  }
  // 두 마디 반복 기호
  for (const p of parts) p.measures.forEach((m, i) => {
    if (m.repeatOf2 && i >= 2) {
      p.measures[i] = cp(p.measures[i - 2]);
      p.measures[i + 1] = cp(p.measures[i - 1]);
    }
  });
  return { parts, bars, report };
}

/* ------------------------------------------------- 8) 성부 정렬 */

/**
 * 한 마디의 여러 성부를 시간축에 맞춘다.
 * 길이가 맞는 성부(보통 위 성부)의 음 위치(x)→시각 표를 만들고, 다른 성부의 음은 x로 시각을 구한 뒤
 * 사이사이 빈 곳을 쉼표로 채운다 (드럼 발 성부처럼 쉼표를 생략한 표기 대응).
 */
export function alignVoices(voices, full, x0, x1) {
  const keys = Object.keys(voices);
  const lens = Object.fromEntries(keys.map(k => [k, measureLength(voices[k])]));
  let primary = keys.find(k => Math.abs(lens[k] - full) < 1e-6) ?? keys.sort((a, b) => lens[b] - lens[a])[0];
  const anchors = [{ x: x0, t: 0 }];
  let t = 0;
  for (const e of [...voices[primary]].sort((a, b) => a.x - b.x)) { anchors.push({ x: e.x, t }); t += evLen(e); }
  anchors.push({ x: x1, t: Math.max(t, full) });
  anchors.sort((a, b) => a.x - b.x);
  const timeAt = x => {
    const hit = anchors.find(a => Math.abs(a.x - x) < 2.2);
    if (hit) return hit.t;
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (x >= a.x && x <= b.x) return a.t + (b.t - a.t) * (x - a.x) / Math.max(1e-6, b.x - a.x);
    }
    return 0;
  };
  const snap = v => Math.round(v * 32) / 32; // 32분음표 단위
  const out = {};
  for (const k of keys) {
    if (k === primary || Math.abs(lens[k] - full) < 1e-6) { out[k] = [...voices[k]].sort((a, b) => a.x - b.x); continue; }
    const evs = [...voices[k]].filter(e => !e.rest).sort((a, b) => a.x - b.x);
    const seq = [];
    let cur = 0;
    for (const e of evs) {
      const at = snap(timeAt(e.x));
      if (at > cur + 1e-6) seq.push(...restsFor(at - cur));
      if (at < cur - 1e-6) continue; // 겹치면 버림
      seq.push(e);
      cur = at + evLen(e);
    }
    if (cur < full - 1e-6) seq.push(...restsFor(full - cur));
    out[k] = seq;
  }
  return out;
}

/**
 * 한 성부로 보았을 때 마디가 넘치면 두 성부로 나눠 본다.
 *  1) 기둥 방향으로 (기둥 없는 온음표는 맞는 쪽으로)
 *  2) 기둥 없는 긴 음(온음표·2분음표)만 따로
 * 두 성부 모두 마디 길이를 넘지 않는 나눔을 고른다. 못 찾으면 null
 */
export function splitVoices(m, full) {
  const fits = (a, b) => measureLength(a) <= full + 1e-6 && measureLength(b) <= full + 1e-6 && a.some(e => !e.rest) && b.some(e => !e.rest);
  const notes = m.filter(e => !e.rest);
  const rests = m.filter(e => e.rest);
  const stemless = notes.filter(e => !e.stem);
  const byDir = d => notes.filter(e => e.stem && (e.stemVoice || 1) === d);
  for (const wholeTo of [1, 2]) {
    const a = [...byDir(1), ...(wholeTo === 1 ? stemless : [])], b = [...byDir(2), ...(wholeTo === 2 ? stemless : [])];
    if (fits(a, b)) return { 1: a, 2: b };
  }
  const longOnes = stemless.filter(e => e.dur <= 2);
  const others = notes.filter(e => !longOnes.includes(e));
  if (fits(others, longOnes)) return { 1: others, 2: longOnes };
  return null;
}

/* ------------------------------------------------- 9) alphaTex 만들기 */

const DUR_LIST = [[1, 0], [2, 1], [2, 0], [4, 1], [4, 0], [8, 1], [8, 0], [16, 1], [16, 0], [32, 0]];
function restsFor(len) {
  const out = [];
  for (const [d, dot] of DUR_LIST) {
    const v = (1 / d) * (dot ? 1.5 : 1);
    while (len >= v - 1e-6) { out.push({ dur: d, dots: dot, rest: true, notes: [] }); len -= v; }
  }
  return out;
}
function evLen(e) { return (1 / e.dur) * (e.dots === 2 ? 1.75 : e.dots ? 1.5 : 1) * (e.tuplet ? 2 / 3 : 1); }

/** 마디 길이를 박자에 맞춘다: 모자라면 쉼표로 채우고, 넘치면 넘치는 사건을 버린다 */
function fitMeasure(evs, full) {
  const out = [];
  let len = 0;
  for (const e of evs) {
    const l = evLen(e);
    if (len + l > full + 1e-6) break;
    out.push(e); len += l;
  }
  // 셋잇단은 3개 묶음이 깨지면 alphaTab이 어긋나므로 묶음 단위 확인
  return out.concat(restsFor(full - len));
}

const ACC = { 1: "#", "-1": "b", 0: "" };
function noteTex(n) { return `${n.step}${ACC[n.alter || 0]}${n.oct}${n.tie ? "{t}" : ""}`; }
function beatTex(e, kind, strings = 6, perc = false) {
  // 종류에 맞지 않는 음(다른 파트에서 섞여 들어온 것)은 뺀다
  const notes = e.notes.filter(n => kind === "tab" ? n.string >= 1 && n.string <= strings && Number.isFinite(n.fret)
    : kind === "drums" ? Number.isFinite(n.pos) : n.step && Number.isFinite(n.oct));
  e = { ...e, notes };
  let body;
  if (e.rest || !e.notes.length) body = "r";
  else if (kind === "tab") {
    const ns = [...new Set(e.notes.map(n => `${n.dead ? "x" : n.fret}.${n.string}${n.tie || n.harmonic ? `{${[n.tie && "t", n.harmonic && "nh"].filter(Boolean).join(" ")}}` : ""}`))];
    body = ns.length > 1 ? `(${ns.join(" ")})` : ns[0];
  } else if (kind === "drums") {
    const ns = [...new Set(e.notes.map(n => perc ? (n.ring ? "CrashMediumHit" : n.xhead ? "CabasaHit" : "TambourineHit") : drumArticulation(n.pos, n.xhead)))];
    body = ns.length > 1 ? `(${ns.join(" ")})` : ns[0];
  } else {
    const ns = [...new Set(e.notes.map(noteTex))]; // 같은 음이 겹쳐 적힌 경우(두 성부 유니즌) 하나로
    body = `(${ns.join(" ")})`;
  }
  const fx = [];
  if (e.dots) fx.push(e.dots === 2 ? "dd" : "d");
  if (e.tuplet) fx.push(`tu ${e.tuplet}`);
  if (e.tremolo && !e.rest) fx.push("tp 16");
  // 음표 효과({t})와 박 효과가 함께 있을 때 헷갈리지 않도록 화음 괄호로 감싼다
  if (fx.length && body !== "r" && !body.startsWith("(")) body = `(${body})`;
  return `:${e.dur} ${body}${fx.length ? `{${fx.join(" ")}}` : ""}`;
}

/** 악보에 적힌 파트 이름 → 트랙 이름 */
function labelName(t) {
  const roman = { I: 1, II: 2, III: 3, IV: 4 };
  if (/^Vo/i.test(t)) return "Vocal";
  if (/^Syn/i.test(t)) return "Synth";
  if (/^Ba/i.test(t)) return "Bass";
  if (/^Dr/i.test(t)) return "Drums";
  const g = t.match(/^Gt-?(I+|IV|\d)?/);
  if (g) return "Guitar" + (g[1] ? " " + (roman[g[1]] || g[1]) : "");
  return t;
}

/** 마디 앞에 붙는 연주 순서 메타데이터 */
function navTex(nav = {}, hasCoda) {
  let t = "";
  if (nav.repeatStart) t += "\\ro ";
  if (nav.volta) t += `\\ae (${nav.volta}) `;
  if (nav.repeatEnd) t += "\\rc 2 ";
  if (nav.segno) t += "\\jump Segno ";
  if (nav.coda) t += "\\jump Coda ";
  if (nav.toCoda) t += "\\jump DaCoda ";
  if (nav.ds) t += hasCoda ? "\\jump DalSegnoAlCoda " : "\\jump DalSegno ";
  return t;
}

const TUNINGS = { 6: "e4 b3 g3 d3 a2 e2", 4: "g2 d2 a1 e1", 5: "g2 d2 a1 e1 b0", 7: "e4 b3 g3 d3 a2 e2 b1" };

export function toAlphaTex(score, title = "", tempo = 120) {
  const { parts, bars } = score;
  const names = { std: "Vocal", guitar: "Guitar", bass: "Bass", drums: "Drums", piano: "Keyboard" };
  const programs = { std: 53, guitar: 29, bass: 33, piano: 0 };
  let gtr = 0, std = 0;
  const hasCoda = bars.some(b => b.nav && b.nav.coda);
  let tex = `\\title "${title.replace(/"/g, "'")}"\n\\tempo ${tempo}\n.\n`;
  // 부록(본편 뒤에 따로 실린 Piano·Keyboard·Percussion 등) 파트 이름과 소리
  const extraNames = ["Piano", "Keyboard 1", "Keyboard 2", "Keyboard 3", "Keyboard 4"];
  const extraPrograms = [0, 89, 81, 48, 88];
  let ex = 0;
  for (const p of parts) {
    let name = names[p.kind];
    let program = programs[p.kind];
    if (p.kind === "guitar") name = `Guitar ${++gtr}`;
    if (p.kind === "std" && !p.extra) name = ++std === 1 ? "Vocal" : `Part ${std}`;
    if (p.label) name = labelName(p.label) || name;
    if (p.extra && p.kind !== "drums") { program = extraPrograms[ex] ?? 0; name = extraNames[ex++] || `Keyboard ${ex}`; }
    if (p.extra && p.kind === "drums") name = "Percussion";
    const kind = p.kind === "guitar" || p.kind === "bass" ? "tab" : p.kind === "drums" ? "drums" : "std";
    tex += `\\track "${name}"\n`;
    if (kind === "drums") tex += `\\instrument percussion\n\\articulation defaults\n\\staff {score}\n`;
    else if (kind === "tab") tex += `\\instrument ${programs[p.kind]}\n\\staff {score tabs}\n\\tuning ${TUNINGS[p.strings] || TUNINGS[6]}\n` + (p.kind === "bass" ? "\\clef F4\n" : "");
    else tex += `\\instrument ${program ?? 0}\n\\staff {score}\n` + (p.clef === "F" ? "\\clef F4\n" : "");
    // 마디마다 성부 나누기를 미리 정해 둔다
    const voiced = p.measures.map((m, i) => {
      const full = bars[i].ts[0] / bars[i].ts[1];
      if (p.kind === "piano") return null;
      const vs = { 1: m.filter(e => (e.voice || 1) === 1), 2: m.filter(e => e.voice === 2) };
      if (vs[1].length && vs[2].length) return alignVoices(vs, full, m.x0 ?? Math.min(...m.map(e => e.x)) - 5, m.x1 ?? Math.max(...m.map(e => e.x)) + 20);
      // 다른 성부용 온쉼표가 함께 적혀 넘치는 경우: 음표만으로 마디가 맞으면 그 쉼표는 뺀다
      if (measureLength(m) > full + 1e-6 && m.some(e => e.rest && e.dur === 1)) {
        const keep = m.filter(e => !(e.rest && e.dur === 1));
        if (measureLength(keep) <= full + 1e-6) { m.splice(0, m.length, ...keep); }
      }
      if (kind !== "drums" && measureLength(m) > full + 1e-6) {
        const sp = splitVoices(m, full);
        if (sp) return alignVoices(sp, full, m.x0 ?? -1e9, m.x1 ?? 1e9);
      }
      return null;
    });
    const voiceCount = kind === "drums" || p.kind === "piano" || voiced.some(Boolean) ? 2 : 1;
    for (let v = 1; v <= voiceCount; v++) {
      if (voiceCount > 1) tex += `\\voice\n`;
      let lastTs = null;
      p.measures.forEach((m, i) => {
        const full = bars[i].ts[0] / bars[i].ts[1];
        let evs = [...m].sort((a, b) => a.x - b.x);
        if (voiceCount > 1) {
          if (p.kind === "piano") evs = evs.filter(e => (e.staff ?? 0) === v - 1);
          else if (voiced[i]) evs = voiced[i][v] || [];
          else evs = v === 1 ? evs : [];
        }
        const fitted = fitMeasure(evs, full);
        let head = "";
        const t = bars[i].ts.join(" ");
        if (t !== lastTs) { head = `\\ts ${t} `; lastTs = t; }
        if (p === parts[0] && v === 1) head = navTex(bars[i].nav, hasCoda) + head; // 연주 순서는 첫 트랙에만
        tex += head + fitted.map(e => beatTex(e, kind, p.strings, p.extra)).join(" ") + " |\n";
      });
    }
  }
  return tex;
}

/* ------------------------------------------------- 10) 기호 사전 대조 */

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}
/**
 * 모양 특징값 (크기와 무관): [명령 순서 해시, 좌표 수, 크기, 가로세로비, 정규화한 표본 좌표 8개]
 * 같은 악보 안에서도 페이지마다 축척이 조금씩 달라 같은 기호의 좌표가 달라지므로,
 * 기호 자체의 크기로 나눈 좌표로 비교한다.
 */
export function shapeFeature(ops, flat) {
  const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const size = Math.max(w, h) || 1;
  const r = v => Math.round(v * 1000) / 1000;
  const n = flat.length;
  const samples = [];
  for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
    const i = Math.floor(n * f / 2) * 2;
    samples.push(r((flat[i] - x0) / size), r((flat[i + 1] - y0) / size));
  }
  return [fnv(ops), n, r(size), r(h / (w || 1e-6) > 50 ? 50 : h / (w || 1e-6)), ...samples];
}
/** 사전으로 기호 분류기를 만든다 (모양이 같으면 크기가 달라도 같은 기호, 여러 개면 크기가 가장 가까운 것) */
export function makeClassifier(table, tol = 0.035) {
  const byKey = new Map();
  for (const row of table) {
    const key = row[1] + ":" + row[2];
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return segs => {
    const ops = segs.map(g => g.op).join(""), flat = segs.flatMap(g => g.pts);
    const f = shapeFeature(ops, flat);
    let best = null, bd = Infinity;
    for (const row of byKey.get(f[0] + ":" + f[1]) || []) {
      const ar = row[4], far = f[3];
      if (Math.abs(Math.log((ar + 0.01) / (far + 0.01))) > 0.12) continue;
      let ok = true;
      for (let i = 4; i < f.length; i++) if (Math.abs(f[i] - row[i + 1]) > tol) { ok = false; break; }
      if (!ok) continue;
      const d = Math.abs(Math.log(row[3] / f[2]));
      // 크기가 너무 다르면 다른 기호(예: 스타카토 점과 점음표의 점)
      if (d < 0.29 && d < bd) { bd = d; best = row[0]; }
    }
    return best;
  };
}

/** 템포: 첫 단 바로 위, 왼쪽 근처의 숫자(♩=142 등). 못 찾으면 null */
export function detectTempo(pages) {
  for (const pg of pages) {
    const verts = verticalRects(pg);
    const sys = groupSystems(findStaves(pg), verts).find(s => s.staves.length > 3);
    if (!sys) continue;
    const ds = pg.glyphs.filter(q => q.cls && /^d\d$/.test(q.cls) && q.bbox[3] < sys.top - 1 && q.bbox[3] > sys.top - 30 && q.x < sys.x0 + 120)
      .sort((a, b) => a.x - b.x);
    let best = null;
    for (let i = 0; i < ds.length; i++) {
      let s = ds[i].cls.slice(1), last = ds[i];
      for (let j = i + 1; j < ds.length && ds[j].bbox[0] - last.bbox[2] < 1.5 && Math.abs(ds[j].bbox[3] - last.bbox[3]) < 1; j++) { s += ds[j].cls.slice(1); last = ds[j]; }
      const v = +s;
      if (v >= 40 && v <= 260 && s.length >= 2) { best = v; break; }
    }
    return best;
  }
  return null;
}

/** 페이지에 밴드 스코어 기호가 충분히 있는가 (데이터 방식으로 읽을 수 있는 PDF인지) */
export function looksLikeBandScore(pages) {
  let labeled = 0, total = 0, systems = 0;
  for (const pg of pages) {
    total += pg.glyphs.length;
    labeled += pg.glyphs.filter(q => q.cls).length;
    systems += groupSystems(findStaves(pg), verticalRects(pg)).filter(s => s.staves.length > 3).length;
  }
  return systems > 0 && total > 50 && labeled / total > 0.2;
}

/* ------------------------------------------------- 11) 연주 순서 (도돌이표·괄호·D.S.·Coda) */

/**
 * 도돌이표 점: 굵은 마디줄 바로 옆, 보표 가운데 두 칸에 위아래로 찍힌 점 한 쌍.
 * 점음표의 점과 모양이 같으므로 먼저 골라내서 "repeat_dot"으로 바꿔 둔다.
 * @returns {{x:number, side:"start"|"end"}[]}
 */
export function markRepeatDots(sys, glyphs, verts) {
  const found = [];
  for (const st of sys.staves) {
    const bars = findBarlines(st, verts).filter(b => b.thick || b.double);
    const mid = (st.top + st.bottom) / 2;
    for (const b of bars) {
      for (const side of ["start", "end"]) {
        const ds = glyphs.filter(q => q.cls === "dot" && Math.abs((q.bbox[1] + q.bbox[3]) / 2 - mid) < st.gap * 1.2 &&
          (side === "end" ? q.bbox[2] <= b.x + 0.3 && b.x - q.bbox[2] < 3.5 : q.bbox[0] >= b.x1 - 0.3 && q.bbox[0] - b.x1 < 3.5));
        if (ds.length >= 2) {
          ds.forEach(q => (q.cls = "repeat_dot"));
          if (st === sys.staves[0]) found.push({ x: side === "end" ? b.x : b.x1, side });
        }
      }
    }
  }
  return found;
}

/**
 * 단 하나의 연주 순서 표시를 마디별로 정리
 * @returns 마디 인덱스별 { repeatStart, repeatEnd, volta, segno, coda, toCoda, ds }
 */
export function navigationMarks(sys, glyphs, edges, repeatDots) {
  const n = edges.length - 1;
  const marks = Array.from({ length: n }, () => ({}));
  const top = sys.staves[0].top, bottom = sys.bottom;
  const measureAt = x => { for (let i = 0; i < n; i++) if (x >= edges[i] - 1 && x < edges[i + 1] + 1) return i; return x < edges[0] ? 0 : n - 1; };
  for (const d of repeatDots) {
    if (d.side === "start") { const i = measureAt(d.x + 2); marks[i].repeatStart = true; }
    else { const i = measureAt(d.x - 2); marks[i].repeatEnd = true; }
  }
  const above = q => q.bbox[3] < top - 1 && q.bbox[3] > top - 32;
  // 1·2번 괄호: 보표 위의 숫자와, 그 숫자 바로 왼쪽에서 시작하는 넓은 꺾쇠 선
  const wide = glyphs.filter(q => !q.cls && above(q) && q.bbox[2] - q.bbox[0] > 25 && q.bbox[3] - q.bbox[1] < 14);
  for (const v of glyphs.filter(q => (q.cls === "v1" || q.cls === "v2") && above(q))) {
    let br = wide.find(w => w.bbox[0] <= v.bbox[0] + 0.5 && v.bbox[0] - w.bbox[0] < 7 && w.bbox[1] <= v.bbox[1] + 1);
    if (!br) continue;
    let x1 = br.bbox[2];
    for (let more = true; more;) { // 여러 조각으로 이어진 꺾쇠
      more = false;
      const nx = wide.find(w => w !== br && Math.abs(w.bbox[0] - x1) < 3 && Math.abs(w.bbox[1] - br.bbox[1]) < 2);
      if (nx) { x1 = nx.bbox[2]; br = nx; more = true; }
    }
    const num = v.cls === "v1" ? 1 : 2;
    for (let i = measureAt(v.bbox[0] + 1); i < n && edges[i] < x1 - 5; i++) marks[i].volta = num;
  }
  // 세뇨 / 코다: 보표 위
  for (const q of glyphs.filter(q => q.cls === "segno" && above(q))) marks[measureAt(q.x)].segno = true;
  for (const q of glyphs.filter(q => q.cls === "coda" && above(q))) {
    const i = measureAt((q.bbox[0] + q.bbox[2]) / 2);
    const rel = ((q.bbox[0] + q.bbox[2]) / 2 - edges[i]) / (edges[i + 1] - edges[i]);
    if (rel > 0.6) marks[i].toCoda = true; else marks[i].coda = true;   // "to ⊕"는 마디 끝, "⊕ Coda"는 마디 처음
  }
  // D.S.: 'D' 바로 뒤 'S' (단 아래쪽에 적힘)
  for (const d of glyphs.filter(q => q.cls === "text_D" && q.y > top - 30 && q.y < bottom + 30)) {
    const s = glyphs.find(q => q.cls === "text_S" && q.bbox[0] > d.bbox[2] - 0.5 && q.bbox[0] - d.bbox[2] < 6 && Math.abs(q.bbox[3] - d.bbox[3]) < 1);
    if (s) marks[measureAt(Math.min(d.x, edges[n] - 2))].ds = true;
  }
  return marks;
}
