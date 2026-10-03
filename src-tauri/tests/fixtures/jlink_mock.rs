//! 软件侧 ABI 测试夹具：自行实现最小 C 接口，不包含 SEGGER 代码或硬件访问。
#![allow(non_snake_case)]
use std::ffi::{c_char, c_int};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering::SeqCst};

static SERIAL: AtomicU32 = AtomicU32::new(0);
static CLOSES: AtomicU32 = AtomicU32::new(0);
static DATA: AtomicU32 = AtomicU32::new(0);
static RESET: AtomicU32 = AtomicU32::new(1);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[no_mangle]
pub unsafe extern "C" fn JLINKARM_EMU_GetList(_host: u32, info: *mut u8, count: c_int) -> c_int {
    if count > 0 && !info.is_null() {
        std::ptr::write_bytes(info, 0, 264);
        std::ptr::write_unaligned(info.cast::<u32>(), 123);
        std::ptr::copy_nonoverlapping(b"J-Link\0".as_ptr(), info.add(50), 7);
    }
    1
}
#[no_mangle]
pub extern "C" fn JLINKARM_EMU_SelectByUSBSN(serial: u32) -> c_int {
    SERIAL.store(serial, SeqCst);
    0
}
#[no_mangle]
pub extern "C" fn JLINKARM_Open() -> *const c_char {
    if SERIAL.load(SeqCst) == 999 {
        c"occupied".as_ptr()
    } else {
        std::ptr::null()
    }
}
#[no_mangle]
pub extern "C" fn JLINKARM_Close() {
    CLOSES.fetch_add(1, SeqCst);
}
#[no_mangle]
pub extern "C" fn JLINKARM_TIF_Select(tif: c_int) -> c_int {
    if tif == 1 {
        0
    } else {
        1
    }
}
#[no_mangle]
pub extern "C" fn JLINKARM_SetSpeed(_speed: u32) {}
#[no_mangle]
pub extern "C" fn JLINKARM_CORESIGHT_Configure(_config: *const c_char) -> c_int {
    0
}
#[no_mangle]
pub unsafe extern "C" fn JLINKARM_CORESIGHT_ReadAPDPReg(reg: u32, ap: u32, value: *mut u32) -> c_int {
    if reg == 3 && ap == 1 {
        *value = DATA.load(SeqCst);
        0
    } else {
        -1
    }
}
#[no_mangle]
pub extern "C" fn JLINKARM_CORESIGHT_WriteAPDPReg(reg: u32, ap: u32, value: u32) -> c_int {
    if reg == 3 && ap == 1 {
        DATA.store(value, SeqCst);
        0
    } else {
        -1
    }
}
#[no_mangle]
pub unsafe extern "C" fn JLINK_SWD_StoreRaw(direction: *const u8, data: *const u8, bits: u32) -> c_int {
    if bits > 64 || *direction != 255 {
        return -1;
    }
    let mut bytes = [0; 8];
    std::ptr::copy_nonoverlapping(data, bytes.as_mut_ptr(), bits.div_ceil(8) as usize);
    SEQUENCE.store(u64::from_le_bytes(bytes), SeqCst);
    0
}
#[no_mangle]
pub extern "C" fn JLINK_SWD_SyncBits() {}
#[no_mangle]
pub extern "C" fn JLINKARM_SetRESET() {
    RESET.store(1, SeqCst);
}
#[no_mangle]
pub extern "C" fn JLINKARM_ClrRESET() {
    RESET.store(0, SeqCst);
}
#[no_mangle]
pub extern "C" fn JLINKARM_SetTCK() -> c_int {
    0
}
#[no_mangle]
pub extern "C" fn JLINKARM_ClrTCK() -> c_int {
    0
}
#[no_mangle]
pub extern "C" fn JLINKARM_SetTMS() -> c_int {
    0
}
#[no_mangle]
pub extern "C" fn JLINKARM_ClrTMS() -> c_int {
    0
}
#[no_mangle]
pub unsafe extern "C" fn JLINKARM_GetHWStatus(status: *mut u8) -> c_int {
    std::ptr::write_bytes(status, 0, 8);
    std::ptr::write_unaligned(status.cast::<u16>(), 3300);
    *status.add(6) = RESET.load(SeqCst) as u8;
    0
}
#[no_mangle]
pub extern "C" fn TEST_Closes() -> u32 {
    CLOSES.load(SeqCst)
}
#[no_mangle]
pub extern "C" fn TEST_Sequence() -> u64 {
    SEQUENCE.load(SeqCst)
}
