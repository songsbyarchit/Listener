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
            self?.statusItem.button?.image = NSImage(systemSymbolName: "speaker.wave.2", accessibilityDescription: "listnr")
            self?.statusItem.button?.image?.isTemplate = true
        }
        hud = PlayerHUD()
        hud.onPause = { [weak self] in self?.speaker.togglePause() }
        hud.onStop = { [weak self] in self?.speaker.stop() }
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
        } else if CommandLine.arguments.contains("--open-main") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.openWindow()
            }
        }
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "speaker.wave.2", accessibilityDescription: "listnr")
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
        guard let text = SelectionReader.selectedText() else {
            if !AXIsProcessTrusted() {
                hud.showError("Grant Accessibility to listnr, then try again.")
            } else {
                hud.showError("Select some text first.")
            }
            return
        }
        speak(text)
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
        ReadStore.shared.add(text: text, source: source)
        hud.show(text: text, status: "reading")
        speaker.speak(text)
    }

    @objc private func openWindow() {
        homeWindow.show()
        statusItem.button?.image = NSImage(systemSymbolName: "speaker.wave.2.fill", accessibilityDescription: "listnr")
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
