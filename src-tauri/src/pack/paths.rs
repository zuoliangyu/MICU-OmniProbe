// Pack 数据目录路径管理模块

use crate::app_config;
#[cfg(target_os = "linux")]
use directories::ProjectDirs;
use std::path::PathBuf;

/// 获取 Pack 数据目录
///
/// 优先级：
/// 1. 用户自定义路径
/// 2. Linux: XDG 标准目录 ~/.local/share/micu-omniprobe/packs
///    （若存在旧目录 ~/.local/share/zuolan-daplink/packs 则继续沿用，便于平滑迁移）
/// 3. 其他平台: 可执行文件同级目录 <exe_dir>/data/packs
pub fn get_packs_dir() -> PathBuf {
    // 1. 优先使用用户自定义路径
    if let Some(custom_dir) = app_config::get_custom_packs_dir() {
        log::info!("使用自定义Pack目录: {:?}", custom_dir);
        return custom_dir;
    }

    // 2. Linux: 使用 XDG 标准目录
    #[cfg(target_os = "linux")]
    {
        // 兼容旧路径：若旧的 zuolan-daplink 目录已有数据，先继续使用以避免用户丢包
        if let Some(legacy) = ProjectDirs::from("com", "zuolan", "daplink") {
            let legacy_dir = legacy.data_dir().join("packs");
            if legacy_dir.exists() {
                return legacy_dir;
            }
        }
        if let Some(proj_dirs) = ProjectDirs::from("com", "micu", "MICU-OmniProbe") {
            return proj_dirs.data_dir().join("packs");
        }
    }

    // 3. 降级方案：使用可执行文件同级目录
    get_legacy_packs_dir().unwrap_or_else(|| PathBuf::from("./data/packs"))
}

/// 获取旧版本的 Pack 目录路径（用于数据迁移）
pub fn get_legacy_packs_dir() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let legacy_dir = exe_dir.join("data").join("packs");
            if legacy_dir.exists() {
                return Some(legacy_dir);
            }
        }
    }
    None
}
