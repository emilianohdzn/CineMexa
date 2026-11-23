import SwiftUI

/// Búsqueda global: películas (título, títulos alternativos, dirección, reparto, género),
/// festivales y crítica. Local sobre el catálogo cargado, sin llamadas extra a la red.
struct SearchView: View {
    let catalog: Catalog?
    let open: (Route) -> Void
    @State private var query = ""

    var body: some View {
        Group {
            if let catalog {
                let results = catalog.search(query)
                List {
                    if query.count < 2 {
                        Section("Sugerencias") {
                            ForEach(catalog.heroFilms.prefix(4)) { film in
                                filmRow(film)
                            }
                        }
                    } else if results.isEmpty {
                        ContentUnavailableView.search(text: query)
                    } else {
                        if !results.films.isEmpty {
                            Section("Películas") { ForEach(results.films) { filmRow($0) } }
                        }
                        if !results.festivals.isEmpty {
                            Section("Festivales") {
                                ForEach(results.festivals) { f in
                                    Button { open(.festival(id: f.id)) } label: {
                                        VStack(alignment: .leading) {
                                            Text(f.name).foregroundStyle(CM.paperCream)
                                            Text("\(f.city), \(CountryName.name(f.country))").font(.caption).foregroundStyle(CM.secondaryText)
                                        }
                                    }
                                }
                            }
                        }
                        if !results.reviews.isEmpty {
                            Section("Crítica") {
                                ForEach(results.reviews) { r in
                                    Button { open(.film(id: r.filmId, transitionID: nil)) } label: {
                                        VStack(alignment: .leading) {
                                            Text(r.title).foregroundStyle(CM.paperCream)
                                            Text("\(r.outlet) · \(catalog.film(r.filmId)?.title ?? "")").font(.caption).foregroundStyle(CM.secondaryText)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            } else {
                EmptyStateView(title: "Cargando", message: "La búsqueda estará disponible en cuanto se cargue el catálogo.")
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Película, director, festival o medio")
        .navigationTitle("Buscar")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func filmRow(_ film: Film) -> some View {
        Button { open(.film(id: film.id, transitionID: nil)) } label: {
            HStack(spacing: 12) {
                PosterView(film: film, cornerRadius: 4).frame(width: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(film.title).foregroundStyle(CM.paperCream)
                    Text([film.year.map { String($0) }, film.directors.first, film.kind == .short ? "Corto" : nil].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(CM.secondaryText)
                }
            }
        }
    }
}
