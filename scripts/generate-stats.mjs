// Generates the profile SVGs in assets/ from the GitHub API.
// Only totals are written out. Repository names are never requested or published.
// Usage: GH_TOKEN=<token> node scripts/generate-stats.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN is required");

const TECH = ["TypeScript", "JavaScript", "Python", "Solidity", "Move", "React", "Next.js", "Tailwind CSS"];
const NAME = "observe";
const NOTE = "just observing";
const TAGLINE = "Developer building web apps and onchain products";
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

// ---------- Design tokens ----------
// Follows the copper design system: copper on neutral, used sparingly; hairlines instead of
// glows; pixel type for the signature and numbers; still at rest, with no looping motion.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => n.toLocaleString("en-US");
const formatPct = (pct) => (pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`);
const WIDTH = 582;

const FONT_FILES = {
  pixel: ["Geist Pixel", 400, "pixel"],
  mono: ["Geist Mono", 400, "mono"],
  regular: ["Funnel Display", 400, "display-regular"],
  medium: ["Funnel Display", 500, "display-medium"],
};

function fontFaces(names) {
  return names
    .map((key) => {
      const [family, weight, file] = FONT_FILES[key];
      const data = readFileSync(`assets/fonts/${file}.woff2`).toString("base64");
      return `@font-face { font-family: "${family}"; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
    })
    .join("\n");
}

const STYLE = `
  svg { --page: #fff; --well: #f2f2f3; --raised: #fff; --ink: #18181b; --ink-2: #5d5d66; --ink-3: #6b6b73;
        --line: #00000012; --line-strong: #00000029; --accent: #d95f35; --cover: #a94a2c; --hatch: #00000024; }
  @media (prefers-color-scheme: dark) {
    svg { --page: #121212; --well: #1b1b1e; --raised: #1f1f22; --ink: #fafafa; --ink-2: #a8a8ad; --ink-3: #8b8b92;
          --line: #ffffff14; --line-strong: #ffffff2e; --accent: #ee7446; --cover: #6e2f1d; --hatch: #ffffff33; }
  }
  text { font-family: "Funnel Display", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-variant-numeric: tabular-nums; }
  .pixel { font-family: "Geist Pixel", ui-monospace, Menlo, monospace; }
  .mono { font-family: "Geist Mono", ui-monospace, Menlo, monospace; }
  .card { fill: var(--raised); stroke: var(--line-strong); }
  .page { fill: var(--page); stroke: var(--line-strong); }
  .well { fill: var(--well); }
  .cover { fill: var(--cover); }
  .mark, .accent { fill: var(--accent); }
  .rule { stroke: var(--line); }
  .ink { fill: var(--ink); }
  .ink-2 { fill: var(--ink-2); }
  .ink-3 { fill: var(--ink-3); }
  .cream { fill: #fff4ea; }
  .title { fill: var(--ink); font-size: 16px; font-weight: 500; letter-spacing: -0.01em; }
  .count { fill: var(--ink-3); font-size: 11px; }
  .note { fill: var(--ink-3); font-size: 12px; }
  .value { fill: var(--ink); font-size: 28px; }
  .label { fill: var(--ink-3); font-size: 12px; }
  .name { fill: var(--ink); font-size: 14px; }
  .bar { fill: var(--line-strong); }
  .neutral { fill: var(--ink-3); }
  .chip { fill: var(--well); stroke: var(--line); }
  .hatch { stroke: var(--hatch); }
  .reveal { animation: reveal 0.7s cubic-bezier(.23, 1, .32, 1) both; }
  @keyframes reveal { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`;

function svgDoc(width, height, title, fonts, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${fontFaces(fonts)}${STYLE}</style>
${body}
</svg>
`;
}

// A section card: copper square, name, raised count, note at the right, then the content.
function section(height, title, name, { count, note, fonts = [] }, body) {
  const raised = count === undefined ? "" : `<tspan class="count" dx="4" dy="-6">${esc(count)}</tspan>`;
  const head = `<rect class="mark" x="24" y="24" width="6" height="6" rx="1.5"/>
<text class="title" x="38" y="33">${esc(name)}${raised}</text>
${note ? `<text class="note pixel" x="${WIDTH - 24}" y="32" text-anchor="end">${esc(note)}</text>` : ""}`;
  const frame = `<rect class="card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="14"/>`;
  return svgDoc(WIDTH, height, title, ["medium", "regular", "pixel", ...fonts], `${frame}\n${head}\n<g class="reveal">${body}</g>`);
}

// ---------- Cards ----------

function bannerSvg() {
  const coverHeight = 118;
  const height = 226;
  const body = `<defs>
  <clipPath id="tile"><rect x="1" y="1" width="${WIDTH - 2}" height="${height - 2}" rx="20"/></clipPath>
  <pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1" class="cream"/></pattern>
  <radialGradient id="bloom" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity=".04"/></radialGradient>
  <mask id="field"><rect width="${WIDTH}" height="${coverHeight}" fill="url(#bloom)"/></mask>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
</defs>
<rect class="page" x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="20"/>
<g clip-path="url(#tile)">
  <rect class="cover" width="${WIDTH}" height="${coverHeight}"/>
  <rect width="${WIDTH}" height="${coverHeight}" filter="url(#grain)" opacity=".12"/>
  <rect width="${WIDTH}" height="${coverHeight}" fill="url(#dots)" mask="url(#field)" class="reveal"/>
</g>
<text class="ink pixel" x="24" y="172" font-size="38">${esc(NAME)}</text>
<text class="note pixel" x="${WIDTH - 24}" y="170" text-anchor="end">${esc(NOTE)}</text>
<text class="ink-2" x="24" y="202" font-size="15">${esc(TAGLINE)}</text>`;
  return svgDoc(WIDTH, height, `${NAME}: ${TAGLINE}`, ["regular", "pixel"], body);
}

function statsSvg(tiles, firstYear, title) {
  const cell = WIDTH / tiles.length;
  const body = tiles
    .map(({ value, label }, i) => {
      const x = cell * i + (i ? 16 : 24);
      const rule = i ? `<line class="rule" x1="${cell * i}" x2="${cell * i}" y1="60" y2="118"/>` : "";
      return `${rule}<text class="value pixel" x="${x}" y="88">${esc(value)}</text><text class="label" x="${x}" y="112">${esc(label)}</text>`;
    })
    .join("\n");
  return section(138, title, "At a glance", { note: `since ${firstYear}` }, body);
}

function languagesSvg(rows, count, title) {
  const rowHeight = 32;
  const top = 52;
  const [barX, barWidth, barHeight] = [128, 346, 4];
  const scale = Math.max(...rows.map((r) => r.pct));
  const body = rows
    .map(({ name, pct }, i) => {
      const y = top + i * rowHeight;
      const mid = y + rowHeight / 2;
      const w = Math.max(4, (pct / scale) * barWidth).toFixed(1);
      return `<line class="rule" x1="24" x2="${WIDTH - 24}" y1="${y}" y2="${y}"/>
<text class="name" x="24" y="${mid + 5}">${esc(name)}</text>
<rect class="well" x="${barX}" y="${mid - barHeight / 2}" width="${barWidth}" height="${barHeight}" rx="2"/>
<rect class="${i === 0 ? "accent" : "neutral"}" x="${barX}" y="${mid - barHeight / 2}" width="${w}" height="${barHeight}" rx="2"/>
<text class="ink-3 pixel" font-size="13" x="${WIDTH - 24}" y="${mid + 4}" text-anchor="end">${formatPct(pct)}</text>`;
    })
    .join("\n");
  return section(top + rows.length * rowHeight + 10, title, "Languages", { count: num(count), note: "by code size" }, body);
}

function activitySvg(months, title) {
  const [left, right, top, bottom] = [24, WIDTH - 24, 82, 176];
  const barWidth = 18;
  const peak = Math.max(1, ...months.map((m) => m.total));
  const peakIndex = months.findIndex((m) => m.total === peak);
  const step = (right - left) / months.length;
  const bars = months
    .map((m, i) => {
      const cx = left + step * (i + 0.5);
      const h = Math.max(2, (m.total / peak) * (bottom - top));
      const x = cx - barWidth / 2;
      const y = bottom - h;
      const r = Math.min(4, h);
      const shape = `M${x} ${bottom}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + barWidth - r}Q${x + barWidth} ${y} ${x + barWidth} ${y + r}V${bottom}Z`;
      const current = i === months.length - 1;
      const cls = i === peakIndex ? "accent" : current ? "" : "bar";
      const mark = current ? `<path d="${shape}" fill="url(#hatch)"/>` : `<path class="${cls}" d="${shape}"/>`;
      const value = i === peakIndex ? `<text class="ink pixel" font-size="13" x="${cx}" y="${y - 8}" text-anchor="middle">${num(m.total)}</text>` : "";
      return `${mark}${value}<text class="ink-3" font-size="12" x="${cx}" y="${bottom + 20}" text-anchor="middle">${esc(m.label)}</text>`;
    })
    .join("\n");
  const defs = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path class="hatch" d="M-1 1l2-2M0 6l6-6M5 7l2-2" fill="none"/></pattern></defs>`;
  const baseline = `<line class="rule" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/>`;
  return section(bottom + 38, title, "Contributions", { note: "last 12 months" }, `${defs}${baseline}\n${bars}`);
}

function techSvg(items) {
  const [padX, gap, chipHeight, startY] = [12, 8, 28, 52];
  let [x, y] = [24, startY];
  const chips = items.map((t) => {
    const w = Math.round(t.length * 7.8) + padX * 2;
    if (x + w > WIDTH - 24) {
      x = 24;
      y += chipHeight + gap;
    }
    const chip = `<rect class="chip" x="${x}" y="${y + 0.5}" width="${w}" height="${chipHeight}" rx="${chipHeight / 2}"/>
<text class="ink-2 mono" font-size="13" x="${x + w / 2}" y="${y + 19}" text-anchor="middle">${esc(t)}</text>`;
    x += w + gap;
    return chip;
  });
  return section(y + chipHeight + 22, `Tools: ${items.join(", ")}`, "Tools", { count: num(items.length), fonts: ["mono"] }, chips.join("\n"));
}

function contactSvg(handle) {
  const [w, h] = [176, 36];
  const label = `Follow ${handle} on X`;
  const body = `<rect class="cover" width="${w}" height="${h}" rx="18"/>
<text class="cream" x="${w / 2}" y="23" text-anchor="middle" font-size="13" font-weight="500">${esc(label)}</text>`;
  return svgDoc(w, h, label, ["medium"], body);
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
  { value: num(thisYear), label: `${year} contributions` },
  { value: num(allTime), label: "Total contributions" },
  { value: num(repos.length), label: "Repositories" },
  { value: `${num(streak)} ${streak === 1 ? "day" : "days"}`, label: "Longest streak" },
];
const statsAlt = `GitHub stats: ${num(thisYear)} contributions in ${year}, ${num(allTime)} total contributions, ${num(repos.length)} repositories, longest streak ${num(streak)} days`;
const langAlt = `Most used languages: ${rows.map((r) => `${r.name} ${formatPct(r.pct)}`).join(", ")}`;
const activityAlt = `Contributions per month, last 12 months: ${months.map((m) => `${m.label} ${num(m.total)}`).join(", ")}`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/banner.svg", bannerSvg());
writeFileSync("assets/stats.svg", statsSvg(tiles, days.find((d) => d.count > 0)?.date.slice(0, 4) ?? year, statsAlt));
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
