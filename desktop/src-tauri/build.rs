fn main() {
    // 画面（サイト）の側から呼べる命令を宣言する（capabilities/main.json で許可する）
    let manifest = tauri_build::AppManifest::new().commands(&["show_window"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("ビルドの準備に失敗しました");
}
