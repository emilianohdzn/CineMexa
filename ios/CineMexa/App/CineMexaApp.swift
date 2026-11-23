import SwiftUI
import SwiftData

@main
struct CineMexaApp: App {
    @State private var model = AppModel()

    init() {
        CMFont.registerBundledFonts()
        // Caché de imágenes y respuestas: 50 MB en memoria, 300 MB en disco.
        URLCache.shared = URLCache(memoryCapacity: 50 * 1024 * 1024, diskCapacity: 300 * 1024 * 1024)
        Appearance.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(\.locale, CineFormat.locale)
                .preferredColorScheme(.dark)
                .tint(CM.projectorYellow)
                .task { await model.load() }
        }
        .modelContainer(for: FavoriteItem.self)
    }
}

enum Appearance {
    static func configure() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(CM.cinemaBlack)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        // Títulos de navegación: los dibuja el sistema (claros en modo oscuro); sólo cambiamos la tipografía.
        if let large = UIFont(name: "Fredoka-Bold", size: 34) {
            UINavigationBar.appearance().largeTitleTextAttributes = [
                .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: large),
                .foregroundColor: UIColor(CM.paperCream),
            ]
        }
        if let title = UIFont(name: "Fredoka-SemiBold", size: 18) {
            UINavigationBar.appearance().titleTextAttributes = [
                .font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: title),
                .foregroundColor: UIColor(CM.paperCream),
            ]
        }
    }
}
