mod probe;
mod runtime;

use crate::commands::probe::ProbeInfo;
use runtime::{ConnectInfo, Lease};

pub use probe::open;

pub fn serial_from_id(id: &str) -> Option<u32> {
    id.strip_prefix("jlink:")?
        .parse::<u32>()
        .ok()
        .filter(|serial| *serial != 0)
}

fn usb_serial(serial: Option<&str>) -> Option<u32> {
    serial?.trim().parse::<u32>().ok().filter(|serial| *serial != 0)
}

fn is_jlink(vid: u16, pid: u16) -> bool {
    vid == 0x1366
        && ([0x0101, 0x0102, 0x0103, 0x0104, 0x0105, 0x0107, 0x0108].contains(&pid)
            || (pid & 0x1000 != 0 && pid & 0x30 != 0))
}

fn add_device(probes: &mut Vec<ProbeInfo>, serial: u32, name: &str, pid: u16, hint: Option<String>) {
    // USB 和官方 DLL 可能同时发现同一探针，序列号是跨驱动的稳定身份。
    probes.retain(|probe| {
        !(is_jlink(probe.vendor_id, probe.product_id) && usb_serial(probe.serial_number.as_deref()) == Some(serial))
            && probe.probe_id != format!("jlink:{serial}")
    });
    probes.push(ProbeInfo {
        probe_id: format!("jlink:{serial}"),
        identifier: format!("{} ({serial})", if name.is_empty() { "J-Link" } else { name }),
        vendor_id: 0x1366,
        product_id: pid,
        serial_number: Some(serial.to_string()),
        probe_type: "JLink".into(),
        dap_version: None,
        debug_info: None,
        connection_hint: hint,
    });
}

pub fn augment(probes: &mut Vec<ProbeInfo>) {
    let runtime = runtime::load();
    // USB 枚举不需要打开设备，官方 DLL 缺失时仍显示用户插入的 J-Link。
    if let Ok(devices) = nusb::list_devices() {
        for device in devices.filter(|d| is_jlink(d.vendor_id(), d.product_id())) {
            let Some(serial) = usb_serial(device.serial_number()) else {
                continue;
            };
            let winusb = device
                .driver()
                .is_some_and(|driver| driver.eq_ignore_ascii_case("winusb"));
            let hint = if winusb { None } else { runtime.as_ref().err().cloned() };
            add_device(
                probes,
                serial,
                device.product_string().unwrap_or("J-Link"),
                device.product_id(),
                hint,
            );
        }
    }
    let Ok(api) = runtime else { return };
    // 已连接时不能调用会改变全局 DLL 状态的枚举 API；USB 列表仍可正常刷新。
    let Ok(_lease) = Lease::acquire() else { return };
    let count = unsafe { (api.list)(1, std::ptr::null_mut(), 0) };
    if !(1..=256).contains(&count) {
        return;
    }
    let mut devices = vec![ConnectInfo::default(); count as usize];
    let found = unsafe { (api.list)(1, devices.as_mut_ptr(), count) };
    if found < 0 {
        log::warn!("J-Link 官方运行库枚举失败: {found}");
        return;
    }
    for device in devices.iter().take(found as usize) {
        if device.serial == 0 {
            continue;
        }
        let end = device
            .product
            .iter()
            .position(|b| *b == 0)
            .unwrap_or(device.product.len());
        let name = String::from_utf8_lossy(&device.product[..end]);
        let pid = probes
            .iter()
            .find(|p| p.probe_id == format!("jlink:{}", device.serial))
            .map(|p| p.product_id)
            .unwrap_or(0);
        add_device(probes, device.serial, &name, pid, None);
    }
}

pub fn runtime_available() -> bool {
    runtime::load().is_ok()
}

pub fn missing_runtime_message() -> String {
    runtime::load()
        .err()
        .unwrap_or_else(|| "J-Link 无法连接，请检查官方驱动和设备占用。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_jlink_products_not_segger_cmsis_dap() {
        assert!(is_jlink(0x1366, 0x1059));
        assert!(is_jlink(0x1366, 0x0101));
        assert!(!is_jlink(0x1366, 0x1008));
        assert!(!is_jlink(0x0483, 0x0101));
    }

    #[test]
    fn same_probe_is_deduplicated_and_different_serials_are_preserved() {
        let mut probes = Vec::new();
        add_device(&mut probes, 123, "J-Link", 0x0101, Some("缺少运行库".into()));
        probes[0].probe_id = "1366:0101:000123".into();
        probes[0].serial_number = Some("000123".into());
        add_device(&mut probes, 456, "J-Link", 0x0101, None);
        add_device(&mut probes, 123, "J-Link", 0x0101, None);
        assert_eq!(probes.len(), 2);
        assert_eq!(probes[1].probe_id, "jlink:123");
        assert!(probes[1].connection_hint.is_none());
    }

    #[test]
    fn selection_requires_a_valid_nonzero_serial() {
        assert_eq!(serial_from_id("jlink:000123"), Some(123));
        assert_eq!(serial_from_id("jlink:0"), None);
        assert_eq!(serial_from_id("jlink:abc"), None);
        assert_eq!(serial_from_id("J-Link"), None);
    }
}
