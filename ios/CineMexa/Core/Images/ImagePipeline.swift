import UIKit
import ImageIO

/// Tamaños que sirve image.tmdb.org. El catálogo trae el póster en w780; la app pide el que necesita.
enum TMDBImageSize: String, Sendable {
    case w92, w185, w342, w500, w780, w1280, original
}

extension URL {
    /// Cambia el segmento de tamaño de una URL de image.tmdb.org (`/t/p/w780/x.jpg` → `/t/p/w342/x.jpg`).
    /// Cualquier otra URL (póster oficial, editorial) se devuelve sin cambios.
    func tmdbResized(_ size: TMDBImageSize) -> URL {
        guard host == "image.tmdb.org" else { return self }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.count >= 4, parts[0] == "t", parts[1] == "p" else { return self }
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)
        components?.path = "/t/p/\(size.rawValue)/" + parts.dropFirst(3).joined(separator: "/")
        return components?.url ?? self
    }
}

enum ImageLoadError: Error, Equatable {
    case http(Int)
    case undecodable
}

/// Descarga, reduce y guarda en caché imágenes remotas.
/// - Reducción con ImageIO al tamaño en pantalla: una miniatura no decodifica un póster de 780 px.
/// - Caché en memoria por URL y tamaño (NSCache con límite de costo) sobre URLCache en disco.
/// - Una sola descarga por URL aunque varias celdas la pidan a la vez.
/// - Reintentos con espera ante errores transitorios (red, 5xx, 429); un 404 no se reintenta.
/// - La cancelación (celda que sale de pantalla) no se guarda como fallo: al volver, se reintenta.
actor ImagePipeline {
    static let shared = ImagePipeline()

    private let memory = NSCache<NSString, UIImage>()
    private var inflight: [String: Task<Data, Error>] = [:]
    private let session: URLSession
    private let retries: Int

    init(session: URLSession? = nil, retries: Int = 2) {
        memory.totalCostLimit = 64 * 1024 * 1024
        memory.countLimit = 400
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.urlCache = URLCache.shared
            config.requestCachePolicy = .returnCacheDataElseLoad
            config.httpMaximumConnectionsPerHost = 6
            config.timeoutIntervalForRequest = 20
            self.session = URLSession(configuration: config)
        }
        self.retries = retries
    }

    nonisolated func cachedImage(for url: URL, maxPixel: CGFloat) -> UIImage? {
        memory.object(forKey: Self.key(url, maxPixel))
    }

    func image(for url: URL, maxPixel: CGFloat) async throws -> UIImage {
        let key = Self.key(url, maxPixel)
        if let hit = memory.object(forKey: key) { return hit }
        let data = try await data(for: url)
        try Task.checkCancellation()
        guard let image = Self.downsample(data, maxPixel: maxPixel) else { throw ImageLoadError.undecodable }
        let cost = Int(image.size.width * image.scale * image.size.height * image.scale * 4)
        memory.setObject(image, forKey: key, cost: cost)
        return image
    }

    private func data(for url: URL) async throws -> Data {
        let id = url.absoluteString
        if let running = inflight[id] { return try await running.value }
        let session = self.session, retries = self.retries
        let task = Task<Data, Error> {
            var attempt = 0
            while true {
                do {
                    let (data, response) = try await session.data(from: url)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 200
                    if status == 200 { return data }
                    throw ImageLoadError.http(status)
                } catch {
                    let transient: Bool = {
                        if case ImageLoadError.http(let s) = error { return s == 429 || s >= 500 }
                        if let e = error as? URLError { return e.code != .cancelled && e.code != .badURL && e.code != .unsupportedURL }
                        return false
                    }()
                    guard transient, attempt < retries, !Task.isCancelled else { throw error }
                    attempt += 1
                    try await Task.sleep(nanoseconds: UInt64(400_000_000 * attempt))
                }
            }
        }
        inflight[id] = task
        defer { inflight[id] = nil }
        return try await task.value
    }

    private static func key(_ url: URL, _ maxPixel: CGFloat) -> NSString {
        "\(url.absoluteString)#\(Int(maxPixel))" as NSString
    }

    /// Decodifica directamente a una miniatura del lado mayor `maxPixel` (sin pasar por la imagen completa).
    static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options) else { return nil }
        let thumb = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixel),
        ] as CFDictionary
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumb) else { return nil }
        return UIImage(cgImage: cg)
    }
}
