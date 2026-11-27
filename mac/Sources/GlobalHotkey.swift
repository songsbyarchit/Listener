import Foundation
import CoreGraphics
import Carbon

/// A session-level key tap. Carbon hotkeys are usually enough, but some text
/// fields consume Option+W/R/L before the hotkey fires. A consuming CGEventTap
/// makes the shortcut win and stops the accented character being typed.
final class GlobalHotkey {
    private let keyCode: UInt32
    private let carbonModifiers: UInt32
    private let callback: () -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var carbonRef: EventHotKeyRef?
    private var carbonHandler: EventHandlerRef?
    private var enabled = true
    private static var nextID: UInt32 = 1
    fileprivate let carbonID: UInt32 = { defer { GlobalHotkey.nextID += 1 }; return GlobalHotkey.nextID }()

    init(keyCode: UInt32, modifiers: UInt32, callback: @escaping () -> Void) {
        self.keyCode = keyCode
        self.carbonModifiers = modifiers
        self.callback = callback
        installTap()
    }

    private func installTap() {
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let userInfo = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: { _, type, event, refcon in
                guard let refcon else { return Unmanaged.passUnretained(event) }
                let hotkey = Unmanaged<GlobalHotkey>.fromOpaque(refcon).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let tap = hotkey.tap { CGEvent.tapEnable(tap: tap, enable: true) }
                    return Unmanaged.passUnretained(event)
                }
                guard type == .keyDown else { return Unmanaged.passUnretained(event) }
                if hotkey.matches(event) {
                    hotkey.callback()
                    return nil
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: userInfo
        ) else {
            installCarbonFallback()
            return
        }
        self.tap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        self.source = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func matches(_ event: CGEvent) -> Bool {
        guard enabled else { return false }
        guard event.getIntegerValueField(.keyboardEventKeycode) == Int64(keyCode) else { return false }
        let flags = event.flags
        guard flags.contains(.maskAlternate) else { return false }
        guard !flags.contains(.maskCommand), !flags.contains(.maskControl) else { return false }
        // ⌥L and ⌥⇧L are different shortcuts, so Shift has to match exactly.
        let wantsShift = carbonModifiers & UInt32(shiftKey) != 0
        guard flags.contains(.maskShift) == wantsShift else { return false }
        return true
    }

    func setEnabled(_ enabled: Bool) {
        self.enabled = enabled
        if let tap { CGEvent.tapEnable(tap: tap, enable: enabled) }
        if let carbonRef {
            if enabled {
                // The event tap is the primary path. Carbon is only a fallback.
            } else {
                UnregisterEventHotKey(carbonRef)
                self.carbonRef = nil
            }
        } else if enabled && tap == nil {
            installCarbonFallback()
        }
    }

    private func installCarbonFallback() {
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: UInt32(kEventHotKeyPressed))
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let userData, let event else { return noErr }
            let hotkey = Unmanaged<GlobalHotkey>.fromOpaque(userData).takeUnretainedValue()
            // Every registered hotkey reaches every handler; only answer our own.
            var pressed = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &pressed)
            guard pressed.id == hotkey.carbonID else { return OSStatus(eventNotHandledErr) }
            hotkey.callback()
            return noErr
        }, 1, &eventType, selfPtr, &carbonHandler)
        let hotKeyID = EventHotKeyID(signature: OSType(0x4B524E4C), id: carbonID)
        RegisterEventHotKey(keyCode, carbonModifiers, hotKeyID,
                            GetApplicationEventTarget(), 0, &carbonRef)
    }

    deinit {
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
        }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let carbonRef { UnregisterEventHotKey(carbonRef) }
        if let carbonHandler { RemoveEventHandler(carbonHandler) }
    }
}
