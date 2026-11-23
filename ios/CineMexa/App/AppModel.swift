import Foundation
import Observation

enum AppTab: String, Hashable, CaseIterable {
    case radar, films, map, trends, festivals
}

/// Estado global: modo de datos, catálogo cargado y estado de sincronización.
@MainActor
@Observable
final class AppModel {
    enum LoadState: Equatable {
        case idle, loading, loaded
        case failed(String)
    }

    var mode: DataMode {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: "data.mode")
            catalog = nil
            Task { await load(force: true) }
        }
    }
    private(set) var catalog: Catalog?
    private(set) var state: LoadState = .idle
    /// Cuándo se obtuvo el catálogo mostrado.
    private(set) var loadedAt: Date?
    /// true si se muestra el último catálogo válido porque la actualización falló.
    private(set) var isShowingCachedData = false
    private(set) var lastError: String?

    var selectedTab: AppTab = .radar
    /// Ciudad elegida manualmente para la disponibilidad local (nunca se pide ubicación).
    var city: String? {
        didSet { UserDefaults.standard.set(city, forKey: "user.city") }
    }

    private let cache: SnapshotCache
    private let repositoryFactory: (DataMode) -> any CatalogRepository

    init(repositoryFactory: ((DataMode) -> any CatalogRepository)? = nil, cache: SnapshotCache = SnapshotCache()) {
        if let ui = UITestLaunch.current {
            // Pruebas de interfaz: estado determinista, sin tocar las preferencias ni la caché del usuario.
            mode = ui.mode
            city = nil
            self.repositoryFactory = ui.repositoryFactory
            self.cache = ui.cache
            return
        }
        let saved = UserDefaults.standard.string(forKey: "data.mode").flatMap(DataMode.init(rawValue:))
        mode = saved ?? (LiveConfig.load() == nil ? .demo : .live)
        city = UserDefaults.standard.string(forKey: "user.city")
        self.cache = cache
        if let repositoryFactory {
            self.repositoryFactory = repositoryFactory
        } else {
            self.repositoryFactory = AppModel.defaultRepository
        }
    }

    nonisolated static func defaultRepository(_ mode: DataMode) -> any CatalogRepository {
        switch mode {
        case .demo: return DemoRepository()
        case .live: return LiveRepository(config: LiveConfig.load())
        }
    }

    var isLiveConfigured: Bool { LiveConfig.load() != nil }

    func load(force: Bool = false) async {
        if state == .loading { return }
        if !force, catalog != nil { return }
        state = .loading
        let requested = mode
        let repo = repositoryFactory(requested)
        do {
            let snapshot = try await repo.fetchSnapshot()
            guard requested == mode else { return } // el usuario cambió de modo mientras cargaba
            catalog = Catalog(snapshot)
            loadedAt = Date()
            isShowingCachedData = false
            lastError = nil
            state = .loaded
            if requested == .live { cache.save(snapshot) }
        } catch {
            guard requested == mode else { return }
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            lastError = message
            // En vivo: conserva el último dato válido e informa que la actualización está pendiente.
            // Nunca se rellena con datos de demostración.
            if requested == .live, catalog == nil, let cached = cache.load() {
                catalog = Catalog(cached)
                loadedAt = cached.meta.generatedAt
                isShowingCachedData = true
                state = .loaded
            } else if catalog != nil {
                isShowingCachedData = true
                state = .loaded
            } else {
                state = .failed(message)
            }
        }
    }
}
