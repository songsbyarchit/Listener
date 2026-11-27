import Foundation

/// A piece of text saved to read or listen to later: a whole article from
/// Chrome, or a selection from any app.
struct Clip: Codable, Identifiable, Equatable {
    var id: String
    var date: String
    var title: String
    var url: String
    var site: String
    var kind: String
    var text: String
    var words: Int
    var done: Bool
    /// True when the local server was not running, so the clip lives only in
    /// ~/.listnr/clips.json until it can be sent.
    var local: Bool? = nil

    var minutes: Int { max(1, Int((Double(words) / 230).rounded())) }
    var savedAt: Date? { ISO8601DateFormatter.clip.date(from: date) }
}

extension ISO8601DateFormatter {
    static let clip: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

/// The collection lives on the local listnr server, so Chrome and the Mac app
/// share it. When the server is down, clips are kept on the Mac and sent the
/// next time it answers.
final class ClipStore {
    static let shared = ClipStore()
    static let changed = Notification.Name("listnr.clips.changed")
    private(set) var clips: [Clip] = []

    private let localPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".listnr", isDirectory: true)
        .appendingPathComponent("clips.json")
    private var api: URL { ListnrVoiceCatalog.serverURL.appendingPathComponent("api/clips") }

    private init() { clips = loadLocal() }

    // MARK: Reading

    func refresh(_ done: (() -> Void)? = nil) {
        var request = URLRequest(url: api)
        request.timeoutInterval = 4
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            let remote = (response as? HTTPURLResponse)?.statusCode == 200
                ? (try? JSONDecoder().decode(ClipList.self, from: data ?? Data()))?.clips
                : nil
            DispatchQueue.main.async {
                let local = self.loadLocal()
                if let remote {
                    self.clips = (local + remote).sorted { $0.date > $1.date }
                    if !local.isEmpty { self.flushLocal(local) }
                } else {
                    self.clips = local
                }
                NotificationCenter.default.post(name: Self.changed, object: nil)
                done?()
            }
        }.resume()
    }

    var unread: [Clip] { clips.filter { !$0.done } }

    // MARK: Writing

    func save(title: String, url: String = "", site: String, kind: String, text: String,
              done: @escaping (Bool) -> Void) {
        let body: [String: Any] = ["title": title, "url": url, "site": site, "kind": kind, "text": text]
        send("POST", api, body) { [weak self] ok in
            guard let self else { return }
            if !ok {
                let words = text.split(whereSeparator: { $0.isWhitespace }).count
                var local = self.loadLocal()
                local.insert(Clip(id: UUID().uuidString, date: ISO8601DateFormatter.clip.string(from: Date()),
                                  title: title, url: url, site: site, kind: kind, text: text,
                                  words: words, done: false, local: true), at: 0)
                self.writeLocal(local)
            }
            self.refresh { done(true) }
        }
    }

    func setDone(_ clip: Clip, _ value: Bool) {
        if clip.local == true {
            writeLocal(loadLocal().map { var item = $0; if item.id == clip.id { item.done = value }; return item })
            refresh()
            return
        }
        send("PATCH", api.appendingPathComponent(clip.id), ["done": value]) { [weak self] _ in self?.refresh() }
    }

    func remove(_ clip: Clip) {
        if clip.local == true {
            writeLocal(loadLocal().filter { $0.id != clip.id })
            refresh()
            return
        }
        send("DELETE", api.appendingPathComponent(clip.id), nil) { [weak self] _ in self?.refresh() }
    }

    // MARK: Helpers

    private struct ClipList: Decodable { let clips: [Clip] }

    private func send(_ method: String, _ url: URL, _ body: [String: Any]?, done: @escaping (Bool) -> Void) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 6
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }

    /// Sends clips saved while the server was down, then drops the local copies.
    private var flushing = false
    private func flushLocal(_ local: [Clip]) {
        guard !flushing else { return }
        flushing = true
        let group = DispatchGroup()
        var sent = Set<String>()
        for clip in local {
            group.enter()
            send("POST", api, ["title": clip.title, "url": clip.url, "site": clip.site,
                               "kind": clip.kind, "text": clip.text]) { ok in
                if ok { sent.insert(clip.id) }
                group.leave()
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.flushing = false
            guard !sent.isEmpty else { return }
            self.writeLocal(self.loadLocal().filter { !sent.contains($0.id) })
            self.refresh()
        }
    }

    private func loadLocal() -> [Clip] {
        guard let data = try? Data(contentsOf: localPath),
              let list = try? JSONDecoder().decode([Clip].self, from: data) else { return [] }
        return list
    }

    private func writeLocal(_ list: [Clip]) {
        try? FileManager.default.createDirectory(at: localPath.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(list) else { return }
        try? data.write(to: localPath, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: localPath.path)
    }
}
