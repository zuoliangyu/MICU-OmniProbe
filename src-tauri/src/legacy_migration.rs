// 更名迁移：EK-OmniProbe（org.embeddedkit.omniprobe）→ MICU-OmniProbe
//
// Tauri 按应用 ID 决定数据目录（WebView 的 localStorage、窗口状态等都在其中），
// 更换 ID 后需要把旧目录整体搬到新 ID 下。必须在 tauri::Builder 创建窗口之前执行，
// 否则 WebView 会先在新目录初始化出空数据，迁移就会被跳过。

#[cfg(target_os = "linux")]
use directories::ProjectDirs;
use directories::BaseDirs;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const LEGACY_IDENTIFIER: &str = "org.embeddedkit.omniprobe";

/// 把旧应用 ID 下的数据目录迁移到新 ID；新目录已存在时视为已迁移，不做任何覆盖
pub fn migrate_legacy_data(identifier: &str) {
    for (from, to) in legacy_dir_pairs(identifier) {
        if let Err(error) = migrate_dir(&from, &to) {
            log::warn!("迁移旧数据目录失败 {:?} -> {:?}: {error}", from, to);
        }
    }
}

fn legacy_dir_pairs(identifier: &str) -> Vec<(PathBuf, PathBuf)> {
    let Some(base) = BaseDirs::new() else {
        return Vec::new();
    };

    // 与 Tauri 路径解析一致：config / data / local data / cache 目录均以应用 ID 命名
    let mut roots: Vec<PathBuf> = vec![
        base.config_dir().to_path_buf(),
        base.data_dir().to_path_buf(),
        base.data_local_dir().to_path_buf(),
        base.cache_dir().to_path_buf(),
    ];
    // macOS 的 WKWebView 数据（localStorage 等）按 Bundle ID 存放在 ~/Library/WebKit 下
    #[cfg(target_os = "macos")]
    {
        roots.push(base.home_dir().join("Library/WebKit"));
        roots.push(base.home_dir().join("Library/Logs"));
    }
    roots.sort();
    roots.dedup();

    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut pairs: Vec<(PathBuf, PathBuf)> = roots
        .iter()
        .map(|root| (root.join(LEGACY_IDENTIFIER), root.join(identifier)))
        .collect();

    // Linux 的 Pack 目录使用 XDG 项目目录（~/.local/share/ek-omniprobe）
    #[cfg(target_os = "linux")]
    if let (Some(legacy), Some(current)) = (
        ProjectDirs::from("org", "EmbeddedKit", "EK-OmniProbe"),
        ProjectDirs::from("com", "micu", "MICU-OmniProbe"),
    ) {
        pairs.push((legacy.data_dir().to_path_buf(), current.data_dir().to_path_buf()));
    }
    pairs
}

fn migrate_dir(from: &Path, to: &Path) -> io::Result<()> {
    if !from.is_dir() || to.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }

    // 同一卷内直接重命名，原子且不复制数据；失败时（跨卷、文件被占用等）改为复制
    if fs::rename(from, to).is_ok() {
        log::info!("已迁移旧数据目录 {:?} -> {:?}", from, to);
        return Ok(());
    }

    // 先复制到临时目录再重命名，避免中途失败留下不完整的新目录；旧目录保持原样
    let staging = to.with_file_name(format!(
        "{}.migrating",
        to.file_name().and_then(|name| name.to_str()).unwrap_or("data")
    ));
    let _ = fs::remove_dir_all(&staging);
    let result = copy_dir(from, &staging).and_then(|_| fs::rename(&staging, to));
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    } else {
        log::info!("已复制旧数据目录 {:?} -> {:?}", from, to);
    }
    result
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("omniprobe-migration-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn moves_legacy_dir_when_target_missing() {
        let root = temp_root("move");
        let from = root.join(LEGACY_IDENTIFIER);
        fs::create_dir_all(from.join("EBWebView/Default")).unwrap();
        fs::write(from.join("EBWebView/Default/state"), b"kept").unwrap();
        let to = root.join("com.micu.omniprobe");

        migrate_dir(&from, &to).unwrap();

        assert_eq!(fs::read(to.join("EBWebView/Default/state")).unwrap(), b"kept");
        assert!(!from.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keeps_existing_target_untouched() {
        let root = temp_root("skip");
        let from = root.join(LEGACY_IDENTIFIER);
        let to = root.join("com.micu.omniprobe");
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("state"), b"old").unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(to.join("state"), b"new").unwrap();

        migrate_dir(&from, &to).unwrap();

        assert_eq!(fs::read(to.join("state")).unwrap(), b"new");
        assert_eq!(fs::read(from.join("state")).unwrap(), b"old");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_dir_preserves_nested_files() {
        let root = temp_root("copy");
        let from = root.join("from");
        fs::create_dir_all(from.join("a/b")).unwrap();
        fs::write(from.join("a/b/c.txt"), b"deep").unwrap();
        let to = root.join("to");

        copy_dir(&from, &to).unwrap();

        assert_eq!(fs::read(to.join("a/b/c.txt")).unwrap(), b"deep");
        fs::remove_dir_all(root).unwrap();
    }
}
