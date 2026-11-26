import Foundation

struct ReadEntry: Codable, Identifiable {
    var id: String
    var date: Date
    var text: String
    var source: String
    /// The server voice that read it. Older entries have none.
    var voice: String?
}

final class ReadStore {
    static let shared = ReadStore()
    private(set) var entries: [ReadEntry] = []
    private let path = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".listnr", isDirectory: true)
        .appendingPathComponent("reads.json")

    private init() { load() }

    func add(text: String, source: String, voice: String? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        entries.insert(ReadEntry(id: UUID().uuidString, date: Date(),
                                 text: trimmed, source: source, voice: voice), at: 0)
        if entries.count > 500 { entries.removeLast(entries.count - 500) }
        save()
    }

    private func load() {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: path),
              let decoded = try? decoder.decode([ReadEntry].self, from: data) else { return }
        entries = decoded
    }

    private func save() {
        try? FileManager.default.createDirectory(at: path.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(entries) else { return }
        try? data.write(to: path, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
}
