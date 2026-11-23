import Foundation

/// Arranque para pruebas de interfaz (CineMexaUITests). Sólo se activa con el argumento `-uiTesting`;
/// `CINEMEXA_UI_MODE` elige el escenario: `demo` (datos de demostración) o `sin-conexion` (en vivo, la red falla y no
/// hay caché: debe verse el estado de error con "Reintentar").
struct UITestLaunch {
    let mode: DataMode
    let repositoryFactory: (DataMode) -> any CatalogRepository
    let cache: SnapshotCache

    static let current: UITestLaunch? = {
        let info = ProcessInfo.processInfo
        guard info.arguments.contains("-uiTesting") else { return nil }
        let emptyCache = SnapshotCache(directory: FileManager.default.temporaryDirectory.appending(path: "uitest-\(UUID().uuidString)"))
        switch info.environment["CINEMEXA_UI_MODE"] ?? "demo" {
        case "sin-conexion":
            return UITestLaunch(mode: .live, repositoryFactory: { _ in FailingRepository() }, cache: emptyCache)
        default:
            return UITestLaunch(mode: .demo, repositoryFactory: { _ in DemoRepository() }, cache: emptyCache)
        }
    }()
}

/// Repositorio que siempre falla como si no hubiera red.
struct FailingRepository: CatalogRepository {
    let mode: DataMode = .live
    func fetchSnapshot() async throws -> CatalogSnapshot {
        throw RepositoryError.network("Sin conexión a internet.")
    }
}
