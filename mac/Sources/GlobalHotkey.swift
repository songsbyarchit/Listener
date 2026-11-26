import Foundation
import Carbon

final class GlobalHotkey {
    private var ref: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private let callback: () -> Void
    private let keyCode: UInt32
    private let modifiers: UInt32
    private let hotKeyID = EventHotKeyID(signature: OSType(0x4C4E5452), id: 1)

    init(keyCode: UInt32, modifiers: UInt32, callback: @escaping () -> Void) {
        self.callback = callback
        self.keyCode = keyCode
        self.modifiers = modifiers
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: UInt32(kEventHotKeyPressed))
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            Unmanaged<GlobalHotkey>.fromOpaque(userData)
                .takeUnretainedValue().callback()
            return noErr
        }, 1, &eventType, selfPtr, &handlerRef)
        setEnabled(true)
    }

    func setEnabled(_ enabled: Bool) {
        if enabled, ref == nil {
            RegisterEventHotKey(keyCode, modifiers, hotKeyID,
                                GetApplicationEventTarget(), 0, &ref)
        } else if !enabled, let current = ref {
            UnregisterEventHotKey(current)
            ref = nil
        }
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let handlerRef { RemoveEventHandler(handlerRef) }
    }
}
