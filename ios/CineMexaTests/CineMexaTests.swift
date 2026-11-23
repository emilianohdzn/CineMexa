import Testing
import Foundation
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
