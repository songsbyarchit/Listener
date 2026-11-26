import Foundation
import AVFoundation

final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    enum State { case speaking, paused, finished }
    var onState: ((State) -> Void)?
    private let synth = AVSpeechSynthesizer()

    override init() {
        super.init()
        synth.delegate = self
    }

    func speak(_ text: String) {
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
        utterance.rate = 0.5
        synth.speak(utterance)
        onState?(.speaking)
    }

    func togglePause() {
        if synth.isPaused {
            synth.continueSpeaking()
            onState?(.speaking)
        } else if synth.isSpeaking {
            synth.pauseSpeaking(at: .immediate)
            onState?(.paused)
        }
    }

    func stop() {
        synth.stopSpeaking(at: .immediate)
        onState?(.finished)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onState?(.finished)
    }
}
