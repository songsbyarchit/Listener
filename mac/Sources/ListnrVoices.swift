import Foundation

struct ListnrVoice: Decodable {
    let id: String
    let name: String
    let note: String?

    var displayNote: String { note?.isEmpty == false ? note! : "Voice" }
}

/// Reads the voice list and default from the same local server the Chrome
/// reader uses. The fallback list is the server's stock Kokoro catalogue.
final class ListnrVoiceCatalog {
    static let shared = ListnrVoiceCatalog()
    static let serverURL = URL(string: "http://127.0.0.1:8787")!

    private(set) var voices: [ListnrVoice] = [
        ListnrVoice(id: "af_heart", name: "Heart", note: "US English · warm female"),
        ListnrVoice(id: "af_bella", name: "Bella", note: "US English · bright female"),
        ListnrVoice(id: "af_nicole", name: "Nicole", note: "US English · soft female"),
        ListnrVoice(id: "af_sarah", name: "Sarah", note: "US English · clear female"),
        ListnrVoice(id: "am_michael", name: "Michael", note: "US English · calm male"),
        ListnrVoice(id: "am_fenrir", name: "Fenrir", note: "US English · deep male"),
        ListnrVoice(id: "am_adam", name: "Adam", note: "US English · neutral male"),
        ListnrVoice(id: "bf_emma", name: "Emma", note: "UK English · female"),
        ListnrVoice(id: "bm_george", name: "George", note: "UK English · male")
    ]
    private(set) var defaultVoice = "af_heart"
    private(set) var providerLabel = "Local Kokoro"
    private(set) var online = false

    private var loading = false
    private var waiters: [() -> Void] = []

    private struct Response: Decodable {
        let voices: [ListnrVoice]
        let defaultVoice: String?
        let providerLabel: String?
    }

    func voice(id: String) -> ListnrVoice? {
        voices.first { $0.id == id }
    }

    func currentVoice() -> ListnrVoice? {
        voice(id: ListnrPreferences.shared.voiceID) ?? voices.first
    }

    func refresh(completion: (() -> Void)? = nil) {
        if let completion { waiters.append(completion) }
        guard !loading else { return }
        loading = true

        var request = URLRequest(url: Self.serverURL.appendingPathComponent("api/voices"))
        request.timeoutInterval = 4
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            var updated: Response?
            if let http = response as? HTTPURLResponse,
               (200..<300).contains(http.statusCode),
               let data {
                updated = try? JSONDecoder().decode(Response.self, from: data)
            }
            DispatchQueue.main.async {
                self.online = updated != nil
                if let updated, !updated.voices.isEmpty {
                    self.voices = updated.voices
                    if let voice = updated.defaultVoice, !voice.isEmpty {
                        self.defaultVoice = voice
                    }
                    if let label = updated.providerLabel, !label.isEmpty {
                        self.providerLabel = label
                    }
                }
                self.loading = false
                let waiters = self.waiters
                self.waiters.removeAll()
                waiters.forEach { $0() }
            }
        }.resume()
    }
}

final class ListnrPreferences {
    static let shared = ListnrPreferences()
    private let key = "listnr.desktop.voice"

    private init() {}

    var hasExplicitVoice: Bool {
        guard let value = UserDefaults.standard.string(forKey: key) else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var voiceID: String {
        get {
            let stored = UserDefaults.standard.string(forKey: key)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !stored.isEmpty,
               ListnrVoiceCatalog.shared.voice(id: stored) != nil {
                return stored
            }
            return ListnrVoiceCatalog.shared.defaultVoice
        }
        set {
            UserDefaults.standard.set(newValue, forKey: key)
        }
    }
}
