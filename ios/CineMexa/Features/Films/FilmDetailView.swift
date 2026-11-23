import SwiftUI
import SwiftData

/// Ficha cinematográfica completa.
struct FilmDetailView: View {
    let catalog: Catalog
    let filmID: String
    @Environment(AppModel.self) private var model

    var body: some View {
        if let film = catalog.film(filmID) {
            content(film)
        } else {
            EmptyStateView(title: "Película no encontrada", message: "Es posible que se haya fusionado con otra ficha o que ya no esté publicada.")
        }
    }

    private func content(_ film: Film) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.xxl) {
                FilmHeader(film: film)
                FilmActions(film: film)
                    .padding(.horizontal, CM.Space.gutter)
                if let synopsis = film.synopsis {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeader(title: "Sinopsis")
                        Text(synopsis)
                            .font(.body)
                            .foregroundStyle(CM.paperCream.opacity(0.92))
                            .padding(.horizontal, CM.Space.gutter)
                    }
                }
                WhereToWatch(catalog: catalog, film: film)
                FilmCriticismSection(catalog: catalog, film: film)
                FilmTimelineSection(catalog: catalog, film: film)
                CreditsSection(film: film)
                VerificationTag(provenance: film.provenance)
                    .padding(.horizontal, CM.Space.gutter)
            }
            .padding(.bottom, CM.Space.xxl)
        }
        .navigationTitle(film.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Encabezado

private struct FilmHeader: View {
    let film: Film

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            backdrop
                .frame(height: 260)
                .clipped()
                .overlay(LinearGradient(colors: [.clear, CM.cinemaBlack], startPoint: .center, endPoint: .bottom))
            HStack(alignment: .bottom, spacing: 16) {
                PosterView(film: film, compactPlaceholder: true)
                    .frame(width: 130)
                    .shadow(color: .black.opacity(0.5), radius: 18, y: 10)
                VStack(alignment: .leading, spacing: 6) {
                    StatusTag(status: film.status)
                    Text(film.title)
                        .font(CMFont.display(30, relativeTo: .title))
                        .foregroundStyle(CM.paperCream)
                        .fixedSize(horizontal: false, vertical: true)
                    if let original = film.originalTitle, original != film.title {
                        Text(original).font(.subheadline.italic()).foregroundStyle(CM.secondaryText)
                    }
                    if !film.altTitles.isEmpty {
                        Text("También: \(film.altTitles.joined(separator: ", "))")
                            .font(.caption).foregroundStyle(CM.secondaryText)
                    }
                    Text(meta)
                        .font(CMFont.mono(12))
                        .foregroundStyle(CM.electricBlue)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, CM.Space.gutter)
            .offset(y: 70)
        }
        .padding(.bottom, 70)
    }

    @ViewBuilder private var backdrop: some View {
        if let url = film.backdrop?.url {
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase { image.resizable().scaledToFill() } else { CM.deepSurface }
            }
        } else {
            ZStack {
                CM.deepSurface
                XMark(size: 260).opacity(0.06).rotationEffect(.degrees(8))
            }
        }
    }

    private var meta: String {
        var parts: [String] = []
        if let y = film.year { parts.append(String(y)) }
        if let r = film.runtimeMinutes { parts.append("\(r) min") }
        parts.append(film.kind.label)
        parts.append(film.countries.map(CountryName.name).joined(separator: " / "))
        return parts.joined(separator: " · ")
    }
}

// MARK: - Acciones

private struct FilmActions: View {
    let film: Film
    @Environment(\.modelContext) private var context
    @Query private var saved: [FavoriteItem]
    @Query private var followed: [FavoriteItem]

    init(film: Film) {
        self.film = film
        let favKey = FavoriteItem.key(.film, film.id)
        let followKey = FavoriteItem.key(.followFilm, film.id)
        _saved = Query(filter: #Predicate<FavoriteItem> { $0.key == favKey })
        _followed = Query(filter: #Predicate<FavoriteItem> { $0.key == followKey })
    }

    var body: some View {
        let isSaved = !saved.isEmpty
        let isFollowing = !followed.isEmpty
        HStack(spacing: 10) {
            ActionButton(title: isSaved ? "Guardada" : "Guardar", symbol: isSaved ? "heart.fill" : "heart", active: isSaved) {
                Favorites.toggle(.film, film.id, title: film.title, in: context)
            }
            .sensoryFeedback(.success, trigger: isSaved)
            .symbolEffect(.bounce, value: isSaved)

            ActionButton(title: isFollowing ? "Siguiendo" : "Seguir", symbol: isFollowing ? "bell.fill" : "bell", active: isFollowing) {
                Favorites.toggle(.followFilm, film.id, title: film.title, in: context)
            }
            .sensoryFeedback(.selection, trigger: isFollowing)

            if let trailer = film.trailerUrl {
                Link(destination: trailer) { ActionLabel(title: "Tráiler", symbol: "play.fill", active: false) }
            } else {
                ActionLabel(title: "Sin tráiler", symbol: "play.slash", active: false)
                    .opacity(0.45)
                    .accessibilityLabel("Tráiler oficial no disponible")
            }

            ShareLink(item: shareText) { ActionLabel(title: "Compartir", symbol: "square.and.arrow.up", active: false) }
        }
    }

    private var shareText: String {
        let year = film.year.map { " (\($0))" } ?? ""
        return "\(film.title)\(year) en Cine Mexa, el radar del cine mexicano."
    }
}

private struct ActionButton: View {
    let title: String
    let symbol: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) { ActionLabel(title: title, symbol: symbol, active: active) }
            .buttonStyle(.plain)
    }
}

private struct ActionLabel: View {
    let title: String
    let symbol: String
    let active: Bool
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.title3)
            Text(title).font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 60)
        .foregroundStyle(active ? CM.ink : CM.paperCream)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(active ? CM.projectorYellow : CM.deepSurface))
        .contentShape(Rectangle())
    }
}

// MARK: - Dónde verla

private struct WhereToWatch: View {
    let catalog: Catalog
    let film: Film
    @Environment(AppModel.self) private var model

    var body: some View {
        let screenings = catalog.upcomingScreenings(for: film.id, city: model.city)
        let allScreenings = catalog.upcomingScreenings(for: film.id, city: nil)
        let offers = catalog.snapshot.streaming.filter { $0.filmId == film.id }
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Dónde verla", kicker: model.city.map { "Funciones en \($0)" } ?? "Funciones confirmadas")
            VStack(alignment: .leading, spacing: 10) {
                if screenings.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(allScreenings.isEmpty ? "No hay funciones confirmadas por una sala." : "No hay funciones confirmadas en \(model.city ?? "tu ciudad").")
                            .font(.callout.weight(.medium))
                            .foregroundStyle(CM.paperCream)
                        if let release = film.mxReleaseDate, let date = DateLogic.parseDay(release) {
                            Label("Estreno en México identificado: \(CineFormat.shortDate(date)). No equivale a una función confirmada.", systemImage: "info.circle")
                                .font(.footnote)
                                .foregroundStyle(CM.secondaryText)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: CM.Radius.card).fill(CM.deepSurface))
                }
                ForEach(screenings) { s in ScreeningRow(screening: s) }
                if !offers.isEmpty {
                    Text("Streaming en México")
                        .font(CMFont.mono(11, weight: .semibold))
                        .foregroundStyle(CM.projectorYellow)
                        .padding(.top, 6)
                    ForEach(offers, id: \.provider) { offer in
                        HStack {
                            Label(offer.provider, systemImage: "play.tv")
                                .foregroundStyle(CM.paperCream)
                            Spacer()
                            Text(offerLabel(offer.offerType)).font(CMFont.mono(11)).foregroundStyle(CM.secondaryText)
                            if let url = offer.url {
                                Link(destination: url) { Image(systemName: "arrow.up.right.square") }
                                    .frame(minWidth: CM.minTap, minHeight: CM.minTap)
                                    .accessibilityLabel("Abrir \(offer.provider)")
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, CM.Space.gutter)
        }
    }

    private func offerLabel(_ type: String) -> String {
        switch type {
        case "subscription": "Suscripción"
        case "rent": "Renta"
        case "buy": "Compra"
        case "free": "Gratis"
        case "ads": "Con anuncios"
        default: type
        }
    }
}

private struct ScreeningRow: View {
    let screening: Screening

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(spacing: 2) {
                Text(screening.startsAt.formatted(.dateTime.day().locale(CineFormat.locale)))
                    .font(CMFont.display(24, relativeTo: .title2))
                Text(screening.startsAt.formatted(.dateTime.month(.abbreviated).locale(CineFormat.locale)).uppercased())
                    .font(CMFont.mono(10, weight: .semibold))
            }
            .foregroundStyle(CM.ink)
            .frame(width: 56, height: 60)
            .background(RoundedRectangle(cornerRadius: 10).fill(CM.paperCream))

            VStack(alignment: .leading, spacing: 3) {
                Text(screening.venue.name).font(.callout.weight(.semibold)).foregroundStyle(CM.paperCream)
                Text("\(screening.venue.city) · \(CineFormat.time(screening.startsAt))")
                    .font(CMFont.mono(11)).foregroundStyle(CM.secondaryText)
                Label(screening.kind.label, systemImage: screening.kind == .commercial ? "ticket" : "film.stack")
                    .font(CMFont.mono(10, weight: .semibold)).foregroundStyle(CM.liveRed)
            }
            Spacer()
            if let url = screening.ticketUrl {
                Link(destination: url) {
                    Text("Boletos").font(.footnote.weight(.bold)).foregroundStyle(CM.ink)
                        .padding(.horizontal, 12).frame(minHeight: CM.minTap)
                        .background(Capsule().fill(CM.projectorYellow))
                }
                .accessibilityLabel("Comprar boletos en \(screening.venue.name)")
            }
        }
        .padding(12)
        .ticketBackground()
    }
}

// MARK: - Créditos

private struct CreditsSection: View {
    let film: Film

    var body: some View {
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Ficha técnica")
            VStack(alignment: .leading, spacing: 12) {
                row("Dirección", film.directors)
                row("Guion", film.writers)
                row("Fotografía", film.cinematographers)
                row("Reparto", film.cast)
                row("Género", film.genres)
                row("Países", film.countries.map(CountryName.name))
                row("Producción", [film.mxParticipation.label])
            }
            .padding(.horizontal, CM.Space.gutter)
        }
    }

    @ViewBuilder
    private func row(_ title: String, _ values: [String]) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased()).font(CMFont.mono(10, weight: .semibold)).foregroundStyle(CM.secondaryText)
                Text(values.joined(separator: ", ")).font(.callout).foregroundStyle(CM.paperCream)
            }
            .accessibilityElement(children: .combine)
        }
    }
}
