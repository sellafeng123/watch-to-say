#!/usr/bin/env swift

import AppKit
import Foundation
import PDFKit
import Vision

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let x: CGFloat
    let y: CGFloat
}

struct OCRPage: Codable {
    let page: Int
    let lines: [OCRLine]
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(code)
}

func renderPage(_ page: PDFPage, scale: CGFloat = 2) throws -> CGImage {
    let bounds = page.bounds(for: .mediaBox)
    let width = max(1, Int(ceil(bounds.width * scale)))
    let height = max(1, Int(ceil(bounds.height * scale)))
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "IELTSOCR", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Could not allocate a bitmap for a PDF page.",
        ])
    }

    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = context
    context.cgContext.setFillColor(NSColor.white.cgColor)
    context.cgContext.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.cgContext.scaleBy(x: scale, y: scale)
    context.cgContext.translateBy(x: -bounds.minX, y: -bounds.minY)
    page.draw(with: .mediaBox, to: context.cgContext)

    guard let image = bitmap.cgImage else {
        throw NSError(domain: "IELTSOCR", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "Could not create an image for a PDF page.",
        ])
    }
    return image
}

func recognizeLines(in image: CGImage) throws -> [OCRLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US", "zh-Hans"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return OCRLine(
            text: candidate.string,
            confidence: candidate.confidence,
            x: observation.boundingBox.minX,
            y: observation.boundingBox.maxY
        )
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fail("Usage: ocr-ielts-pdf.swift INPUT.pdf OUTPUT.json", code: 2)
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])
guard FileManager.default.isReadableFile(atPath: inputURL.path),
      let document = PDFDocument(url: inputURL) else {
    fail("IELTS OCR failed: unreadable PDF input: \(inputURL.path)")
}
guard document.pageCount > 0 else {
    fail("IELTS OCR failed: PDF has zero pages.")
}

var pages: [OCRPage] = []
var recognizedLineCount = 0
do {
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else {
            fail("IELTS OCR failed: could not read page \(index + 1).")
        }
        let lines = try recognizeLines(in: renderPage(page))
        recognizedLineCount += lines.count
        pages.append(OCRPage(page: index + 1, lines: lines))
        FileHandle.standardError.write(Data("OCR page \(index + 1)/\(document.pageCount): \(lines.count) lines\n".utf8))
    }
} catch {
    fail("IELTS OCR failed: \(error.localizedDescription)")
}

guard recognizedLineCount > 0 else {
    fail("IELTS OCR failed: zero recognized lines.")
}

do {
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(pages)
    try data.write(to: outputURL, options: .atomic)
    FileHandle.standardError.write(Data("Wrote \(pages.count) pages and \(recognizedLineCount) lines to \(outputURL.path).\n".utf8))
} catch {
    fail("IELTS OCR failed while writing output: \(error.localizedDescription)")
}
