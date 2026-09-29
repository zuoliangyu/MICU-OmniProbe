use crate::error::{AppError, AppResult};
use crate::pack::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use zip::ZipArchive;

/// 校验 Pack 名称：作为目录名时拒绝路径分隔符、相对路径、控制字符与平台保留字符。
pub fn validate_pack_name(name: &str) -> AppResult<()> {
    if name.is_empty() {
        return Err(AppError::InvalidInput("Pack 名称不能为空".into()));
    }
    if name.len() > 128 {
        return Err(AppError::InvalidInput("Pack 名称过长".into()));
    }
    if name == "." || name == ".." {
        return Err(AppError::InvalidInput("Pack 名称非法".into()));
    }
    let forbidden = ['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'];
    if name.chars().any(|c| forbidden.contains(&c) || c.is_control()) {
        return Err(AppError::InvalidInput("Pack 名称包含路径分隔符或保留字符".into()));
    }
    Ok(())
}

/// 校验 zip 条目名称并构造目标路径，防御 Zip Slip。
fn safe_zip_extract_path(base: &Path, entry_name: &str) -> AppResult<PathBuf> {
    if entry_name.contains('\0') {
        return Err(AppError::PackError("zip 条目名包含 NUL".into()));
    }
    let entry_path = Path::new(entry_name);
    if entry_path.is_absolute() {
        return Err(AppError::PackError(format!("zip 条目使用了绝对路径: {entry_name}")));
    }
    // 仅允许 Normal 组件（拒绝 ParentDir/CurDir/Prefix/RootDir）
    for component in entry_path.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(AppError::PackError(format!("zip 条目包含非法路径成分: {entry_name}")));
            }
        }
    }
    Ok(base.join(entry_path))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackInfo {
    pub name: String,
    pub vendor: String,
    pub version: String,
    pub description: String,
    pub device_count: usize,
}

pub struct PackManager {
    packs_dir: PathBuf,
}

impl PackManager {
    pub fn new() -> AppResult<Self> {
        // 使用新的路径逻辑（Linux使用XDG目录，其他平台使用可执行文件同级目录）
        let packs_dir = paths::get_packs_dir();

        log::info!("Pack 数据目录: {:?}", packs_dir);

        // 尝试创建目录
        if let Err(e) = fs::create_dir_all(&packs_dir) {
            log::error!("无法创建Pack目录 {:?}: {}", packs_dir, e);
            return Err(AppError::PackError(format!(
                "无法创建Pack目录: {}。请检查文件系统权限。",
                e
            )));
        }

        // 检查是否需要从旧位置迁移数据（仅Linux）
        #[cfg(target_os = "linux")]
        {
            if let Some(legacy_dir) = paths::get_legacy_packs_dir() {
                if legacy_dir != packs_dir {
                    log::info!("检测到旧Pack目录: {:?}", legacy_dir);
                    if let Err(e) = Self::migrate_legacy_packs(&legacy_dir, &packs_dir) {
                        log::warn!("Pack数据迁移失败: {}", e);
                    }
                }
            }
        }

        Ok(Self { packs_dir })
    }

    /// 从旧位置迁移Pack数据（仅Linux）
    #[cfg(target_os = "linux")]
    fn migrate_legacy_packs(from: &Path, to: &Path) -> AppResult<()> {
        if !from.exists() || !from.is_dir() {
            return Ok(());
        }

        log::info!("开始迁移Pack数据: {:?} -> {:?}", from, to);

        let mut migrated_count = 0;

        for entry in fs::read_dir(from)? {
            let entry = entry?;
            let src = entry.path();

            if src.is_dir() {
                let pack_name = src.file_name().unwrap();
                let dst = to.join(pack_name);

                if !dst.exists() {
                    log::info!("迁移Pack: {:?}", pack_name);
                    if let Err(e) = Self::copy_dir_recursive(&src, &dst) {
                        log::warn!("迁移Pack {:?} 失败: {}", pack_name, e);
                    } else {
                        migrated_count += 1;
                    }
                }
            }
        }

        if migrated_count > 0 {
            log::info!("Pack数据迁移完成，共迁移 {} 个Pack", migrated_count);
        }

        Ok(())
    }

    /// 递归复制目录
    #[cfg(target_os = "linux")]
    fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
        fs::create_dir_all(dst)?;

        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if src_path.is_dir() {
                Self::copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                fs::copy(&src_path, &dst_path)?;
            }
        }

        Ok(())
    }

    pub fn import_pack(&self, pack_path: &Path) -> AppResult<PackInfo> {
        log::info!("🔄 开始导入 Pack: {:?}", pack_path);

        let file = fs::File::open(pack_path)?;
        let mut archive = ZipArchive::new(file).map_err(|e| AppError::PackError(format!("无法打开Pack文件: {}", e)))?;

        // 查找.pdsc文件
        let mut pdsc_content = String::new();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| AppError::PackError(e.to_string()))?;

            if file.name().ends_with(".pdsc") {
                log::info!("📄 找到 PDSC 文件: {}", file.name());
                std::io::Read::read_to_string(&mut file, &mut pdsc_content)?;
                break;
            }
        }

        if pdsc_content.is_empty() {
            return Err(AppError::PackError("Pack文件中未找到.pdsc文件".to_string()));
        }

        // 解析.pdsc获取基本信息
        log::info!("🔍 开始解析 PDSC 文件...");
        let pack_info = super::parser::parse_pdsc(&pdsc_content)?;

        // PDSC 中的 name 来自不可信的 .pack 文件，必须按目录名规则校验
        validate_pack_name(&pack_info.name)?;

        // 创建Pack目录
        let pack_dir = self.packs_dir.join(&pack_info.name);
        log::info!("📁 创建 Pack 目录: {:?}", pack_dir);
        fs::create_dir_all(&pack_dir)?;

        // 解压Pack
        log::info!("📦 开始解压 Pack 文件...");
        let file = fs::File::open(pack_path)?;
        let mut archive = ZipArchive::new(file).map_err(|e| AppError::PackError(format!("无法打开Pack文件: {}", e)))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| AppError::PackError(e.to_string()))?;

            // Zip Slip 防御：拒绝绝对路径、`..`、符号链接
            const SYMLINK_MODE: u32 = 0o120000;
            if let Some(mode) = file.unix_mode() {
                if mode & 0o170000 == SYMLINK_MODE {
                    log::warn!("跳过 zip 中的符号链接条目: {}", file.name());
                    continue;
                }
            }
            let outpath = safe_zip_extract_path(&pack_dir, file.name())?;

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p)?;
                    }
                }
                let mut outfile = fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
            }
        }

        log::info!("✅ Pack 导入成功!");
        Ok(pack_info)
    }

    pub fn list_packs(&self) -> AppResult<Vec<PackInfo>> {
        log::info!("📋 开始列出已导入的 Pack...");
        let mut packs = Vec::new();

        if !self.packs_dir.exists() {
            log::warn!("⚠️  Pack 目录不存在: {:?}", self.packs_dir);
            return Ok(packs);
        }

        for entry in fs::read_dir(&self.packs_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                log::debug!("🔍 扫描目录: {:?}", path);
                // 查找.pdsc文件
                for pdsc_entry in fs::read_dir(&path)? {
                    let pdsc_entry = pdsc_entry?;
                    let pdsc_path = pdsc_entry.path();

                    if pdsc_path.extension().is_some_and(|ext| ext == "pdsc") {
                        log::info!("📄 找到 PDSC 文件: {:?}", pdsc_path);
                        let content = fs::read_to_string(&pdsc_path)?;
                        if let Ok(info) = super::parser::parse_pdsc(&content) {
                            packs.push(info);
                        }
                        break;
                    }
                }
            }
        }

        log::info!("✅ 共找到 {} 个 Pack", packs.len());
        Ok(packs)
    }

    /// 仅在校验通过后才返回 pack 目录路径，避免 IPC 入参直接拼路径。
    pub fn get_pack_dir(&self, pack_name: &str) -> AppResult<PathBuf> {
        validate_pack_name(pack_name)?;
        Ok(self.packs_dir.join(pack_name))
    }

    pub fn delete_pack(&self, pack_name: &str) -> AppResult<()> {
        log::info!("=== 开始删除Pack ===");
        log::info!("Pack名称: {}", pack_name);

        let pack_dir = self.get_pack_dir(pack_name)?;
        log::info!("Pack目录路径: {:?}", pack_dir);

        if !pack_dir.exists() {
            log::error!("Pack目录不存在: {:?}", pack_dir);
            return Err(AppError::PackError(format!("Pack不存在: {}", pack_name)));
        }

        log::info!("Pack目录存在，准备删除");

        // 检查目录权限
        match fs::metadata(&pack_dir) {
            Ok(metadata) => {
                log::info!("目录权限: {:?}", metadata.permissions());
                log::info!("是否为目录: {}", metadata.is_dir());
            }
            Err(e) => {
                log::error!("无法读取目录元数据: {}", e);
            }
        }

        match fs::remove_dir_all(&pack_dir) {
            Ok(_) => {
                log::info!("✓ 成功删除Pack目录");
                Ok(())
            }
            Err(e) => {
                log::error!("删除Pack目录失败: {}", e);
                log::error!("错误类型: {:?}", e.kind());
                Err(AppError::PackError(format!("删除Pack失败: {}", e)))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_name_rejects_path_tricks() {
        assert!(validate_pack_name("Keil.STM32F4xx_DFP.2.17.1").is_ok());
        for bad in ["", ".", "..", "a/b", r"a\b", "C:pack", "a\0b", "a\nb", &"x".repeat(129)] {
            assert!(validate_pack_name(bad).is_err(), "应拒绝 {bad:?}");
        }
    }

    #[test]
    fn zip_entries_stay_inside_base() {
        let base = std::env::temp_dir().join("pack-base");
        assert_eq!(
            safe_zip_extract_path(&base, "Flash/STM32F4xx.FLM").unwrap(),
            base.join("Flash/STM32F4xx.FLM")
        );
        for bad in ["../evil.txt", "Flash/../../evil.txt", "./a", "/etc/passwd", "a\0b"] {
            assert!(safe_zip_extract_path(&base, bad).is_err(), "应拒绝 {bad:?}");
        }
    }
}
