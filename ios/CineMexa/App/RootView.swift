import SwiftUI

/// Rutas de navegación tipadas, compartidas por todas las pestañas.
enum Route: Hashable {
    case film(id: String, transitionID: String?)
    case festival(id: String)
    case criticism
    case sources
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            Tab("Radar", systemImage: "dot.radiowaves.left.and.right", value: AppTab.radar) {
                TabRoot { RadarView(catalog: $0) }
            }
            Tab("Películas", systemImage: "film.stack", value: AppTab.films) {
                TabRoot { FilmsView(catalog: $0) }
            }
            Tab("Mapa", systemImage: "globe.americas.fill", value: AppTab.map) {
                TabRoot { FestivalMapView(catalog: $0) }
            }
            Tab("Trends", systemImage: "chart.line.uptrend.xyaxis", value: AppTab.trends) {
                TabRoot { TrendsView(catalog: $0) }
            }
            Tab("Festivales", systemImage: "calendar", value: AppTab.festivals) {
                TabRoot { FestivalsView(catalog: $0) }
            }
        }
        .sensoryFeedback(.selection, trigger: model.selectedTab)
    }
}

/// Envoltorio de cada pestaña: NavigationStack propio, destinos tipados,
/// barra con búsqueda global, favoritos y configuración, y estados de carga/error.
struct TabRoot<Content: View>: View {
    @Environment(AppModel.self) private var model
    private let content: (Catalog) -> Content

    init(@ViewBuilder content: @escaping (Catalog) -> Content) {
        self.content = content
    }
    @State private var path = NavigationPath()
    @State private var sheet: GlobalSheet?
    @Namespace private var heroNamespace

    enum GlobalSheet: String, Identifiable {
        case search, favorites, settings
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let catalog = model.catalog {
                    content(catalog)
                } else if case .failed(let message) = model.state {
                    ErrorStateView(message: message) { await model.load(force: true) }
                } else {
                    LoadingSkeleton()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(CM.cinemaBlack.ignoresSafeArea())
            .navigationDestination(for: Route.self) { route in
                Group {
                    if let catalog = model.catalog {
                        destination(route, catalog: catalog)
                    }
                }
                .background(CM.cinemaBlack.ignoresSafeArea())
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { sheet = .search } label: { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("Buscar")
                    Menu {
                        Button { sheet = .favorites } label: { Label("Favoritos", systemImage: "heart") }
                        Button { path.append(Route.sources) } label: { Label("Fuentes y créditos", systemImage: "books.vertical") }
                        Button { sheet = .settings } label: { Label("Configuración", systemImage: "gearshape") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Más opciones")
                }
            }
        }
        .environment(\.heroNamespace, heroNamespace)
        .sheet(item: $sheet) { which in
            NavigationStack {
                Group {
                    switch which {
                    case .search: SearchView(catalog: model.catalog) { route in open(route) }
                    case .favorites: FavoritesView(catalog: model.catalog) { route in open(route) }
                    case .settings: SettingsView()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Cerrar") { sheet = nil }
                    }
                }
            }
            .presentationBackground(CM.cinemaBlack)
        }
    }

    private func open(_ route: Route) {
        sheet = nil
        path.append(route)
    }

    @ViewBuilder
    private func destination(_ route: Route, catalog: Catalog) -> some View {
        switch route {
        case .film(let id, let transitionID):
            FilmDetailView(catalog: catalog, filmID: id).heroDestination(transitionID)
        case .festival(let id):
            FestivalDetailView(catalog: catalog, festivalID: id)
        case .criticism:
            CriticismFeedView(catalog: catalog)
        case .sources:
            SourcesView(catalog: catalog)
        }
    }
}
