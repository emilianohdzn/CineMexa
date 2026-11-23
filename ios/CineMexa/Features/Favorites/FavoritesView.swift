import SwiftUI
import SwiftData

/// Favoritos locales (sin cuenta).
struct FavoritesView: View {
    let catalog: Catalog?
    let open: (Route) -> Void
    @Environment(\.modelContext) private var context
    @Query(sort: \FavoriteItem.createdAt, order: .reverse) private var items: [FavoriteItem]

    var body: some View {
        let films = items.filter { $0.kind == .film }
        let festivals = items.filter { $0.kind == .festival }
        let follows = items.filter { $0.kind == .followFilm }
        List {
            if items.isEmpty {
                ContentUnavailableView("Aún no guardas nada", systemImage: "heart",
                                       description: Text("Toca el corazón en una película o festival para encontrarlos aquí."))
            }
            if !films.isEmpty { section("Películas", films) { .film(id: $0, transitionID: nil) } }
            if !festivals.isEmpty { section("Festivales", festivals) { .festival(id: $0) } }
            if !follows.isEmpty { section("Siguiendo novedades", follows) { .film(id: $0, transitionID: nil) } }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Favoritos")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func section(_ title: String, _ list: [FavoriteItem], route: @escaping (String) -> Route) -> some View {
        Section(title) {
            ForEach(list) { item in
                Button { open(route(item.entityID)) } label: {
                    HStack {
                        Text(item.title).foregroundStyle(CM.paperCream)
                        Spacer()
                        if !exists(item) {
                            Text("No disponible").font(.caption).foregroundStyle(CM.secondaryText)
                        }
                    }
                }
                .disabled(!exists(item))
            }
            .onDelete { offsets in
                for index in offsets { context.delete(list[index]) }
                try? context.save()
            }
        }
    }

    /// Un favorito puede apuntar a un dato que no existe en el modo actual (p. ej. demo vs. en vivo).
    private func exists(_ item: FavoriteItem) -> Bool {
        guard let catalog else { return false }
        switch item.kind {
        case .film, .followFilm: return catalog.film(item.entityID) != nil
        case .festival: return catalog.festival(item.entityID) != nil
        }
    }
}
