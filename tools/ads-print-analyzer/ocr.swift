import AppKit
import Foundation
import Vision

struct TextLine: Encodable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let confidence: Float
}

guard CommandLine.arguments.count == 2,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Não foi possível abrir a imagem.\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["pt-BR", "en-US"]
request.usesLanguageCorrection = true

do {
    try VNImageRequestHandler(cgImage: cgImage).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> TextLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return TextLine(
            text: candidate.string,
            x: Double(box.minX),
            y: Double(1 - box.maxY),
            width: Double(box.width),
            height: Double(box.height),
            confidence: candidate.confidence
        )
    }
    let data = try JSONEncoder().encode(lines)
    FileHandle.standardOutput.write(data)
} catch {
    let detail = error as NSError
    fputs("Falha no reconhecimento de texto: \(detail.domain) código \(detail.code) \(detail.userInfo)\n", stderr)
    exit(1)
}
