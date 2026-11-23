import SwiftUI

/// Tarjeta de póster + datos mínimos. Abre la ficha con transición zoom.
struct FilmCard: View {
    let catalog: Catalog
    let film: Film
    /// Identifica la tarjeta para la transición (la misma película puede aparecer en varias secciones).
    var section: String
    var showsAvailability = true

    private var transitionID: String { "\(section)-\(film.id)" }

    var body: some View {
        NavigationLink(value: Route.film(id: film.id, transitionID: transitionID)) {
            VStack(alignment: .leading, spacing: 8) {
                PosterView(film: film)
                    .heroSource(transitionID)
                VStack(alignment: .leading, spacing: 3) {
                    Text(film.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(CM.paperCream)
                        .lineLimit(2, reservesSpace: true)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 6) {
                        if let year = film.year { Text(String(year)) }
                        if film.kind == .short { Text("· Corto") }
                    }
                    .font(CMFont.mono(11))
                    .foregroundStyle(CM.secondaryText)
                    if showsAvailability {
                        let a = catalog.availability(for: film)
                        Label(a.label, systemImage: a.symbol)
                            .font(CMFont.mono(10, weight: .semibold))
                            .foregroundStyle(film.status == .upcoming ? CM.electricBlue : CM.liveRed)
                            .lineLimit(2)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Abre la ficha de la película")
    }
}

/// Ligera respuesta al tocar una tarjeta.
struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.cm(reduceMotion), value: configuration.isPressed)
    }
}

/// Carrusel horizontal nativo con paginación por vista.
struct FilmCarousel: View {
    let catalog: Catalog
    let films: [Film]
    let section: String
    var cardWidth: CGFloat = 140

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 14) {
                ForEach(films) { film in
                    FilmCard(catalog: catalog, film: film, section: section)
                        .frame(width: cardWidth)
                        .cardEntrance()
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, CM.Space.gutter)
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.hidden)
    }
}
