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

        switch kind {
        case .speekr:
            let bubble = path(rect(6, 6, 18, 15, 5), 5)
            fill(bubble, paper)
            let tail = NSBezierPath()
            tail.move(to: NSPoint(x: 9 * unit, y: 10 * unit))
            tail.line(to: NSPoint(x: 8 * unit, y: 4.5 * unit))
            tail.line(to: NSPoint(x: 13 * unit, y: 9 * unit))
            tail.close()
            fill(tail, paper)
            for (i, h) in [4, 8, 10, 8, 4].enumerated() {
                let x = 9.5 + CGFloat(i) * 2.8
                let bar = path(rect(x, 13.5 - CGFloat(h) / 2, 1.5, CGFloat(h), 0.75), 0.75)
                fill(bar, ink)
            }

        case .writr:
            let page = path(rect(7, 4, 16, 22, 3), 3)
            fill(page, paper)
            let fold = NSBezierPath()
            fold.move(to: NSPoint(x: 23 * unit, y: 4 * unit))
            fold.line(to: NSPoint(x: 18 * unit, y: 4 * unit))
            fold.line(to: NSPoint(x: 23 * unit, y: 9 * unit))
            fold.close()
            fill(fold, ink)
            for y in [10.5, 14.5, 18.5] as [CGFloat] {
                fill(path(rect(10, y, 9, 1.4, 0.7), 0.7), ink)
            }
            fill(path(rect(10, 22.4, 5, 1.4, 0.7), 0.7), ink)

        case .readr:
            let left = NSBezierPath()
            left.move(to: NSPoint(x: 15 * unit, y: 8 * unit))
            left.line(to: NSPoint(x: 6 * unit, y: 6 * unit))
            left.line(to: NSPoint(x: 6 * unit, y: 21 * unit))
            left.line(to: NSPoint(x: 15 * unit, y: 24 * unit))
            left.close()
            fill(left, paper)
            let right = NSBezierPath()
            right.move(to: NSPoint(x: 15 * unit, y: 8 * unit))
            right.line(to: NSPoint(x: 24 * unit, y: 6 * unit))
            right.line(to: NSPoint(x: 24 * unit, y: 21 * unit))
            right.line(to: NSPoint(x: 15 * unit, y: 24 * unit))
            right.close()
            fill(right, paper)
            fill(path(rect(14.5, 7.5, 1.2, 17, 0.6), 0.6), ink)
            for y in [11, 15, 19] as [CGFloat] {
                fill(path(rect(8, y, 5, 1.2, 0.6), 0.6), ink)
                fill(path(rect(17, y, 5, 1.2, 0.6), 0.6), ink)
            }

        case .listnr:
            let page = path(rect(7, 4, 16, 22, 3), 3)
            fill(page, paper)
            for y in [9, 13, 17] as [CGFloat] {
                fill(path(rect(10, y, 9, 1.4, 0.7), 0.7), ink)
            }
            let play = NSBezierPath()
            play.move(to: NSPoint(x: 12 * unit, y: 18.5 * unit))
            play.line(to: NSPoint(x: 12 * unit, y: 24.5 * unit))
            play.line(to: NSPoint(x: 19 * unit, y: 21.5 * unit))
            play.close()
            fill(play, ink)
        }
    }
}
