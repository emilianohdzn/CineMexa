import Foundation
import SwiftData

/// Favoritos y seguimientos locales (sin cuenta). Preparado para sincronizarse
/// con la tabla user_favorites de Supabase cuando exista inicio de sesión opcional.
@Model
final class FavoriteItem {
    enum Kind: String, Codable { case film, festival, followFilm }

    @Attribute(.unique) var key: String
    var kindRaw: String
    var entityID: String
    var title: String
    var createdAt: Date

    init(kind: Kind, entityID: String, title: String, createdAt: Date = Date()) {
        self.key = FavoriteItem.key(kind, entityID)
        self.kindRaw = kind.rawValue
        self.entityID = entityID
        self.title = title
        self.createdAt = createdAt
    }

    var kind: Kind { Kind(rawValue: kindRaw) ?? .film }

    static func key(_ kind: Kind, _ id: String) -> String { "\(kind.rawValue):\(id)" }
}

enum Favorites {
    @MainActor
    static func isSaved(_ kind: FavoriteItem.Kind, _ id: String, in context: ModelContext) -> Bool {
        let key = FavoriteItem.key(kind, id)
        let descriptor = FetchDescriptor<FavoriteItem>(predicate: #Predicate { $0.key == key })
        return ((try? context.fetchCount(descriptor)) ?? 0) > 0
    }

    /// Alterna el estado y devuelve el nuevo valor.
    @MainActor @discardableResult
    static func toggle(_ kind: FavoriteItem.Kind, _ id: String, title: String, in context: ModelContext) -> Bool {
        let key = FavoriteItem.key(kind, id)
        let descriptor = FetchDescriptor<FavoriteItem>(predicate: #Predicate { $0.key == key })
        if let existing = try? context.fetch(descriptor), !existing.isEmpty {
            existing.forEach { context.delete($0) }
            try? context.save()
            return false
        }
        context.insert(FavoriteItem(kind: kind, entityID: id, title: title))
        try? context.save()
        return true
    }
}
