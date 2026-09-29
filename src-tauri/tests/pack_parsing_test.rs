// Pack 解析测试
// 用于验证 XML 解析 bug 修复

#[cfg(test)]
mod tests {
    use micu_omniprobe_lib::pack::progress;
    use micu_omniprobe_lib::pack::target_gen;
    use std::sync::{Arc, Mutex};

    #[test]
    fn test_multiple_subfamily_parsing() {
        // 模拟包含多个 subFamily 的 PDSC 内容
        let pdsc_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<package>
  <devices>
    <family Dfamily="TestFamily">
      <subFamily DsubFamily="SubFamily1">
        <device Dname="Device1A">
          <processor Dcore="Cortex-M4" Dfpu="1" Dmpu="0"/>
          <memory id="IROM1" start="0x08000000" size="0x100000"/>
          <memory id="IRAM1" start="0x20000000" size="0x20000"/>
        </device>
        <device Dname="Device1B">
          <processor Dcore="Cortex-M4" Dfpu="1" Dmpu="0"/>
          <memory id="IROM1" start="0x08000000" size="0x200000"/>
          <memory id="IRAM1" start="0x20000000" size="0x40000"/>
        </device>
      </subFamily>
      <subFamily DsubFamily="SubFamily2">
        <device Dname="Device2A">
          <processor Dcore="Cortex-M4" Dfpu="1" Dmpu="0"/>
          <memory id="IROM1" start="0x08000000" size="0x100000"/>
          <memory id="IRAM1" start="0x20000000" size="0x20000"/>
        </device>
        <device Dname="Device2B">
          <processor Dcore="Cortex-M4" Dfpu="1" Dmpu="0"/>
          <memory id="IROM1" start="0x08000000" size="0x200000"/>
          <memory id="IRAM1" start="0x20000000" size="0x40000"/>
        </device>
      </subFamily>
      <subFamily DsubFamily="SubFamily3">
        <device Dname="Device3A">
          <processor Dcore="Cortex-M4" Dfpu="1" Dmpu="0"/>
          <memory id="IROM1" start="0x08000000" size="0x100000"/>
          <memory id="IRAM1" start="0x20000000" size="0x20000"/>
        </device>
      </subFamily>
    </family>
  </devices>
</package>"#;

        // 解析设备
        let devices = target_gen::parse_devices_from_pdsc(pdsc_content, None).expect("解析失败");

        // 验证：应该解析出 5 个设备（修复前只能解析出 2 个）
        assert_eq!(devices.len(), 5, "应该解析出 5 个设备，实际解析出 {} 个", devices.len());

        // 验证设备名称
        let device_names: Vec<String> = devices.iter().map(|d| d.name.clone()).collect();
        assert!(device_names.contains(&"Device1A".to_string()));
        assert!(device_names.contains(&"Device1B".to_string()));
        assert!(device_names.contains(&"Device2A".to_string()));
        assert!(device_names.contains(&"Device2B".to_string()));
        assert!(device_names.contains(&"Device3A".to_string()));

        println!("✅ 测试通过：成功解析所有 subFamily 中的设备");
        println!("   解析出的设备: {:?}", device_names);
    }

    #[test]
    fn test_progress_callback() {
        let pdsc_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<package>
  <devices>
    <family Dfamily="TestFamily">
      <device Dname="TestDevice">
        <processor Dcore="Cortex-M4" Dfpu="1" Dmpu="0"/>
        <memory id="IROM1" start="0x08000000" size="0x100000"/>
        <memory id="IRAM1" start="0x20000000" size="0x20000"/>
      </device>
    </family>
  </devices>
</package>"#;

        // 创建进度跟踪
        let progress_log = Arc::new(Mutex::new(Vec::new()));
        let progress_log_clone = progress_log.clone();

        let callback: progress::ProgressCallback = Box::new(move |prog: progress::PackScanProgress| {
            progress_log_clone
                .lock()
                .unwrap()
                .push(format!("{:?}: {}", prog.phase, prog.message));
        });

        // 解析设备
        let devices = target_gen::parse_devices_from_pdsc(pdsc_content, Some(&callback)).expect("解析失败");

        assert_eq!(devices.len(), 1);

        // 验证进度回调被调用
        let log = progress_log.lock().unwrap();
        assert!(!log.is_empty(), "进度回调应该被调用");

        println!("✅ 测试通过：进度回调正常工作");
        println!("   进度日志:");
        for entry in log.iter() {
            println!("     {}", entry);
        }
    }
}
