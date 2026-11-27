import AppKit

// Shared pages for every Kernl app: History, Profile and FAQ, plus the log of
// questions asked. Each app shows its own data; Kernl shows all four together.
// The same file is copied into writr, readr and listnr, like KernlStyle.

// MARK: Apps

enum KernlSuiteApp: String, CaseIterable {
    case speakr, writr, readr, listnr

    var title: String { rawValue }

    /// Each app's bright logo tone. Only for a view about that one app: combined
    /// views are black and white, with never more than one accent on screen.
    var tint: NSColor {
        switch self {
        case .speakr: return NSColor(srgbRed: 0.910, green: 0.365, blue: 0.541, alpha: 1)
        case .writr: return NSColor(srgbRed: 0.125, green: 0.718, blue: 0.745, alpha: 1)
        case .readr: return NSColor(srgbRed: 0.953, green: 0.447, blue: 0.078, alpha: 1)
        case .listnr: return NSColor(srgbRed: 0.545, green: 0.765, blue: 0.290, alpha: 1)
        }
    }

    var verb: String {
        switch self {
        case .speakr: return "dictated"
        case .writr: return "drafted"
        case .readr: return "explained"
        case .listnr: return "listened to"
        }
    }
}

// MARK: Data

struct KernlHistoryItem {
    let app: KernlSuiteApp
    let date: Date
    let text: String
    /// Where it happened: the app, site or kind of message.
    let place: String
    let seconds: Double
    let cost: Double

    var words: Int { text.split(whereSeparator: { $0.isWhitespace }).count }
}

enum KernlSuiteData {
    private static let home = FileManager.default.homeDirectoryForCurrentUser

    private static func rows(_ path: String) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: home.appendingPathComponent(path)),
              let object = try? JSONSerialization.jsonObject(with: data) else { return [] }
        if let list = object as? [[String: Any]] { return list }
        if let dict = object as? [String: Any], let list = dict["sessions"] as? [[String: Any]] { return list }
        return []
    }

    private static let iso: ISO8601DateFormatter = ISO8601DateFormatter()
    private static let isoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func date(_ value: Any?) -> Date? {
        if let text = value as? String { return iso.date(from: text) ?? isoFraction.date(from: text) }
        if let number = value as? Double { return Date(timeIntervalSinceReferenceDate: number) }
        return nil
    }

    static func items(for app: KernlSuiteApp) -> [KernlHistoryItem] {
        switch app {
        case .speakr:
            return rows(".speakr/usage.json").compactMap { row in
                guard let when = date(row["timestamp"]) else { return nil }
                let text = (row["editedTranscript"] as? String) ?? (row["transcript"] as? String) ?? ""
                let place = (row["appName"] as? String) ?? (row["context"] as? String) ?? ""
                let cost = ((row["asrCostUSD"] as? Double) ?? 0) + ((row["cleanupCostUSD"] as? Double) ?? 0)
                return KernlHistoryItem(app: .speakr, date: when, text: text, place: place,
                                        seconds: (row["audioSeconds"] as? Double) ?? 0, cost: cost)
            }
        case .writr:
            return rows(".writr/drafts.json").compactMap { row in
                guard let when = date(row["date"]) else { return nil }
                let text = row["text"] as? String ?? ""
                let place = [row["medium"] as? String, row["app"] as? String].compactMap { $0 }
                    .filter { !$0.isEmpty }.joined(separator: " in ")
                return KernlHistoryItem(app: .writr, date: when, text: text, place: place,
                                        seconds: 0, cost: estimateCost(words: text))
            }
        case .readr:
            return rows(".readr/lessons.json").compactMap { row in
                guard let when = date(row["date"]) else { return nil }
                let text = readableLesson(row["text"] as? String ?? "")
                return KernlHistoryItem(app: .readr, date: when, text: text,
                                        place: [row["app"] as? String].compactMap { $0 }.joined(),
                                        seconds: 0, cost: estimateCost(words: text) * 2)
            }
        case .listnr:
            return rows(".listnr/reads.json").compactMap { row in
                guard let when = date(row["date"]) else { return nil }
                let text = row["text"] as? String ?? ""
                let words = Double(text.split(whereSeparator: { $0.isWhitespace }).count)
                return KernlHistoryItem(app: .listnr, date: when, text: text,
                                        place: (row["app"] as? String) ?? "",
                                        seconds: words / 150 * 60, cost: 0)
            }
        }
    }

    static func allItems() -> [KernlHistoryItem] {
        KernlSuiteApp.allCases.flatMap(items(for:)).sorted { $0.date > $1.date }
    }

    /// gpt-4o-mini, roughly: a screen of context in, the reply out.
    private static func estimateCost(words text: String) -> Double {
        let out = Double(text.count) / 4
        return (1_500 * 0.15 + out * 0.60) / 1_000_000
    }

    /// readr stores its bubble as JSON; history shows the readable part.
    private static func readableLesson(_ raw: String) -> String {
        guard raw.hasPrefix("{"), let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return raw }
        let parts = ["title", "summary", "answer", "core"].compactMap { object[$0] as? String }
        return parts.isEmpty ? raw : parts.joined(separator: ". ")
    }
}

// MARK: Edits

enum KernlEdits {
    /// Share of characters you changed after speakr or writr wrote them.
    static func rates(_ range: KernlRange) -> [(String, Int, Int)] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let iso = ISO8601DateFormatter()
        func load(_ path: String) -> [[String: Any]] {
            guard let data = try? Data(contentsOf: home.appendingPathComponent(path)),
                  let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
            return list
        }
        var speakrChanged = 0, speakrTotal = 0
        for row in load(".speakr/usage.json") where (row["editObserved"] as? Bool) == true {
            guard let when = (row["timestamp"] as? String).flatMap(iso.date(from:)), range.includes(when) else { continue }
            let inserted = row["insertedCharacters"] as? Int ?? 0
            let edited = (row["editedTranscript"] as? String)?.count ?? 0
            guard inserted > 0, edited <= max(40, inserted * 2) else { continue }
            speakrChanged += min(row["changedCharacters"] as? Int ?? 0, inserted)
            speakrTotal += inserted
        }
        var writrChanged = 0, writrTotal = 0
        for row in load(".writr/drafts.json") {
            guard let changed = row["changedCharacters"] as? Int,
                  let when = (row["date"] as? String).flatMap(iso.date(from:)), range.includes(when) else { continue }
            writrChanged += changed
            writrTotal += (row["text"] as? String)?.count ?? 0
        }
        return [("speakr", speakrChanged, speakrTotal), ("writr", writrChanged, writrTotal)]
    }

    static func card(_ range: KernlRange) -> [NSView] {
        let rows = rates(range).map { entry -> NSView in
            let percent = entry.2 > 0 ? Int((Double(entry.1) / Double(entry.2) * 100).rounded()) : 0
            let value = entry.2 > 0 ? "\(percent)%" : "not measured"
            return KernlBarRow(label: "\(entry.0) edited", value: value,
                               fraction: entry.2 > 0 ? Double(percent) / 100 : 0, tint: KernlTheme.ink)
        }
        return [KernlCard(content: fleetVStack([
            fleetLabel("How much you edit", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel("Characters you changed after the app wrote them. Lower means it got it right.",
                       size: 12, color: KernlTheme.muted, lines: 0)
        ] + rows, spacing: 10))]
    }
}

// MARK: Time ranges

enum KernlRange: Int, CaseIterable {
    case day, week, month, all
    var title: String { ["24h", "7d", "30d", "All"][rawValue] }
    func includes(_ date: Date, now: Date = Date()) -> Bool {
        switch self {
        case .day: return date > now.addingTimeInterval(-86_400)
        case .week: return date > now.addingTimeInterval(-7 * 86_400)
        case .month: return date > now.addingTimeInterval(-30 * 86_400)
        case .all: return true
        }
    }
}

/// A row of pill buttons where one is chosen.
final class KernlPillChoice: NSStackView {
    private var buttons: [KernlButton] = []
    private let onChange: (Int) -> Void
    private(set) var selected: Int

    init(_ titles: [String], selected: Int, onChange: @escaping (Int) -> Void) {
        self.selected = selected
        self.onChange = onChange
        super.init(frame: .zero)
        orientation = .horizontal
        spacing = 6
        translatesAutoresizingMaskIntoConstraints = false
        for (index, title) in titles.enumerated() {
            let button = KernlButton(title, style: .secondary, target: self, action: #selector(tapped(_:)))
            button.tag = index
            button.state = index == selected ? .on : .off
            buttons.append(button)
            addArrangedSubview(button)
        }
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func tapped(_ sender: NSButton) {
        selected = sender.tag
        for button in buttons { button.state = button.tag == selected ? .on : .off; button.needsDisplay = true }
        onChange(selected)
    }
}

// MARK: Text analysis

enum KernlWords {
    static let stop: Set<String> = [
        "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for", "with", "is", "are",
        "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "i", "me", "my", "you",
        "your", "we", "our", "they", "them", "he", "she", "his", "her", "so", "as", "if", "then", "than",
        "just", "do", "does", "did", "have", "has", "had", "can", "will", "would", "could", "should", "not",
        "no", "yes", "from", "by", "up", "out", "about", "into", "what", "which", "who", "how", "when",
        "there", "here", "all", "also", "too", "very", "get", "got", "like", "im", "i'm", "it's", "dont",
        "don't", "um", "uh", "yeah", "ok", "okay", "more", "some", "any", "one", "make", "sure", "want",
        "need", "really", "thing", "things", "well", "now", "let", "lets", "let's", "go", "going", "be", "s"
    ]

    static func words(_ text: String) -> [String] {
        text.lowercased()
            .split(whereSeparator: { !($0.isLetter || $0.isNumber || $0 == "'") })
            .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "'")) }
            .filter { $0.count > 1 }
    }

    static func topWords(_ texts: [String], limit: Int = 8) -> [(String, Int)] {
        var counts: [String: Int] = [:]
        for text in texts { for word in words(text) where !stop.contains(word) && word.count > 2 { counts[word, default: 0] += 1 } }
        return counts.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.prefix(limit).map { ($0.key, $0.value) }
    }

    /// Two- and three-word phrases that recur, ignoring ones made only of
    /// filler words.
    static func topPhrases(_ texts: [String], limit: Int = 6) -> [(String, Int)] {
        var counts: [String: Int] = [:]
        for text in texts {
            let list = words(text)
            for n in [2, 3] where list.count >= n {
                for start in 0...(list.count - n) {
                    let gram = Array(list[start..<(start + n)])
                    let content = gram.filter { !stop.contains($0) }
                    guard content.count >= 2 || (n == 2 && content.count == 1 && !stop.contains(gram[1]) && !stop.contains(gram[0])) else { continue }
                    counts[gram.joined(separator: " "), default: 0] += 1
                }
            }
        }
        return counts.filter { $0.value > 1 }
            .sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .prefix(limit).map { ($0.key, $0.value) }
    }

    /// Names a place by the site in it when there is one, so "Google Chrome"
    /// with a LinkedIn tab counts as LinkedIn.
    static func placeName(_ raw: String) -> String {
        let lower = raw.lowercased()
        let sites: [(String, String)] = [("linkedin", "LinkedIn"), ("slack", "Slack"), ("whatsapp", "WhatsApp"),
                                         ("gmail", "Gmail"), ("mail", "Mail"), ("outlook", "Outlook"),
                                         ("terminal", "Terminal"), ("claude", "Claude"), ("notion", "Notion"),
                                         ("salesforce", "Salesforce"), ("chrome", "Chrome"), ("safari", "Safari")]
        for (needle, name) in sites where lower.contains(needle) { return name }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "Unknown" : trimmed.prefix(1).uppercased() + trimmed.dropFirst()
    }
}

// MARK: Bars

final class KernlBarRow: NSView {
    init(label: String, value: String, fraction: Double, tint: NSColor) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let name = fleetLabel(label, size: 13, color: KernlTheme.ink, lines: 1)
        name.cell?.lineBreakMode = .byTruncatingTail
        let number = fleetLabel(value, size: 12, color: KernlTheme.muted, lines: 1)
        number.alignment = .right
        let track = NSView()
        track.wantsLayer = true
        track.layer?.backgroundColor = KernlTheme.soft.cgColor
        track.layer?.cornerRadius = 3
        let fill = NSView()
        fill.wantsLayer = true
        fill.layer?.backgroundColor = tint.cgColor
        fill.layer?.cornerRadius = 3
        for view in [name, number, track, fill] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 22),
            name.leadingAnchor.constraint(equalTo: leadingAnchor),
            name.centerYAnchor.constraint(equalTo: centerYAnchor),
            name.widthAnchor.constraint(equalToConstant: 160),
            track.leadingAnchor.constraint(equalTo: name.trailingAnchor, constant: 12),
            track.centerYAnchor.constraint(equalTo: centerYAnchor),
            track.heightAnchor.constraint(equalToConstant: 6),
            track.trailingAnchor.constraint(equalTo: number.leadingAnchor, constant: -12),
            number.trailingAnchor.constraint(equalTo: trailingAnchor),
            number.centerYAnchor.constraint(equalTo: centerYAnchor),
            number.widthAnchor.constraint(equalToConstant: 64),
            fill.leadingAnchor.constraint(equalTo: track.leadingAnchor),
            fill.topAnchor.constraint(equalTo: track.topAnchor),
            fill.bottomAnchor.constraint(equalTo: track.bottomAnchor),
            fill.widthAnchor.constraint(equalTo: track.widthAnchor, multiplier: CGFloat(max(0.02, min(1, fraction))))
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
}

private func barCard(_ title: String, _ rows: [(String, Int)], tint: NSColor, empty: String,
                     format: (Int) -> String = { "\($0)" }) -> NSView {
    let top = Double(rows.first?.1 ?? 1)
    var views: [NSView] = [fleetLabel(title, size: 15, weight: .medium, color: KernlTheme.ink, lines: 1)]
    if rows.isEmpty {
        views.append(fleetLabel(empty, size: 13, color: KernlTheme.muted, lines: 0))
    } else {
        views += rows.map { KernlBarRow(label: $0.0, value: format($0.1), fraction: Double($0.1) / max(1, top), tint: tint) }
    }
    return KernlCard(content: fleetVStack(views, spacing: 10))
}

// MARK: History page

final class KernlHistoryPage: NSView {
    private let apps: [KernlSuiteApp]
    private let body = NSStackView()
    private var range = KernlRange.all
    private var sort = 0
    private var query = ""
    private let search = NSSearchField()

    init(apps: [KernlSuiteApp], title: String = "History", subtitle: String) {
        self.apps = apps
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        search.placeholderString = "Search"
        search.font = Type.sans(13)
        search.target = self
        search.action = #selector(searched)
        search.translatesAutoresizingMaskIntoConstraints = false
        search.widthAnchor.constraint(greaterThanOrEqualToConstant: 180).isActive = true
        let ranges = KernlPillChoice(KernlRange.allCases.map(\.title), selected: range.rawValue) { [weak self] in
            self?.range = KernlRange(rawValue: $0) ?? .all; self?.reload()
        }
        let sorts = KernlPillChoice(["Newest", "Longest", "Costliest"], selected: 0) { [weak self] in
            self?.sort = $0; self?.reload()
        }
        let controls = fleetHStack([search, fleetSpacer(), sorts, ranges], spacing: 12)
        body.orientation = .vertical
        body.alignment = .leading
        body.spacing = 18
        body.translatesAutoresizingMaskIntoConstraints = false
        let column = fleetVStack([KernlAppShell.pageHeader(eyebrow: "", title: title, subtitle: subtitle), controls, body], spacing: 18)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
            controls.widthAnchor.constraint(equalTo: column.widthAnchor),
            body.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
        reload()
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func searched() { query = search.stringValue.lowercased(); reload() }

    private func reload() {
        body.arrangedSubviews.forEach { $0.removeFromSuperview() }
        var items = apps.flatMap(KernlSuiteData.items(for:)).filter { range.includes($0.date) }
        if !query.isEmpty { items = items.filter { $0.text.lowercased().contains(query) || $0.place.lowercased().contains(query) } }
        switch sort {
        case 1: items.sort { ($0.seconds, Double($0.words)) > ($1.seconds, Double($1.words)) }
        case 2: items.sort { $0.cost > $1.cost }
        default: items.sort { $0.date > $1.date }
        }
        let total = items.reduce(0) { $0 + $1.cost }
        let summary = fleetLabel("\(items.count) item\(items.count == 1 ? "" : "s")  ·  \(items.reduce(0) { $0 + $1.words }) words  ·  \(KernlSuitePages.money(total))",
                                 size: 12, color: KernlTheme.muted, lines: 1)
        body.addArrangedSubview(summary)
        if items.isEmpty {
            body.addArrangedSubview(fleetLabel("Nothing here for this range yet.", size: 13, color: KernlTheme.muted, lines: 1))
            return
        }
        for item in items.prefix(200) {
            let row = KernlSuitePages.historyRow(item, showApp: apps.count > 1)
            body.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: body.widthAnchor).isActive = true
        }
    }
}

enum KernlSuitePages {
    static func money(_ value: Double) -> String {
        if value == 0 { return "$0.00" }
        return value < 0.01 ? String(format: "$%.5f", value) : String(format: "$%.2f", value)
    }

    static func historyRow(_ item: KernlHistoryItem, showApp: Bool) -> NSView {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.dateFormat = Calendar.current.isDateInToday(item.date) ? "HH:mm" : "d MMM, HH:mm"
        let time = fleetLabel(formatter.string(from: item.date), size: 12, color: KernlTheme.muted, lines: 1)
        time.widthAnchor.constraint(equalToConstant: 92).isActive = true
        let text = fleetLabel(item.text.replacingOccurrences(of: "\n", with: " "), size: 13, color: KernlTheme.ink, lines: 3)
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        var meta: [String] = []
        if !item.place.isEmpty { meta.append(KernlWords.placeName(item.place)) }
        meta.append("\(item.words) words")
        if item.seconds > 0 { meta.append(item.seconds < 60 ? "\(Int(item.seconds.rounded())) s" : "\(Int(item.seconds / 60)) min") }
        if item.cost > 0 { meta.append(money(item.cost)) }
        let metaLabel = fleetLabel(meta.joined(separator: "  ·  "), size: 11, color: KernlTheme.muted, lines: 1)
        var lead: [NSView] = []
        if showApp {
            // Combined views stay black and white: the app is named, not coloured.
            let name = fleetLabel(item.app.title, size: 12, weight: .medium, color: KernlTheme.ink, lines: 1)
            name.widthAnchor.constraint(equalToConstant: 56).isActive = true
            lead.append(name)
        }
        let body = fleetVStack([text, metaLabel], spacing: 5)
        body.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let row = fleetHStack(lead + [time, body], spacing: 14, alignment: .top)
        return KernlHoverRow.wrap(row, copying: item.text)
    }

    // MARK: Profile

    static func profile(apps: [KernlSuiteApp], tint: NSColor, title: String = "Profile",
                        subtitle: String, extra: ((KernlRange) -> [NSView])? = nil) -> NSView {
        KernlProfilePage(apps: apps, tint: tint, title: title, subtitle: subtitle, extra: extra)
    }
}

final class KernlProfilePage: NSView {
    private let apps: [KernlSuiteApp]
    private let tint: NSColor
    private let body = NSStackView()
    private var range = KernlRange.all
    private let extra: ((KernlRange) -> [NSView])?

    init(apps: [KernlSuiteApp], tint: NSColor, title: String, subtitle: String, extra: ((KernlRange) -> [NSView])?) {
        self.apps = apps
        self.tint = tint
        self.extra = extra
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let ranges = KernlPillChoice(KernlRange.allCases.map(\.title), selected: range.rawValue) { [weak self] in
            self?.range = KernlRange(rawValue: $0) ?? .all; self?.reload()
        }
        body.orientation = .vertical
        body.alignment = .leading
        body.spacing = 18
        body.translatesAutoresizingMaskIntoConstraints = false
        let column = fleetVStack([KernlAppShell.pageHeader(eyebrow: "", title: title, subtitle: subtitle),
                                  fleetHStack([fleetSpacer(), ranges], spacing: 8), body], spacing: 18)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
        reload()
    }
    required init?(coder: NSCoder) { fatalError() }

    private func add(_ view: NSView) {
        body.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: body.widthAnchor).isActive = true
    }

    private func reload() {
        body.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let items = apps.flatMap(KernlSuiteData.items(for:)).filter { range.includes($0.date) }
        let words = items.reduce(0) { $0 + $1.words }
        let places = Dictionary(grouping: items.filter { !$0.place.isEmpty }, by: { KernlWords.placeName($0.place) })
            .map { ($0.key, $0.value.count) }.sorted { $0.1 > $1.1 }
        let busiest = places.first?.0 ?? "None yet"
        add(KernlStatGrid([
            (label: apps.count > 1 ? "items" : "uses", value: "\(items.count)", foot: range == .all ? "all time" : "last \(range.title)"),
            (label: "words", value: "\(words)", foot: items.isEmpty ? "" : "\(words / max(1, items.count)) on average"),
            (label: "most used in", value: busiest, foot: places.first.map { "\($0.1) times" } ?? ""),
            (label: "cost", value: KernlSuitePages.money(items.reduce(0) { $0 + $1.cost }), foot: "this range")
        ], minTileWidth: 150, tileHeight: 104, valueSize: 22))

        if apps.count > 1 {
            let byApp = apps.map { app in (app.title, items.filter { $0.app == app }.count) }.sorted { $0.1 > $1.1 }
            let byWords = apps.map { app in (app.title, items.filter { $0.app == app }.reduce(0) { $0 + $1.words }) }.sorted { $0.1 > $1.1 }
            add(KernlSuiteCompare(byApp: byApp, byWords: byWords))
        }
        add(barCard("Where", Array(places.prefix(8)), tint: tint, empty: "Use the app and the places you use it appear here."))
        let texts = items.map(\.text)
        add(barCard("Words you use most", KernlWords.topWords(texts), tint: tint,
                    empty: "No words yet. Common words like \"the\" and \"a\" are left out."))
        add(barCard("Phrases", KernlWords.topPhrases(texts), tint: tint,
                    empty: "Phrases you repeat show here once they come up twice."))
        for view in extra?(range) ?? [] { add(view) }
    }
}

/// Kernl's comparison: which app gets used most, by uses and by words.
final class KernlSuiteCompare: NSView {
    init(byApp: [(String, Int)], byWords: [(String, Int)]) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        func rows(_ list: [(String, Int)]) -> [NSView] {
            let top = Double(list.first?.1 ?? 1)
            return list.map { entry in
                return KernlBarRow(label: entry.0, value: "\(entry.1)", fraction: Double(entry.1) / max(1, top),
                                   tint: KernlTheme.ink)
            }
        }
        let card = KernlCard(content: fleetVStack(
            [fleetLabel("Apps compared", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1),
             fleetLabel("Uses", size: 12, color: KernlTheme.muted, lines: 1)] + rows(byApp) +
            [fleetLabel("Words", size: 12, color: KernlTheme.muted, lines: 1)] + rows(byWords), spacing: 10))
        card.translatesAutoresizingMaskIntoConstraints = false
        addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: topAnchor), card.bottomAnchor.constraint(equalTo: bottomAnchor),
            card.leadingAnchor.constraint(equalTo: leadingAnchor), card.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
}

// MARK: Questions asked

/// Every question asked in any app's FAQ, answered or not, in ~/.fleet/asked.json.
/// Answering one in Kernl adds it to ~/.fleet/faqs.md, which every FAQ reads.
enum KernlAskLog {
    struct Entry: Codable {
        var id: String
        var date: Date
        var app: String
        var question: String
        var answer: String
        var matched: Bool
        var answeredByYou: Bool?
    }

    static let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".fleet/asked.json")
    static let faqURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".fleet/faqs.md")

    static func all() -> [Entry] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: url), let list = try? decoder.decode([Entry].self, from: data) else { return [] }
        return list
    }

    static func save(_ list: [Entry]) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? encoder.encode(list) { try? data.write(to: url, options: .atomic) }
    }

    static func record(app: String, question: String, answer: String, matched: Bool) {
        var list = all()
        list.insert(Entry(id: UUID().uuidString, date: Date(), app: app, question: question,
                          answer: answer, matched: matched, answeredByYou: nil), at: 0)
        save(Array(list.prefix(1_000)))
        DistributedNotificationCenter.default().postNotificationName(.init("com.archit.kernl.asked"), object: nil,
                                                                     userInfo: nil, deliverImmediately: true)
    }

    static var unanswered: [Entry] { all().filter { !$0.matched && $0.answeredByYou != true } }

    /// Writes your answer into the shared FAQ so every app can use it.
    static func answer(_ id: String, with text: String) {
        var list = all()
        guard let index = list.firstIndex(where: { $0.id == id }) else { return }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        list[index].answer = clean
        list[index].answeredByYou = true
        list[index].matched = true
        save(list)
        let entry = "\n\n## \(list[index].question.trimmingCharacters(in: .whitespacesAndNewlines))\n\(clean)\n"
        if let handle = try? FileHandle(forWritingTo: faqURL) {
            handle.seekToEndOfFile()
            handle.write(entry.data(using: .utf8) ?? Data())
            try? handle.close()
        } else {
            try? ("# kernl knowledge base" + entry).write(to: faqURL, atomically: true, encoding: .utf8)
        }
    }

    /// A draft email of every unanswered question, for answering later.
    static func emailDraft(to address: String) -> URL? {
        let open = unanswered
        let body = open.isEmpty ? "No unanswered questions." :
            open.map { "[\($0.app)] \($0.question)" }.joined(separator: "\n")
        var parts = URLComponents()
        parts.scheme = "mailto"
        parts.path = address
        parts.queryItems = [URLQueryItem(name: "subject", value: "kernl: \(open.count) unanswered question\(open.count == 1 ? "" : "s")"),
                            URLQueryItem(name: "body", value: body)]
        return parts.url
    }
}

// MARK: FAQ

enum KernlFAQ {
    struct Entry { let title: String; let body: String }

    static func entries() -> [Entry] {
        guard let text = try? String(contentsOf: KernlAskLog.faqURL, encoding: .utf8) else { return [] }
        return text.components(separatedBy: "\n## ").dropFirst().map { part in
            let lines = part.components(separatedBy: .newlines)
            return Entry(title: lines.first?.trimmingCharacters(in: .whitespaces) ?? "",
                         body: lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    /// FAQs about one app, or all of them for Kernl.
    static func entries(for app: String?) -> [Entry] {
        let list = entries()
        guard let app, app != "kernl" else { return list }
        return list.filter { ($0.title + " " + $0.body).lowercased().contains(app) }
    }

    static func tokens(_ text: String) -> Set<String> {
        Set(KernlWords.words(text).filter { !KernlWords.stop.contains($0) && !["kernl", "app", "apps"].contains($0) })
    }

    /// The best entries for a question, strongest first. An entry counts when
    /// it shares at least two meaningful words, or one for a short question.
    static func matches(_ question: String, app: String?) -> [Entry] {
        let q = tokens(question)
        guard !q.isEmpty else { return [] }
        let needed = q.count <= 2 ? 1 : 2
        return entries().map { entry -> (Entry, Int) in
            let title = tokens(entry.title)
            let hay = title.union(tokens(entry.body))
            var score = q.reduce(0) { $0 + (hay.contains($1) ? 1 : 0) } + q.reduce(0) { $0 + (title.contains($1) ? 1 : 0) }
            if let app, (entry.title + entry.body).lowercased().contains(app) { score += 1 }
            return (entry, score)
        }
        .filter { $0.1 >= needed }
        .sorted { $0.1 > $1.1 }
        .prefix(3).map(\.0)
    }

    /// Answers from the FAQ only. No match means a plain "no answer yet", and
    /// the question is saved for you to answer.
    static func ask(_ question: String, app: String, completion: @escaping (String, Bool) -> Void) {
        let found = matches(question, app: app)
        let finish: (String, Bool) -> Void = { text, matched in
            KernlAskLog.record(app: app, question: question, answer: matched ? text : "", matched: matched)
            DispatchQueue.main.async { completion(text, matched) }
        }
        let noMatch = "No answer yet. Saved, so it can be added to the FAQ."
        guard !found.isEmpty else { return finish(noMatch, false) }
        guard let key = envKey() else { return finish(found[0].body, true) }
        let context = found.map { "## \($0.title)\n\($0.body)" }.joined(separator: "\n\n")
        let body: [String: Any] = [
            "model": "gpt-4o-mini", "temperature": 0.1,
            "messages": [
                ["role": "system", "content": "Answer the question directly in two or three plain sentences, using only the FAQ entries given. Do not mention the entries or say how closely they match. If they do not answer the question, reply with exactly NO_MATCH."],
                ["role": "user", "content": "Question: \(question)\n\nFAQ:\n\(context)"]
            ]
        ]
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = object["choices"] as? [[String: Any]],
                  let message = choices.first?["message"] as? [String: Any],
                  let text = (message["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) else {
                return finish(found[0].body, true)
            }
            if text.contains("NO_MATCH") { finish(noMatch, false) } else { finish(text, true) }
        }.resume()
    }

    static func envKey() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        for path in [".fleet/fleet.env", ".writr/.env", ".speakr/.env"] {
            guard let text = try? String(contentsOf: home.appendingPathComponent(path), encoding: .utf8) else { continue }
            for line in text.components(separatedBy: .newlines) {
                let clean = line.trimmingCharacters(in: .whitespaces)
                guard clean.hasPrefix("OPENAI_API_KEY=") else { continue }
                let value = String(clean.dropFirst("OPENAI_API_KEY=".count))
                    .trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
                if !value.isEmpty { return value }
            }
        }
        return nil
    }
}

/// The FAQ tab: ask a question, then the questions and answers for this app.
final class KernlFAQPage: NSView, NSTextFieldDelegate {
    private let app: String
    private let field = NSTextField()
    private let answer = fleetLabel("", size: 14, color: KernlTheme.ink, lines: 0)
    private let list = NSStackView()

    init(app: String, subtitle: String) {
        self.app = app
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        field.placeholderString = "Ask a question"
        field.font = Type.sans(14)
        field.bezelStyle = .roundedBezel
        field.delegate = self
        field.target = self
        field.action = #selector(askTapped)
        field.translatesAutoresizingMaskIntoConstraints = false
        field.heightAnchor.constraint(equalToConstant: 32).isActive = true
        let ask = fleetButton("Ask", primary: true, target: self, action: #selector(askTapped))
        answer.isHidden = true
        let askCard = KernlCard(content: fleetVStack([fleetHStack([field, ask], spacing: 10), answer], spacing: 12))
        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 18
        list.translatesAutoresizingMaskIntoConstraints = false
        let entries = KernlFAQ.entries(for: app)
        for entry in entries {
            let item = fleetVStack([fleetLabel(entry.title, size: 14, weight: .medium, color: KernlTheme.ink, lines: 0),
                                    fleetLabel(entry.body.replacingOccurrences(of: "`", with: ""), size: 13, color: KernlTheme.muted, lines: 0)],
                                   spacing: 4)
            list.addArrangedSubview(item)
            item.widthAnchor.constraint(equalTo: list.widthAnchor).isActive = true
        }
        if entries.isEmpty {
            list.addArrangedSubview(fleetLabel("No questions yet. Ask one above.", size: 13, color: KernlTheme.muted, lines: 1))
        }
        let listCard = KernlCard(content: fleetVStack([fleetLabel("Questions", size: 15, weight: .medium, color: KernlTheme.ink, lines: 1), list], spacing: 14))
        let column = fleetVStack([KernlAppShell.pageHeader(eyebrow: "", title: "FAQ", subtitle: subtitle), askCard, listCard], spacing: 18)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
            askCard.widthAnchor.constraint(equalTo: column.widthAnchor),
            listCard.widthAnchor.constraint(equalTo: column.widthAnchor),
            list.widthAnchor.constraint(equalTo: listCard.widthAnchor, constant: -48)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func askTapped() {
        let question = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        answer.isHidden = false
        answer.textColor = KernlTheme.muted
        answer.stringValue = "Looking…"
        KernlFAQ.ask(question, app: app) { [weak self] text, matched in
            self?.answer.textColor = matched ? KernlTheme.ink : KernlTheme.muted
            self?.answer.stringValue = text
        }
    }
}

/// Kernl's "Asked" tab: every question from every app, newest first, with a
/// box to answer the open ones straight into the FAQ.
final class KernlAskedPage: NSView {
    private let list = NSStackView()
    private var showOpenOnly = true
    private let email: String

    init(email: String) {
        self.email = email
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let filter = KernlPillChoice(["Unanswered", "All"], selected: 0) { [weak self] in
            self?.showOpenOnly = $0 == 0; self?.reload()
        }
        let mail = fleetButton("Email me the open ones", target: self, action: #selector(emailTapped))
        list.orientation = .vertical
        list.alignment = .leading
        list.spacing = 14
        list.translatesAutoresizingMaskIntoConstraints = false
        let column = fleetVStack([
            KernlAppShell.pageHeader(eyebrow: "", title: "Asked",
                                     subtitle: "Every question asked in any app. Answer one here and it joins the FAQ everywhere."),
            fleetHStack([filter, fleetSpacer(), mail], spacing: 10), list
        ], spacing: 18)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
            list.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
        reload()
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func emailTapped() {
        if let url = KernlAskLog.emailDraft(to: email) { NSWorkspace.shared.open(url) }
    }

    private func reload() {
        list.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let entries = showOpenOnly ? KernlAskLog.unanswered : KernlAskLog.all()
        if entries.isEmpty {
            list.addArrangedSubview(fleetLabel(showOpenOnly ? "Nothing waiting for an answer." : "No questions asked yet.",
                                               size: 13, color: KernlTheme.muted, lines: 1))
            return
        }
        for entry in entries.prefix(150) {
            let row = KernlAskedRow(entry: entry) { [weak self] in self?.reload() }
            list.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: list.widthAnchor).isActive = true
        }
    }
}

final class KernlAskedRow: NSView {
    private let entry: KernlAskLog.Entry
    private let field = NSTextField()
    private let onAnswered: () -> Void

    init(entry: KernlAskLog.Entry, onAnswered: @escaping () -> Void) {
        self.entry = entry
        self.onAnswered = onAnswered
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.dateFormat = "d MMM, HH:mm"
        let meta = fleetLabel("\(entry.app)  ·  \(formatter.string(from: entry.date))", size: 11, color: KernlTheme.muted, lines: 1)
        let question = fleetLabel(entry.question, size: 14, weight: .medium, color: KernlTheme.ink, lines: 0)
        var views: [NSView] = [meta, question]
        if entry.matched {
            views.append(fleetLabel(entry.answer, size: 13, color: KernlTheme.muted, lines: 0))
        } else {
            field.placeholderString = "Write the answer"
            field.font = Type.sans(13)
            field.bezelStyle = .roundedBezel
            field.target = self
            field.action = #selector(save)
            field.translatesAutoresizingMaskIntoConstraints = false
            let save = fleetButton("Add to FAQ", target: self, action: #selector(save))
            views.append(fleetHStack([field, save], spacing: 8))
        }
        let card = KernlCard(content: fleetVStack(views, spacing: 8))
        card.translatesAutoresizingMaskIntoConstraints = false
        addSubview(card)
        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: topAnchor), card.bottomAnchor.constraint(equalTo: bottomAnchor),
            card.leadingAnchor.constraint(equalTo: leadingAnchor), card.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func save() {
        KernlAskLog.answer(entry.id, with: field.stringValue)
        onAnswered()
    }
}


// MARK: Info

/// Who made it, and when.
final class KernlInfoPage: NSView {
    init(app: String, version: String = "1.0") {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.dateFormat = "d MMMM yyyy"
        let built = (Bundle.main.executableURL.flatMap { try? $0.resourceValues(forKeys: [.contentModificationDateKey]) }?
            .contentModificationDate) ?? Date()
        func row(_ label: String, _ value: String) -> NSView {
            fleetHStack([fleetLabel(label, size: 13, color: KernlTheme.muted, lines: 1), fleetSpacer(),
                         fleetLabel(value, size: 13, weight: .medium, color: KernlTheme.ink, lines: 1)], spacing: 12)
        }
        let card = KernlCard(content: fleetVStack([
            row("App", app),
            row("Version", version),
            row("Developer", "songsbyarchit"),
            row("Built", formatter.string(from: built)),
            row("Part of", "kernl: speakr, listnr, writr and readr")
        ], spacing: 12))
        let note = fleetVStack([
            fleetLabel("Be lucky.", size: 22, weight: .medium, color: KernlTheme.ink, lines: 1),
            fleetLabel("Built with \u{2665} between Sheffield and Shoreditch.", size: 14, color: KernlTheme.muted, lines: 0)
        ], spacing: 6)
        let column = fleetVStack([KernlAppShell.pageHeader(eyebrow: "", title: "Info", subtitle: "About \(app)."),
                                  card, fleetGap(8), note], spacing: 18)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: topAnchor), column.bottomAnchor.constraint(equalTo: bottomAnchor),
            column.leadingAnchor.constraint(equalTo: leadingAnchor), column.trailingAnchor.constraint(equalTo: trailingAnchor),
            card.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }
}


// MARK: Feedback

/// The feedback box on the writr and readr popups. Your note and a screenshot
/// of the whole screen go to the model once, in the background, which turns
/// them into a short rule: one about this person or place, and one general one
/// when it applies. Rules live in ~/.fleet/learned.md and ride along with every
/// draft and explanation. The note and screenshot are deleted after 24 hours.
enum KernlFeedback {
    static let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".fleet/feedback", isDirectory: true)
    static let rulesURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".fleet/learned.md")
    static let keepFor: TimeInterval = 24 * 3600

    static let bansURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".fleet/learned-bans.json")

    /// Only the rules that apply here: ones naming a person or app found in
    /// `context`, plus the "everywhere" rules, newest first, eight at most.
    /// Keeps the prompt short however much feedback builds up.
    static func promptNote(matching context: String = "") -> String {
        guard let text = try? String(contentsOf: rulesURL, encoding: .utf8) else { return "" }
        let haystack = context.lowercased()
        let rules = text.components(separatedBy: .newlines).filter { $0.hasPrefix("- ") }.reversed().filter { line in
            guard let close = line.firstIndex(of: "]"), let open = line.firstIndex(of: "[") else { return false }
            let tags = line[line.index(after: open)..<close].lowercased()
                .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            return tags.contains("everywhere") || tags.contains { !$0.isEmpty && haystack.contains($0) }
        }.prefix(8)
        guard !rules.isEmpty else { return "" }
        return "\n\nLearned from his feedback (follow these):\n" + rules.joined(separator: "\n")
    }

    struct Ban: Codable { var text: String; var person: String; var place: String }

    static func bans() -> [Ban] {
        guard let data = try? Data(contentsOf: bansURL) else { return [] }
        return (try? JSONDecoder().decode([Ban].self, from: data)) ?? []
    }

    /// Removes words and emoji you said never to use, when they apply to the
    /// person or app in `context`. Done in code, so it costs no prompt.
    static func clean(_ output: String, matching context: String) -> String {
        let haystack = context.lowercased()
        var text = output
        for ban in bans() where !ban.text.isEmpty {
            let scoped = [ban.person, ban.place].filter { !$0.isEmpty }
            guard scoped.isEmpty || scoped.contains(where: { haystack.contains($0.lowercased()) }) else { continue }
            let escaped = NSRegularExpression.escapedPattern(for: ban.text)
            let isWord = ban.text.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || $0 == " " }
            let pattern = isWord ? "(?i)\\b\(escaped)\\b" : escaped
            text = text.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
        }
        // Tidy the gaps a removal leaves.
        text = text.replacingOccurrences(of: " {2,}", with: " ", options: .regularExpression)
            .replacingOccurrences(of: " ([,.!?])", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: "[,;:]+([.!?])", with: "$1", options: .regularExpression)
            .replacingOccurrences(of: ",{2,}", with: ",", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespaces)
    }

    private static func addBans(_ list: [String], person: String, place: String) {
        let clean = list.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty && $0.count <= 40 }
        guard !clean.isEmpty else { return }
        var all = bans().filter { ban in !clean.contains { $0.lowercased() == ban.text.lowercased() && ban.person == person && ban.place == place } }
        all += clean.map { Ban(text: $0, person: person, place: place) }
        if let data = try? JSONEncoder().encode(Array(all.suffix(200))) { try? data.write(to: bansURL, options: .atomic) }
    }

    static func submit(app: String, note: String, output: String, place: String,
                       done: ((String?) -> Void)? = nil) {
        let clean = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        prune()
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        let id = UUID().uuidString
        let shot = folder.appendingPathComponent("\(id).jpg")
        DispatchQueue.global(qos: .utility).async {
            capture(to: shot)
            let record: [String: Any] = ["date": ISO8601DateFormatter().string(from: Date()), "app": app,
                                         "note": clean, "output": output, "place": place]
            if let data = try? JSONSerialization.data(withJSONObject: record, options: .prettyPrinted) {
                try? data.write(to: folder.appendingPathComponent("\(id).json"), options: .atomic)
            }
            learn(app: app, note: clean, output: output, place: place, screenshot: shot) { rule in
                DispatchQueue.main.async { done?(rule) }
            }
        }
    }

    /// Deletes notes and screenshots older than a day.
    static func prune() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        for file in files {
            let date = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if Date().timeIntervalSince(date) > keepFor { try? fm.removeItem(at: file) }
        }
    }

    private static func capture(to url: URL) {
        let raw = url.deletingPathExtension().appendingPathExtension("png")
        let grab = Process()
        grab.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        grab.arguments = ["-x", "-m", raw.path]
        try? grab.run(); grab.waitUntilExit()
        // Small enough to send quickly: 1600 px wide JPEG.
        let shrink = Process()
        shrink.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
        shrink.arguments = ["-Z", "1600", "-s", "format", "jpeg", raw.path, "--out", url.path]
        shrink.standardOutput = FileHandle.nullDevice
        shrink.standardError = FileHandle.nullDevice
        try? shrink.run(); shrink.waitUntilExit()
        try? FileManager.default.removeItem(at: raw)
    }

    private static func learn(app: String, note: String, output: String, place: String, screenshot: URL,
                              done: @escaping (String?) -> Void) {
        guard let key = KernlFAQ.envKey() else { return done(nil) }
        let instructions = """
        Archit gave feedback on something \(app) wrote for him. Using his note, what \(app) wrote and the screenshot,         write rules for next time. Reply with JSON only: {"person": "", "place": "", "rule": "", "general": "", "never": []}.
        person: the name of the person in the chat on screen, if there is one. place: the app or site (WhatsApp, Slack, LinkedIn, email).
        rule: one short imperative about this person or place, such as "Keanu is a close friend: reply casually, short, no formalities".
        general: one short rule that applies everywhere, only if the note implies one, else "".
        never: exact emoji or words he said never to use, e.g. ["😂"] for "i never use 😂". Empty if none.
        """
        var content: [[String: Any]] = [["type": "text", "text": "Note: \(note)\nWhat \(app) wrote: \(output.prefix(1500))\nApp in front: \(place)"]]
        if let data = try? Data(contentsOf: screenshot) {
            content.append(["type": "image_url", "image_url": ["url": "data:image/jpeg;base64,\(data.base64EncodedString())", "detail": "low"]])
        }
        let body: [String: Any] = ["model": "gpt-4o-mini", "temperature": 0.2,
                                   "response_format": ["type": "json_object"],
                                   "messages": [["role": "system", "content": instructions], ["role": "user", "content": content]]]
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 40
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            guard let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = object["choices"] as? [[String: Any]],
                  let message = choices.first?["message"] as? [String: Any],
                  let text = message["content"] as? String,
                  let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
                return done(nil)
            }
            var lines: [String] = []
            let person = (json["person"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
            let where_ = ((json["place"] as? String)?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? place
            if let never = json["never"] as? [String] {
                // A ban about a specific person applies to them; otherwise everywhere.
                addBans(never, person: person, place: person.isEmpty ? "" : where_)
            }
            if let rule = json["rule"] as? String, !rule.isEmpty {
                let tag = [person, where_].filter { !$0.isEmpty }.joined(separator: ", ")
                lines.append("- [\(tag.isEmpty ? app : tag)] \(rule)")
            }
            if let general = json["general"] as? String, !general.isEmpty { lines.append("- [everywhere] \(general)") }
            append(lines)
            done(lines.first)
        }.resume()
    }

    /// Adds rules, replacing an older rule with the same tag, keeping 60 at most.
    private static func append(_ lines: [String]) {
        guard !lines.isEmpty else { return }
        var existing = ((try? String(contentsOf: rulesURL, encoding: .utf8)) ?? "")
            .components(separatedBy: .newlines).filter { $0.hasPrefix("- ") }
        for line in lines {
            let tag = line.components(separatedBy: "]").first ?? line
            if !tag.contains("everywhere") { existing.removeAll { $0.hasPrefix(tag + "]") } }
            existing.append(line)
        }
        let text = "# Learned from feedback\n\nWritten by writr and readr from your notes. Edit or delete any line.\n\n"
            + existing.suffix(60).joined(separator: "\n") + "\n"
        try? text.write(to: rulesURL, atomically: true, encoding: .utf8)
    }
}

/// The small "Tell writr what to change" box on the popups.
final class KernlFeedbackField: NSView, NSTextFieldDelegate {
    private let field = NSTextField()
    private let status = fleetLabel("", size: 11, color: KernlTheme.muted, lines: 2)
    var onSubmit: ((String) -> Void)?

    init(placeholder: String) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        field.placeholderString = placeholder
        field.font = Type.sans(12)
        field.bezelStyle = .roundedBezel
        field.focusRingType = .none
        field.delegate = self
        field.target = self
        field.action = #selector(send)
        field.translatesAutoresizingMaskIntoConstraints = false
        status.isHidden = true
        let stack = fleetVStack([field, status], spacing: 4)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor), stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor), stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            field.widthAnchor.constraint(equalTo: stack.widthAnchor),
            field.heightAnchor.constraint(equalToConstant: 26)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    var isTyping: Bool { field.currentEditor() != nil && !field.stringValue.isEmpty }

    func reset() {
        field.stringValue = ""
        status.isHidden = true
    }

    /// Just "Learned", with a tick: the letters drift together and fade in.
    /// The rule itself is in the tooltip, for anyone curious.
    func showLearned(_ rule: String?) {
        status.isHidden = false
        status.toolTip = rule.map { $0.replacingOccurrences(of: "- ", with: "") }
        learnTimer?.invalidate()
        let frames = 14
        var frame = 0
        func render(_ t: CGFloat) {
            let eased = 1 - pow(1 - t, 3)
            let text = NSMutableAttributedString()
            if let tick = NSImage(systemSymbolName: "checkmark", accessibilityDescription: nil)?
                .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 9, weight: .semibold)) {
                let attachment = NSTextAttachment()
                attachment.image = tick
                text.append(NSAttributedString(attachment: attachment))
                text.append(NSAttributedString(string: " "))
            }
            text.append(NSAttributedString(string: "Learned"))
            text.addAttributes([
                .font: Type.sans(11, .medium),
                .foregroundColor: KernlTheme.ink.withAlphaComponent(0.25 + 0.75 * eased),
                .kern: (1 - eased) * 3.5
            ], range: NSRange(location: 0, length: text.length))
            status.attributedStringValue = text
        }
        render(0)
        learnTimer = Timer.scheduledTimer(withTimeInterval: 0.028, repeats: true) { [weak self] timer in
            frame += 1
            render(CGFloat(frame) / CGFloat(frames))
            if frame >= frames { timer.invalidate(); self?.learnTimer = nil }
        }
    }
    private var learnTimer: Timer?

    @objc private func send() {
        let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        field.stringValue = ""
        status.isHidden = false
        status.toolTip = nil; status.stringValue = "Learning…"
        onSubmit?(text)
    }
}


/// A copy button that shows only while the pointer is over its row, so lists
/// read as plain text. Shows a tick for a moment once copied.
final class KernlHoverRow: NSView {
    private weak var copy: KernlCopyButton?
    init(row: NSView, copy: KernlCopyButton) {
        self.copy = copy
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: leadingAnchor), row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor), row.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        copy.alphaValue = 0
    }
    required init?(coder: NSCoder) { fatalError() }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { fade(to: 1) }
    override func mouseExited(with event: NSEvent) { if copy?.justCopied != true { fade(to: 0) } }
    private func fade(to value: CGFloat) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.12
            copy?.animator().alphaValue = value
        }
    }

    /// Wraps `content` with a copy button for `text` on its trailing edge.
    static func wrap(_ content: NSView, copying text: String) -> NSView {
        let copy = KernlCopyButton(text: text)
        content.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return KernlHoverRow(row: fleetHStack([content, copy], spacing: 8, alignment: .top), copy: copy)
    }
}

final class KernlCopyButton: NSButton {
    private(set) var justCopied = false
    private let text: String
    private var resetWork: DispatchWorkItem?

    init(text: String) {
        self.text = text
        super.init(frame: .zero)
        bezelStyle = .regularSquare
        isBordered = false
        imagePosition = .imageOnly
        symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 11, weight: .regular)
        setAccessibilityLabel("Copy")
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: 26).isActive = true
        heightAnchor.constraint(equalToConstant: 22).isActive = true
        setContentHuggingPriority(.required, for: .horizontal)
        setContentCompressionResistancePriority(.required, for: .horizontal)
        target = self
        action = #selector(copyText)
        showIcon(copied: false)
    }
    required init?(coder: NSCoder) { fatalError() }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }

    private func showIcon(copied: Bool) {
        justCopied = copied
        image = NSImage(systemSymbolName: copied ? "checkmark" : "square.on.square",
                        accessibilityDescription: copied ? "Copied" : "Copy")
        contentTintColor = copied ? KernlTheme.ink : KernlTheme.muted
        toolTip = copied ? "Copied" : "Copy"
    }

    @objc private func copyText() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        showIcon(copied: true)
        resetWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.showIcon(copied: false) }
        resetWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4, execute: work)
    }
}
