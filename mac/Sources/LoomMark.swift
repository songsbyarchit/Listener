import AppKit

/// The small in-app mark. Same black tile and cream glyph as the app icon,
/// drawn small enough to sit beside a lowercase name.
enum LoomAppMark {
    case speekr
    case listnr
    case writr
    case readr
}

final class LoomMarkView: NSView {
    private let kind: LoomAppMark
    private let size: CGFloat
    private let ink = NSColor(srgbRed: 0.078, green: 0.078, blue: 0.082, alpha: 1)
    private let paper = NSColor(srgbRed: 0.969, green: 0.961, blue: 0.941, alpha: 1)
    private let orange = NSColor(srgbRed: 0.949, green: 0.333, blue: 0.2, alpha: 1)

    init(kind: LoomAppMark, size: CGFloat = 30) {
        self.kind = kind
        self.size = size
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: size).isActive = true
        heightAnchor.constraint(equalToConstant: size).isActive = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let s = min(bounds.width, bounds.height)
        guard s > 2 else { return }
        let unit = s / 30

        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> NSRect {
            NSRect(x: x * unit, y: y * unit, width: w * unit, height: h * unit)
                .insetBy(dx: 0, dy: 0)
        }
        func path(_ rect: NSRect, _ radius: CGFloat) -> NSBezierPath {
            NSBezierPath(roundedRect: rect, xRadius: radius * unit, yRadius: radius * unit)
        }

        let tile = path(NSRect(x: 0.5 * unit, y: 0.5 * unit, width: 29 * unit, height: 29 * unit), 8)
        ink.setFill()
        tile.fill()
        paper.withAlphaComponent(0.14).setStroke()
        tile.lineWidth = max(0.5, 0.6 * unit)
        tile.stroke()

        func fill(_ path: NSBezierPath, _ color: NSColor) {
            color.setFill()
            path.fill()
        }

        let letter: String
        switch kind {
        case .speekr: letter = "S"
        case .listnr: letter = "L"
        case .writr: letter = "W"
        case .readr: letter = "R"
        }
        let font = NSFont(name: "InstrumentSans-Regular_Bold", size: 17 * unit)
            ?? NSFont.systemFont(ofSize: 17 * unit, weight: .bold)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: paper
        ]
        let text = letter as NSString
        let textSize = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (s - textSize.width) / 2,
                              y: 2 * unit + max(0, (14 * unit - textSize.height) / 2)),
                  withAttributes: attributes)

        let heights: [CGFloat] = [2.2, 3.2, 4.4, 3.2, 2.2]
        let barWidth: CGFloat = 1.2
        let gap: CGFloat = 1.2
        let total = barWidth * CGFloat(heights.count) + gap * CGFloat(heights.count - 1)
        var x = (s - total) / 2
        for (index, height) in heights.enumerated() {
            let bar = NSBezierPath(roundedRect: NSRect(x: x, y: 23.2 * unit,
                                                       width: barWidth * unit,
                                                       height: height * unit),
                                   xRadius: barWidth * unit / 2,
                                   yRadius: barWidth * unit / 2)
            (index == 2 ? orange : paper).setFill()
            bar.fill()
            x += (barWidth + gap) * unit
        }
    }
}
