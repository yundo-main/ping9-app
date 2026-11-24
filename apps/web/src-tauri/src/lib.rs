use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      // 파일 메뉴 — 화면의 가져오기/내보내기와 같은 동작을 메뉴 이벤트로 웹뷰에 보낸다 (T0.40)
      let menu = Menu::default(app.handle())?;
      let new = MenuItemBuilder::with_id("menu-new", "새 토폴로지")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
      let import = MenuItemBuilder::with_id("menu-import", "가져오기…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
      let export = MenuItemBuilder::with_id("menu-export", "내보내기…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
      let mut file = None;
      for kind in menu.items()? {
        if let MenuItemKind::Submenu(sub) = kind {
          if sub.text()? == "File" {
            file = Some(sub);
            break;
          }
        }
      }
      // 기본 "About PING9"는 네이티브 창이라 개발자 정보가 안 나온다.
      // 정보 창을 여는 이벤트를 보내는 커스텀 항목으로 바꾼다 (T0.43)
      let about = MenuItemBuilder::with_id("menu-about", "PING9에 관하여").build(app)?;
      // Help 메뉴에도 같은 창을 여는 항목을 넣는다. 항목은 한 메뉴에만 속할 수 있어 id가 다른 복사본을 만든다
      let about_help = MenuItemBuilder::with_id("menu-about-help", "PING9에 관하여").build(app)?;
      for kind in menu.items()? {
        if let MenuItemKind::Submenu(sub) = kind {
          for item in sub.items()? {
            let is_about = matches!(&item, MenuItemKind::Predefined(pre) if pre.text()?.starts_with("About"));
            if is_about {
              sub.remove(&item)?;
              sub.insert(&about, 0)?;
            }
          }
          if sub.text()? == "Help" {
            if !sub.items()?.is_empty() {
              sub.append(&PredefinedMenuItem::separator(app)?)?;
            }
            sub.append(&about_help)?;
          }
        }
      }
      match file {
        Some(sub) => {
          sub.append(&PredefinedMenuItem::separator(app)?)?;
          sub.append(&new)?;
          sub.append(&import)?;
          sub.append(&export)?;
        }
        None => {
          let sub = SubmenuBuilder::new(app, "파일")
            .item(&new)
            .item(&import)
            .item(&export)
            .build()?;
          menu.insert(&sub, 1)?;
        }
      }
      app.set_menu(menu)?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_menu_event(|app, event| {
      match event.id().as_ref() {
        "menu-new" | "menu-import" | "menu-export" | "menu-about" => {
          let _ = app.emit(event.id().as_ref(), ());
        }
        // Help 메뉴의 복사본은 앱 메뉴 항목과 같은 이벤트로 변환한다
        "menu-about-help" => {
          let _ = app.emit("menu-about", ());
        }
        _ => {}
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
