import SwiftUI
import UIKit
import CoreText

// MARK: - Color tokens

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

/// Paleta Cine Mexa. Contrastes medidos sobre Cinema Black (WCAG 2.x):
/// Paper Cream 16.4:1 · Projector Yellow 11.2:1 · Electric Blue 8.7:1 · Secondary Text 6.1:1 · Live Red 5.4:1.
/// Texto sobre rojo o amarillo siempre en tinta oscura (blanco sobre Live Red sólo da 3.6:1).
/// Sobre Paper Cream se usan creamSecondary (6.0:1) y creamRed (5.1:1) en lugar de los tonos para fondo oscuro.
enum CM {
    static let cinemaBlack = Color(hex: 0x0B0E13)
    static let deepSurface = Color(hex: 0x141922)
    static let raisedSurface = Color(hex: 0x1C2330)
    static let projectorYellow = Color(hex: 0xFFB81C)
    static let liveRed = Color(hex: 0xF04D3D)
    static let paperCream = Color(hex: 0xF4EBDD)
    static let electricBlue = Color(hex: 0x65BACB)
    static let secondaryText = Color(hex: 0x89929E)
    /// Tinta para texto sobre Paper Cream y sobre amarillo.
    static let ink = Color(hex: 0x0B0E13)
    static let creamSecondary = Color(hex: 0x5C5850)
    static let creamRed = Color(hex: 0xB8321F)
    static let hairline = Color.white.opacity(0.08)

    enum Space {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 36
        static let gutter: CGFloat = 20
    }

    enum Radius {
        static let chip: CGFloat = 999
        static let card: CGFloat = 14
        static let poster: CGFloat = 10
    }

    /// Tamaño mínimo de objetivo táctil (HIG).
    static let minTap: CGFloat = 44
}

// MARK: - Typography

/// Fredoka (títulos expresivos) · SF Pro (lectura y UI) · IBM Plex Mono (fechas, cifras, fuentes).
/// Las fuentes se registran en tiempo de ejecución y escalan con Dynamic Type.
/// Si alguna faltara, Font.custom cae automáticamente a la fuente del sistema.
enum CMFont {
    static func registerBundledFonts() {
        for name in ["Fredoka-SemiBold", "Fredoka-Bold", "IBMPlexMono-Regular", "IBMPlexMono-Medium", "IBMPlexMono-SemiBold"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// Titulares de marca. Fredoka Bold (700, el peso máximo disponible de la familia).
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .largeTitle) -> Font {
        .custom("Fredoka-Bold", size: size, relativeTo: style)
    }
    static func headline(_ size: CGFloat = 20, relativeTo style: Font.TextStyle = .title3) -> Font {
        .custom("Fredoka-SemiBold", size: size, relativeTo: style)
    }
    static func mono(_ size: CGFloat = 12, weight: Font.Weight = .medium, relativeTo style: Font.TextStyle = .caption) -> Font {
        let name = switch weight {
        case .semibold, .bold, .heavy, .black: "IBMPlexMono-SemiBold"
        case .regular, .light, .thin, .ultraLight: "IBMPlexMono-Regular"
        default: "IBMPlexMono-Medium"
        }
        return .custom(name, size: size, relativeTo: style)
    }
}

// MARK: - Motion & haptics

extension View {
    /// Aparición progresiva al entrar en pantalla. Desactivada con Reducir movimiento.
    func cardEntrance() -> some View { modifier(CardEntrance()) }
}

private struct CardEntrance: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content.scrollTransition(.interactive, axis: .horizontal) { view, phase in
                view
                    .scaleEffect(phase.isIdentity ? 1 : 0.94)
                    .opacity(phase.isIdentity ? 1 : 0.75)
            }
        }
    }
}

extension Animation {
    static func cm(_ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.82)
    }
}

// MARK: - Hero transition namespace

private struct HeroNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    var heroNamespace: Namespace.ID? {
        get { self[HeroNamespaceKey.self] }
        set { self[HeroNamespaceKey.self] = newValue }
    }
}

extension View {
    /// Fuente de la transición zoom (iOS 18) hacia la ficha.
    func heroSource(_ id: String) -> some View { modifier(HeroSource(id: id)) }
    /// Destino de la transición zoom.
    func heroDestination(_ id: String?) -> some View { modifier(HeroDestination(id: id)) }
}

private struct HeroSource: ViewModifier {
    let id: String
    @Environment(\.heroNamespace) private var namespace
    func body(content: Content) -> some View {
        if let namespace {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

private struct HeroDestination: ViewModifier {
    let id: String?
    @Environment(\.heroNamespace) private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        if let namespace, let id, !reduceMotion {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}
