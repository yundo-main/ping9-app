#!/usr/bin/env node
// PING9 데스크톱 산출물 빌드·수집 스크립트 (T17.2).
// `apps/web`의 Tauri 껍데기를 빌드하고 결과물을 deploy/<버전>/ 아래에 모은다.
//
// 사용법:
//   node scripts/desktop-release.mjs            지금 버전으로 빌드
//   node scripts/desktop-release.mjs patch      패치 버전을 올리고 빌드
//   node scripts/desktop-release.mjs minor      마이너 버전을 올리고 빌드
//   node scripts/desktop-release.mjs major      메이저 버전을 올리고 빌드
//   node scripts/desktop-release.mjs 0.2.0      버전을 정해 빌드

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";

const WEB = "apps/web";
const CONF_PATH = join(WEB, "src-tauri/tauri.conf.json");
const CARGO_PATH = join(WEB, "src-tauri/Cargo.toml");
const BUNDLE_DIR = join(WEB, "src-tauri/target/release/bundle");

// OS별 산출물을 찾는 규칙과 바꿀 이름. Tauri가 만드는 이름(PING9_버전_아치)은 OS마다 달라 일관된 이름으로 바꾼다
const ARTIFACTS = [
  { dir: "dmg", ext: ".dmg", name: (v) => `PING9-${v}-macos-arm64.dmg` },
  { dir: "nsis", ext: ".exe", name: (v) => `PING9-${v}-windows-x64-setup.exe` },
  { dir: "msi", ext: ".msi", name: (v) => `PING9-${v}-windows-x64.msi` },
];

const conf = JSON.parse(readFileSync(CONF_PATH, "utf8"));

const arg = process.argv[2];
let version = conf.version;
if (arg !== undefined) {
  const [maj, min, pat] = version.split(".").map(Number);
  const next = { patch: [maj, min, pat + 1], minor: [maj, min + 1, 0], major: [maj + 1, 0, 0] }[arg]
    ?? (/^\d+\.\d+\.\d+$/.test(arg) ? arg.split(".").map(Number) : null);
  if (next === null) {
    console.error(`알 수 없는 인수: ${arg}. patch|minor|major|x.y.z 중 하나를 주세요.`);
    process.exit(1);
  }
  version = next.join(".");
  conf.version = version;
  writeFileSync(CONF_PATH, `${JSON.stringify(conf, null, 2)}\n`);
  // Cargo.toml도 같은 버전으로 맞춘다 — 두 곳이 어긋나면 앱의 정보가 갈라진다
  writeFileSync(CARGO_PATH, readFileSync(CARGO_PATH, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));
  console.log(`버전 ${version}으로 올림 (tauri.conf.json, Cargo.toml)`);
}

console.log(`PING9 ${version} 데스크톱 빌드 시작 (${platform()}/${arch()})`);
execSync("pnpm --filter @ping9/web tauri build", { stdio: "inherit" });

// 산출물을 deploy/<버전>/으로 옮긴다
const outDir = join("deploy", version);
mkdirSync(outDir, { recursive: true });
const collected = [];
for (const artifact of ARTIFACTS) {
  const dir = join(BUNDLE_DIR, artifact.dir);
  let names;
  try { names = readdirSync(dir); } catch { continue; }
  for (const name of names.filter((n) => n.endsWith(artifact.ext))) {
    const from = join(dir, name);
    const to = join(outDir, artifact.name(version));
    copyFileSync(from, to);
    collected.push({ file: artifact.name(version), from, to });
  }
}
if (collected.length === 0) {
  console.error(`수집한 산출물이 없습니다. ${BUNDLE_DIR} 아래를 확인하세요.`);
  process.exit(1);
}

// 검증용 목록: 이름, 크기, sha256
const manifest = {
  version,
  builtAt: new Date().toISOString(),
  platform: `${platform()}/${arch()}`,
  files: collected.map(({ file, to }) => ({
    file,
    bytes: statSync(to).size,
    sha256: createHash("sha256").update(readFileSync(to)).digest("hex"),
  })),
};
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\n${outDir}/`);
for (const { file, to } of collected) console.log(`  ${file}  (${(statSync(to).size / 1024 / 1024).toFixed(1)} MB)`);
console.log("  manifest.json  (버전·sha256 기록)");
