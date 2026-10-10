//! WebView2 pointer-capability correction for Windows touchscreen machines.
//!
//! Chromium's device enumeration on some Windows touchscreen devices (e.g.
//! Surface) registers only the touch digitizer, so CSS media queries report
//! `(hover: none)` and `(pointer: coarse)` even while a mouse is in use —
//! which keeps every Tailwind `hover:` / `group-hover:` utility (including
//! the tab close button) permanently disabled. The same applies to
//! `(any-hover)` / `(any-pointer)`, so no CSS-side query can recover.
//!
//! When a fine pointer (mouse or precision touchpad) is present we override
//! the renderer's report via blink-settings so the media queries match the
//! hardware. Must run before the first WebView2 environment is created.

const BLINK_SETTINGS_ARGS: &str =
    "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4";

#[cfg(target_os = "windows")]
pub fn apply_webview_pointer_capabilities() {
    if !has_fine_pointer() {
        return;
    }

    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    let mut value = std::env::var(KEY).unwrap_or_default();
    if !value.is_empty() {
        value.push(' ');
    }
    value.push_str(BLINK_SETTINGS_ARGS);
    std::env::set_var(KEY, value);
}

#[cfg(not(target_os = "windows"))]
pub fn apply_webview_pointer_capabilities() {}

/// True when Windows reports a mouse or a precision touchpad.
///
/// Touchscreen digitizers deliberately do NOT count: Chromium treats the
/// primary pointer as touch there, which is exactly the report we correct.
#[cfg(target_os = "windows")]
fn has_fine_pointer() -> bool {
    use std::alloc::{alloc, dealloc, Layout};

    // Minimal FFI for user32 raw-input enumeration; avoids a new dependency.
    #[link(name = "user32")]
    extern "system" {
        fn GetRawInputDeviceList(
            list: *mut RawInputDeviceList,
            count: *mut u32,
            size: u32,
        ) -> u32;
        fn GetRawInputDeviceInfoW(
            device: isize,
            command: u32,
            data: *mut u8,
            size: *mut u32,
        ) -> u32;
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct RawInputDeviceList {
        h_device: isize,
        dw_type: u32,
    }

    const RIM_TYPEMOUSE: u32 = 0;
    const RIM_TYPEHID: u32 = 2;
    const RIDI_DEVICEINFO: u32 = 0x2000_0007;
    // HID usage-page / usage pairs from HID_USAGE_PAGE_DIGITIZER.
    const USAGE_PAGE_DIGITIZER: u16 = 0x000D;
    const USAGE_TOUCH_PAD: u16 = 0x0005;

    unsafe {
        let mut count: u32 = 0;
        if GetRawInputDeviceList(std::ptr::null_mut(), &mut count, std::mem::size_of::<RawInputDeviceList>() as u32)
            == u32::MAX
        {
            return false;
        }
        if count == 0 {
            return false;
        }
        let layout = Layout::array::<RawInputDeviceList>(count as usize).expect("device list layout");
        let list = alloc(layout) as *mut RawInputDeviceList;
        if list.is_null() {
            return false;
        }
        let fetched = GetRawInputDeviceList(list, &mut count, std::mem::size_of::<RawInputDeviceList>() as u32);

        let mut fine = false;
        if fetched != u32::MAX {
            for i in 0..fetched as usize {
                let device = *list.add(i);
                if device.dw_type == RIM_TYPEMOUSE {
                    fine = true;
                    break;
                }
                if device.dw_type != RIM_TYPEHID {
                    continue;
                }
                // RID_DEVICE_INFO: cbSize@0, dwType@4, then the HID union
                // member: vendorId@8, productId@10, versionNumber@12,
                // usagePage@14, usage@16 (all USHORT).
                let mut info = [0u8; 32];
                let mut info_size = info.len() as u32;
                if GetRawInputDeviceInfoW(device.h_device, RIDI_DEVICEINFO, info.as_mut_ptr(), &mut info_size)
                    != u32::MAX
                {
                    let usage_page = u16::from_ne_bytes([info[14], info[15]]);
                    let usage = u16::from_ne_bytes([info[16], info[17]]);
                    if usage_page == USAGE_PAGE_DIGITIZER && usage == USAGE_TOUCH_PAD {
                        fine = true;
                        break;
                    }
                }
            }
        }

        dealloc(list as *mut u8, layout);
        fine
    }
}
