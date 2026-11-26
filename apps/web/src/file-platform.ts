// 데스크톱(Tauri) 전용 파일·메뉴 동작 — @ping9/editor의 `download`·`onActions` prop에 꽂는다.
// editor 패키지는 Tauri를 모른다: 저장은 브라우저 다운로드가 기본이고, 여기서 저장 창 구현을 넘긴다 (E3.0).

import type { MenuActions } from "@ping9/editor";

/**
 * 파일로 받게 한다. Tauri 웹뷰에는 다운로드가 없어, 저장 창을 열어 고른 자리에 쓴다 (T17.5).
 * 브라우저(Pages)에서도 호출돼도 된다 — editor 쪽 기본 동작과 같은 결과다.
 */
export async function downloadText(fileName: string, text: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName;
    window.document.body.append(link);
    link.click();
    link.remove();
    // 받기가 시작된 뒤에 놓는다. 바로 놓으면 받지 못하는 브라우저가 있다
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const [{ save }, { writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await save({ defaultPath: fileName });
  // 저장 창에서 취소하면 null — 아무것도 쓰지 않는다
  if (path !== null) await writeTextFile(path, text);
}

/**
 * 데스크톱 파일 메뉴의 "가져오기"가 쓰는 열기 창. 고른 파일을 `File`로 돌려준다. 취소하면 null (T0.40).
 * 브라우저에는 메뉴가 없어 Tauri에서만 부른다
 */
export async function pickImportFile(): Promise<File | null> {
  const [{ open }, { readTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await open({ filters: [{ name: "PING9 토폴로지", extensions: ["json"] }] });
  if (path === null || Array.isArray(path)) return null;
  const text = await readTextFile(path);
  return new File([text], path.split("/").pop() ?? "topology.ping9.json");
}

/** Tauri 메뉴 이벤트를 editor의 액션에 연결한다. 브라우저에서는 아무것도 안 한다 (T0.40, E3.0) */
export function listenTauriMenu(actions: MenuActions): void {
  if (!("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    await listen("menu-import", () => {
      void pickImportFile().then((file) => {
        if (file !== null) return actions.importTopology(file);
      });
    });
    await listen("menu-export", () => actions.exportTopology());
    await listen("menu-about", () => actions.openAbout());
    await listen("menu-new", () => actions.newTopology());
    await listen("menu-undo", () => actions.undo());
    await listen("menu-redo", () => actions.redo());
  });
}
