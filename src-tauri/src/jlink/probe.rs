//! 仅负责 SEGGER DLL 到 probe-rs 的 Cortex-M / SWD 传输适配。
//! 芯片描述、复位序列、烧录算法、调试和 RTT 仍由 probe-rs 处理。
use super::runtime::{self, Api, HardwareStatus, Lease};
use probe_rs::architecture::arm::{
    sequences::ArmDebugSequence, ArmCommunicationInterface, ArmDebugInterface, ArmError, DapProbe, RawDapAccess,
    RegisterAddress,
};
use probe_rs::probe::{DebugProbe, DebugProbeError, Probe, WireProtocol};
use probe_rs::CoreStatus;
use std::ffi::CStr;
use std::sync::Arc;
use std::time::Duration;

pub fn open(serial: u32) -> Result<Probe, String> {
    let api = runtime::load()?;
    Ok(Probe::new(open_native(serial, api)?))
}

fn open_native(serial: u32, api: Arc<Api>) -> Result<NativeProbe, String> {
    let lease = Lease::acquire()?;
    // 枚举和打开期间均持有租约，不允许其他线程改变 DLL 当前选择的探针。
    unsafe {
        if (api.select)(serial) < 0 {
            return Err(format!("无法选择 J-Link {serial}，请检查设备是否仍已连接。"));
        }
        let error = (api.open)();
        if !error.is_null() {
            let message = CStr::from_ptr(error).to_string_lossy().into_owned();
            (api.close)();
            return Err(format!(
                "无法打开 J-Link {serial}: {message}。请检查官方驱动，并关闭正在占用它的调试会话。"
            ));
        }
    }
    Ok(NativeProbe {
        api,
        _lease: lease,
        speed: 1000,
        protocol: WireProtocol::Swd,
        reset_asserted: false,
    })
}

struct NativeProbe {
    api: Arc<Api>,
    _lease: Lease,
    speed: u32,
    protocol: WireProtocol,
    reset_asserted: bool,
}

impl std::fmt::Debug for NativeProbe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SeggerJLink")
            .field("library", &self.api.path)
            .field("speed", &self.speed)
            .finish()
    }
}

impl Drop for NativeProbe {
    fn drop(&mut self) {
        // Close 先于租约释放和 Library 卸载；即使 attach 失败也会执行。
        if self.reset_asserted {
            unsafe { (self.api.set_reset)() };
        }
        unsafe { (self.api.close)() };
    }
}

fn check(code: i32, operation: &str) -> Result<(), DebugProbeError> {
    if code < 0 {
        Err(DebugProbeError::Other(format!(
            "J-Link {operation}失败（错误码 {code}），请检查目标供电、接线和设备占用。"
        )))
    } else {
        Ok(())
    }
}

impl NativeProbe {
    fn hardware_status(&self) -> Result<HardwareStatus, DebugProbeError> {
        let mut status = HardwareStatus::default();
        let result = unsafe { (self.api.hardware_status)(&mut status) };
        if result != 0 {
            return Err(DebugProbeError::Other(format!(
                "J-Link 读取引脚状态失败（错误码 {result}）"
            )));
        }
        Ok(status)
    }
}

impl DebugProbe for NativeProbe {
    fn get_name(&self) -> &str {
        "J-Link (SEGGER)"
    }
    fn speed_khz(&self) -> u32 {
        self.speed
    }

    fn set_speed(&mut self, speed: u32) -> Result<u32, DebugProbeError> {
        if speed == 0 || speed >= 50_000 {
            return Err(DebugProbeError::UnsupportedSpeed(speed));
        }
        unsafe { (self.api.set_speed)(speed) };
        self.speed = speed;
        Ok(speed)
    }

    fn select_protocol(&mut self, protocol: WireProtocol) -> Result<(), DebugProbeError> {
        if protocol != WireProtocol::Swd {
            return Err(DebugProbeError::UnsupportedProtocol(protocol));
        }
        let result = unsafe { (self.api.tif_select)(1) };
        if result != 0 {
            return Err(DebugProbeError::Other("J-Link 无法选择 SWD 接口".into()));
        }
        self.protocol = protocol;
        Ok(())
    }

    fn active_protocol(&self) -> Option<WireProtocol> {
        Some(self.protocol)
    }

    fn attach(&mut self) -> Result<(), DebugProbeError> {
        self.select_protocol(self.protocol)?;
        check(unsafe { (self.api.configure)(c"".as_ptr()) }, "初始化 SWD")
    }

    fn detach(&mut self) -> Result<(), probe_rs::Error> {
        Ok(())
    }

    fn target_reset(&mut self) -> Result<(), DebugProbeError> {
        self.target_reset_assert()?;
        std::thread::sleep(Duration::from_millis(10));
        self.target_reset_deassert()
    }

    fn target_reset_assert(&mut self) -> Result<(), DebugProbeError> {
        unsafe { (self.api.clear_reset)() };
        self.reset_asserted = true;
        Ok(())
    }

    fn target_reset_deassert(&mut self) -> Result<(), DebugProbeError> {
        unsafe { (self.api.set_reset)() };
        self.reset_asserted = false;
        Ok(())
    }

    fn has_arm_interface(&self) -> bool {
        true
    }

    fn try_get_arm_debug_interface<'probe>(
        self: Box<Self>,
        sequence: Arc<dyn ArmDebugSequence>,
    ) -> Result<Box<dyn ArmDebugInterface + 'probe>, (Box<dyn DebugProbe>, ArmError)> {
        Ok(ArmCommunicationInterface::create(self, sequence, false))
    }

    fn into_probe(self: Box<Self>) -> Box<dyn DebugProbe> {
        self
    }
    fn try_as_dap_probe(&mut self) -> Option<&mut dyn DapProbe> {
        Some(self)
    }
    fn get_target_voltage(&mut self) -> Result<Option<f32>, DebugProbeError> {
        Ok(Some(f32::from(self.hardware_status()?.voltage_mv) / 1000.0))
    }
}

impl DapProbe for NativeProbe {}

impl RawDapAccess for NativeProbe {
    fn raw_read_register(&mut self, address: RegisterAddress) -> Result<u32, ArmError> {
        let mut value = 0;
        // DLL 负责 AP posted-read 和 WAIT 重试，probe-rs 负责 SELECT/bank 切换。
        check(
            unsafe {
                (self.api.read_register)(
                    u32::from(address.a2_and_3() / 4),
                    u32::from(address.is_ap()),
                    &mut value,
                )
            },
            "读取调试寄存器",
        )?;
        Ok(value)
    }

    fn raw_write_register(&mut self, address: RegisterAddress, value: u32) -> Result<(), ArmError> {
        check(
            unsafe { (self.api.write_register)(u32::from(address.a2_and_3() / 4), u32::from(address.is_ap()), value) },
            "写入调试寄存器",
        )?;
        Ok(())
    }

    fn jtag_sequence(&mut self, _cycles: u8, _tms: bool, _tdi: u64) -> Result<(), DebugProbeError> {
        Err(DebugProbeError::UnsupportedProtocol(WireProtocol::Jtag))
    }

    fn swj_sequence(&mut self, bit_len: u8, bits: u64) -> Result<(), DebugProbeError> {
        if bit_len == 0 || bit_len > 64 {
            return Err(DebugProbeError::Other("SWD 输出序列长度必须为 1–64 位".into()));
        }
        let directions = [0xffu8; 8];
        let data = bits.to_le_bytes();
        check(
            unsafe { (self.api.store_swd)(directions.as_ptr(), data.as_ptr(), u32::from(bit_len)) },
            "输出 SWD 序列",
        )?;
        unsafe { (self.api.sync_swd)() };
        Ok(())
    }

    fn swj_pins(&mut self, output: u32, select: u32, wait: u32) -> Result<u32, DebugProbeError> {
        if select & !0x83 != 0 {
            return Err(DebugProbeError::CommandNotSupportedByProbe {
                command_name: "SWJ pins (only TCK, TMS, nRESET)",
            });
        }
        unsafe {
            if select & 1 != 0 {
                check(
                    if output & 1 != 0 {
                        (self.api.set_tck)()
                    } else {
                        (self.api.clear_tck)()
                    },
                    "设置时钟引脚",
                )?;
            }
            if select & 2 != 0 {
                check(
                    if output & 2 != 0 {
                        (self.api.set_tms)()
                    } else {
                        (self.api.clear_tms)()
                    },
                    "设置数据引脚",
                )?;
            }
            if select & 0x80 != 0 {
                self.reset_asserted = output & 0x80 == 0;
                if output & 0x80 != 0 {
                    (self.api.set_reset)()
                } else {
                    (self.api.clear_reset)()
                }
            }
        }
        std::thread::sleep(Duration::from_micros(u64::from(wait)));
        let status = self.hardware_status()?;
        Ok(u32::from(status.tck != 0) | (u32::from(status.tms != 0) << 1) | (u32::from(status.reset != 0) << 7))
    }

    fn into_probe(self: Box<Self>) -> Box<dyn DebugProbe> {
        self
    }
    fn core_status_notification(&mut self, _state: CoreStatus) -> Result<(), DebugProbeError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use probe_rs::architecture::arm::dp::DpRegisterAddress;

    #[test]
    fn dll_boundary_preserves_registers_errors_and_session_lifetime() {
        // 独立模拟 DLL 验证 ABI 和资源生命周期，不连接任何物理 USB 设备。
        let directory = std::env::temp_dir().join(format!("micu-jlink-ffi-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let dll = directory.join("mock_jlink.dll");
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/jlink_mock.rs");
        let output = std::process::Command::new("rustc")
            .args(["--crate-type", "cdylib", "--edition", "2021"])
            .arg(source)
            .arg("-o")
            .arg(&dll)
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        {
            let api = Arc::new(Api::load_at(&dll).unwrap());
            let inspector = unsafe { libloading::Library::new(&dll).unwrap() };
            let closes = unsafe {
                inspector
                    .get::<unsafe extern "C" fn() -> u32>(b"TEST_Closes\0")
                    .unwrap()
            };
            let sequence = unsafe {
                inspector
                    .get::<unsafe extern "C" fn() -> u64>(b"TEST_Sequence\0")
                    .unwrap()
            };
            let mut devices = [runtime::ConnectInfo::default()];
            assert_eq!(unsafe { (api.list)(1, devices.as_mut_ptr(), 1) }, 1);
            assert_eq!(devices[0].serial, 123);
            let mut probe = open_native(123, Arc::clone(&api)).unwrap();
            assert!(open_native(123, Arc::clone(&api)).unwrap_err().contains("另一个工作台"));
            probe.select_protocol(WireProtocol::Swd).unwrap();
            probe.attach().unwrap();
            assert!(probe.select_protocol(WireProtocol::Jtag).is_err());
            let ap = RegisterAddress::ApRegister(0x0c);
            probe.raw_write_register(ap, 0x1234_abcd).unwrap();
            assert_eq!(probe.raw_read_register(ap).unwrap(), 0x1234_abcd);
            let invalid = DpRegisterAddress {
                address: 0x0c,
                bank: None,
            }
            .into();
            assert!(probe.raw_read_register(invalid).is_err());
            probe.swj_sequence(16, 0xe79e).unwrap();
            assert_eq!(unsafe { sequence() }, 0xe79e);
            probe.target_reset_assert().unwrap();
            assert_eq!(probe.swj_pins(0, 0, 0).unwrap() & 0x80, 0);
            probe.target_reset_deassert().unwrap();
            assert_eq!(probe.swj_pins(0, 0, 0).unwrap() & 0x80, 0x80);
            assert_eq!(probe.get_target_voltage().unwrap(), Some(3.3));
            probe.target_reset_assert().unwrap();
            drop(probe);
            assert_eq!(unsafe { closes() }, 1);
            let mut status = HardwareStatus::default();
            assert_eq!(unsafe { (api.hardware_status)(&mut status) }, 0);
            assert_eq!(status.reset, 1, "关闭会话时必须释放复位引脚");
            assert!(open_native(999, Arc::clone(&api)).unwrap_err().contains("occupied"));
            assert_eq!(unsafe { closes() }, 2);
            drop(open_native(123, api).unwrap());
            assert_eq!(unsafe { closes() }, 3);
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
