# deploy/ — 데스크톱 산출물

`pnpm tauri build`이 만드는 설치본을 버전별로 모아 두는 곳입니다.
**산출물은 커밋하지 않습니다** — 이 README와 `.gitkeep`만 git에 있습니다.

## 사용법

```bash
# 지금 버전으로 빌드
pnpm desktop:release

# 버전을 올리고 빌드 (tauri.conf.json과 Cargo.toml을 함께 올림)
pnpm desktop:release patch     # 0.1.0 → 0.1.1
pnpm desktop:release minor     # 0.1.0 → 0.2.0
pnpm desktop:release 0.2.0     # 버전을 정함
```

## 구조

```
deploy/
└── 0.1.0/
    ├── PING9-0.1.0-macos-arm64.dmg
    ├── PING9-0.1.0-windows-x64-setup.exe   (Windows/CI 빌드에서)
    └── manifest.json                        버전·빌드 시각·파일별 sha256
```

- 버전의 원천은 `apps/web/src-tauri/tauri.conf.json`의 `version`이고,
  스크립트가 `Cargo.toml`의 `version`도 함께 맞춥니다. 둘을 손으로 다르게 고치지 마세요.
- 이 Mac(arm64)에서는 mac용 dmg만 나옵니다. Windows의 exe는
  GitHub Actions matrix 빌드(계획 T17.3)가 만들고 이 곳과 같은 규칙으로 모읍니다.
- 설치본은 아직 서명되지 않았습니다. macOS는 Gatekeeper 경고가 뜹니다 — 서명은 T17.4에서 다룹니다.
