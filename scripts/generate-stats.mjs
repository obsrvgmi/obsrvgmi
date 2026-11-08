// Generates the profile SVGs in assets/ from the GitHub API.
// Only totals are written out. Repository names are never requested or published.
// Usage: GH_TOKEN=<token> node scripts/generate-stats.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN is required");

const TECH = ["TypeScript", "JavaScript", "Python", "Solidity", "Move", "React", "Next.js", "Tailwind CSS"];
const TAGLINE = ["Developer building web apps", "and onchain products"];
const HANDLE = "@obsrvgmi";

// ---------- Data ----------

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "User-Agent": "profile-stats" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data.viewer;
}

async function fetchRepos() {
  const query = `query($after: String) { viewer { repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
    pageInfo { hasNextPage endCursor }
    nodes { isPrivate languages(first: 15, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
  } } }`;
  const repos = [];
  let after = null;
  do {
    const { repositories: page } = await gql(query, { after });
    repos.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return repos;
}

async function fetchDays() {
  const { contributionsCollection: c } = await gql(`{ viewer { contributionsCollection { contributionYears } } }`);
  const days = [];
  for (const year of c.contributionYears) {
    const data = await gql(
      `query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) {
        contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`,
      { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    for (const week of data.contributionsCollection.contributionCalendar.weeks) {
      for (const d of week.contributionDays) days.push({ date: d.date, count: d.contributionCount });
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function languageShares(repos) {
  const bytes = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
  }
  const sorted = [...bytes].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, size]) => sum + size, 0);
  const rows = sorted.slice(0, 6).map(([name, size]) => ({ name, pct: (size / total) * 100 }));
  const rest = sorted.slice(6).reduce((sum, [, size]) => sum + size, 0);
  if (rest > 0) rows.push({ name: "Other", pct: (rest / total) * 100 });
  return { rows, count: sorted.length };
}

function longestStreak(days) {
  let best = 0;
  let run = 0;
  let previous = null;
  for (const { date, count } of days) {
    const time = Date.parse(`${date}T00:00:00Z`);
    run = count > 0 ? (previous !== null && time - previous === 86400000 ? run + 1 : 1) : 0;
    if (count > 0) previous = time;
    best = Math.max(best, run);
  }
  return best;
}

function lastTwelveMonths(days, now) {
  const months = [];
  for (let back = 11; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const key = d.toISOString().slice(0, 7);
    const total = days.filter((day) => day.date.startsWith(key)).reduce((sum, day) => sum + day.count, 0);
    months.push({ label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), total });
  }
  return months;
}

// ---------- Shared drawing ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => n.toLocaleString("en-US");
const formatPct = (pct) => (pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const WIDTH = 640;

const STYLE = `<style>
  text { font-family: ${FONT}; }
  .title { fill: #fbf1e7; font-size: 16px; font-weight: 600; }
  .value { font-size: 30px; font-weight: 700; }
  .label { fill: #c9b3a1; font-size: 13px; }
  .name { fill: #f3e3d3; font-size: 14px; }
  .pct { fill: #c9b3a1; font-size: 14px; }
  .axis { fill: #a99280; font-size: 11px; }
  .chip { fill: #f3e3d3; font-size: 13px; font-weight: 500; }
  .grow { transform-box: fill-box; transform-origin: left center; animation: grow 1.1s cubic-bezier(.2,.8,.2,1) both; }
  .fade { animation: fade 1.2s ease-out both; }
  @keyframes grow { from { transform: scaleX(0); } }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>`;

const DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#160f0b"/><stop offset="1" stop-color="#22160f"/></linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4c7a1"/><stop offset=".55" stop-color="#d88a55"/><stop offset="1" stop-color="#b4623a"/></linearGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4c7a1" stop-opacity=".55"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#b4623a" stop-opacity=".55"/></linearGradient>
  <radialGradient id="glowA"><stop offset="0" stop-color="#f4c7a1" stop-opacity=".2"/><stop offset="1" stop-color="#f4c7a1" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowB"><stop offset="0" stop-color="#8a4526" stop-opacity=".28"/><stop offset="1" stop-color="#8a4526" stop-opacity="0"/></radialGradient>
  <filter id="soft" x="-20%" y="-150%" width="140%" height="400%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>`;

function card(height, title, body, extraDefs = "", extraStyle = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${STYLE}${extraStyle}
${DEFS}${extraDefs}
<clipPath id="frame"><rect x="1" y="1" width="${WIDTH - 2}" height="${height - 2}" rx="16"/></clipPath>
<g clip-path="url(#frame)">
  <rect width="${WIDTH}" height="${height}" fill="url(#bg)"/>
  <ellipse cx="60" cy="0" rx="260" ry="${Math.max(120, height * 0.7)}" fill="url(#glowA)"/>
  <ellipse cx="${WIDTH - 40}" cy="${height}" rx="280" ry="${Math.max(130, height * 0.8)}" fill="url(#glowB)"/>
</g>
<rect x="1" y="1" width="${WIDTH - 2}" height="${height - 2}" rx="16" fill="none" stroke="url(#edge)" stroke-width="1.5"/>
${body}
</svg>
`;
}

// ---------- Cards ----------

function bannerSvg() {
  // Fixed seed, so the star field does not change between runs.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 46 }, (_, i) => {
    const twinkle = i % 5 === 0 ? ` class="tw" style="animation-delay:${(rand() * 4).toFixed(1)}s"` : "";
    return `<circle cx="${(rand() * WIDTH).toFixed(1)}" cy="${(rand() * 240).toFixed(1)}" r="${(0.5 + rand() * 0.9).toFixed(1)}" fill="#ffe9d6" opacity="${(0.25 + rand() * 0.55).toFixed(2)}"${twinkle}/>`;
  }).join("");

  const [cx, cy] = [496, 120];
  const orbit = (cls, rx, ry, tilt, dotAt) => `<g class="${cls}"><g transform="rotate(${tilt} ${cx} ${cy})">
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="url(#accent)" stroke-opacity=".4"/>
    <circle cx="${cx + rx * Math.cos(dotAt)}" cy="${cy + ry * Math.sin(dotAt)}" r="3.5" fill="#f4c7a1"/></g></g>`;

  const body = `${stars}
<text x="40" y="118" font-size="64" font-weight="700" letter-spacing="-1.5" fill="url(#accent)">observe</text>
<text x="42" y="154" font-size="17" fill="#f3e3d3">${esc(TAGLINE[0])}</text>
<text x="42" y="178" font-size="17" fill="#f3e3d3">${esc(TAGLINE[1])}</text>
${orbit("spinA", 112, 44, -24, 0.7)}
${orbit("spinB", 104, 36, 28, 3.9)}
<circle cx="${cx}" cy="${cy}" r="62" fill="url(#glowA)"/>
<path d="M${cx - 76} ${cy} Q${cx} ${cy - 66} ${cx + 76} ${cy} Q${cx} ${cy + 66} ${cx - 76} ${cy} Z" fill="#160f0b" fill-opacity=".85" stroke="url(#accent)" stroke-width="2.5" stroke-linejoin="round"/>
<circle class="iris" cx="${cx}" cy="${cy}" r="27" fill="url(#iris)"/>
<circle cx="${cx}" cy="${cy}" r="11" fill="#160f0b"/>
<circle cx="${cx + 7}" cy="${cy - 8}" r="4" fill="#ffe9d6" opacity=".9"/>`;

  const defs = `<defs><radialGradient id="iris"><stop offset="0" stop-color="#b4623a"/><stop offset=".6" stop-color="#d88a55"/><stop offset="1" stop-color="#f4c7a1"/></radialGradient></defs>`;
  const style = `<style>
  .spinA, .spinB { transform-origin: ${cx}px ${cy}px; animation: spin 48s linear infinite; }
  .spinB { animation-duration: 72s; animation-direction: reverse; }
  .iris { transform-origin: ${cx}px ${cy}px; animation: pulse 6s ease-in-out infinite; }
  .tw { animation: tw 4s ease-in-out infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { transform: scale(1.08); } }
  @keyframes tw { 50% { opacity: .1; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>`;
  return card(240, `observe: ${TAGLINE.join(" ")}`, body, defs, style);
}

const ICONS = {
  bolt: `<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>`,
  commit: `<circle cx="12" cy="12" r="4"/><path d="M2 12h6M16 12h6"/>`,
  repo: `<path d="M5 18V5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12"/>`,
  flame: `<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-2 1-4 2-5 0 2 1 3 2 3 1-3 0-6 2-10z"/>`,
};

function statsSvg(tiles, title) {
  const cell = WIDTH / tiles.length;
  const body = tiles
    .map(({ value, label, icon }, i) => {
      const x = cell * i + 20;
      const rule = i ? `<line x1="${cell * i}" x2="${cell * i}" y1="24" y2="118" stroke="#ffffff" stroke-opacity=".08"/>` : "";
      return `${rule}<g class="fade" style="animation-delay:${i * 0.12}s">
  <rect x="${x}" y="20" width="32" height="32" rx="9" fill="#ffffff" fill-opacity=".06" stroke="url(#accent)" stroke-opacity=".5"/>
  <g transform="translate(${x + 7} 27) scale(.75)" fill="none" stroke="url(#iconStroke)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>
  <text class="value" x="${x}" y="92" fill="url(#accent)">${esc(value)}</text>
  <text class="label" x="${x}" y="114">${esc(label)}</text>
</g>`;
    })
    .join("\n");
  const defs = `<defs><linearGradient id="iconStroke" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="24"><stop offset="0" stop-color="#f4c7a1"/><stop offset="1" stop-color="#d88a55"/></linearGradient></defs>`;
  return card(136, title, body, defs);
}

function languagesSvg(rows, count, title) {
  const rowHeight = 30;
  const top = 64;
  const [barX, barWidth, barHeight] = [132, 420, 10];
  const scale = Math.max(...rows.map((r) => r.pct));
  const body = rows
    .map(({ name, pct }, i) => {
      const y = top + i * rowHeight;
      const w = Math.max(5, (pct / scale) * barWidth).toFixed(1);
      const bar = `<rect x="${barX}" y="${y}" width="${w}" height="${barHeight}" rx="5" fill="url(#accent)"`;
      return `<text class="name" x="24" y="${y + 10}">${esc(name)}</text>
<rect x="${barX}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="#ffffff" fill-opacity=".07"/>
<g class="grow" style="animation-delay:${i * 0.08}s">${bar} filter="url(#soft)" opacity=".55"/>${bar}/></g>
<text class="pct" x="${WIDTH - 24}" y="${y + 10}" text-anchor="end">${formatPct(pct)}</text>`;
    })
    .join("\n");
  const heading = `<text class="title" x="24" y="38">Most used languages</text><text class="label" x="${WIDTH - 24}" y="38" text-anchor="end">${num(count)} languages in total</text>`;
  return card(top + rows.length * rowHeight + 8, title, `${heading}\n${body}`);
}

function activitySvg(months, title) {
  const [left, right, top, bottom] = [40, WIDTH - 28, 88, 208];
  const peak = Math.max(1, ...months.map((m) => m.total));
  const step = (right - left) / (months.length - 1);
  const pts = months.map((m, i) => ({ x: left + i * step, y: bottom - (m.total / peak) * (bottom - top), ...m }));
  const curve = (list) =>
    list
      .map((p, i) => {
        if (!i) return `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        const a = list[i - 1];
        const mid = ((a.x + p.x) / 2).toFixed(1);
        return `C${mid} ${a.y.toFixed(1)} ${mid} ${p.y.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(" ");
  const full = pts.slice(0, -1);
  const partial = pts.slice(-2);
  const area = `${curve(pts)} L${right} ${bottom} L${left} ${bottom} Z`;
  const peakPoint = pts.reduce((a, b) => (b.total > a.total ? b : a));
  const peakAnchor = peakPoint.x > WIDTH - 70 ? "end" : peakPoint.x < 70 ? "start" : "middle";

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = bottom - f * (bottom - top);
      return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#ffffff" stroke-opacity=".08"/><text class="axis" x="${left - 8}" y="${y + 4}" text-anchor="end">${num(Math.round(peak * f))}</text>`;
    })
    .join("");
  const labels = pts.map((p) => `<text class="axis" x="${p.x}" y="${bottom + 20}" text-anchor="middle">${esc(p.label)}</text>`).join("");

  const body = `<text class="title" x="24" y="38">Contributions, last 12 months</text>
${grid}${labels}
<g class="fade">
  <path d="${area}" fill="url(#areaFill)"/>
  <path d="${curve(full)}" fill="none" stroke="url(#lineStroke)" stroke-width="2.5" stroke-linecap="round"/>
  <path d="${curve(partial)}" fill="none" stroke="#b4623a" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="2 6"/>
  <circle cx="${peakPoint.x}" cy="${peakPoint.y}" r="9" fill="#f4c7a1" opacity=".25"/>
  <circle cx="${peakPoint.x}" cy="${peakPoint.y}" r="4.5" fill="#f4c7a1" stroke="#160f0b" stroke-width="2"/>
  <text class="name" x="${peakPoint.x}" y="${peakPoint.y - 15}" text-anchor="${peakAnchor}" font-weight="600">${num(peakPoint.total)}</text>
</g>`;
  const defs = `<defs>
  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d88a55" stop-opacity=".4"/><stop offset="1" stop-color="#d88a55" stop-opacity="0"/></linearGradient>
  <linearGradient id="lineStroke" gradientUnits="userSpaceOnUse" x1="${left}" y1="0" x2="${right}" y2="0"><stop offset="0" stop-color="#f4c7a1"/><stop offset=".55" stop-color="#d88a55"/><stop offset="1" stop-color="#b4623a"/></linearGradient>
</defs>`;
  return card(bottom + 38, title, body, defs);
}

function techSvg(items) {
  const [padX, gap, chipHeight, startY] = [14, 10, 34, 58];
  const widthOf = (t) => Math.round(t.length * 7.6) + padX * 2 + 14;
  let [x, y] = [24, startY];
  const chips = items.map((t) => {
    const w = widthOf(t);
    if (x + w > WIDTH - 24) {
      x = 24;
      y += chipHeight + gap;
    }
    const chip = `<rect x="${x}" y="${y}" width="${w}" height="${chipHeight}" rx="17" fill="#ffffff" fill-opacity=".05" stroke="url(#accent)" stroke-opacity=".55"/>
<circle cx="${x + padX + 2}" cy="${y + chipHeight / 2}" r="3.5" fill="url(#accent)"/>
<text class="chip" x="${x + padX + 13}" y="${y + 22}">${esc(t)}</text>`;
    x += w + gap;
    return chip;
  });
  const body = `<text class="title" x="24" y="38">Tech stack</text>\n${chips.join("\n")}`;
  return card(y + chipHeight + 22, `Tech stack: ${items.join(", ")}`, body);
}

function contactSvg(handle) {
  const [w, h] = [190, 44];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(`Follow ${handle} on X`)}">
<title>${esc(`Follow ${handle} on X`)}</title>
<style>text { font-family: ${FONT}; }</style>
<defs><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4c7a1"/><stop offset=".55" stop-color="#d88a55"/><stop offset="1" stop-color="#b4623a"/></linearGradient></defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="21" fill="#160f0b" stroke="url(#accent)" stroke-width="1.5"/>
<text x="${w / 2}" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="#fbf1e7">Follow ${esc(handle)} on X</text>
</svg>
`;
}

// ---------- Build ----------

const repos = await fetchRepos();
// Stop rather than publish lower numbers if the token cannot see private repositories.
if (!repos.some((r) => r.isPrivate)) throw new Error("Token cannot see private repositories; keeping existing stats");

const days = await fetchDays();
const now = new Date();
const year = now.getUTCFullYear();
const allTime = days.reduce((sum, d) => sum + d.count, 0);
const thisYear = days.filter((d) => d.date.startsWith(`${year}-`)).reduce((sum, d) => sum + d.count, 0);
const streak = longestStreak(days);
const { rows, count } = languageShares(repos);
const months = lastTwelveMonths(days, now);

const tiles = [
  { value: num(thisYear), label: `${year} contributions`, icon: "bolt" },
  { value: num(allTime), label: "Total contributions", icon: "commit" },
  { value: num(repos.length), label: "Repositories", icon: "repo" },
  { value: `${num(streak)} ${streak === 1 ? "day" : "days"}`, label: "Longest streak", icon: "flame" },
];
const statsAlt = `GitHub stats: ${num(thisYear)} contributions in ${year}, ${num(allTime)} total contributions, ${num(repos.length)} repositories, longest streak ${num(streak)} days`;
const langAlt = `Most used languages: ${rows.map((r) => `${r.name} ${formatPct(r.pct)}`).join(", ")}`;
const activityAlt = `Contributions per month, last 12 months: ${months.map((m) => `${m.label} ${num(m.total)}`).join(", ")}`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/banner.svg", bannerSvg());
writeFileSync("assets/stats.svg", statsSvg(tiles, statsAlt));
writeFileSync("assets/languages.svg", languagesSvg(rows, count, langAlt));
writeFileSync("assets/activity.svg", activitySvg(months, activityAlt));
writeFileSync("assets/tech.svg", techSvg(TECH));
writeFileSync("assets/contact.svg", contactSvg(HANDLE));

// Keep the README's alt text in step with the charts.
const readme = readFileSync("README.md", "utf8")
  .replace(/(src="assets\/stats\.svg" alt=")[^"]*/, `$1${esc(statsAlt)}`)
  .replace(/(src="assets\/languages\.svg" alt=")[^"]*/, `$1${esc(langAlt)}`)
  .replace(/(src="assets\/activity\.svg" alt=")[^"]*/, `$1${esc(activityAlt)}`);
writeFileSync("README.md", readme);

console.log(statsAlt);
console.log(langAlt);
console.log(activityAlt);
