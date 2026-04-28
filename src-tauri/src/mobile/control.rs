// scrcpy control message encoders.
//
// Wire format reference: scrcpy server's ControlMessageReader.java. Big-endian
// throughout. We only encode the message types this build actually uses —
// keyboard typing (INJECT_TEXT / INJECT_KEYCODE), clipboard, rotate, etc.
// land in follow-up commits.

const TYPE_INJECT_KEYCODE: u8 = 0;
const _TYPE_INJECT_TEXT: u8 = 1;
const TYPE_INJECT_TOUCH_EVENT: u8 = 2;
const TYPE_INJECT_SCROLL_EVENT: u8 = 3;
const TYPE_BACK_OR_SCREEN_ON: u8 = 4;

// Android MotionEvent action constants used by scrcpy's pointer protocol.
const ACTION_DOWN: u8 = 0;
const ACTION_UP: u8 = 1;
const ACTION_MOVE: u8 = 2;

// AKeyEvent action constants.
const KEY_ACTION_DOWN: u8 = 0;
const KEY_ACTION_UP: u8 = 1;

// Android KeyEvent keycodes used by scrcpy nav buttons.
pub const KEYCODE_HOME: i32 = 3;
pub const KEYCODE_APP_SWITCH: i32 = 187;

#[derive(Debug, Copy, Clone)]
pub enum TouchAction {
    Down,
    Up,
    Move,
}

impl TouchAction {
    fn byte(self) -> u8 {
        match self {
            TouchAction::Down => ACTION_DOWN,
            TouchAction::Up => ACTION_UP,
            TouchAction::Move => ACTION_MOVE,
        }
    }

    fn is_down(self) -> bool {
        !matches!(self, TouchAction::Up)
    }
}

/// 32-byte INJECT_TOUCH_EVENT message.
///
/// `screen_width`/`screen_height` are the dimensions of whatever space the
/// (x, y) coordinates were sampled in — typically the canvas / video frame.
/// scrcpy scales to the actual device screen on the device side, so we don't
/// need to know the device's physical size.
pub fn encode_touch(
    action: TouchAction,
    pointer_id: i64,
    x: i32,
    y: i32,
    screen_width: u16,
    screen_height: u16,
) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[0] = TYPE_INJECT_TOUCH_EVENT;
    buf[1] = action.byte();
    buf[2..10].copy_from_slice(&pointer_id.to_be_bytes());
    buf[10..14].copy_from_slice(&x.to_be_bytes());
    buf[14..18].copy_from_slice(&y.to_be_bytes());
    buf[18..20].copy_from_slice(&screen_width.to_be_bytes());
    buf[20..22].copy_from_slice(&screen_height.to_be_bytes());
    // u16 fixed-point, 0..0xffff = 0..1. Full pressure on touch contact, 0 on lift.
    let pressure: u16 = if action.is_down() { 0xffff } else { 0 };
    buf[22..24].copy_from_slice(&pressure.to_be_bytes());
    // action_button + buttons: 0 for plain touch (mouse emulation only).
    // bytes 24..28 and 28..32 are already zero.
    buf
}

/// 21-byte INJECT_SCROLL_EVENT message. `hscroll`/`vscroll` are clamped to
/// [-1.0, 1.0] and encoded as i16 fixed-point.
pub fn encode_scroll(
    x: i32,
    y: i32,
    screen_width: u16,
    screen_height: u16,
    hscroll: f32,
    vscroll: f32,
) -> [u8; 21] {
    let mut buf = [0u8; 21];
    buf[0] = TYPE_INJECT_SCROLL_EVENT;
    buf[1..5].copy_from_slice(&x.to_be_bytes());
    buf[5..9].copy_from_slice(&y.to_be_bytes());
    buf[9..11].copy_from_slice(&screen_width.to_be_bytes());
    buf[11..13].copy_from_slice(&screen_height.to_be_bytes());
    buf[13..15].copy_from_slice(&i16_fixed(hscroll).to_be_bytes());
    buf[15..17].copy_from_slice(&i16_fixed(vscroll).to_be_bytes());
    // buttons (4 bytes) — leave 0.
    buf
}

fn i16_fixed(f: f32) -> i16 {
    let clamped = f.clamp(-1.0, 1.0);
    // -1.0 → -32768, 1.0 → 32767 (close enough — scrcpy scales by 0x8000 on the way back).
    let scaled = clamped * 32767.0;
    if scaled > 32767.0 {
        32767
    } else if scaled < -32768.0 {
        -32768
    } else {
        scaled as i16
    }
}

/// 2-byte BACK_OR_SCREEN_ON message. action 0 = down, 1 = up. We send the
/// pair as one logical "press" from the toolbar.
pub fn encode_back_or_screen_on(down: bool) -> [u8; 2] {
    [TYPE_BACK_OR_SCREEN_ON, if down { ACTION_DOWN } else { ACTION_UP }]
}

/// 14-byte INJECT_KEYCODE message — used here only for the Home / App-switch
/// toolbar buttons (BACK has its own dedicated message). For arbitrary
/// keyboard input we'll switch to INJECT_TEXT in a follow-up.
pub fn encode_keycode(down: bool, keycode: i32, repeat: i32, meta_state: i32) -> [u8; 14] {
    let mut buf = [0u8; 14];
    buf[0] = TYPE_INJECT_KEYCODE;
    buf[1] = if down { KEY_ACTION_DOWN } else { KEY_ACTION_UP };
    buf[2..6].copy_from_slice(&keycode.to_be_bytes());
    buf[6..10].copy_from_slice(&repeat.to_be_bytes());
    buf[10..14].copy_from_slice(&meta_state.to_be_bytes());
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn touch_down_layout() {
        let m = encode_touch(TouchAction::Down, 1, 100, 200, 1080, 2400);
        assert_eq!(m[0], TYPE_INJECT_TOUCH_EVENT);
        assert_eq!(m[1], ACTION_DOWN);
        assert_eq!(i64::from_be_bytes(m[2..10].try_into().unwrap()), 1);
        assert_eq!(i32::from_be_bytes(m[10..14].try_into().unwrap()), 100);
        assert_eq!(i32::from_be_bytes(m[14..18].try_into().unwrap()), 200);
        assert_eq!(u16::from_be_bytes(m[18..20].try_into().unwrap()), 1080);
        assert_eq!(u16::from_be_bytes(m[20..22].try_into().unwrap()), 2400);
        assert_eq!(u16::from_be_bytes(m[22..24].try_into().unwrap()), 0xffff);
    }

    #[test]
    fn touch_up_zeroes_pressure() {
        let m = encode_touch(TouchAction::Up, 1, 0, 0, 1, 1);
        assert_eq!(u16::from_be_bytes(m[22..24].try_into().unwrap()), 0);
    }

    #[test]
    fn scroll_clamps_overflow() {
        let m = encode_scroll(0, 0, 1, 1, 5.0, -5.0);
        assert_eq!(i16::from_be_bytes(m[13..15].try_into().unwrap()), 32767);
        assert_eq!(i16::from_be_bytes(m[15..17].try_into().unwrap()), -32768);
    }
}
