import Foundation
import AppKit
import ApplicationServices
import Carbon

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotkey: GlobalHotkey?
    private var speaker: Speaker!
    private var hud: PlayerHUD!
    private var homeWindow: ListnrHomeWindowController!
    private var lastText = ""
    private var appearanceItems: [NSMenuItem] = []
    private var pauseItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        FontRegistrar.register()
        applyStoredAppearance()
        if !AXIsProcessTrusted() {
            _ = AXIsProcessTrustedWithOptions(
                [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            )
        }

        speaker = Speaker()
        homeWindow = ListnrHomeWindowController()
        homeWindow.onRead = { [weak self] in self?.readSelection() }
        homeWindow.onReadClipboard = { [weak self] in self?.readClipboard() }
        homeWindow.onClose = { [weak self] in
            NSApp.setActivationPolicy(.accessory)
            self?.statusItem.button?.image = MenuBarMark.image
            self?.statusItem.button?.image?.isTemplate = true
        }
        hud = PlayerHUD()
        hud.onPause = { [weak self] in self?.speaker.togglePause() }
        hud.onStop = { [weak self] in self?.speaker.stop() }
        hud.progressProvider = { [weak self] in self?.speaker.progress }
        hud.onSpeed = { [weak self] in self?.speaker.cycleRate() ?? 1 }
        hud.speedProvider = { [weak self] in self?.speaker.rate ?? 1 }
        hud.onSettings = { [weak self] in self?.openSettings() }
        hud.onMute = { [weak self] in
            guard let self else { return false }
            self.speaker.muted.toggle()
            return self.speaker.muted
        }
        speaker.onState = { [weak self] state in
            guard let self else { return }
            self.pauseItem.title = state == .paused ? "Continue" : "Pause"
            self.hud.update(state, text: self.lastText)
        }

        hotkey = GlobalHotkey(keyCode: 37, modifiers: UInt32(optionKey)) { [weak self] in
            self?.readSelection()
        }
        updateHotkeyForFrontmost()
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.updateHotkeyForFrontmost()
        }
        buildStatusItem()
        applyStoredAppearance()
        KernlAppearance.observe { [weak self] in
            self?.applyStoredAppearance()
        }
        NSApp.setActivationPolicy(.accessory)

        if CommandLine.arguments.contains("--settings") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.homeWindow.showSettings()
            }
        } else if CommandLine.arguments.contains("--test-voice") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.testVoice() }
        } else if CommandLine.arguments.contains("--open-main") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.openWindow()
            }
        }
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = MenuBarMark.image
        statusItem.button?.image?.isTemplate = true
        statusItem.button?.toolTip = "listnr — read selected text"

        let menu = NSMenu()
        menu.addItem(item("Open listnr", #selector(openWindow)))
        menu.addItem(item("Settings…", #selector(openSettings)))
        menu.addItem(item("Read selection  ⌥L", #selector(readSelection)))
        menu.addItem(item("Read clipboard", #selector(readClipboard)))
        pauseItem = item("Pause", #selector(togglePause))
        menu.addItem(pauseItem)
        menu.addItem(item("Stop", #selector(stop)))
        menu.addItem(.separator())

        let appearance = NSMenuItem(title: "Appearance", action: nil, keyEquivalent: "")
        let appearanceMenu = NSMenu(title: "Appearance")
        for (index, title) in ["System", "Light", "Dark"].enumerated() {
            let entry = NSMenuItem(title: title, action: #selector(setAppearance(_:)), keyEquivalent: "")
            entry.tag = index
            entry.target = self
            appearanceItems.append(entry)
            appearanceMenu.addItem(entry)
        }
        appearance.submenu = appearanceMenu
        menu.addItem(appearance)

        let loom = NSMenu(title: "Kernl")
        loom.addItem(item("Open Kernl folder", #selector(openKernlFolder)))
        loom.addItem(item("Open Chrome extension folder", #selector(openExtensionFolder)))
        let loomItem = NSMenuItem(title: "Kernl", action: nil, keyEquivalent: "")
        loomItem.submenu = loom
        menu.addItem(loomItem)
        menu.addItem(.separator())
        menu.addItem(item("Quit listnr", #selector(quit)))
        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    private func updateHotkeyForFrontmost() {
        // Chrome owns Option L for the extension. Remove the desktop hotkey
        // there so the two readers cannot consume the same keystroke.
        let chrome = NSWorkspace.shared.frontmostApplication?.bundleIdentifier?
            .lowercased().contains("chrome") ?? false
        hotkey?.setEnabled(!chrome)
    }

    @objc private func readSelection() {
        // ⌥L while reading stops it, like a play/stop key.
        if speaker.isActive {
            speaker.stop()
            return
        }
        if let selected = SelectionReader.selectedText(), !selected.isEmpty {
            speak(selected, source: "selection")
            return
        }
        guard AXIsProcessTrusted() else {
            hud.showError("Grant Accessibility to listnr, then try again.")
            return
        }
        guard let text = SelectionReader.fallbackText(), !text.isEmpty else {
            hud.showError("No readable text is visible.")
            return
        }
        speak(text, source: "screen")
    }

    // MARK: Follow the selection

    private var selectionTimer: Timer?
    /// The selection that was on screen when this read started.
    private var followedSelection = ""

    /// While reading, highlighting different text switches the player to it,
    /// so listnr reads what you are looking at now, not what it started with.
    private func startFollowingSelection() {
        selectionTimer?.invalidate()
        let timer = Timer(timeInterval: 0.8, repeats: true) { [weak self] _ in self?.checkSelection() }
        RunLoop.main.add(timer, forMode: .common)
        selectionTimer = timer
    }

    private func checkSelection() {
        guard speaker.isActive else {
            selectionTimer?.invalidate()
            return
        }
        guard let selected = SelectionReader.selectedText()?.trimmingCharacters(in: .whitespacesAndNewlines),
              selected.count >= 3,
              selected != followedSelection.trimmingCharacters(in: .whitespacesAndNewlines),
              selected != lastText.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        speak(selected, source: "selection")
    }

    /// Reads a fixed sample line, so a voice can be heard before reading real text.
    @objc func testVoice() {
        if speaker.isActive { speaker.stop() }
        speak("This is listnr reading in your chosen voice. It highlights each word as it goes, and you can change the speed at any time.",
              source: "test")
    }

    @objc private func readClipboard() {
        guard let text = NSPasteboard.general.string(forType: .string),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            hud.showError("The clipboard is empty.")
            return
        }
        speak(text, source: "clipboard")
    }

    private func speak(_ text: String, source: String = "selection") {
        lastText = text
        followedSelection = SelectionReader.selectedText() ?? ""
        startFollowingSelection()
        ReadStore.shared.add(text: text, source: source,
                             voice: ListnrVoiceCatalog.shared.currentVoice()?.id)
        hud.show(text: text, status: "reading")
        speaker.speak(text)
    }

    /// Opening listnr again (from Kernl, Finder or Spotlight) raises its window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openWindow()
        return true
    }

    @objc private func openWindow() {
        homeWindow.show()
        statusItem.button?.image = MenuBarMark.image
        statusItem.button?.image?.isTemplate = true
    }

    @objc private func openSettings() {
        homeWindow.showSettings()
    }

    @objc private func togglePause() { speaker.togglePause() }
    @objc private func stop() { speaker.stop() }

    private func applyStoredAppearance() {
        let value = KernlAppearance.value()
        KernlAppearance.apply(value)
        for (index, item) in appearanceItems.enumerated() {
            item.state = ["system", "light", "dark"][index] == value ? .on : .off
        }
    }

    @objc private func setAppearance(_ sender: NSMenuItem) {
        let value = ["system", "light", "dark"][max(0, min(sender.tag, 2))]
        KernlAppearance.set(value)
        applyStoredAppearance()
    }

    @objc private func openKernlFolder() {
        NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".fleet", isDirectory: true))
    }

    @objc private func openExtensionFolder() {
        let root = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        NSWorkspace.shared.open(root)
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
