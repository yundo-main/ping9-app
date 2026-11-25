// docs/index.html의 히스토리 섹션을 docs/task-logs/README.md 표에서 다시 만든다 (T0.65).
// 랜딩에 손으로 목록을 유지하지 않고, 배포 워크플로(web-pages.yml)가 이 스크립트를 돌려
// 사이트에 올리는 index.html을 갱신한다. 로컬 미리보기용으로 수동 실행해도 된다.
//
//   node scripts/update-landing-history.mjs [index.html 경로]
//
// index.html 안의 <!--HISTORY:BEGIN/END-->(최근 RECENT개)와
// <!--HISTORY-MORE:BEGIN/END-->(나머지, <details> 안) 두 구역을 바꾼다.

import { readFileSync, writeFileSync } from "node:fs";

const indexPath = process.argv[2] ?? "docs/index.html";
const readmePath = "docs/task-logs/README.md";
const REPO = "https://github.com/yundo-main/ping9-app/blob/main/docs/task-logs";
const RECENT = 12;

const rows = [];
for (const line of readFileSync(readmePath, "utf8").split("\n")) {
  const match = line.match(/^\|\s*(T[\d.]+)\s+(.+?)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)/);
  if (match === null) continue;
  const [, id, title, , file] = match;
  rows.push({ id, title: title.replace(/\s*\(계획에 없는 새 ID\)\s*$/, ""), file });
}
if (rows.length === 0) throw new Error("task-logs README에서 행을 찾지 못했습니다");

const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const tr = (row) =>
  `      <tr><td class="hid">${row.id}</td><td><a href="${REPO}/${row.file}">${escape(row.title)}</a></td></tr>`;
const newest = rows.toReversed();
const recent = newest.slice(0, RECENT).map(tr).join("\n");
const rest = newest.slice(RECENT).map(tr).join("\n");

let index = readFileSync(indexPath, "utf8");
for (const [mark, html] of [["HISTORY", recent], ["HISTORY-MORE", rest]]) {
  const begin = `<!--${mark}:BEGIN-->`, end = `<!--${mark}:END-->`;
  const [before, rest_] = index.split(begin);
  if (rest_ === undefined) throw new Error(`${indexPath}에 ${begin} 표시가 없습니다`);
  const [, after] = rest_.split(end);
  if (after === undefined) throw new Error(`${indexPath}에 ${end} 표시가 없습니다`);
  index = `${before}${begin}\n${html}\n      ${end}${after}`;
}

writeFileSync(indexPath, index);
console.log(`${indexPath}: 히스토리 최근 ${Math.min(RECENT, rows.length)}행 + 이전 ${Math.max(0, rows.length - RECENT)}행 갱신`);
