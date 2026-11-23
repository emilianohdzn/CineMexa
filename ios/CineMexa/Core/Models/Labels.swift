import Foundation

// Textos en español de México para los valores del contrato.
// Cada estado tiene texto + símbolo: el color nunca es el único portador de información.

extension FilmStatus {
    var label: String {
        switch self {
        case .inTheaters: "En cartelera"
        case .releaseIdentified: "Estreno identificado"
        case .festival: "En festivales"
        case .upcoming: "Próximamente"
        case .archive: "Archivo"
        }
    }
    var symbol: String {
        switch self {
        case .inTheaters: "ticket.fill"
        case .releaseIdentified: "calendar.badge.checkmark"
        case .festival: "laurel.leading"
        case .upcoming: "clock"
        case .archive: "archivebox"
        }
    }
}

extension FilmKind {
    var label: String { self == .short ? "Cortometraje" : "Largometraje" }
}

extension MexicanParticipation {
    var label: String {
        switch self {
        case .majority: "Producción mexicana"
        case .coproduction: "Coproducción"
        case .minority: "Coproducción minoritaria"
        case .unknown: "Participación por confirmar"
        }
    }
}

extension ScreeningKind {
    var label: String {
        switch self {
        case .commercial: "Exhibición confirmada en sala"
        case .cineteca: "Función de cineteca"
        case .cineclub: "Función de cineclub"
        case .festival: "Función de festival"
        }
    }
}

extension FestivalEventKind {
    var label: String {
        switch self {
        case .selection: "Selección anunciada"
        case .screening: "Función programada"
        case .award: "Premio recibido"
        case .premiere: "Estreno en festival"
        }
    }
    var symbol: String {
        switch self {
        case .selection: "checkmark.seal"
        case .screening: "film"
        case .award: "trophy.fill"
        case .premiere: "sparkles"
        }
    }
}

extension TimelineKind {
    var symbol: String {
        switch self {
        case .festivalSelection: "checkmark.seal"
        case .festivalScreening: "film"
        case .premiere: "sparkles"
        case .award: "trophy.fill"
        case .theatricalRelease: "ticket.fill"
        case .streaming: "play.tv"
        }
    }
}

extension NewsKind {
    var label: String {
        switch self {
        case .selection: "Selección"
        case .award: "Premio"
        case .premiere: "Estreno"
        case .call: "Convocatoria"
        case .publication: "Publicación"
        case .industry: "Industria"
        }
    }
}

extension TrendWindow {
    var label: String {
        switch self {
        case .day: "24 horas"
        case .week: "7 días"
        case .month: "30 días"
        }
    }
}

extension VerificationStatus {
    var label: String {
        switch self {
        case .verified: "Verificado"
        case .editorial: "Editorial"
        case .automatic: "Automático"
        case .unverified: "Sin verificar"
        case .demo: "Demo"
        }
    }
    var symbol: String {
        switch self {
        case .verified: "checkmark.shield.fill"
        case .editorial: "pencil.and.list.clipboard"
        case .automatic: "gearshape.2"
        case .unverified: "questionmark.circle"
        case .demo: "theatermasks"
        }
    }
}

enum CountryName {
    static func name(_ code: String) -> String {
        Locale(identifier: "es_MX").localizedString(forRegionCode: code) ?? code
    }
}
