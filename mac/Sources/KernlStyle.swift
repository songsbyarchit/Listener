import Foundation
import AppKit

enum KernlTheme {
    private static func dynamic(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        }
    }
    static let paper = dynamic(light: NSColor(srgbRed: 0.949, green: 0.910, blue: 0.843, alpha: 1),
                               dark: NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 1))
    static let card = dynamic(light: NSColor(srgbRed: 1.0, green: 0.992, blue: 0.973, alpha: 1),
                              dark: NSColor(srgbRed: 0.114, green: 0.114, blue: 0.122, alpha: 1))
    static let soft = dynamic(light: NSColor(srgbRed: 0.910, green: 0.863, blue: 0.788, alpha: 1),
                              dark: NSColor(srgbRed: 0.161, green: 0.161, blue: 0.169, alpha: 1))
    static let ink = dynamic(light: NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 1),
                             dark: NSColor(srgbRed: 0.969, green: 0.961, blue: 0.941, alpha: 1))
    static let muted = dynamic(light: NSColor(srgbRed: 0.431, green: 0.416, blue: 0.392, alpha: 1),
                               dark: NSColor(srgbRed: 0.659, green: 0.639, blue: 0.604, alpha: 1))
    static let line = dynamic(light: NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 0.16),
                              dark: NSColor(srgbRed: 0.969, green: 0.961, blue: 0.941, alpha: 0.15))
    static let lineStrong = dynamic(light: NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 0.32),
                                    dark: NSColor(srgbRed: 0.969, green: 0.961, blue: 0.941, alpha: 0.26))
    static let accent = dynamic(light: NSColor(srgbRed: 0.067, green: 0.341, blue: 0.298, alpha: 1),
                                dark: NSColor(srgbRed: 0.545, green: 0.765, blue: 0.290, alpha: 1))
    static let blue = accent
}

final class KernlBackdrop: NSView {
    override var wantsUpdateLayer: Bool { true }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError() }
    override func updateLayer() { layer?.backgroundColor = KernlTheme.paper.cgColor }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

final class KernlHairlineView: NSView {
    override var wantsUpdateLayer: Bool { true }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
    }
    required init?(coder: NSCoder) { fatalError() }
    override func updateLayer() { layer?.backgroundColor = KernlTheme.line.cgColor }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

final class KernlCard: NSView {
    let content: NSView
    /// Set to make the whole card a button with a hover border and pointer cursor.
    var onClick: (() -> Void)? {
        didSet {
            setAccessibilityRole(onClick == nil ? .group : .button)
            window?.invalidateCursorRects(for: self)
            needsDisplay = true
        }
    }
    private var hovering = false { didSet { needsDisplay = true } }
    override var wantsUpdateLayer: Bool { true }
    init(content: NSView, padding: NSEdgeInsets = NSEdgeInsets(top: 18, left: 20, bottom: 18, right: 20)) {
        self.content = content
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.borderWidth = 1
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: topAnchor, constant: padding.top),
            content.leadingAnchor.constraint(equalTo: leadingAnchor, constant: padding.left),
            content.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -padding.right),
            content.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -padding.bottom)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    override func updateLayer() {
        layer?.backgroundColor = KernlTheme.card.cgColor
        layer?.borderColor = (hovering && onClick != nil ? KernlTheme.accent : KernlTheme.line).cgColor
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas where area.owner === self { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero,
                                       options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }
    override func resetCursorRects() {
        if onClick != nil { addCursorRect(bounds, cursor: .pointingHand) }
    }
    /// A clickable card owns every point inside it, so text and padding open it too.
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard onClick != nil else { return super.hitTest(point) }
        return frame.contains(point) ? self : nil
    }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { onClick != nil }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func mouseDown(with event: NSEvent) {
        if onClick == nil { super.mouseDown(with: event) }
    }
    override func mouseUp(with event: NSEvent) {
        guard let onClick else { return super.mouseUp(with: event) }
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onClick() }
    }
    override func accessibilityPerformPress() -> Bool {
        guard let onClick else { return false }
        onClick()
        return true
    }
}


/// A wrapping proof strip: equal tiles that fall into balanced rows when the
/// window narrows. Cards are frame-laid so the grid can reflow on resize.
final class KernlStatGrid: NSView {
    private let cards: [KernlCard]
    private let spacing: CGFloat
    private let minTileWidth: CGFloat
    private let tileHeight: CGFloat
    private var heightConstraint: NSLayoutConstraint!
    private var columns = 0
    private var rows = 0
    /// Makes every tile clickable and reports the tapped tile's index.
    var onSelect: ((Int) -> Void)? {
        didSet {
            for (index, card) in cards.enumerated() {
                card.onClick = onSelect.map { select in { select(index) } }
            }
        }
    }

    init(_ items: [(label: String, value: String, foot: String)],
         minTileWidth: CGFloat = 136, tileHeight: CGFloat = 116, spacing: CGFloat = 12,
         valueSize fixedSize: CGFloat? = nil) {
        self.spacing = spacing
        self.minTileWidth = minTileWidth
        self.tileHeight = tileHeight
        // One value size per row, set by the longest value, so the strip reads evenly.
        let count = items.map { $0.value.count }.max() ?? 0
        self.cards = items.map { item in
            let valueSize: CGFloat = fixedSize ?? (count <= 5 ? 29 : (count <= 8 ? 24 : (count <= 10 ? 19 : 17)))
            let value = fleetLabel(item.value, size: valueSize, weight: .medium, color: KernlTheme.ink, lines: 1)
            value.cell?.lineBreakMode = .byTruncatingTail
            let label = fleetLabel(item.label, size: 11, weight: .medium, color: KernlTheme.muted, lines: 1)
            let foot = fleetLabel(item.foot, size: 11, color: KernlTheme.muted, lines: 2)
            let card = KernlCard(content: fleetVStack([value, label, foot], spacing: 4),
                                 padding: NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16))
            card.translatesAutoresizingMaskIntoConstraints = true
            card.autoresizingMask = []
            return card
        }
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        for card in cards { addSubview(card) }
        heightConstraint = heightAnchor.constraint(equalToConstant: tileHeight)
        heightConstraint.isActive = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    override func layout() {
        super.layout()
        let width = bounds.width
        guard width > 0, !cards.isEmpty else { return }
        var cols = max(1, min(cards.count, Int((width + spacing) / (minTileWidth + spacing))))
        if cols > 2, cards.count % cols == 1 { cols -= 1 }
        let rowCount = Int(ceil(Double(cards.count) / Double(cols)))
        let cardWidth = max(0, (width - CGFloat(cols - 1) * spacing) / CGFloat(cols))
        for (index, card) in cards.enumerated() {
            let column = index % cols
            let row = index / cols
            card.frame = NSRect(x: CGFloat(column) * (cardWidth + spacing),
                                y: CGFloat(row) * (tileHeight + spacing),
                                width: cardWidth,
                                height: tileHeight)
        }
        if cols != columns || rowCount != rows {
            columns = cols
            rows = rowCount
            heightConstraint.constant = CGFloat(rowCount) * tileHeight + CGFloat(rowCount - 1) * spacing
        }
    }
}

func fleetLabel(_ text: String,
                size: CGFloat = 13,
                weight: Type.Weight = .regular,
                color: NSColor = KernlTheme.ink,
                lines: Int = 0) -> NSTextField {
    let field = NSTextField(wrappingLabelWithString: text)
    field.font = Type.sans(size, weight)
    field.textColor = color
    field.maximumNumberOfLines = lines
    field.isSelectable = true
    field.drawsBackground = false
    field.isBezeled = false
    field.isEditable = false
    field.translatesAutoresizingMaskIntoConstraints = false
    field.cell?.wraps = true
    field.cell?.isScrollable = false
    return field
}

func fleetTitle(_ text: String) -> NSTextField {
    let field = NSTextField(wrappingLabelWithString: text)
    field.font = Type.sans(32, .medium)
    field.textColor = KernlTheme.ink
    field.maximumNumberOfLines = 1
    field.isSelectable = false
    field.drawsBackground = false
    field.isBezeled = false
    field.isEditable = false
    field.translatesAutoresizingMaskIntoConstraints = false
    return field
}

func fleetEyebrow(_ text: String) -> NSTextField {
    let field = NSTextField(wrappingLabelWithString: text.uppercased())
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byWordWrapping
    field.attributedStringValue = NSAttributedString(
        string: text.uppercased(),
        attributes: [
            .font: Type.sans(11, .medium),
            .foregroundColor: KernlTheme.muted,
            .kern: 1.0,
            .paragraphStyle: style
        ]
    )
    field.isSelectable = false
    field.drawsBackground = false
    field.isBezeled = false
    field.isEditable = false
    field.translatesAutoresizingMaskIntoConstraints = false
    return field
}

func fleetHStack(_ views: [NSView], spacing: CGFloat = 10,
                 alignment: NSLayoutConstraint.Attribute = .centerY) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = .horizontal
    stack.alignment = alignment
    stack.spacing = spacing
    stack.translatesAutoresizingMaskIntoConstraints = false
    return stack
}

func fleetVStack(_ views: [NSView], spacing: CGFloat = 10,
                 alignment: NSLayoutConstraint.Attribute = .leading,
                 fillWidth: Bool = true) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = .vertical
    stack.alignment = alignment
    stack.spacing = spacing
    stack.translatesAutoresizingMaskIntoConstraints = false
    if fillWidth {
        for view in views {
            view.translatesAutoresizingMaskIntoConstraints = false
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
    }
    return stack
}

final class KernlButton: NSButton {
    enum Style { case primary, secondary }
    private let style: Style
    private var hovering = false { didSet { needsDisplay = true } }
    override var wantsUpdateLayer: Bool { true }
    override var state: NSControl.StateValue { didSet { needsDisplay = true } }

    init(_ title: String, style: Style = .secondary, target: AnyObject?, action: Selector?) {
        self.style = style
        super.init(frame: .zero)
        isBordered = false
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        self.target = target
        self.action = action
        heightAnchor.constraint(equalToConstant: 36).isActive = true
        attributedTitle = NSAttributedString(
            string: title,
            attributes: [
                .font: Type.sans(14, .medium),
                .foregroundColor: style == .primary ? KernlTheme.paper : KernlTheme.ink
            ]
        )
        let width = ceil((title as NSString).size(withAttributes: [.font: Type.sans(14, .medium)]).width) + 36
        widthAnchor.constraint(greaterThanOrEqualToConstant: max(64, width)).isActive = true
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layout() {
        super.layout()
        layer?.cornerRadius = bounds.height / 2
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas where area.owner === self { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero,
                                       options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func updateLayer() {
        guard let layer else { return }
        switch style {
        case .primary:
            // Filled buttons are ink, not accent: the accent stays for hover
            // outlines and small marks, so colour never shouts.
            layer.backgroundColor = (hovering ? KernlTheme.ink.withAlphaComponent(0.86) : KernlTheme.ink).cgColor
            layer.borderWidth = 0
        case .secondary:
            let selected = state == .on
            layer.backgroundColor = (hovering || selected) ? KernlTheme.soft.cgColor : NSColor.clear.cgColor
            layer.borderWidth = 1
            layer.borderColor = (selected ? KernlTheme.ink : KernlTheme.lineStrong).cgColor
        }
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

func fleetButton(_ title: String, primary: Bool = false,
                 target: AnyObject?, action: Selector) -> NSButton {
    KernlButton(title, style: primary ? .primary : .secondary, target: target, action: action)
}

/// A quiet "‹ Back" link for detail pages. Esc goes back too.
final class KernlBackButton: NSButton {
    private var hovering = false { didSet { refresh() } }
    init(target: AnyObject?, action: Selector) {
        super.init(frame: .zero)
        self.target = target
        self.action = action
        isBordered = false
        bezelStyle = .regularSquare
        imagePosition = .imageLeading
        imageHugsTitle = true
        image = NSImage(systemSymbolName: "chevron.left", accessibilityDescription: "Back")?
            .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold))
        keyEquivalent = "\u{1b}"
        setAccessibilityLabel("Back")
        translatesAutoresizingMaskIntoConstraints = false
        refresh()
    }
    required init?(coder: NSCoder) { fatalError() }
    private func refresh() {
        let color = hovering ? KernlTheme.ink : KernlTheme.muted
        contentTintColor = color
        attributedTitle = NSAttributedString(string: " Back", attributes: [
            .font: Type.sans(13, .medium), .foregroundColor: color
        ])
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); refresh() }
}

func fleetSwitch(isOn: Bool, target: AnyObject?, action: Selector) -> NSSwitch {
    let toggle = NSSwitch()
    toggle.state = isOn ? .on : .off
    toggle.target = target
    toggle.action = action
    toggle.translatesAutoresizingMaskIntoConstraints = false
    return toggle
}

func fleetTextScroll(editable: Bool) -> (NSScrollView, NSTextView) {
    let scroll = NSScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    scroll.drawsBackground = false
    scroll.borderType = .noBorder
    let text = NSTextView()
    text.isEditable = editable
    text.isSelectable = true
    text.drawsBackground = false
    text.font = Type.sans(15)
    text.textColor = KernlTheme.ink
    text.textContainerInset = NSSize(width: 2, height: 8)
    text.isRichText = false
    text.autoresizingMask = [.width]
    text.isVerticallyResizable = true
    text.isHorizontallyResizable = false
    text.textContainer?.widthTracksTextView = true
    scroll.documentView = text
    return (scroll, text)
}

func fleetGap(_ height: CGFloat) -> NSView {
    let view = NSView()
    view.translatesAutoresizingMaskIntoConstraints = false
    view.heightAnchor.constraint(equalToConstant: height).isActive = true
    return view
}

func fleetSpacer() -> NSView {
    let view = NSView()
    view.translatesAutoresizingMaskIntoConstraints = false
    view.setContentHuggingPriority(.defaultLow, for: .horizontal)
    view.setContentHuggingPriority(.defaultLow, for: .vertical)
    return view
}


final class KernlPanelCard: NSView {
    override var wantsUpdateLayer: Bool { true }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.borderWidth = 1
    }
    required init?(coder: NSCoder) { fatalError() }
    override func updateLayer() {
        layer?.backgroundColor = KernlTheme.card.cgColor
        layer?.borderColor = KernlTheme.line.cgColor
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

final class KernlBubbleView: NSView {
    let label: NSTextField
    override var wantsUpdateLayer: Bool { true }
    init(label: NSTextField) {
        self.label = label
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 14
        translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
    override func updateLayer() {
        layer?.backgroundColor = KernlTheme.soft.cgColor
    }
}

/// One window size for every Kernl app. Each home window opens at the same
/// size, centred on the screen in use, and page content stops widening at a
/// readable measure so a very wide window adds margin instead of stretching.
enum KernlWindowSize {
    static let standard = NSSize(width: 1040, height: 720)
    static let minimum = NSSize(width: 860, height: 600)
    static let readableWidth: CGFloat = 960

    static func reset(_ window: NSWindow) {
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? window.screen ?? NSScreen.main
        guard let visible = screen?.visibleFrame else { window.center(); return }
        let content = NSSize(width: min(standard.width, visible.width - 48),
                             height: min(standard.height, visible.height - 48))
        var frame = window.frameRect(forContentRect: NSRect(origin: .zero, size: content))
        frame.origin = NSPoint(x: visible.midX - frame.width / 2, y: visible.midY - frame.height / 2)
        window.setFrame(frame, display: true)
    }

    /// Fills the window up to the readable width, then holds that width.
    static func limitReadableWidth(_ content: NSView, in root: NSView) {
        let fill = content.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -32)
        fill.priority = .defaultHigh
        NSLayoutConstraint.activate([
            fill,
            content.widthAnchor.constraint(lessThanOrEqualToConstant: readableWidth)
        ])
    }
}

/// The small pill left behind when a quick window tucks itself away. One
/// click brings the window back; untouched, it leaves after a few seconds.
final class KernlRestorePill {
    var onRestore: (() -> Void)?
    private let panel: NSPanel
    private var hideWork: DispatchWorkItem?

    init(title: String) {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 96, height: 36),
                        styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        let card = KernlPanelCard()
        card.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView = card
        let button = NSButton(title: title, target: nil, action: nil)
        button.isBordered = false
        button.image = NSImage(systemSymbolName: "arrow.uturn.backward", accessibilityDescription: nil)
        button.imagePosition = .imageLeading
        button.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: Type.sans(13, .medium), .foregroundColor: KernlTheme.ink
        ])
        button.contentTintColor = KernlTheme.accent
        button.translatesAutoresizingMaskIntoConstraints = false
        button.target = self
        button.action = #selector(restore)
        card.addSubview(button)
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: card.centerYAnchor)
        ])
    }

    /// Shows the pill at the bottom-right corner of where the window was.
    func show(near frame: NSRect, seconds: Double = 6) {
        panel.setFrameOrigin(NSPoint(x: frame.maxX - panel.frame.width, y: frame.minY))
        panel.orderFrontRegardless()
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.panel.orderOut(nil) }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func hide() {
        hideWork?.cancel()
        panel.orderOut(nil)
    }

    @objc private func restore() {
        hide()
        onRestore?()
    }
}

/// Places a quick window in the bottom-right corner without covering another
/// Kernl app's floating window, so listnr, readr and writr can be open at once.
enum KernlPlacement {
    static let suiteOwners: Set<String> = ["listnr", "readr", "writr", "Readr", "Writr", "Listnr", "Speakr", "speakr"]

    /// Frames of other suite apps' floating windows on screen, in AppKit coordinates.
    static func otherSuiteFrames(on screen: NSScreen) -> [NSRect] {
        let me = ProcessInfo.processInfo.processIdentifier
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let primaryHeight = NSScreen.screens.first?.frame.height ?? screen.frame.height
        return list.compactMap { info in
            guard let owner = info[kCGWindowOwnerName as String] as? String, suiteOwners.contains(owner),
                  (info[kCGWindowOwnerPID as String] as? Int32) != me,
                  (info[kCGWindowLayer as String] as? Int ?? 0) > 0,
                  let bounds = info[kCGWindowBounds as String] as? [String: CGFloat],
                  let width = bounds["Width"], let height = bounds["Height"], width > 60, height > 30 else { return nil }
            // Quartz has its origin at the top left; AppKit at the bottom left.
            let rect = NSRect(x: bounds["X"] ?? 0, y: primaryHeight - (bounds["Y"] ?? 0) - height, width: width, height: height)
            return rect.intersects(screen.frame) ? rect : nil
        }
    }

    /// The bottom-right spot for `size`, moved left (or up) past other suite windows.
    static func cornerOrigin(for size: NSSize, on screen: NSScreen, margin: CGFloat = 20) -> NSPoint {
        let visible = screen.visibleFrame
        var frame = NSRect(x: visible.maxX - size.width - margin, y: visible.minY + margin,
                           width: size.width, height: size.height)
        let others = otherSuiteFrames(on: screen)
        for _ in 0..<4 {
            guard let blocker = others.first(where: { $0.insetBy(dx: -6, dy: -6).intersects(frame) }) else { break }
            let left = blocker.minX - size.width - 12
            if left >= visible.minX + margin {
                frame.origin.x = left
            } else {
                frame.origin = NSPoint(x: visible.maxX - size.width - margin, y: blocker.maxY + 12)
            }
        }
        frame.origin.y = min(frame.origin.y, visible.maxY - size.height - margin)
        return frame.origin
    }
}

/// A quiet "Closing in 3s" at the bottom of a quick window, with a thin line
/// that drains to nothing as the window is about to leave. Any interaction
/// cancels it.
final class KernlCountdown: NSView {
    private let label = NSTextField(labelWithString: "")
    private let line = CALayer()
    private var timer: Timer?
    private var endsAt = Date()
    private var duration: Double = 1

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        label.font = Type.sans(11)
        label.textColor = KernlTheme.muted
        label.alignment = .right
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        layer?.addSublayer(line)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 18),
            label.trailingAnchor.constraint(equalTo: trailingAnchor),
            label.topAnchor.constraint(equalTo: topAnchor)
        ])
        isHidden = true
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError() }

    func start(seconds: Double) {
        timer?.invalidate()
        duration = max(0.5, seconds)
        endsAt = Date().addingTimeInterval(duration)
        isHidden = false
        tick()
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func cancel() {
        timer?.invalidate()
        timer = nil
        isHidden = true
    }

    private func tick() {
        let remaining = max(0, endsAt.timeIntervalSinceNow)
        label.stringValue = "Closing in \(Int(remaining.rounded(.up)))s"
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        line.backgroundColor = KernlTheme.accent.withAlphaComponent(0.55).cgColor
        line.frame = CGRect(x: 0, y: 0, width: bounds.width * CGFloat(remaining / duration), height: 2)
        CATransaction.commit()
        if remaining <= 0 { timer?.invalidate() }
    }

    override func layout() {
        super.layout()
        tick()
    }
}

/// Remembers the prompts typed into a quick window, most recent first, with
/// how often each is used. Stored as JSON in the app's own folder.
final class KernlPromptHistory {
    struct Entry: Codable { var text: String; var count: Int; var last: Date }
    private let url: URL
    private(set) var entries: [Entry] = []

    init(url: URL) {
        self.url = url
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: url), let saved = try? decoder.decode([Entry].self, from: data) {
            entries = saved
        }
    }

    func record(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if let index = entries.firstIndex(where: { $0.text.caseInsensitiveCompare(text) == .orderedSame }) {
            var entry = entries.remove(at: index)
            entry.count += 1
            entry.last = Date()
            entry.text = text
            entries.insert(entry, at: 0)
        } else {
            entries.insert(Entry(text: text, count: 1, last: Date()), at: 0)
        }
        if entries.count > 200 { entries.removeLast(entries.count - 200) }
        save()
    }

    /// The most recent earlier prompt that starts with what has been typed.
    func completion(for typed: String) -> String? {
        let prefix = typed.lowercased()
        guard !prefix.isEmpty else { return nil }
        return entries.first { $0.text.lowercased().hasPrefix(prefix) && $0.text.count > typed.count }?.text
    }

    /// The custom prompt used most, once it has been used at least `minimum` times.
    func favourite(minimum: Int = 3, excluding: Set<String> = []) -> String? {
        entries.filter { $0.count >= minimum && !excluding.contains($0.text.lowercased()) }
            .max { $0.count == $1.count ? $0.last < $1.last : $0.count < $1.count }?.text
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted]
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? encoder.encode(entries) { try? data.write(to: url, options: .atomic) }
    }
}

/// A one-line prompt box with inline history. As you type, the rest of an
/// earlier prompt appears selected; the right arrow keeps it, typing replaces
/// it. Return sends, Escape clears. There is no dropdown.
final class KernlPromptField: NSTextField, NSTextFieldDelegate {
    var history: KernlPromptHistory?
    var onSubmit: ((String) -> Void)?
    private var lastTypedLength = 0

    init(placeholder: String) {
        super.init(frame: .zero)
        placeholderString = placeholder
        font = Type.sans(13)
        isBezeled = true
        bezelStyle = .roundedBezel
        focusRingType = .default
        translatesAutoresizingMaskIntoConstraints = false
        delegate = self
        heightAnchor.constraint(greaterThanOrEqualToConstant: 30).isActive = true
        setAccessibilityLabel(placeholder)
    }

    required init?(coder: NSCoder) { fatalError() }

    func controlTextDidChange(_ notification: Notification) {
        guard let editor = currentEditor() else { return }
        let typed = stringValue
        let selection = editor.selectedRange
        // Only complete while typing forwards at the end, never on delete.
        defer { lastTypedLength = typed.count }
        guard typed.count > lastTypedLength, selection.location == (typed as NSString).length,
              let full = history?.completion(for: typed) else { return }
        let typedLength = (typed as NSString).length
        stringValue = typed + String(full.dropFirst(typed.count))
        editor.selectedRange = NSRange(location: typedLength, length: (stringValue as NSString).length - typedLength)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            let text = stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return true }
            history?.record(text)
            onSubmit?(text)
            stringValue = ""
            lastTypedLength = 0
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            stringValue = ""
            lastTypedLength = 0
            return true
        default:
            return false
        }
    }
}


/// Closes a popup after a quiet spell: a countdown runs for the last few
/// seconds, then the popup hides and an Undo pill can bring it back. Any click,
/// scroll or key inside the popup restarts the wait, whether or not it lands on
/// a button, and the popup never closes while the pointer is over it.
final class KernlIdleDismiss {
    var idleSeconds: Double
    var countdownSeconds: Double
    var undoSeconds: Double
    var undoEnabled = true
    var enabled = true
    /// Extra reasons to wait, such as a field being typed in.
    var isHeld: () -> Bool = { false }
    var onHide: (() -> Void)?
    var onRestore: (() -> Void)?

    private weak var window: NSWindow?
    private let countdown: KernlCountdown
    private var warnWork: DispatchWorkItem?
    private var closeWork: DispatchWorkItem?
    private var monitor: Any?
    private var hoverTimer: Timer?
    private var hovering = false
    private lazy var pill: KernlRestorePill = {
        let pill = KernlRestorePill(title: "Undo")
        pill.onRestore = { [weak self] in
            guard let self else { return }
            self.window?.orderFrontRegardless()
            self.onRestore?()
            self.arm()
        }
        return pill
    }()

    init(window: NSWindow, countdown: KernlCountdown, idle: Double, countdown last: Double, undo: Double = 3) {
        self.window = window
        self.countdown = countdown
        self.idleSeconds = idle
        self.countdownSeconds = last
        self.undoSeconds = undo
        monitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .keyDown]
        ) { [weak self] event in
            if let self, event.window === self.window, self.isArmed { self.arm() }
            return event
        }
    }

    deinit { if let monitor { NSEvent.removeMonitor(monitor) } }

    private(set) var isArmed = false

    /// Starts, or restarts, the wait. Hovering over the popup counts as using
    /// it: the wait stops while the pointer is inside and starts again, from
    /// the top, when it leaves.
    func arm() {
        cancel()
        guard enabled, let window, window.isVisible else { return }
        isArmed = true
        watchHover()
        hovering = window.frame.contains(NSEvent.mouseLocation)
        if hovering { return }
        let warn = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.countdown.start(seconds: self.countdownSeconds)
        }
        warnWork = warn
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, idleSeconds - countdownSeconds), execute: warn)
        let close = DispatchWorkItem { [weak self] in self?.closeNow() }
        closeWork = close
        DispatchQueue.main.asyncAfter(deadline: .now() + idleSeconds, execute: close)
    }

    private func watchHover() {
        guard hoverTimer == nil else { return }
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self, let window = self.window else { return }
            guard self.isArmed, window.isVisible else { self.stopWatchingHover(); return }
            let inside = window.frame.contains(NSEvent.mouseLocation)
            if inside == self.hovering { return }
            self.hovering = inside
            if inside { self.pause() } else { self.arm() }
        }
        RunLoop.main.add(timer, forMode: .common)
        hoverTimer = timer
    }

    private func stopWatchingHover() {
        hoverTimer?.invalidate()
        hoverTimer = nil
    }

    /// Holds the wait while the pointer is over the popup.
    private func pause() {
        warnWork?.cancel()
        closeWork?.cancel()
        countdown.cancel()
    }

    /// Stops the wait, for example while the popup is busy.
    func cancel() {
        stopWatchingHover()
        isArmed = false
        warnWork?.cancel()
        closeWork?.cancel()
        countdown.cancel()
    }

    func hideUndo() { pill.hide() }

    private func closeNow() {
        guard let window else { return }
        if isHeld() || window.frame.contains(NSEvent.mouseLocation) {
            arm()
            return
        }
        cancel()
        let frame = window.frame
        window.orderOut(nil)
        onHide?()
        if undoEnabled { pill.show(near: frame, seconds: undoSeconds) }
    }
}
