import Foundation
import CoreLocation

/// Índices y consultas sobre un CatalogSnapshot. Las vistas consultan aquí, nunca recorren JSON.
final class Catalog: @unchecked Sendable {
    let snapshot: CatalogSnapshot
    let filmsByID: [String: Film]
    let festivalsByID: [String: Festival]
    let editionsByID: [String: (FestivalEdition, Festival)]
    let reviewsByFilm: [String: [Review]]
    let screeningsByFilm: [String: [Screening]]
    let eventsByFilm: [String: [FestivalEvent]]
    let eventsByFestival: [String: [FestivalEvent]]
    let timelineByFilm: [String: [TimelineEvent]]

    init(_ snapshot: CatalogSnapshot) {
        self.snapshot = snapshot
        filmsByID = Dictionary(snapshot.films.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        festivalsByID = Dictionary(snapshot.festivals.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var editions: [String: (FestivalEdition, Festival)] = [:]
        for f in snapshot.festivals { for e in f.editions { editions[e.id] = (e, f) } }
        editionsByID = editions
        reviewsByFilm = Dictionary(grouping: snapshot.reviews, by: \.filmId).mapValues { $0.sorted { $0.publishedAt > $1.publishedAt } }
        screeningsByFilm = Dictionary(grouping: snapshot.screenings, by: \.filmId).mapValues { $0.sorted { $0.startsAt < $1.startsAt } }
        eventsByFilm = Dictionary(grouping: snapshot.festivalEvents, by: \.filmId)
        eventsByFestival = Dictionary(grouping: snapshot.festivalEvents, by: \.festivalId)
        timelineByFilm = Dictionary(grouping: snapshot.timeline, by: \.filmId).mapValues { $0.sorted { $0.date < $1.date } }
    }

    var isDemo: Bool { snapshot.meta.mode == .demo }

    func film(_ id: String) -> Film? { filmsByID[id] }
    func festival(_ id: String) -> Festival? { festivalsByID[id] }

    // MARK: Películas

    /// Etiqueta de disponibilidad en México. Distingue estreno identificado de función confirmada.
    func availability(for film: Film, now: Date = Date()) -> (label: String, symbol: String) {
        let upcoming = (screeningsByFilm[film.id] ?? []).filter { $0.startsAt >= now.addingTimeInterval(-3 * 3600) }
        if upcoming.contains(where: { $0.kind == .commercial }) { return (ScreeningKind.commercial.label, "ticket.fill") }
        if let s = upcoming.first(where: { $0.kind == .cineteca || $0.kind == .cineclub }) { return (s.kind.label, "film.stack") }
        return (film.status.label, film.status.symbol)
    }

    func upcomingScreenings(for filmID: String, city: String?, now: Date = Date()) -> [Screening] {
        (screeningsByFilm[filmID] ?? []).filter {
            $0.startsAt >= now.addingTimeInterval(-3 * 3600) && (city == nil || $0.venue.city == city)
        }
    }

    var cities: [String] {
        Array(Set(snapshot.screenings.map(\.venue.city))).sorted()
    }

    /// Películas para el hero: lo que está pasando ahora, sin repetir.
    var heroFilms: [Film] {
        let order: [FilmStatus] = [.inTheaters, .releaseIdentified, .festival, .upcoming]
        return snapshot.films
            .filter { $0.status != .archive }
            .sorted { (order.firstIndex(of: $0.status) ?? 9, $0.title) < (order.firstIndex(of: $1.status) ?? 9, $1.title) }
            .prefix(6).map { $0 }
    }

    var billboardFilms: [Film] {
        snapshot.films.filter { [.inTheaters, .releaseIdentified, .upcoming].contains($0.status) }
            .sorted { ($0.mxReleaseDate ?? "9999") < ($1.mxReleaseDate ?? "9999") }
    }

    func films(matching filter: FilmFilter, refinements: FilmRefinements = .init()) -> [Film] {
        snapshot.films.filter { film in
            let passesFilter: Bool = switch filter {
            case .all: true
            case .inTheaters: film.status == .inTheaters || film.status == .releaseIdentified
            case .upcoming: film.status == .upcoming
            case .festivals: !(eventsByFilm[film.id] ?? []).isEmpty
            case .shorts: film.kind == .short
            case .documentaries: film.isDocumentary
            case .animation: film.isAnimation
            case .criticism: !(reviewsByFilm[film.id] ?? []).isEmpty
            case .archive: film.status == .archive
            }
            return passesFilter && refinements.matches(film)
        }
        .sorted { ($0.year ?? 0, $0.title) > ($1.year ?? 0, $1.title) }
    }

    var allGenres: [String] { Array(Set(snapshot.films.flatMap(\.genres))).sorted() }
    var allYears: [Int] { Array(Set(snapshot.films.compactMap(\.year))).sorted(by: >) }
    var allDirectors: [String] { Array(Set(snapshot.films.flatMap(\.directors))).sorted() }

    // MARK: Crítica

    var recentReviews: [Review] {
        snapshot.reviews.filter { !$0.isAutomatedSummary }.sorted { $0.publishedAt > $1.publishedAt }
    }

    // MARK: Festivales

    struct EditionRef: Identifiable, Hashable {
        let festival: Festival
        let edition: FestivalEdition
        var id: String { edition.id }
    }

    var allEditions: [EditionRef] {
        snapshot.festivals.flatMap { f in f.editions.map { EditionRef(festival: f, edition: $0) } }
            .sorted { ($0.edition.startsOn ?? "9999") < ($1.edition.startsOn ?? "9999") }
    }

    func editions(status: Set<EditionStatus>, now: Date = Date()) -> [EditionRef] {
        allEditions.filter { status.contains(DateLogic.status(of: $0.edition, now: now)) }
    }

    /// Convocatorias con fecha límite futura confirmada, de la más próxima a la más lejana.
    func openCalls(now: Date = Date()) -> [EditionRef] {
        allEditions.filter { ($0.edition.callDeadline ?? .distantPast) > now && $0.edition.callUrl != nil }
            .sorted { $0.edition.callDeadline! < $1.edition.callDeadline! }
    }

    func editions(activeOn day: String) -> [EditionRef] {
        allEditions.filter { ref in
            guard let s = ref.edition.startsOn, let e = ref.edition.endsOn, !ref.edition.isCancelled else { return false }
            return s <= day && day <= e
        }
    }

    struct FilmEvents: Identifiable {
        let film: Film
        let events: [FestivalEvent]
        var id: String { film.id }
    }

    func groupByFilm(_ events: [FestivalEvent]) -> [FilmEvents] {
        Dictionary(grouping: events, by: \.filmId)
            .compactMap { (id, evs) -> FilmEvents? in
                guard let f = film(id) else { return nil }
                let sorted = evs.sorted { a, b in (a.occursAt ?? .distantFuture) < (b.occursAt ?? .distantFuture) }
                return FilmEvents(film: f, events: sorted)
            }
            .sorted { a, b in a.film.title < b.film.title }
    }

    func mexicanFilms(in festival: Festival) -> [FilmEvents] {
        groupByFilm(eventsByFestival[festival.id] ?? [])
    }

    // MARK: Mapa

    struct MapItem: Identifiable, Hashable {
        let festival: Festival
        let events: [FestivalEvent]
        var id: String { festival.id }
        var coordinate: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: festival.venue.latitude, longitude: festival.venue.longitude)
        }
        static func == (a: MapItem, b: MapItem) -> Bool { a.id == b.id && a.events == b.events }
        func hash(into h: inout Hasher) { h.combine(id) }
    }

    /// Festivales con actividad documentada en el periodo.
    /// Una selección sin fecha sólo cuenta si la edición se traslapa con el periodo;
    /// nunca se presenta como función actual.
    func mapItems(period: MapPeriod, kinds: Set<FestivalEventKind>, filmKind: FilmKind?, query: String, now: Date = Date()) -> [MapItem] {
        let q = query.trimmingCharacters(in: .whitespaces).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: CineFormat.locale)
        return snapshot.festivals.compactMap { fest in
            let evs = (eventsByFestival[fest.id] ?? []).filter { ev in
                guard kinds.contains(ev.kind), let film = film(ev.filmId) else { return false }
                if let filmKind, film.kind != filmKind { return false }
                if !q.isEmpty && !film.title.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: CineFormat.locale).contains(q) { return false }
                if let at = ev.occursAt { return DateLogic.isInPeriod(at, period: period, now: now) }
                guard let pair = editionsByID[ev.editionId] else { return false }
                return DateLogic.editionOverlaps(pair.0, period: period, now: now)
            }
            return evs.isEmpty ? nil : MapItem(festival: fest, events: evs)
        }
    }

    // MARK: Tendencias

    func trends(_ window: TrendWindow) -> TrendRanking? {
        snapshot.trends.first { $0.window == window }
    }

    // MARK: Búsqueda

    struct SearchResults {
        var films: [Film] = []
        var festivals: [Festival] = []
        var reviews: [Review] = []
        var isEmpty: Bool { films.isEmpty && festivals.isEmpty && reviews.isEmpty }
    }

    func search(_ text: String) -> SearchResults {
        let q = Self.fold(text)
        guard q.count >= 2 else { return SearchResults() }
        let films = snapshot.films.filter { f in
            ([f.title, f.originalTitle ?? ""] + f.altTitles + f.directors + f.cast + f.genres).contains { Self.fold($0).contains(q) }
        }
        let festivals = snapshot.festivals.filter { f in
            [f.name, f.shortName ?? "", f.city].contains { Self.fold($0).contains(q) }
        }
        let reviews = snapshot.reviews.filter { r in
            [r.title, r.outlet, r.criticName ?? ""].contains { Self.fold($0).contains(q) }
        }
        return SearchResults(films: films, festivals: festivals, reviews: reviews)
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: CineFormat.locale)
    }
}

enum FilmFilter: String, CaseIterable, Identifiable {
    case all, inTheaters, upcoming, festivals, shorts, documentaries, animation, criticism, archive
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "Todas"
        case .inTheaters: "En cartelera"
        case .upcoming: "Próximamente"
        case .festivals: "En festivales"
        case .shorts: "Cortometrajes"
        case .documentaries: "Documentales"
        case .animation: "Animación"
        case .criticism: "Crítica"
        case .archive: "Archivo"
        }
    }
}

struct FilmRefinements: Equatable {
    var year: Int?
    var genre: String?
    var director: String?
    var participation: MexicanParticipation?
    var streamingOnly = false
    var filmsWithStreaming: Set<String> = []

    var isActive: Bool { year != nil || genre != nil || director != nil || participation != nil || streamingOnly }

    func matches(_ film: Film) -> Bool {
        if let year, film.year != year { return false }
        if let genre, !film.genres.contains(genre) { return false }
        if let director, !film.directors.contains(director) { return false }
        if let participation, film.mxParticipation != participation { return false }
        if streamingOnly && !filmsWithStreaming.contains(film.id) { return false }
        return true
    }
}
