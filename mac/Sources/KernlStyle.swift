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
                                dark: NSColor(srgbRed: 0.067, green: 0.341, blue: 0.298, alpha: 1))
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
}

final class KernlCard: NSView {
    let content: NSView
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
        layer?.borderColor = KernlTheme.line.cgColor
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
            layer.backgroundColor = (hovering ? KernlTheme.accent.blended(withFraction: 0.08, of: .black) ?? KernlTheme.accent : KernlTheme.accent).cgColor
            layer.borderWidth = 0
        case .secondary:
            layer.backgroundColor = hovering ? KernlTheme.soft.cgColor : NSColor.clear.cgColor
            layer.borderWidth = 1
            layer.borderColor = KernlTheme.lineStrong.cgColor
        }
    }
}

func fleetButton(_ title: String, primary: Bool = false,
                 target: AnyObject?, action: Selector) -> NSButton {
    KernlButton(title, style: primary ? .primary : .secondary, target: target, action: action)
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
