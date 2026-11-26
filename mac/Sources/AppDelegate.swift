import Foundation
import AppKit
import ApplicationServices
import Carbon

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotkey: GlobalHotkey?
    private var speaker: Speaker!
    private var hud: PlayerHUD!
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
        buildStatusItem()
        applyStoredAppearance()
        NSApp.setActivationPolicy(.accessory)
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "speaker.wave.2", accessibilityDescription: "listnr")
        statusItem.button?.image?.isTemplate = true
        statusItem.button?.toolTip = "listnr — read selected text"

        let menu = NSMenu()
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

        let loom = NSMenu(title: "Loom")
        loom.addItem(item("Open Loom folder", #selector(openLoomFolder)))
        loom.addItem(item("Open Chrome extension folder", #selector(openExtensionFolder)))
        let loomItem = NSMenuItem(title: "Loom", action: nil, keyEquivalent: "")
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
        speak(text)
    }

    private func speak(_ text: String) {
        lastText = text
        hud.show(text: text, status: "reading")
        speaker.speak(text)
    }

    @objc private func togglePause() { speaker.togglePause() }
    @objc private func stop() { speaker.stop() }

    private func applyStoredAppearance() {
        let stored = UserDefaults.standard.string(forKey: "loom.appearance") ?? "system"
        applyAppearance(stored)
    }

    private func applyAppearance(_ value: String) {
        switch value {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
        for (index, item) in appearanceItems.enumerated() {
            item.state = ["system", "light", "dark"][index] == value ? .on : .off
        }
    }

    @objc private func setAppearance(_ sender: NSMenuItem) {
        let value = ["system", "light", "dark"][max(0, min(sender.tag, 2))]
        UserDefaults.standard.set(value, forKey: "loom.appearance")
        applyAppearance(value)
    }

    @objc private func openLoomFolder() {
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
