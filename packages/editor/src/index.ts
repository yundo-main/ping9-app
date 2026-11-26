// PING9 본체(apps/web)와 PING9 Edu(edu/app)가 같이 쓰는 시뮬레이터 화면 패키지 (E3.0).
// editor는 Tauri를 모른다: 파일 저장·메뉴 같은 플랫폼 동작은 EditorApp의 prop으로 받는다.

export { EditorApp } from "./app";
export type { EditorAppProps, MenuActions } from "./app";
export { TOPOLOGY_NAME, simulator, useSnapshot } from "./simulator";
