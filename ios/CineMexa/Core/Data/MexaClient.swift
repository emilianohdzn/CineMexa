import Foundation

/// Respuesta de Mexa (Fase A, sin modelo): texto, elementos enlazables y las fuentes que la sostienen.
struct MexaAnswer: Codable, Equatable, Sendable {
    struct Item: Codable, Equatable, Sendable, Hashable {
        var label: String
        var filmId: String?
        var festivalId: String?
    }
    struct Citation: Codable, Equatable, Sendable, Hashable {
        var type: String
        var id: String
        var label: String
        var source: String
        var url: String?
        var retrievedAt: String?
        var verification: String
        var link: URL? { url.flatMap(URL.init(string:)).flatMap { $0.scheme == "https" || $0.scheme == "http" ? $0 : nil } }
    }
    struct Option: Codable, Equatable, Sendable, Hashable {
        var label: String
        var filmId: String
    }
    var intent: String
    var text: String
    var items: [Item]
    var citations: [Citation]
    var options: [Option]?
    var unanswered: String?
}

/// Llama a la Edge Function `mexa` con la misma configuración pública que el catálogo.
struct MexaClient: Sendable {
    var config: LiveConfig?
    var session: URLSession = .shared

    func ask(_ question: String) async throws -> MexaAnswer {
        guard let config else { throw RepositoryError.liveNotConfigured }
        var request = URLRequest(url: config.baseUrl.appending(path: "functions/v1/mexa"))
        request.httpMethod = "POST"
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20
        request.httpBody = try JSONEncoder().encode(["question": question])
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
            return try CineJSON.decoder().decode(MexaAnswer.self, from: data)
        } catch {
            throw RepositoryError.decoding(String(describing: error))
        }
    }
}
