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

        let nav = UINavigationBarAppearance()
        nav.configureWithTransparentBackground()
        nav.backgroundColor = UIColor(CM.cinemaBlack.opacity(0.92))
        let titleFont = UIFont(name: "Fredoka-SemiBold", size: 18) ?? .systemFont(ofSize: 18, weight: .semibold)
        let largeFont = UIFont(name: "Fredoka-Bold", size: 34) ?? .systemFont(ofSize: 34, weight: .bold)
        nav.titleTextAttributes = [.foregroundColor: UIColor(CM.paperCream), .font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: titleFont)]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor(CM.paperCream), .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: largeFont)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
    }
}
