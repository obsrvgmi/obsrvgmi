// Generates assets/stats.svg and assets/languages.svg from the GitHub API.
// Only totals are written out. Repository names are never requested or published.
// Usage: GH_TOKEN=<token> node scripts/generate-stats.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const token = process.env.GH_TOKEN;
if (!token) throw new Error("GH_TOKEN is required");

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

async function fetchContributions() {
  const { contributionsCollection: c } = await gql(`{ viewer { contributionsCollection { contributionYears } } }`);
  const byYear = {};
  for (const year of c.contributionYears) {
    const data = await gql(
      `query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) { contributionCalendar { totalContributions } } } }`,
      { from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    byYear[year] = data.contributionsCollection.contributionCalendar.totalContributions;
  }
  return byYear;
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

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const WIDTH = 640;

const STYLE = `<style>
  text { font-family: ${FONT}; }
  .card { fill: #ffffff; stroke: #d0d7de; }
  .title { fill: #1f2328; font-size: 16px; font-weight: 600; }
  .value { fill: #1f2328; font-size: 30px; font-weight: 600; }
  .label { fill: #59636e; font-size: 13px; }
  .name { fill: #1f2328; font-size: 14px; }
  .pct { fill: #59636e; font-size: 14px; }
  .bar { fill: #1f6feb; }
  .track { fill: #eff2f5; }
  .rule { stroke: #d0d7de; }
  @media (prefers-color-scheme: dark) {
    .card { fill: #0d1117; stroke: #30363d; }
    .title, .value, .name { fill: #f0f6fc; }
    .label, .pct { fill: #9198a1; }
    .bar { fill: #4493f8; }
    .track { fill: #21262d; }
    .rule { stroke: #30363d; }
  }
</style>`;

const svg = (height, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
${STYLE}
<rect class="card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="8"/>
${body}
</svg>
`;

function statsSvg(tiles, title) {
  const cell = WIDTH / tiles.length;
  const body = tiles
    .map(({ value, label }, i) => {
      const x = cell * i + 24;
      const rule = i ? `<line class="rule" x1="${cell * i}" x2="${cell * i}" y1="24" y2="84"/>` : "";
      return `${rule}<text class="value" x="${x}" y="54">${esc(value)}</text><text class="label" x="${x}" y="78">${esc(label)}</text>`;
    })
    .join("\n");
  return svg(108, title, body);
}

function languagesSvg(rows, title) {
  const rowHeight = 30;
  const top = 62;
  const [barX, barWidth, barHeight] = [132, 420, 10];
  const scale = Math.max(...rows.map((r) => r.pct));
  const body = rows
    .map(({ name, pct }, i) => {
      const y = top + i * rowHeight;
      const w = Math.max(4, (pct / scale) * barWidth).toFixed(1);
      return [
        `<text class="name" x="24" y="${y + 9}">${esc(name)}</text>`,
        `<rect class="track" x="${barX}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4"/>`,
        `<rect class="bar" x="${barX}" y="${y}" width="${w}" height="${barHeight}" rx="4"/>`,
        `<text class="pct" x="${WIDTH - 24}" y="${y + 9}" text-anchor="end">${formatPct(pct)}</text>`,
      ].join("");
    })
    .join("\n");
  const heading = `<text class="title" x="24" y="36">Most used languages</text>`;
  return svg(top + rows.length * rowHeight + 10, title, `${heading}\n${body}`);
}

const formatPct = (pct) => (pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`);

const repos = await fetchRepos();
// Stop rather than publish lower numbers if the token cannot see private repositories.
if (!repos.some((r) => r.isPrivate)) throw new Error("Token cannot see private repositories; keeping existing stats");

const byYear = await fetchContributions();
const year = new Date().getUTCFullYear();
const allTime = Object.values(byYear).reduce((sum, n) => sum + n, 0);
const { rows, count } = languageShares(repos);

const tiles = [
  { value: (byYear[year] ?? 0).toLocaleString("en-US"), label: `${year} contributions` },
  { value: allTime.toLocaleString("en-US"), label: "Total contributions" },
  { value: repos.length.toLocaleString("en-US"), label: "Repositories" },
  { value: count.toLocaleString("en-US"), label: "Languages" },
];
const statsAlt = `GitHub stats: ${tiles.map((t) => `${t.value} ${t.label.toLowerCase()}`).join(", ")}`;
const langAlt = `Most used languages: ${rows.map((r) => `${r.name} ${formatPct(r.pct)}`).join(", ")}`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats.svg", statsSvg(tiles, statsAlt));
writeFileSync("assets/languages.svg", languagesSvg(rows, langAlt));

// Keep the README's alt text in step with the charts.
const readme = readFileSync("README.md", "utf8")
  .replace(/(src="assets\/stats\.svg" alt=")[^"]*/, `$1${esc(statsAlt)}`)
  .replace(/(src="assets\/languages\.svg" alt=")[^"]*/, `$1${esc(langAlt)}`);
writeFileSync("README.md", readme);

console.log(statsAlt);
console.log(langAlt);
