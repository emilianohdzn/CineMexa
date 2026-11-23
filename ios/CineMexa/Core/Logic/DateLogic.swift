import Foundation

enum EditionStatus: String, Sendable {
    case upcoming, active, past, unconfirmed, cancelled

    var label: String {
        switch self {
        case .upcoming: "Próximo"
        case .active: "En curso"
        case .past: "Concluido"
        case .unconfirmed: "Fechas por confirmar"
        case .cancelled: "Cancelado"
        }
    }
    var symbol: String {
        switch self {
        case .upcoming: "calendar"
        case .active: "dot.radiowaves.left.and.right"
        case .past: "checkmark.circle"
        case .unconfirmed: "questionmark.circle"
        case .cancelled: "xmark.octagon"
        }
    }
}

enum MapPeriod: String, CaseIterable, Identifiable, Sendable {
    case week, month, upcoming, last12, historic
    var id: String { rawValue }
    var label: String {
        switch self {
        case .week: "Esta semana"
        case .month: "Este mes"
        case .upcoming: "Próximos"
        case .last12: "Últimos 12 meses"
        case .historic: "Histórico"
        }
    }
}

/// Reglas temporales. Equivalentes a packages/core/src/availability.ts.
enum DateLogic {
    static let day: TimeInterval = 86_400

    /// Fecha de calendario "AAAA-MM-DD" de `date` en la zona horaria indicada.
    static func calendarDay(_ date: Date, timeZone: TimeZone) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    static func parseDay(_ s: String, timeZone: TimeZone = .current) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)
    }

    /// Fechas inclusivas, comparadas en la zona horaria del festival.
    static func status(of edition: FestivalEdition, now: Date) -> EditionStatus {
        if edition.isCancelled { return .cancelled }
        guard let start = edition.startsOn, let end = edition.endsOn else { return .unconfirmed }
        let today = calendarDay(now, timeZone: TimeZone(identifier: edition.timezone) ?? .current)
        if today < start { return .upcoming }
        if today > end { return .past }
        return .active
    }

    /// ¿Un evento con fecha confirmada cae en el periodo? Sin fecha, nunca.
    static func isInPeriod(_ date: Date?, period: MapPeriod, now: Date) -> Bool {
        guard let date else { return false }
        let t = date.timeIntervalSince(now)
        switch period {
        case .week: return t >= -3 * day && t <= 7 * day
        case .month: return t >= -7 * day && t <= 31 * day
        case .upcoming: return t >= 0
        case .last12: return t >= -365 * day && t <= 0
        case .historic: return t <= 0
        }
    }

    /// ¿La edición se traslapa con el periodo? Se usa para festivales sin funciones fechadas.
    static func editionOverlaps(_ edition: FestivalEdition, period: MapPeriod, now: Date) -> Bool {
        guard let s = edition.startsOn.flatMap({ parseDay($0) }),
              let e = edition.endsOn.flatMap({ parseDay($0) })?.addingTimeInterval(day - 1) else { return false }
        switch period {
        case .week: return e >= now.addingTimeInterval(-3 * day) && s <= now.addingTimeInterval(7 * day)
        case .month: return e >= now.addingTimeInterval(-7 * day) && s <= now.addingTimeInterval(31 * day)
        case .upcoming: return e >= now
        case .last12: return s <= now && e >= now.addingTimeInterval(-365 * day)
        case .historic: return s <= now
        }
    }
}

/// Formatos en español de México.
enum CineFormat {
    static let locale = Locale(identifier: "es_MX")

    static func longDate(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(locale))
    }
    static func shortDate(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year().locale(locale))
    }
    static func dayMonth(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).locale(locale))
    }
    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour().minute().locale(locale))
    }
    static func dateTime(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute().locale(locale))
    }
    /// "lunes, 23 de noviembre" → "Lunes, 23 de noviembre" (sólo la primera letra).
    static func sentenceCase(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let f = RelativeDateTimeFormatter()
        f.locale = locale
        f.unitsStyle = .full
        // Un instante del servidor unos segundos "en el futuro" (desfase de reloj) se muestra como ahora.
        // También el último minuto: con un intervalo de 0 s el formateador dice "dentro de 0 segundos".
        let interval = date.timeIntervalSince(now)
        if interval > -60, interval < 120 { return "hace un momento" }
        return f.localizedString(for: date, relativeTo: now)
    }
    static func dayRange(_ start: String?, _ end: String?) -> String {
        guard let s = start.flatMap({ DateLogic.parseDay($0) }), let e = end.flatMap({ DateLogic.parseDay($0) }) else {
            return "Fechas por confirmar"
        }
        return "\(dayMonth(s)) – \(shortDate(e))"
    }
    static func number(_ value: Double) -> String {
        value.formatted(.number.locale(locale).precision(.fractionLength(0)))
    }
}
