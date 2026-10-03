pub mod ai_bridge;
pub mod app_config;
pub mod ble;
pub mod commands;
pub mod debug_symbols;
pub mod error;
#[cfg(windows)]
mod jlink;
pub mod legacy_migration;
pub mod pack;
pub mod serial;
pub mod state;
pub mod text_encoding;
pub mod udev;

use commands::{ble as ble_cmd, config, debug as debug_cmd, export, flash, probe, rtt, serial as serial_cmd};
use futures::StreamExt;
use state::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    // 探针枚举也依赖 Espressif 插件，须在任何连接命令执行前完成注册。
    std::sync::LazyLock::force(&config::TARGET_REGISTRY);

    let context = tauri::generate_context!();
    legacy_migration::migrate_legacy_data(&context.config().identifier);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            app.manage(AppState::new());

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match nusb::watch_devices() {
                    Ok(mut events) => {
                        while events.next().await.is_some() {
                            let _ = app_handle.emit("usb-device-changed", ());
                        }
                    }
                    Err(error) => log::warn!("USB 热插拔监听启动失败: {error}"),
                }
            });

            // Linux 系统启动时检查 udev 规则
            #[cfg(target_os = "linux")]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    check_udev_on_startup(app_handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 探针命令
            probe::list_probes,
            probe::connect_target,
            probe::disconnect,
            probe::get_connection_status,
            probe::check_usb_permissions,
            probe::install_udev_rules,
            probe::get_udev_install_instructions,
            // RTT 独立连接命令
            probe::connect_rtt,
            probe::disconnect_rtt,
            probe::get_rtt_connection_status,
            // Flash命令
            flash::flash_firmware,
            flash::erase_chip,
            flash::erase_sector,
            flash::verify_firmware,
            flash::read_flash,
            flash::get_firmware_info,
            // RTT命令
            rtt::start_rtt,
            rtt::stop_rtt,
            rtt::clear_rtt_buffer,
            // 配置命令
            config::search_chips,
            config::get_chip_info,
            config::init_packs,
            config::import_pack,
            config::list_imported_packs,
            config::delete_pack,
            config::get_pack_scan_report,
            // Pack目录管理命令
            config::get_packs_directory,
            config::set_custom_packs_directory,
            // 导出命令
            export::write_text_file,
            export::read_text_file,
            export::write_binary_file,
            export::allow_image_asset,
            // 串口命令
            serial_cmd::list_serial_ports_cmd,
            serial_cmd::connect_serial,
            serial_cmd::disconnect_serial,
            serial_cmd::write_serial,
            serial_cmd::write_serial_string,
            serial_cmd::send_serial_file,
            serial_cmd::cancel_serial_file_transfer,
            serial_cmd::start_serial,
            serial_cmd::stop_serial,
            serial_cmd::clear_serial_buffer,
            // AI 数据桥接命令
            ai_bridge::start_ai_bridge,
            ai_bridge::stop_ai_bridge,
            ai_bridge::get_ai_bridge_status,
            ai_bridge::set_ai_bridge_write_enabled,
            ai_bridge::publish_ai_samples,
            ai_bridge::publish_ai_text_lines,
            // 调试命令
            debug_cmd::debug_attach,
            debug_cmd::debug_detach,
            debug_cmd::debug_get_status,
            debug_cmd::debug_run,
            debug_cmd::debug_halt,
            debug_cmd::debug_step_in,
            debug_cmd::debug_step_over,
            debug_cmd::debug_step_out,
            debug_cmd::debug_reset,
            debug_cmd::debug_read_memory,
            debug_cmd::debug_read_registers,
            debug_cmd::debug_load_elf,
            debug_cmd::debug_clear_symbols,
            debug_cmd::debug_get_call_stack,
            debug_cmd::debug_set_breakpoint,
            debug_cmd::debug_set_source_breakpoint,
            debug_cmd::debug_clear_breakpoint,
            debug_cmd::debug_list_breakpoints,
            debug_cmd::debug_clear_all_breakpoints,
            debug_cmd::debug_read_source,
            // BLE 蓝牙命令
            ble_cmd::ble_start_scan,
            ble_cmd::ble_stop_scan,
            ble_cmd::ble_connect,
            ble_cmd::ble_disconnect,
            ble_cmd::ble_list_services,
            ble_cmd::ble_detect_nus,
            ble_cmd::ble_subscribe,
            ble_cmd::ble_unsubscribe,
            ble_cmd::ble_write,
            ble_cmd::ble_write_string,
        ])
        .run(context)
        .expect("启动应用程序时出错");
}

/// Linux 启动时检查 udev 规则
#[cfg(target_os = "linux")]
async fn check_udev_on_startup(app: tauri::AppHandle) {
    log::info!("检查 udev 规则...");

    // 延迟 2 秒，等待窗口完全加载
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // 检查 udev 规则是否已安装
    if !udev::check_udev_rules_installed() {
        log::warn!("未检测到 udev 规则，发送通知到前端");

        // 发送事件到前端
        let _ = app.emit("udev-rules-missing", ());
    } else {
        log::info!("udev 规则已安装");
    }
}
