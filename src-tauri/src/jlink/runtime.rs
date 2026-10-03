//! 加载用户安装的 SEGGER 运行库；不分发 DLL，也不修改 USB 驱动。
use libloading::Library;
use parking_lot::Mutex;
use std::ffi::{c_char, c_int};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
use winreg::RegKey;

// SEGGER 的常用 API 使用进程级状态。一个租约覆盖从枚举或 Open 到 Close 的整个操作，
// 避免列表刷新、不同工作台或多探针会话切换当前设备。租约可以随 probe 移动到工作线程。
static IN_USE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static API: LazyLock<Mutex<Option<Arc<Api>>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug)]
pub struct Lease;

impl Lease {
    pub fn acquire() -> Result<Self, String> {
        IN_USE
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .map(|_| Self)
            .map_err(|_| "J-Link 正由另一个工作台使用，请先断开该工作台的连接。".into())
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        IN_USE.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[repr(C)]
#[derive(Clone)]
pub struct ConnectInfo {
    pub serial: u32,
    connection: u8,
    usb_address: u32,
    ip: [u8; 16],
    time: c_int,
    time_us: u64,
    hardware_version: u32,
    mac: [u8; 6],
    pub product: [u8; 32],
    nickname: [u8; 32],
    firmware: [u8; 112],
    dhcp: u8,
    dhcp_valid: u8,
    ip_connections: u8,
    ip_connections_valid: u8,
    padding: [u8; 34],
}

impl Default for ConnectInfo {
    fn default() -> Self {
        // 此 C 结构仅包含整数及整数数组，全部清零是有效值。
        unsafe { std::mem::zeroed() }
    }
}

#[repr(C)]
#[derive(Default)]
pub struct HardwareStatus {
    pub voltage_mv: u16,
    pub tck: u8,
    pub tdi: u8,
    pub tdo: u8,
    pub tms: u8,
    pub reset: u8,
    pub trst: u8,
}

macro_rules! api {
    ($($field:ident: $signature:ty => $name:literal),+ $(,)?) => {
        pub struct Api {
            // Library 必须比函数指针活得久；成功加载后由 Arc 持有至会话关闭。
            _library: Library,
            pub path: PathBuf,
            $(pub $field: $signature,)+
        }

        impl Api {
            pub(super) fn load_at(path: &Path) -> Result<Self, String> {
                let path = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
                // 仅按绝对路径加载，从 DLL 自身目录及系统安全目录解析依赖。
                let library: Library = unsafe {
                    libloading::os::windows::Library::load_with_flags(&path, 0x00000100 | 0x00001000)
                }.map_err(|e| format!("{}: {e}", path.display()))?.into();
                unsafe {
                    $(let $field = *library.get::<$signature>(concat!($name, "\0").as_bytes())
                        .map_err(|e| format!("{} 缺少 {}: {e}", path.display(), $name))?;)+
                    Ok(Self { _library: library, path, $($field,)+ })
                }
            }
        }
    };
}

api! {
    list: unsafe extern "C" fn(u32, *mut ConnectInfo, c_int) -> c_int => "JLINKARM_EMU_GetList",
    select: unsafe extern "C" fn(u32) -> c_int => "JLINKARM_EMU_SelectByUSBSN",
    open: unsafe extern "C" fn() -> *const c_char => "JLINKARM_Open",
    close: unsafe extern "C" fn() -> () => "JLINKARM_Close",
    tif_select: unsafe extern "C" fn(c_int) -> c_int => "JLINKARM_TIF_Select",
    set_speed: unsafe extern "C" fn(u32) -> () => "JLINKARM_SetSpeed",
    configure: unsafe extern "C" fn(*const c_char) -> c_int => "JLINKARM_CORESIGHT_Configure",
    read_register: unsafe extern "C" fn(u32, u32, *mut u32) -> c_int => "JLINKARM_CORESIGHT_ReadAPDPReg",
    write_register: unsafe extern "C" fn(u32, u32, u32) -> c_int => "JLINKARM_CORESIGHT_WriteAPDPReg",
    store_swd: unsafe extern "C" fn(*const u8, *const u8, u32) -> c_int => "JLINK_SWD_StoreRaw",
    sync_swd: unsafe extern "C" fn() -> () => "JLINK_SWD_SyncBits",
    set_reset: unsafe extern "C" fn() -> () => "JLINKARM_SetRESET",
    clear_reset: unsafe extern "C" fn() -> () => "JLINKARM_ClrRESET",
    set_tck: unsafe extern "C" fn() -> c_int => "JLINKARM_SetTCK",
    clear_tck: unsafe extern "C" fn() -> c_int => "JLINKARM_ClrTCK",
    set_tms: unsafe extern "C" fn() -> c_int => "JLINKARM_SetTMS",
    clear_tms: unsafe extern "C" fn() -> c_int => "JLINKARM_ClrTMS",
    hardware_status: unsafe extern "C" fn(*mut HardwareStatus) -> c_int => "JLINKARM_GetHWStatus",
}

pub fn load() -> Result<Arc<Api>, String> {
    let mut cached = API.lock();
    if let Some(api) = cached.as_ref() {
        return Ok(Arc::clone(api));
    }
    let candidates = candidates();
    let mut errors = Vec::new();
    for candidate in candidates {
        match Api::load_at(&candidate) {
            Ok(api) => {
                log::info!("使用 SEGGER 运行库: {}", api.path.display());
                let api = Arc::new(api);
                *cached = Some(Arc::clone(&api));
                return Ok(api);
            }
            Err(error) => errors.push(error),
        }
    }
    if !errors.is_empty() {
        log::warn!("J-Link 运行库加载失败: {}", errors.join("; "));
        Err("检测到 J-Link 软件，但运行库版本或位数不兼容。请安装与本应用位数一致的新版 SEGGER J-Link 软件，然后刷新探针列表。".into())
    } else {
        Err("已识别 J-Link，但未找到 SEGGER 运行库。请安装官方 J-Link Software and Documentation Pack 后刷新，无需切换 USB 驱动。".into())
    }
}

fn candidates() -> Vec<PathBuf> {
    let mut result = Vec::new();
    // 支持便携版或自定义安装位置；普通用户无需设置。
    if let Some(path) = std::env::var_os("MICU_JLINK_LIBRARY") {
        add_directory_or_file(&mut result, PathBuf::from(path));
    }
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(hive);
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) = root.open_subkey_with_flags("SOFTWARE\\SEGGER\\J-Link", KEY_READ | view) {
                for name in ["InstallPath", "InstallDir", "Path"] {
                    if let Ok(path) = key.get_value::<String, _>(name) {
                        add_directory_or_file(&mut result, PathBuf::from(path));
                    }
                }
            }
            if let Ok(key) = root.open_subkey_with_flags(
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                KEY_READ | view,
            ) {
                for name in key.enum_keys().flatten() {
                    let Ok(item) = key.open_subkey(name) else { continue };
                    let display: String = item.get_value("DisplayName").unwrap_or_default();
                    if display.contains("J-Link") || display.contains("JLink") {
                        if let Ok(path) = item.get_value::<String, _>("InstallLocation") {
                            add_directory_or_file(&mut result, PathBuf::from(path));
                        }
                    }
                }
            }
        }
    }
    for variable in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root).join("SEGGER");
            let mut dirs: Vec<_> = std::fs::read_dir(root)
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with("JLink"))
                })
                .collect();
            dirs.sort_by(|a, b| b.cmp(a));
            for dir in dirs {
                add_directory_or_file(&mut result, dir);
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path).filter(|dir| dir.is_absolute()) {
            add_directory_or_file(&mut result, dir);
        }
    }
    result
}

fn add_directory_or_file(result: &mut Vec<PathBuf>, path: PathBuf) {
    if !path.is_absolute() {
        return;
    }
    let candidates = if path.is_dir() {
        let name = if cfg!(target_pointer_width = "64") {
            "JLink_x64.dll"
        } else {
            "JLinkARM.dll"
        };
        vec![path.join(name)]
    } else {
        vec![path]
    };
    for candidate in candidates {
        if candidate.is_file() && !result.contains(&candidate) {
            result.push(candidate);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_layout_matches_segger_abi() {
        assert_eq!(std::mem::size_of::<ConnectInfo>(), 264);
        assert_eq!(std::mem::offset_of!(ConnectInfo, time_us), 32);
        assert_eq!(std::mem::offset_of!(ConnectInfo, product), 50);
        assert_eq!(std::mem::size_of::<HardwareStatus>(), 8);
    }

    #[test]
    fn relative_and_missing_libraries_are_not_candidates() {
        let mut paths = Vec::new();
        add_directory_or_file(&mut paths, PathBuf::from("JLink_x64.dll"));
        add_directory_or_file(&mut paths, PathBuf::from("Z:/micu-nonexistent/JLink_x64.dll"));
        assert!(paths.is_empty());
    }
}
