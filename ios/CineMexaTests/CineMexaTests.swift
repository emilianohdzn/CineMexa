import Testing
import Foundation
import MapKit
import UIKit
@testable import CineMexa

/// Tests de la capa de datos y reglas. Se ejecutan con ⌘U en Xcode o con
/// `xcodebuild test -scheme CineMexa -destination 'platform=iOS Simulator,name=iPhone 16'`.

@Suite("Datos de demostración")
struct DemoDataTests {
    let now = ISO8601DateFormatter().date(from: "2026-11-23T18:00:00Z")!

    @Test func decodificaElContratoCompleto() async throws {
        let repo = DemoRepository(bundle: Bundle(for: AppModel.self), now: { [now] in now })
        let snapshot = try await repo.fetchSnapshot()
        #expect(snapshot.meta.mode == .demo)
        #expect(snapshot.films.count >= 10)
        #expect(snapshot.festivals.count == 14)
        #expect(Set(snapshot.trends.map(\.window)) == Set(TrendWindow.allCases))
    }

    @Test func todoElContenidoDemoEstaMarcado() async throws {
        let snapshot = try await DemoRepository(bundle: Bundle(for: AppModel.self), now: { [now] in now }).fetchSnapshot()
        #expect(snapshot.films.allSatisfy { $0.provenance.verification == .demo })
        #expect(snapshot.reviews.allSatisfy { $0.provenance.verification == .demo })
        #expect(snapshot.festivalEvents.allSatisfy { $0.provenance.verification == .demo })
        #expect(snapshot.films.allSatisfy { $0.poster == nil }, "La demo nunca inventa pósters")
    }

    @Test func losCortosTienenLaMismaPresencia() async throws {
        let catalog = Catalog(try await DemoRepository(bundle: Bundle(for: AppModel.self), now: { [now] in now }).fetchSnapshot())
        #expect(catalog.films(matching: .shorts).count >= 3)
        #expect(!catalog.mapItems(period: .historic, kinds: Set(FestivalEventKind.allCases), filmKind: .short, query: "", now: now.addingTimeInterval(90 * 86_400)).isEmpty)
    }
}

@Suite("Fechas relativas de la demo")
struct RelativeDateTokenTests {
    let tz = TimeZone(identifier: "America/Mexico_City")!
    let now = ISO8601DateFormatter().date(from: "2026-11-23T18:00:00Z")! // 12:00 en CDMX

    @Test func resuelveDiasHorasYFechasDeCalendario() {
        let text = #"{"a":"rel:-2d","b":"rel:+1d@20:30","c":"day:+5d","d":"rel:-27h","e":"rel:+0d"}"#
        let out = RelativeDateTokens.resolve(text, now: now, timeZone: tz)
        #expect(out.contains(#""a":"2026-11-21T18:00:00Z""#))
        #expect(out.contains(#""b":"2026-11-25T02:30:00Z""#)) // 24 nov 20:30 CDMX
        #expect(out.contains(#""c":"2026-11-28""#))
        #expect(out.contains(#""d":"2026-11-22T15:00:00Z""#))
        #expect(out.contains(#""e":"2026-11-23T18:00:00Z""#))
    }

    @Test func noTocaTextoQueNoEsToken() {
        let text = #"{"title":"relámpago: day one","url":"https://example.com/rel:-2d"}"#
        #expect(RelativeDateTokens.resolve(text, now: now, timeZone: tz) == text)
    }
}

@Suite("Reglas de fechas")
struct DateLogicTests {
    func edition(_ s: String?, _ e: String?, cancelled: Bool = false) -> FestivalEdition {
        FestivalEdition(id: "e", label: "x", year: 2026, startsOn: s, endsOn: e, timezone: "America/Mexico_City",
                        programUrl: nil, callUrl: nil, callDeadline: nil, isCancelled: cancelled,
                        provenance: Provenance(source: "test", sourceUrl: nil, retrievedAt: .now, publishedAt: nil, verification: .verified, confidence: nil))
    }
    let now = ISO8601DateFormatter().date(from: "2026-11-23T18:00:00Z")!

    @Test func tiempoRelativoNuncaDiceDentroDeCeroSegundos() {
        #expect(CineFormat.relative(now, now: now) == "hace un momento")
        #expect(CineFormat.relative(now.addingTimeInterval(30), now: now) == "hace un momento")
        #expect(CineFormat.relative(now.addingTimeInterval(-20), now: now) == "hace un momento")
        #expect(CineFormat.relative(now.addingTimeInterval(-3 * 3600), now: now).hasPrefix("hace"))
    }

    @Test func estadoDeEdicionEsInclusivoYEnLaZonaDelFestival() {
        #expect(DateLogic.status(of: edition("2026-11-20", "2026-11-23"), now: now) == .active)
        #expect(DateLogic.status(of: edition("2026-11-24", "2026-11-30"), now: now) == .upcoming)
        #expect(DateLogic.status(of: edition("2026-10-01", "2026-10-05"), now: now) == .past)
        #expect(DateLogic.status(of: edition(nil, nil), now: now) == .unconfirmed)
        #expect(DateLogic.status(of: edition("2026-11-20", "2026-11-23", cancelled: true), now: now) == .cancelled)
    }

    @Test func elMapaNuncaMuestraActividadSinFecha() {
        #expect(DateLogic.isInPeriod(nil, period: .historic, now: now) == false)
        #expect(DateLogic.isInPeriod(now.addingTimeInterval(3 * 86_400), period: .week, now: now))
        #expect(DateLogic.isInPeriod(now.addingTimeInterval(-200 * 86_400), period: .upcoming, now: now) == false)
    }
}

@Suite("Catálogo")
struct CatalogTests {
    let now = ISO8601DateFormatter().date(from: "2026-11-23T18:00:00Z")!

    func catalog() async throws -> Catalog {
        Catalog(try await DemoRepository(bundle: Bundle(for: AppModel.self), now: { [now] in now }).fetchSnapshot())
    }

    @Test func estrenoIdentificadoNoEsFuncionConfirmada() async throws {
        let c = try await catalog()
        let domingo = try #require(c.snapshot.films.first { $0.slug == "domingo-siete" })
        #expect(c.upcomingScreenings(for: domingo.id, city: nil, now: now).isEmpty)
        #expect(c.availability(for: domingo, now: now).label == "Estreno identificado")
        let sal = try #require(c.snapshot.films.first { $0.slug == "la-sal-del-desierto" })
        #expect(c.availability(for: sal, now: now).label == "Exhibición confirmada en sala")
    }

    @Test func busquedaIgnoraAcentosYMayusculas() async throws {
        let c = try await catalog()
        #expect(c.search("ULTIMOS cometas").films.map(\.slug) == ["los-ultimos-cometas"])
        #expect(c.search("morelia").festivals.map(\.slug) == ["ficm"])
        #expect(c.search("x").isEmpty, "Menos de dos caracteres no busca")
    }

    @Test func filtrosDePeliculas() async throws {
        let c = try await catalog()
        #expect(c.films(matching: .documentaries).allSatisfy { $0.isDocumentary })
        #expect(c.films(matching: .animation).allSatisfy { $0.isAnimation })
        #expect(c.films(matching: .criticism).allSatisfy { !(c.reviewsByFilm[$0.id] ?? []).isEmpty })
        var r = FilmRefinements(); r.participation = .coproduction
        #expect(c.films(matching: .all, refinements: r).allSatisfy { $0.mxParticipation == .coproduction })
    }

    @Test func rankingNuncaTieneMasDeCincoNiHuecos() async throws {
        let c = try await catalog()
        for w in TrendWindow.allCases {
            let r = try #require(c.trends(w))
            #expect(r.entries.count <= 5)
            #expect(r.entries.map(\.rank) == Array(1...r.entries.count))
            #expect(r.label == "Tendencias digitales", "Sólo YouTube y medios")
        }
    }
}

@Suite("Repositorio en vivo")
struct LiveRepositoryTests {
    @Test func sinConfiguracionFallaConMensajeClaro() async {
        await #expect(throws: RepositoryError.liveNotConfigured) {
            try await LiveRepository(config: nil).fetchSnapshot()
        }
    }

    @MainActor
    @Test func unFalloEnVivoNoSeRellenaConDemo() async {
        struct Failing: CatalogRepository {
            let mode: DataMode = .live
            func fetchSnapshot() async throws -> CatalogSnapshot { throw RepositoryError.network("sin red") }
        }
        UserDefaults.standard.set("live", forKey: "data.mode")
        defer { UserDefaults.standard.removeObject(forKey: "data.mode") }
        let model = AppModel(repositoryFactory: { _ in Failing() })
        await model.load(force: true)
        #expect(model.catalog?.isDemo != true)
        if model.catalog == nil {
            #expect(model.state == .failed("No hay conexión con el servidor. sin red"))
        } else {
            #expect(model.isShowingCachedData)
        }
    }
}

@Suite("Encuadre del mapa")
struct MapFramingTests {
    let now = ISO8601DateFormatter().date(from: "2026-11-23T18:00:00Z")!

    func historicItems() async throws -> [Catalog.MapItem] {
        let catalog = Catalog(try await DemoRepository(bundle: Bundle(for: AppModel.self), now: { [now] in now }).fetchSnapshot())
        return catalog.mapItems(period: .historic, kinds: Set(FestivalEventKind.allCases), filmKind: nil, query: "", now: now)
    }

    @Test func separaAmericaDeEuropa() async throws {
        let items = try await historicItems()
        let groups = MapRegionGroup.groups(items)
        #expect(groups.map(\.items.count).reduce(0, +) == items.count)
        for group in groups {
            let lons = group.items.map(\.coordinate.longitude)
            #expect(lons.max()! - lons.min()! < 85, "Cada región cabe en lo que MapKit deja alejar")
        }
        let all = MapRegionGroup.groups(try await historicItems().filter { $0.festival.country == "MX" })
        #expect(all.count == 1 && all[0].name == "México")
    }

    @Test func elEncuadreContieneLaRegionYRespetaLaProporcion() async throws {
        let size = CGSize(width: 402, height: 675)
        for group in MapRegionGroup.groups(try await historicItems()) {
            let rect = FestivalMapView.fittingRect(group.items, viewSize: size)
            for item in group.items {
                #expect(rect.contains(MKMapPoint(item.coordinate)), "Falta \(item.festival.name)")
            }
            #expect(abs(rect.height / rect.width - Double(size.height / size.width)) < 0.01)
        }
    }
}

/// Marca para ubicar el bundle de pruebas (los recursos de Fixtures/ viven ahí).
private final class TestBundleMarker {}

@Suite("Catálogo del backend")
struct LiveCatalogContractTests {
    /// Muestra generada por backend/test/catalog.test.ts (CINEMEXA_WRITE_SAMPLE=1 npm test).
    @Test func decodificaLaRespuestaDeLaEdgeFunction() throws {
        let url = try #require(Bundle(for: TestBundleMarker.self).url(forResource: "live-catalog-sample", withExtension: "json"))
        let snapshot = try CineJSON.decoder().decode(CatalogSnapshot.self, from: Data(contentsOf: url))
        #expect(snapshot.meta.mode == .live)
        #expect(snapshot.films.count == 2)
        #expect(snapshot.films.allSatisfy { $0.provenance.verification == .automatic })
        #expect(snapshot.festivalEvents.contains { $0.occursAt == nil }, "sin fecha confirmada se conserva como nil")
        let catalog = Catalog(snapshot)
        #expect(!catalog.films(matching: .shorts).isEmpty)
        #expect(snapshot.meta.filmHashes?.count == 2, "el GET completo trae la huella de cada película")
    }

    static func sample() throws -> CatalogSnapshot {
        let url = try #require(Bundle(for: TestBundleMarker.self).url(forResource: "live-catalog-sample", withExtension: "json"))
        return try CineJSON.decoder().decode(CatalogSnapshot.self, from: Data(contentsOf: url))
    }

    @Test func incrementalReconstruyeCambiosYEliminaciones() throws {
        let previous = try Self.sample()
        var delta = previous
        var changed = previous.films[0]
        changed.title = "Título corregido"
        delta.films = [changed]
        delta.meta.delta = SnapshotDelta(filmIds: [changed.id], changed: 1, total: 1)
        let merged = try LiveRepository.merge(previous: previous, delta: delta)
        #expect(merged.films.map(\.id) == [changed.id], "la película que ya no está en el orden vigente se elimina")
        #expect(merged.films[0].title == "Título corregido")
        #expect(merged.meta.delta == nil)

        delta.meta.delta = SnapshotDelta(filmIds: [changed.id, "desconocida"], changed: 1, total: 2)
        #expect(throws: RepositoryError.self) { try LiveRepository.merge(previous: previous, delta: delta) }
    }

    @Test func siElIncrementalFallaPideElCatalogoCompleto() async throws {
        let sample = try Self.sample()
        let dir = FileManager.default.temporaryDirectory.appending(path: "cache-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let cache = SnapshotCache(directory: dir)
        cache.save(sample)
        let full = try CineJSON.encoder().encode(sample)
        StubURLProtocol.responder = { request in
            if request.httpMethod == "POST" { return (400, Data(#"{"error":"invalid_delta_request"}"#.utf8)) }
            return (200, full)
        }
        StubURLProtocol.requests = []
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let repo = LiveRepository(config: LiveConfig(baseUrl: URL(string: "https://ejemplo.supabase.co")!, anonKey: "publica"),
                                  session: URLSession(configuration: config), cache: cache)
        let snapshot = try await repo.fetchSnapshot()
        #expect(snapshot.films.count == sample.films.count)
        #expect(StubURLProtocol.requests == ["POST", "GET"], "primero intenta el incremental, luego el completo")
    }
}

/// Servidor simulado para LiveRepository.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responder: (URLRequest) -> (Int, Data) = { _ in (500, Data()) }
    nonisolated(unsafe) static var requests: [String] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request.httpMethod ?? "GET")
        let (status, body) = Self.responder(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite("Imágenes")
struct ImageTests {
    @Test func tamanoDeTMDBSeReescribeSoloEnSuDominio() {
        let tmdb = URL(string: "https://image.tmdb.org/t/p/w780/abc123.jpg")!
        #expect(tmdb.tmdbResized(.w342).absoluteString == "https://image.tmdb.org/t/p/w342/abc123.jpg")
        #expect(tmdb.tmdbResized(.original).absoluteString == "https://image.tmdb.org/t/p/original/abc123.jpg")
        let oficial = URL(string: "https://festival.example/t/p/w780/poster.jpg")!
        #expect(oficial.tmdbResized(.w185) == oficial)
        let raro = URL(string: "https://image.tmdb.org/otra/ruta.jpg")!
        #expect(raro.tmdbResized(.w185) == raro)
    }

    @Test func elTamanoPedidoCubreElAnchoSinExcederse() {
        #expect(ImageSizing.posterSize(forPixelWidth: 120) == .w185)   // miniatura de 40 pt a 3x
        #expect(ImageSizing.posterSize(forPixelWidth: 330) == .w342)   // tarjeta de 165 pt a 2x
        #expect(ImageSizing.posterSize(forPixelWidth: 390) == .w500)   // ficha de 130 pt a 3x
        #expect(ImageSizing.posterSize(forPixelWidth: 900) == .w780)   // portada
        #expect(ImageSizing.backdropSize(forPixelWidth: 1179) == .w1280)
    }

    @Test func laMiniaturaSeDecodificaAlTamanoPedido() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 900), format: {
            let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f
        }())
        let data = try #require(renderer.image { ctx in
            UIColor.orange.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 600, height: 900))
        }.jpegData(compressionQuality: 0.8))
        let thumb = try #require(ImagePipeline.downsample(data, maxPixel: 300))
        #expect(max(thumb.size.width * thumb.scale, thumb.size.height * thumb.scale) == 300)
        #expect(ImagePipeline.downsample(Data("no es imagen".utf8), maxPixel: 300) == nil)
    }
}
