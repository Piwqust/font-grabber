//! Minimal WebAssembly ABI for converting web fonts to clean sfnt (TTF/OTF).
//!
//! No `wasm-bindgen`: the interface is plain `extern "C"` functions over linear
//! memory so the extension only needs `cargo build --target wasm32-unknown-unknown`.
//!
//! Protocol (single-threaded, so module-level buffers are safe):
//!   1. `alloc(len)` -> ptr; JS writes `len` input bytes there.
//!   2. `convert(font_ptr, font_len, fmt, meta_ptr, meta_len)` -> 1 ok / 0 error.
//!      `meta` is UTF-8 `"family\tweight\tstyle"` used for name-table repair.
//!   3. On success read `result_ptr()`/`result_len()`; on error `error_ptr()`/`error_len()`.
//!   4. `dealloc(ptr, len)` frees an input buffer.

mod name_repair;

use wuff::{decompress_woff1, decompress_woff2};

const WOFF2_SIGNATURE: u32 = 0x774F_4632; // "wOF2"
const WOFF_SIGNATURE: u32 = 0x774F_4646; // "wOFF"
const SFNT_TRUETYPE: u32 = 0x0001_0000;
const SFNT_OPENTYPE: u32 = 0x4F54_544F; // "OTTO"
const SFNT_TRUE: u32 = 0x7472_7565; // "true"

static mut RESULT: Vec<u8> = Vec::new();
static mut ERROR: Vec<u8> = Vec::new();

/// Allocate a zeroed buffer the host can fill with input bytes.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = vec![0u8; len];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Free a buffer previously returned by [`alloc`].
///
/// # Safety
/// `ptr`/`len` must come from a matching `alloc` call.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len != 0 {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

/// Convert a font to sfnt. Returns 1 on success, 0 on error.
///
/// # Safety
/// Pointers must reference valid host-allocated regions of the given lengths.
#[no_mangle]
pub unsafe extern "C" fn convert(
    font_ptr: *const u8,
    font_len: usize,
    fmt: u32,
    meta_ptr: *const u8,
    meta_len: usize,
) -> i32 {
    let font = std::slice::from_raw_parts(font_ptr, font_len);
    let meta = if meta_len == 0 {
        &[][..]
    } else {
        std::slice::from_raw_parts(meta_ptr, meta_len)
    };

    match do_convert(font, fmt, meta) {
        Ok(output) => {
            RESULT = output;
            ERROR = Vec::new();
            1
        }
        Err(message) => {
            ERROR = message.into_bytes();
            RESULT = Vec::new();
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    unsafe { (*std::ptr::addr_of!(RESULT)).as_ptr() }
}

#[no_mangle]
pub extern "C" fn result_len() -> usize {
    unsafe { (*std::ptr::addr_of!(RESULT)).len() }
}

#[no_mangle]
pub extern "C" fn error_ptr() -> *const u8 {
    unsafe { (*std::ptr::addr_of!(ERROR)).as_ptr() }
}

#[no_mangle]
pub extern "C" fn error_len() -> usize {
    unsafe { (*std::ptr::addr_of!(ERROR)).len() }
}

fn do_convert(font: &[u8], fmt: u32, meta: &[u8]) -> Result<Vec<u8>, String> {
    let sfnt = decompress(font, fmt)?;

    let meta_str = std::str::from_utf8(meta).unwrap_or("");
    let mut parts = meta_str.splitn(3, '\t');
    let family = parts.next().unwrap_or("").trim();
    let weight = {
        let value = parts.next().unwrap_or("").trim();
        if value.is_empty() {
            "400"
        } else {
            value
        }
    };
    let style = {
        let value = parts.next().unwrap_or("").trim();
        if value.is_empty() {
            "normal"
        } else {
            value
        }
    };

    // Only attempt name repair when we actually have a usable family name.
    if family.is_empty() {
        return Ok(sfnt);
    }
    name_repair::repair_name_table_if_needed(&sfnt, family, weight, style)
        .map_err(|error| error.to_string())
}

fn decompress(data: &[u8], fmt: u32) -> Result<Vec<u8>, String> {
    let format = if fmt == 0 { sniff(data) } else { fmt };
    match format {
        1 => decompress_woff2(data).map_err(|error| format!("WOFF2 decompression failed: {error}")),
        2 => decompress_woff1(data).map_err(|error| format!("WOFF decompression failed: {error}")),
        3 => Ok(data.to_vec()),
        _ => Err("Unsupported font format".to_string()),
    }
}

fn sniff(data: &[u8]) -> u32 {
    if data.len() < 4 {
        return 0;
    }
    let signature = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
    match signature {
        WOFF2_SIGNATURE => 1,
        WOFF_SIGNATURE => 2,
        SFNT_TRUETYPE | SFNT_OPENTYPE | SFNT_TRUE => 3,
        _ => 0,
    }
}
