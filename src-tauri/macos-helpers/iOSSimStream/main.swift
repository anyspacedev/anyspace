// iossimstream — captures an iOS Simulator window with ScreenCaptureKit and
// emits H.264 Annex-B on stdout for the Tauri host to forward to the web
// frontend's WebCodecs decoder.
//
// Args:
//   --device-name "<name>"   Match a Simulator window whose title starts
//                            with this string (e.g. "iPhone 15 Pro").
//   --width <px> / --height <px> / --fps <n> / --bitrate <bps>
//                            Optional encoder parameters.
//
// The helper exits with non-zero status and writes a one-line error to
// stderr if the window can't be located, ScreenCaptureKit permission is
// denied, or the encoder fails. The Rust parent attaches both pipes so
// errors surface back through `mobile_connect`.
//
// Compiled on macOS by the Cargo build.rs:
//   swiftc main.swift -O -o iossimstream \
//       -framework ScreenCaptureKit -framework VideoToolbox \
//       -framework CoreMedia -framework CoreVideo -framework AppKit
//
// Min OS: macOS 13 (Ventura) for the async ScreenCaptureKit APIs we use.

import AppKit
import ApplicationServices
import CoreGraphics
import CoreMedia
import CoreVideo
import Darwin
import Foundation
import ScreenCaptureKit
import VideoToolbox

// MARK: - Args

struct Args {
    var deviceName: String = ""
    var width: Int = 0
    var height: Int = 0
    var fps: Int = 30
    var bitrate: Int = 6_000_000
}

func parseArgs() -> Args {
    var args = Args()
    var i = 1
    let argv = CommandLine.arguments
    while i < argv.count {
        let a = argv[i]
        let v = i + 1 < argv.count ? argv[i + 1] : ""
        switch a {
        case "--device-name": args.deviceName = v; i += 2
        case "--width":       args.width = Int(v) ?? 0; i += 2
        case "--height":      args.height = Int(v) ?? 0; i += 2
        case "--fps":         args.fps = Int(v) ?? 30; i += 2
        case "--bitrate":     args.bitrate = Int(v) ?? 6_000_000; i += 2
        default: i += 1
        }
    }
    return args
}

// MARK: - stderr / stdout

/// All status + error messages go to stderr; the parent forwards each line
/// to its own stderr (visible in `npm run tauri:dev`) and surfaces the trail
/// to the user when startup fails.
func log(_ msg: String) {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8) ?? Data())
}

let stdout = FileHandle.standardOutput

func writeBytes(_ data: Data) {
    // SCStream's sample handler is async and FileHandle.write can throw on
    // closed pipe — we catch and bail rather than crash.
    do {
        try stdout.write(contentsOf: data)
    } catch {
        log("stdout write failed: \(error.localizedDescription)")
        exit(0)  // parent likely closed the pipe; clean exit
    }
}

// MARK: - Window discovery

func discoverSimulatorWindows() async throws -> [SCWindow] {
    // SCShareableContent excludes windows belonging to the calling process
    // and (with onScreenWindowsOnly:false) includes off-screen / minimised
    // windows too. The "Simulator" applicationName matches the GUI host
    // app — there is no window when Simulator.app isn't running, even if
    // the device runtime is booted via `simctl boot`.
    let content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: false)
    return content.windows.filter {
        $0.owningApplication?.applicationName == "Simulator"
    }
}

/// Launch Simulator.app if it isn't already running. Doesn't steal focus —
/// the host Tauri app stays active while Simulator boots up its window for
/// whatever device `simctl` already has booted.
func launchSimulatorApp() async throws {
    guard let url = NSWorkspace.shared.urlForApplication(
        withBundleIdentifier: "com.apple.iphonesimulator")
    else {
        throw NSError(
            domain: "iossimstream", code: 6,
            userInfo: [NSLocalizedDescriptionKey:
                "Couldn't locate Simulator.app — is Xcode installed?"])
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = false
    config.hides = false
    _ = try await NSWorkspace.shared.openApplication(at: url, configuration: config)
}

func findSimulatorWindow(deviceName: String) async throws -> SCWindow {
    var windows = try await discoverSimulatorWindows()

    if windows.isEmpty {
        // Booted via simctl but Simulator.app GUI isn't running. Launch it
        // (without stealing focus) and poll briefly — Simulator.app
        // re-attaches to any already-booted device on startup.
        log("No Simulator windows visible — launching Simulator.app …")
        try await launchSimulatorApp()
        for _ in 0..<30 {
            try await Task.sleep(nanoseconds: 200_000_000) // 0.2 s × 30 = 6 s
            windows = try await discoverSimulatorWindows()
            if !windows.isEmpty { break }
        }
    }

    if windows.isEmpty {
        throw NSError(
            domain: "iossimstream", code: 1,
            userInfo: [NSLocalizedDescriptionKey:
                "Simulator.app launched but no device window appeared within 6 s. " +
                "Open Simulator manually, confirm \"\(deviceName)\" is showing, then retry."])
    }

    // Prefer a window whose title mentions the device name; fall back to
    // the first Simulator window if the user has only one booted.
    let match = windows.first {
        ($0.title ?? "").localizedCaseInsensitiveContains(deviceName)
    } ?? windows.first!
    return match
}

// MARK: - VideoToolbox H.264 encoder

final class H264Encoder {
    private var session: VTCompressionSession?
    private let width: Int
    private let height: Int
    /// Annex-B start-code prefix used between every NALU.
    private let startCode = Data([0x00, 0x00, 0x00, 0x01])

    init(width: Int, height: Int, fps: Int, bitrate: Int) throws {
        self.width = width
        self.height = height
        var session: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(width),
            height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: nil,    // using the synchronous variant via Encode + dequeue
            refcon: nil,
            compressionSessionOut: &session)
        guard status == noErr, let session = session else {
            throw NSError(domain: "iossimstream", code: Int(status),
                          userInfo: [NSLocalizedDescriptionKey: "VTCompressionSessionCreate failed: \(status)"])
        }
        self.session = session

        // Real-time low-latency baseline encode — matches scrcpy defaults so
        // the frontend can use a single avc1.42E01F decoder configuration.
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel,
                             value: kVTProfileLevel_H264_Baseline_AutoLevel)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate,
                             value: NSNumber(value: bitrate))
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate,
                             value: NSNumber(value: fps))
        // One IDR per second — gives the WebCodecs decoder a recovery point
        // every 30 frames if the channel hiccups.
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval,
                             value: NSNumber(value: fps))

        VTCompressionSessionPrepareToEncodeFrames(session)
    }

    func encode(pixelBuffer: CVPixelBuffer, pts: CMTime) {
        guard let session = session else { return }
        VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: pts,
            duration: .invalid,
            frameProperties: nil,
            infoFlagsOut: nil
        ) { [weak self] status, _, sampleBuffer in
            guard status == noErr, let sampleBuffer = sampleBuffer else { return }
            self?.handleSample(sampleBuffer)
        }
    }

    /// Convert a CMSampleBuffer (length-prefixed AVCC) to Annex-B and write
    /// to stdout. For keyframes we prepend SPS + PPS so the WebCodecs decoder
    /// can bootstrap without any out-of-band config.
    private func handleSample(_ sampleBuffer: CMSampleBuffer) {
        guard CMSampleBufferGetNumSamples(sampleBuffer) > 0 else { return }

        let isKey: Bool = {
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
                let first = attachments.first
            else { return false }
            // Keyframe iff "NotSync" is absent or false.
            if let notSync = first[kCMSampleAttachmentKey_NotSync] as? Bool { return !notSync }
            return true
        }()

        var output = Data()

        if isKey {
            if let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) {
                let paramSets = parameterSets(formatDesc: formatDesc)
                for ps in paramSets {
                    output.append(startCode)
                    output.append(ps)
                }
            }
        }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer, atOffset: 0, lengthAtOffsetOut: nil,
            totalLengthOut: &totalLength, dataPointerOut: &dataPointer)
        guard status == kCMBlockBufferNoErr, let ptr = dataPointer else { return }
        let buf = UnsafeMutableBufferPointer<UInt8>(
            start: UnsafeMutableRawPointer(ptr).bindMemory(to: UInt8.self, capacity: totalLength),
            count: totalLength)

        var i = 0
        while i + 4 <= totalLength {
            // VTCompressionSession emits AVCC: 4-byte big-endian NAL length then NAL bytes.
            let nalLen = (Int(buf[i]) << 24) | (Int(buf[i + 1]) << 16) |
                         (Int(buf[i + 2]) << 8)  | Int(buf[i + 3])
            i += 4
            if i + nalLen > totalLength { break }
            output.append(startCode)
            output.append(Data(bytes: ptr.advanced(by: i), count: nalLen))
            i += nalLen
        }
        writeBytes(output)
    }

    private func parameterSets(formatDesc: CMFormatDescription) -> [Data] {
        var count = 0
        var nalUnitHeaderLen: Int32 = 0
        // First call: get count.
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDesc, parameterSetIndex: 0,
            parameterSetPointerOut: nil, parameterSetSizeOut: nil,
            parameterSetCountOut: &count, nalUnitHeaderLengthOut: &nalUnitHeaderLen)
        var out: [Data] = []
        for idx in 0..<count {
            var ptr: UnsafePointer<UInt8>?
            var size = 0
            let s = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                formatDesc, parameterSetIndex: idx,
                parameterSetPointerOut: &ptr, parameterSetSizeOut: &size,
                parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
            if s == noErr, let ptr = ptr {
                out.append(Data(bytes: ptr, count: size))
            }
        }
        return out
    }

    deinit {
        if let session = session {
            VTCompressionSessionInvalidate(session)
        }
    }
}

// MARK: - SCStream output

final class StreamOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    let encoder: H264Encoder
    private var firstFramePTS: CMTime?

    init(encoder: H264Encoder) {
        self.encoder = encoder
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .screen else { return }
        guard sampleBuffer.isValid else { return }

        // Status defaults to `.complete` when the attachment is missing (e.g.
        // a buffer minted by SCScreenshotManager). Skip explicitly idle/blank
        // frames since their pixel buffer is the prior frame's data without
        // any content delta — encoding it is just wasted work.
        let status: SCFrameStatus = {
            guard let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                let info = attachments.first,
                let raw = info[.status] as? Int,
                let parsed = SCFrameStatus(rawValue: raw) else { return .complete }
            return parsed
        }()
        guard status == .complete else { return }

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstFramePTS == nil { firstFramePTS = pts }
        encoder.encode(pixelBuffer: pixelBuffer, pts: pts)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("SCStream stopped: \(error.localizedDescription)")
        exit(2)
    }
}

// MARK: - Input

/// Locate the running Simulator.app process so CGEvents can be posted
/// directly to its PID instead of relying on focus.
func findSimulatorPid() -> pid_t? {
    NSWorkspace.shared.runningApplications
        .first { $0.bundleIdentifier == "com.apple.iphonesimulator" }?
        .processIdentifier
}

/// Convert a canvas-pixel coordinate (0..canvasWidth, 0..canvasHeight) to a
/// screen point inside the captured Simulator window. SCWindow.frame is in
/// CG screen coordinates (top-left origin) and CGEvent uses the same system,
/// so the mapping is a straight linear interpolation.
func canvasToScreen(_ x: Int, _ y: Int,
                    _ canvasWidth: Int, _ canvasHeight: Int,
                    _ frame: CGRect) -> CGPoint {
    let nx = canvasWidth > 0 ? CGFloat(x) / CGFloat(canvasWidth) : 0
    let ny = canvasHeight > 0 ? CGFloat(y) / CGFloat(canvasHeight) : 0
    return CGPoint(x: frame.origin.x + nx * frame.size.width,
                   y: frame.origin.y + ny * frame.size.height)
}

/// Tracks whether we've already nagged about Accessibility permission so the
/// stderr stream isn't flooded once per touch event.
var inputWarnedNoAX = false

func warnIfMissingAX() {
    if AXIsProcessTrusted() { return }
    if inputWarnedNoAX { return }
    inputWarnedNoAX = true
    log("Accessibility permission missing — keyboard events are being silently dropped. " +
        "Grant in System Settings → Privacy & Security → Accessibility, then quit & restart this app.")
}

// IOSSIM_INPUT=1 opts-in to mouse/scroll injection. Default off because the
// only injection path available to an unsigned binary — `post(tap:
// .cgSessionEventTap)` — physically warps the OS cursor on every event.
// With React's setPointerCapture, that triggers a runaway feedback loop
// where the warped cursor produces phantom pointermoves which warp the
// cursor again. SimulatorKit's private Indigo HID API (the same path idb
// and Detox use) injects directly into the simulator without disturbing
// the host cursor — that's the next planned commit.
let inputDispatchEnabled =
    ProcessInfo.processInfo.environment["IOSSIM_INPUT"] == "1"

func dispatchTouch(_ action: String, screen: CGPoint, pid: pid_t) {
    if !inputDispatchEnabled {
        // Drop the event. Logged at the call site already; we just no-op
        // here so the user's cursor isn't dragged into the simulator on
        // every interaction. Set IOSSIM_INPUT=1 in the environment to
        // re-enable (and live with the cursor flicker until SimulatorKit
        // injection lands).
        return
    }
    let mouseType: CGEventType
    switch action {
    case "down": mouseType = .leftMouseDown
    case "up":   mouseType = .leftMouseUp
    case "move": mouseType = .leftMouseDragged
    default:     return
    }
    guard let event = CGEvent(mouseEventSource: nil,
                              mouseType: mouseType,
                              mouseCursorPosition: screen,
                              mouseButton: .left)
    else {
        log("(touch) CGEvent constructor returned nil")
        return
    }
    event.post(tap: .cgSessionEventTap)
    warnIfMissingAX()
}

func dispatchScroll(at screen: CGPoint, dy: Double, pid: pid_t) {
    if !inputDispatchEnabled { return }
    let ticks = Int32(dy.clamped(to: -1.0...1.0) * 3)
    guard let event = CGEvent(scrollWheelEvent2Source: nil,
                              units: .line,
                              wheelCount: 1,
                              wheel1: ticks,
                              wheel2: 0,
                              wheel3: 0)
    else {
        log("(scroll) CGEvent constructor returned nil")
        return
    }
    event.location = screen
    event.post(tap: .cgSessionEventTap)
    warnIfMissingAX()
}

/// Activate the Simulator app so subsequent keyboard events land in its
/// focused window. Keyboard events route by focus (unlike mouse, which
/// routes by cursor position), so we have to steal focus briefly. This
/// is the same UX as macOS' own ⌘⇥ app switcher, just programmatic.
func activateSimulator(pid: pid_t) {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return }
    if !app.isActive {
        app.activate(options: [.activateIgnoringOtherApps])
        // Tiny pause so the activate request lands before the key events.
        usleep(60_000)
    }
}

func dispatchKey(virtualKey: CGKeyCode, flags: CGEventFlags, pid: pid_t) {
    activateSimulator(pid: pid)
    let src = CGEventSource(stateID: .hidSystemState)
    if let down = CGEvent(keyboardEventSource: src, virtualKey: virtualKey, keyDown: true) {
        down.flags = flags
        down.post(tap: .cgSessionEventTap)
    }
    if let up = CGEvent(keyboardEventSource: src, virtualKey: virtualKey, keyDown: false) {
        up.flags = flags
        up.post(tap: .cgSessionEventTap)
    }
    warnIfMissingAX()
}

// Common AppKit virtual keycodes we use for nav buttons.
let kVK_ANSI_H: CGKeyCode = 0x04

func handleInputCommand(_ json: [String: Any], window: SCWindow, pid: pid_t) {
    guard let kind = json["kind"] as? String else {
        log("(input) malformed: missing 'kind' in \(json)")
        return
    }
    let frame = window.frame
    switch kind {
    case "touch":
        guard let action = json["action"] as? String,
              let x = json["x"] as? Int,
              let y = json["y"] as? Int,
              let cw = json["screenWidth"] as? Int,
              let ch = json["screenHeight"] as? Int else {
            log("(touch) malformed payload: \(json)")
            return
        }
        let p = canvasToScreen(x, y, cw, ch, frame)
        log("touch \(action) canvas(\(x),\(y))/\(cw)x\(ch) -> screen(\(Int(p.x)),\(Int(p.y))) pid=\(pid)")
        dispatchTouch(action, screen: p, pid: pid)

    case "scroll":
        guard let x = json["x"] as? Int,
              let y = json["y"] as? Int,
              let cw = json["screenWidth"] as? Int,
              let ch = json["screenHeight"] as? Int,
              let dy = (json["dy"] as? Double) ?? (json["dy"] as? Int).map(Double.init) else {
            log("(scroll) malformed payload: \(json)")
            return
        }
        let p = canvasToScreen(x, y, cw, ch, frame)
        log("scroll dy=\(dy) at screen(\(Int(p.x)),\(Int(p.y)))")
        dispatchScroll(at: p, dy: dy, pid: pid)

    case "home":
        log("home (⌘⇧H) -> pid=\(pid)")
        dispatchKey(virtualKey: kVK_ANSI_H, flags: [.maskCommand, .maskShift], pid: pid)

    case "appSwitch":
        log("appSwitch (double ⌘⇧H) -> pid=\(pid)")
        dispatchKey(virtualKey: kVK_ANSI_H, flags: [.maskCommand, .maskShift], pid: pid)
        usleep(120_000)
        dispatchKey(virtualKey: kVK_ANSI_H, flags: [.maskCommand, .maskShift], pid: pid)

    case "back":
        // iOS doesn't have a dedicated "back" gesture; no-op so the toolbar
        // button doesn't error out for users coming from Android.
        log("back (no-op on iOS)")

    default:
        log("ignoring unknown input kind: \(kind)")
    }
}

/// Read newline-delimited JSON commands from stdin and dispatch each one.
/// Returns when stdin closes (parent disconnects).
func readInputCommands(window: SCWindow, pid: pid_t) async {
    do {
        for try await line in FileHandle.standardInput.bytes.lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            guard let data = trimmed.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                log("(skipping malformed input line)")
                continue
            }
            handleInputCommand(json, window: window, pid: pid)
        }
    } catch {
        log("input reader stopped: \(error.localizedDescription)")
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

// MARK: - Main

// Strong references to the live capture stack. SCStream's delegate slot is
// weak, and even though our async main() never returns past `RunLoop.main.run()`,
// stashing these in a static-storage singleton keeps the lifetime obvious
// and avoids any "delegate deallocated" surprises across the async boundary.
enum Active {
    static var encoder: H264Encoder?
    static var output: StreamOutput?
    static var stream: SCStream?
}

// Dedicated dispatch queue for SCStream sample callbacks.
//
// IMPORTANT: do NOT use DispatchQueue.main here. Our `static func main()
// async` runs on the Swift cooperative thread pool, not the actual main
// thread, and `RunLoop.main.run()` from a cooperative worker doesn't pump
// the main DispatchQueue. With sampleHandlerQueue:.main the queue would
// fill up, SCK would back-pressure, and after a couple seconds the stream
// would terminate with "application connection being interrupted".
// A dedicated background queue avoids the main-thread plumbing entirely.
let sampleQueue = DispatchQueue(label: "iossimstream.samples", qos: .userInteractive)

@main
struct App {
    // Sync main keeps the actual main thread / run loop available to AppKit
    // and DispatchQueue.main. Async setup runs in a Task; the main thread
    // parks on RunLoop.main.run() to keep the process alive for SCStream
    // callbacks.
    static func main() {
        // Initialize AppKit on the main thread before any AppKit / CoreGraphics
        // call. We're a raw command-line binary (no .app bundle, no Info.plist),
        // and without this we hit:
        //   Assertion failed: (did_initialize), function CGS_REQUIRE_INIT,
        //   CGInitialization.c
        // when SCStream / NSScreen first touch the WindowServer connection.
        // `setActivationPolicy(.prohibited)` marks us as a faceless tool —
        // no Dock icon, no menu bar.
        _ = NSApplication.shared
        _ = NSApplication.shared.setActivationPolicy(.prohibited)

        Task {
            await runAsync()
        }

        // Park the real main thread on the run loop. SCStream callbacks fire
        // on our dedicated `sampleQueue`, but pumping the main run loop also
        // services any .main DispatchQueue work (NSWorkspace, etc.) that
        // AppKit hands off internally.
        RunLoop.main.run()
    }

    static func runAsync() async {
        let args = parseArgs()
        if args.deviceName.isEmpty {
            log("--device-name is required")
            exit(64)  // EX_USAGE
        }
        log("starting (deviceName: \"\(args.deviceName)\")")

        let target: SCWindow
        do {
            target = try await findSimulatorWindow(deviceName: args.deviceName)
        } catch {
            log(error.localizedDescription)
            exit(3)
        }
        log("window found: \"\(target.title ?? "<untitled>")\" " +
            "frame=\(Int(target.frame.width))x\(Int(target.frame.height))")

        // SCContentFilter for a single window — captures only that surface,
        // not the whole desktop. The first-run Screen Recording prompt fires
        // here if the user hasn't granted permission.
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        // SCWindow `frame` is in points, not pixels. Multiply by the screen's
        // backingScaleFactor when available — most modern Macs are 2x.
        let scale = NSScreen.main?.backingScaleFactor ?? 2.0
        let pxW = args.width > 0 ? args.width : Int(target.frame.width * scale)
        let pxH = args.height > 0 ? args.height : Int(target.frame.height * scale)
        config.width = pxW
        config.height = pxH
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(args.fps))
        config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        config.queueDepth = 5
        config.showsCursor = false

        let encoder: H264Encoder
        do {
            encoder = try H264Encoder(
                width: pxW, height: pxH, fps: args.fps, bitrate: args.bitrate)
        } catch {
            log(error.localizedDescription)
            exit(4)
        }
        log("encoder ready: \(pxW)x\(pxH) @ \(args.fps)fps, \(args.bitrate)bps")

        let output = StreamOutput(encoder: encoder)
        let stream = SCStream(filter: filter, configuration: config, delegate: output)
        Active.encoder = encoder
        Active.output = output
        Active.stream = stream
        do {
            try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: sampleQueue)
            try await stream.startCapture()
        } catch {
            log("startCapture failed: \(error.localizedDescription). " +
                "Grant Screen Recording permission in System Settings → Privacy & Security.")
            exit(5)
        }
        log("capture started — waiting for first frame")

        // SCK only delivers frames when on-screen content changes. On a fresh
        // connect (e.g. simulator on the home screen, no animation), no frame
        // ever flows and the canvas stays blank until the user taps something.
        // Issue a one-shot screenshot via SCScreenshotManager and push it
        // through the same encoder pipeline so the canvas paints immediately.
        if #available(macOS 14.0, *) {
            do {
                let buffer = try await SCScreenshotManager.captureSampleBuffer(
                    contentFilter: filter, configuration: config)
                output.stream(stream, didOutputSampleBuffer: buffer, of: .screen)
                log("issued initial screenshot")
            } catch {
                log("(non-fatal) initial screenshot failed: \(error.localizedDescription)")
            }
        }

        // Spin up the input reader. Touch / key / scroll commands arrive on
        // stdin as newline-delimited JSON; we map to CGEvents posted to the
        // Simulator's PID so they don't depend on Simulator.app being focused.
        //
        // CGEvent.postToPid requires Accessibility permission when targeting
        // another process. Without it, posts silently no-op. Probe up-front
        // and prompt the user to grant it if missing.
        if !AXIsProcessTrusted() {
            log("Accessibility permission not granted — popping the system prompt. " +
                "Required for keyboard events (Home / Recent toolbar buttons). " +
                "Grant the helper binary access in System Settings → Privacy & Security → " +
                "Accessibility, then quit & restart this app.")
            let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            _ = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
        } else {
            log("Accessibility permission granted")
        }

        if inputDispatchEnabled {
            log("IOSSIM_INPUT=1 — mouse/scroll dispatch ENABLED (cursor will warp to simulator window on every event)")
        } else {
            log("Mouse/scroll input is disabled by default — CGEvent injection warps the OS " +
                "cursor on every event which creates a runaway feedback loop. Set " +
                "IOSSIM_INPUT=1 to opt-in. Keyboard (Home / Recent) still works. " +
                "Real touch input is the next planned commit (SimulatorKit Indigo HID).")
        }

        if let pid = findSimulatorPid() {
            log("Simulator pid=\(pid) — input ready")
            Task {
                await readInputCommands(window: target, pid: pid)
            }
        } else {
            log("(non-fatal) couldn't find Simulator pid — input commands will be ignored")
        }

        // runAsync() returns here; the main thread keeps the process alive via
        // its own RunLoop.main.run() loop. The Active singleton retains the
        // capture stack.
    }
}
