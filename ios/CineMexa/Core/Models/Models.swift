import Foundation

// Contrato de datos de la API de Cine Mexa (versión 1).
// Es el mismo JSON que produce el backend y que contiene DemoData.json.
// Las claves llegan en snake_case y se decodifican con .convertFromSnakeCase.
// Las fechas-instante son Date (UTC); las fechas de calendario son String "AAAA-MM-DD".

enum DataMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case demo, live
    var id: String { rawValue }
}

enum VerificationStatus: String, Codable, Sendable {
    case verified, editorial, automatic, unverified, demo
}

struct Provenance: Codable, Hashable, Sendable {
    var source: String
    var sourceUrl: URL?
    var retrievedAt: Date
    var publishedAt: Date?
    var verification: VerificationStatus
    var confidence: Double?
}

struct ImageAsset: Codable, Hashable, Sendable {
    var url: URL
    var width: Int?
    var height: Int?
    var source: String
    var attribution: String?
}

enum FilmKind: String, Codable, Sendable { case feature, short }
enum MexicanParticipation: String, Codable, Sendable { case majority, coproduction, minority, unknown }

enum FilmStatus: String, Codable, CaseIterable, Sendable {
    case inTheaters = "in_theaters"
    case releaseIdentified = "release_identified"
    case festival
    case upcoming
    case archive
}

struct Film: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var slug: String
    var title: String
    var originalTitle: String?
    var altTitles: [String]
    var year: Int?
    var kind: FilmKind
    var runtimeMinutes: Int?
    var countries: [String]
    var mxParticipation: MexicanParticipation
    var genres: [String]
    var isDocumentary: Bool
    var isAnimation: Bool
    var synopsis: String?
    var poster: ImageAsset?
    var backdrop: ImageAsset?
    var directors: [String]
    var writers: [String]
    var cinematographers: [String]
    var cast: [String]
    var trailerUrl: URL?
    var status: FilmStatus
    var mxReleaseDate: String?
    var provenance: Provenance
}

struct Venue: Codable, Hashable, Sendable {
    var name: String
    var city: String
    var country: String
    var latitude: Double
    var longitude: Double
    var coordinatePrecision: String?
}

enum ScreeningKind: String, Codable, Sendable { case commercial, cineteca, cineclub, festival }

struct Screening: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var filmId: String
    var venue: Venue
    var kind: ScreeningKind
    var startsAt: Date
    var ticketUrl: URL?
    var provenance: Provenance
}

struct StreamingOffer: Codable, Hashable, Sendable {
    var filmId: String
    var provider: String
    var offerType: String
    var url: URL?
    var provenance: Provenance
}

struct Review: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var filmId: String
    var outlet: String
    var criticName: String?
    var title: String
    var url: URL
    var publishedAt: Date
    /// Sólo presente cuando el uso de la puntuación está autorizado.
    var score: Double?
    var scoreScale: Double?
    /// Sólo presente cuando su reproducción está permitida.
    var excerpt: String?
    var isAutomatedSummary: Bool
    var provenance: Provenance
}

enum TimelineKind: String, Codable, Sendable {
    case festivalSelection = "festival_selection"
    case festivalScreening = "festival_screening"
    case premiere, award
    case theatricalRelease = "theatrical_release"
    case streaming
}

struct TimelineEvent: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var filmId: String
    var kind: TimelineKind
    var date: Date
    var label: String
    var place: String?
    var provenance: Provenance
}

struct FestivalEdition: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var label: String
    var year: Int
    var startsOn: String?
    var endsOn: String?
    var timezone: String
    var programUrl: URL?
    var callUrl: URL?
    var callDeadline: Date?
    var isCancelled: Bool
    var provenance: Provenance
}

struct Festival: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var slug: String
    var name: String
    var shortName: String?
    var city: String
    var country: String
    var websiteUrl: URL?
    var focus: [String]
    var venue: Venue
    var editions: [FestivalEdition]
    var provenance: Provenance

    var displayName: String { shortName ?? name }
}

enum FestivalEventKind: String, Codable, CaseIterable, Sendable { case selection, screening, award, premiere }

struct FestivalEvent: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var editionId: String
    var festivalId: String
    var filmId: String
    var kind: FestivalEventKind
    var section: String?
    var awardName: String?
    /// nil = sin fecha confirmada. Nunca se muestra como actividad actual.
    var occursAt: Date?
    var announcedAt: Date?
    var provenance: Provenance
}

enum NewsKind: String, Codable, Sendable { case selection, award, premiere, call, publication, industry }

struct NewsItem: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var kind: NewsKind
    var title: String
    var url: URL
    var outlet: String?
    var publishedAt: Date
    var filmId: String?
    var festivalId: String?
    var provenance: Provenance
}

enum TrendWindow: String, Codable, CaseIterable, Identifiable, Sendable {
    case day = "24h", week = "7d", month = "30d"
    var id: String { rawValue }
}

struct TrendSignal: Codable, Hashable, Sendable {
    var source: String
    var metric: String
    var current: Double
    var baseline: Double
    var growthPct: Double?
}

struct TrendEntry: Codable, Hashable, Sendable {
    var filmId: String
    var rank: Int
    var previousRank: Int?
    var score: Int
    var explanation: String
    var signals: [TrendSignal]
}

struct TrendPoint: Codable, Hashable, Sendable {
    var date: Date
    var filmId: String
    var score: Int
}

struct TrendRanking: Codable, Hashable, Sendable {
    var window: TrendWindow
    var computedAt: Date
    var label: String
    var sourcesUsed: [String]
    var methodologyVersion: String
    var isDemo: Bool?
    var entries: [TrendEntry]
    var history: [TrendPoint]
}

struct SourceStatus: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var name: String
    var attribution: String?
    var lastSyncAt: Date?
    /// "ok", "pending", "failed", "not_configured"
    var status: String
}

struct SnapshotMeta: Codable, Hashable, Sendable {
    var mode: DataMode
    var apiVersion: String
    var generatedAt: Date
    var notice: String?
    var sources: [SourceStatus]
}

struct CatalogSnapshot: Codable, Sendable {
    var meta: SnapshotMeta
    var films: [Film]
    var screenings: [Screening]
    var streaming: [StreamingOffer]
    var reviews: [Review]
    var timeline: [TimelineEvent]
    var festivals: [Festival]
    var festivalEvents: [FestivalEvent]
    var news: [NewsItem]
    var trends: [TrendRanking]
}
