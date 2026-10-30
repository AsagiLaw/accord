// Accord のデスクトップ版（Tauri）。公開中のサイトを窓の中に開く。
// 画面の中身はサイトそのものなので、サイトを更新すればアプリも新しくなる。ここを変えたときだけ配布物を作り直す
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;
use webview2_com::Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION, COREWEBVIEW2_PERMISSION_STATE_ALLOW};
use webview2_com::PermissionRequestedEventHandler;
use windows_core::PWSTR;

const APP_URL: &str = "https://accord-hazel-eta.vercel.app";

/// 開くサイト。手元で試すときだけ、ACCORD_URL で変えられる
fn app_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(url) = std::env::var("ACCORD_URL") {
            return url;
        }
    }
    APP_URL.to_string()
}

/// 窓を隠したことをページにも伝える。伝えないと visibilityState が visible のままになり、開いているチャットの新着を既読にしてしまう
fn set_page_visible(win: &WebviewWindow, visible: bool) {
    let _ = win.with_webview(move |webview| unsafe {
        let _ = webview.controller().SetIsVisible(visible);
    });
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        set_page_visible(&win, true);
        let _ = win.set_focus();
    }
}

/// 隠れている窓を前に出す（通知を押したとき。画面の側から呼ぶ）
#[tauri::command]
fn show_window(app: AppHandle) {
    show_main(&app);
}

/// http・https のリンクだけを、いつものブラウザで開く
fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// 通知の許可を、Accord のサイトにだけ出す（WebView2 は何もしないと断る）
fn allow_notifications(win: &WebviewWindow, origin: String) -> tauri::Result<()> {
    win.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
            args.PermissionKind(&mut kind)?;
            let mut uri = PWSTR::null();
            args.Uri(&mut uri as *mut PWSTR)?;
            let requested = Url::parse(&uri.to_string().unwrap_or_default()).map(|u| u.origin().ascii_serialization());
            if kind == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS && requested.as_ref() == Ok(&origin) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = 0;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    })
}

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let url = app_url();
    let origin = Url::parse(&url).expect("正しい URL").origin();
    let notify_origin = origin.ascii_serialization();
    // 画面の側に渡すものは、ここに書いたものだけ
    let script = format!(
        r#"window.__ACCORD_URL__ = {url:?};
if (location.origin === new URL(window.__ACCORD_URL__).origin) {{
  window.accordDesktop = {{ platform: "win32", show: () => window.__TAURI_INTERNALS__.invoke("show_window") }};
}}"#
    );
    let shown = AtomicBool::new(false);

    let nav_app = app.clone();
    let popup_app = app.clone();
    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Accord")
        .inner_size(1280.0, 800.0)
        .min_inner_size(480.0, 400.0)
        // 最初の画面ができてから出す（白い窓が一瞬見えないように）
        .visible(false)
        .initialization_script(&script)
        // アプリの中の画像などのドラッグを、ページの側で受け取るため
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(true)
        // アプリの外へ移るリンクは、いつものブラウザで
        .on_navigation(move |to| {
            let ours = to.origin() == origin || to.host_str() == Some("tauri.localhost");
            if ours || !matches!(to.scheme(), "http" | "https") {
                return true;
            }
            open_outside(&nav_app, to);
            false
        })
        // 別の窓を開くリンクも、いつものブラウザで
        .on_new_window(move |to, _features| {
            open_outside(&popup_app, &to);
            NewWindowResponse::Deny
        })
        .on_page_load(move |win, payload| {
            if payload.event() == PageLoadEvent::Finished && !shown.swap(true, Ordering::Relaxed) {
                let _ = win.show();
            }
        })
        .build()?;
    allow_notifications(&win, notify_origin)
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "Accord を開く").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "終了").build(app)?;
    let menu = MenuBuilder::new(app).item(&open).separator().item(&quit).build()?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Accord")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // 2つ目を開こうとしたら、開いている窓を前に出す（いちばん先に登録する）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        // 窓の大きさと位置を覚える（見える・隠れているは覚えない）
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() & !StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![show_window])
        // Discord と同じく、閉じるボタンでは終わらず、通知を受け取れるように隠すだけ（終わるのはトレイのメニュー）
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
                if let Some(main) = win.app_handle().get_webview_window("main") {
                    set_page_visible(&main, false);
                }
            }
            // 最小化したとき・戻したとき
            if let WindowEvent::Resized(_) = event {
                if let Some(main) = win.app_handle().get_webview_window("main") {
                    let visible = win.is_visible().unwrap_or(true) && !win.is_minimized().unwrap_or(false);
                    set_page_visible(&main, visible);
                }
            }
        })
        .setup(|app| {
            // 手元で試すときは、試し先のサイトからも命令を呼べるようにする
            #[cfg(debug_assertions)]
            app.add_capability(format!(r#"{{"identifier":"debug","windows":["main"],"remote":{{"urls":["{}/*"]}},"permissions":["allow-show-window"]}}"#, app_url()))?;
            create_tray(app.handle())?;
            create_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Accord を起動できませんでした");
}
