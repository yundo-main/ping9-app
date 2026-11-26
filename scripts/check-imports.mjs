// 프로젝트 경계 검사 — 두 제품(ping9-app / PING9 Edu)의 import 규칙이 지켜지는지 본다.
//
//   node scripts/check-imports.mjs     추적 중인 소스 파일을 검사
//
// 규칙 (docs/repo-structure.md):
//   - edu/**     → apps/*(본체)를 import하지 않는다
//   - packages/** → apps/*·edu/*를 모른다 (공용 코어)
//   - packages/editor → @tauri-apps/*(플랫폼)를 모른다 — 플랫폼 동작은 prop
//   - packages/engine·shared → UI·플랫폼 없는 순수 TS (react·vite·tauri 금지)
//   - apps/**    → edu/*를 모른다
//   - 패키지 사이 상대 경로 우회 금지 (../../packages/... 같은 탈출)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, posix } from "node:path";

const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => SOURCE.test(f) && !f.includes("node_modules"));

/** 영역별 금지 규칙 — specifier가 deny에 맞으면 위반 */
const RULES = [
  { area: /^edu\//, deny: /^(@ping9\/web|apps\/)/, why: "edu는 apps/*(본체)를 import하지 않는다" },
  { area: /^packages\//, deny: /^(apps\/|edu\/|@ping9\/web|@ping9\/edu)/, why: "packages는 apps·edu를 모른다 (공용 코어)" },
  { area: /^packages\/editor\//, deny: /^@tauri-apps\//, why: "editor는 Tauri를 모른다 — 플랫폼 동작은 prop으로" },
  { area: /^packages\/(engine|shared)\//, deny: /^(react|react-dom|@tauri-apps\/|vite)(\/|$)/, why: "engine·shared는 순수 TS — UI·플랫폼 없음" },
  { area: /^apps\//, deny: /^(edu\/|@ping9\/edu)/, why: "본체는 edu를 모른다" },
  { area: /^apps\/web\//, deny: /^@ping9\/(engine|shared)/, why: "apps/web은 @ping9/editor 경유로만 도달" },
];

const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** 파일이 속한 패키지·영역 루트 — packages/editor, apps/web, edu/app은 두 단, scripts·docs는 한 단 */
function areaRoot(file) {
  const parts = file.split("/");
  if (parts.length >= 3 && (parts[0] === "packages" || parts[0] === "apps" || parts[0] === "edu")) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0];
}

const violations = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rules = RULES.filter((rule) => rule.area.test(file));
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(SPECIFIER)) {
      const spec = match[1];
      for (const rule of rules) {
        if (rule.deny.test(spec)) {
          violations.push(`${file}:${index + 1}  "${spec}" — ${rule.why}`);
        }
      }
      // 상대 경로로 자기 패키지 밖으로 나가는지 — 패키지 exports 우회를 막는다.
      // docs/의 가이드 문서를 `?raw`로 읽는 테스트 픽스처는 의도된 탈출이라 허용한다
      if (spec.startsWith(".")) {
        const resolved = posix.normalize(posix.join(dirname(file), spec));
        if (!resolved.startsWith(areaRoot(file) + "/") && !resolved.startsWith("docs/")) {
          violations.push(`${file}:${index + 1}  "${spec}" — 상대 경로가 ${areaRoot(file)} 밖으로 나간다 (패키지 이름으로 import)`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`경계 위반 ${violations.length}건:`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`경계 검사 통과: 파일 ${files.length}개`);
