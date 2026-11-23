import Foundation

/// Fuente de datos de la app. Las vistas nunca hablan con proveedores externos:
/// sólo con un repositorio, que a su vez sólo habla con la API de Cine Mexa.
protocol CatalogRepository: Sendable {
    var mode: DataMode { get }
    func fetchSnapshot() async throws -> CatalogSnapshot
}

enum RepositoryError: LocalizedError, Equatable {
    case demoDataMissing
    case liveNotConfigured
    case badStatus(Int)
    case decoding(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .demoDataMissing: "No se encontraron los datos de demostración en la app."
        case .liveNotConfigured: "El modo en vivo todavía no está configurado. Agrega la URL del backend en Configuración."
        case .badStatus(let code): "El servidor respondió con un error (\(code))."
        case .decoding(let detail): "La respuesta del servidor no tiene el formato esperado. \(detail)"
        case .network(let detail): "No hay conexión con el servidor. \(detail)"
        }
    }
}

enum CineJSON {
    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let date = parseInstant(s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Fecha inválida: \(s)")
        }
        return d
    }

    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .iso8601
        return e
    }

    static func parseInstant(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }
}

// MARK: - Demo

/// Lee DemoData.json del bundle y resuelve sus fechas relativas al momento actual.
struct DemoRepository: CatalogRepository {
    let mode: DataMode = .demo
    var bundle: Bundle = .main
    var now: @Sendable () -> Date = { Date() }

    func fetchSnapshot() async throws -> CatalogSnapshot {
        guard let url = bundle.url(forResource: "DemoData", withExtension: "json") else {
            throw RepositoryError.demoDataMissing
        }
        let raw = try String(contentsOf: url, encoding: .utf8)
        let resolved = RelativeDateTokens.resolve(raw, now: now(), timeZone: .current)
        do {
            return try CineJSON.decoder().decode(CatalogSnapshot.self, from: Data(resolved.utf8))
        } catch {
            throw RepositoryError.decoding(String(describing: error))
        }
    }
}

/// Tokens de fecha de la demo:
///  - "rel:-3d"        → ahora − 3 días (instante ISO 8601)
///  - "rel:+2d@20:30"  → dentro de 2 días a las 20:30 hora local
///  - "rel:-27h"       → ahora − 27 horas
///  - "day:+5d"        → fecha de calendario local "AAAA-MM-DD"
enum RelativeDateTokens {
    static let pattern = try! NSRegularExpression(pattern: "\"(rel|day):([+-]?\\d+)([dh])(?:@(\\d{2}):(\\d{2}))?\"")

    static func resolve(_ text: String, now: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let dayFormatter = DateFormatter()
        dayFormatter.calendar = calendar
        dayFormatter.timeZone = timeZone
        dayFormatter.locale = Locale(identifier: "en_US_POSIX")
        dayFormatter.dateFormat = "yyyy-MM-dd"

        let ns = text as NSString
        var result = ""
        var cursor = 0
        for match in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let kind = ns.substring(with: match.range(at: 1))
            let amount = Int(ns.substring(with: match.range(at: 2))) ?? 0
            let unit = ns.substring(with: match.range(at: 3))
            var date: Date
            if unit == "h" {
                date = now.addingTimeInterval(TimeInterval(amount) * 3600)
            } else {
                date = calendar.date(byAdding: .day, value: amount, to: now) ?? now
            }
            if match.range(at: 4).location != NSNotFound,
               let h = Int(ns.substring(with: match.range(at: 4))),
               let m = Int(ns.substring(with: match.range(at: 5))) {
                date = calendar.date(bySettingHour: h, minute: m, second: 0, of: date) ?? date
            }
            let value = kind == "day" ? dayFormatter.string(from: date) : iso.string(from: date)
            result += "\"\(value)\""
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return result
    }
}

// MARK: - Live

struct LiveConfig: Codable, Equatable, Sendable {
    /// URL del proyecto Supabase, p. ej. https://xyzcompany.supabase.co
    var baseUrl: URL
    /// Clave pública (anon/publishable). Nunca una service_role key.
    var anonKey: String

    static func load(bundle: Bundle = .main, defaults: UserDefaults = .standard) -> LiveConfig? {
        if let s = defaults.string(forKey: "live.baseUrl"), let url = URL(string: s), url.scheme == "https",
           let key = defaults.string(forKey: "live.anonKey"), !key.isEmpty {
            return LiveConfig(baseUrl: url, anonKey: key)
        }
        guard let url = bundle.url(forResource: "LiveConfig", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(LiveConfig.self, from: data)
    }
}

/// Lee el catálogo desde la Edge Function `catalog` del backend (Fase 3/4).
struct LiveRepository: CatalogRepository {
    let mode: DataMode = .live
    var config: LiveConfig?
    var session: URLSession = .shared

    func fetchSnapshot() async throws -> CatalogSnapshot {
        guard let config else { throw RepositoryError.liveNotConfigured }
        var request = URLRequest(url: config.baseUrl.appending(path: "functions/v1/catalog"))
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw RepositoryError.network(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw RepositoryError.badStatus(http.statusCode)
        }
        do {
            let snapshot = try CineJSON.decoder().decode(CatalogSnapshot.self, from: data)
            guard snapshot.meta.mode == .live else {
                throw RepositoryError.decoding("El servidor envió datos de demostración en modo en vivo.")
            }
            return snapshot
        } catch let e as RepositoryError {
            throw e
        } catch {
            throw RepositoryError.decoding(String(describing: error))
        }
    }
}

// MARK: - Caché del último catálogo válido

/// Conserva en disco el último catálogo en vivo válido para mostrarlo si una actualización falla.
struct SnapshotCache: Sendable {
    var directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    private var fileURL: URL { directory.appending(path: "catalog-live.json") }

    func save(_ snapshot: CatalogSnapshot) {
        guard snapshot.meta.mode == .live, let data = try? CineJSON.encoder().encode(snapshot) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    func load() -> CatalogSnapshot? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? CineJSON.decoder().decode(CatalogSnapshot.self, from: data)
    }
}
