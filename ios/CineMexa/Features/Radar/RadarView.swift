import SwiftUI
import MapKit

/// Portada: ¿qué está pasando hoy en el cine mexicano?
struct RadarView: View {
    let catalog: Catalog
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: CM.Space.xxl) {
                header
                HeroCarousel(catalog: catalog, films: catalog.heroFilms)
                billboard
                topFive
                worldPreview
                upcomingFestivals
                recentCriticism
                latestNews
                footer
            }
            .padding(.bottom, CM.Space.xxl)
        }
        .refreshable { await model.load(force: true) }
        .navigationTitle("Radar")
        .toolbar(.visible, for: .navigationBar)
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { Wordmark(size: 20) }
        }
    }

    // A. Encabezado
    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(CineFormat.longDate(Date()).capitalized(with: CineFormat.locale))
                .font(CMFont.mono(12, weight: .semibold))
                .foregroundStyle(CM.secondaryText)
            Text("El cine mexicano\nestá pasando.")
                .font(CMFont.display(40))
                .foregroundStyle(CM.paperCream)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if catalog.isDemo { DemoBanner() }
                SyncStatusLine()
            }
        }
        .padding(.horizontal, CM.Space.gutter)
        .padding(.top, CM.Space.m)
    }

    // C. En cartelera
    @ViewBuilder private var billboard: some View {
        let films = catalog.billboardFilms
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "En cartelera", kicker: "Estrenos mexicanos")
            Text("Distinguimos funciones confirmadas por una sala de las fechas de estreno identificadas.")
                .font(.footnote)
                .foregroundStyle(CM.secondaryText)
                .padding(.horizontal, CM.Space.gutter)
            if films.isEmpty {
                EmptyStateView(title: "Sin estrenos registrados", message: "Cuando haya estrenos mexicanos confirmados aparecerán aquí.")
            } else {
                FilmCarousel(catalog: catalog, films: films, section: "billboard")
            }
        }
    }

    // D. Top 5
    @ViewBuilder private var topFive: some View {
        if let ranking = catalog.trends(.week), !ranking.entries.isEmpty {
            VStack(alignment: .leading, spacing: CM.Space.m) {
                SectionHeader(title: "Top 5 del momento", kicker: ranking.label) {
                    Button { model.selectedTab = .trends } label: { SeeAllLabel(text: "Trends") }
                }
                VStack(spacing: 10) {
                    ForEach(ranking.entries, id: \.filmId) { entry in
                        if let film = catalog.film(entry.filmId) {
                            NavigationLink(value: Route.film(id: film.id, transitionID: "top-\(film.id)")) {
                                RankRow(entry: entry, film: film, compact: true)
                                    .heroSource("top-\(film.id)")
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
                .padding(.horizontal, CM.Space.gutter)
                Text("Fuentes: \(ranking.sourcesUsed.joined(separator: ", ")) · últimos 7 días")
                    .font(CMFont.mono(10))
                    .foregroundStyle(CM.secondaryText)
                    .padding(.horizontal, CM.Space.gutter)
            }
        }
    }

    // E. México en el mundo
    @ViewBuilder private var worldPreview: some View {
        let items = catalog.mapItems(period: .month, kinds: Set(FestivalEventKind.allCases), filmKind: nil, query: "")
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "México en el mundo", kicker: "Este mes") {
                Button { model.selectedTab = .map } label: { SeeAllLabel(text: "Mapa") }
            }
            Button { model.selectedTab = .map } label: {
                Map(initialPosition: .region(MKCoordinateRegion(center: .init(latitude: 30, longitude: -40),
                                                                span: .init(latitudeDelta: 90, longitudeDelta: 170))),
                    interactionModes: []) {
                    ForEach(items) { item in
                        Annotation(item.festival.displayName, coordinate: item.coordinate) {
                            Circle().fill(CM.projectorYellow).frame(width: 12, height: 12)
                                .overlay(Circle().stroke(CM.cinemaBlack, lineWidth: 2))
                        }
                    }
                }
                .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
                .frame(height: 190)
                .clipShape(RoundedRectangle(cornerRadius: CM.Radius.card, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text(items.isEmpty ? "Sin actividad confirmada este mes" : "\(items.count) sedes con actividad confirmada")
                        .font(CMFont.mono(11, weight: .semibold))
                        .padding(8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(10)
                }
                .allowsHitTesting(false)
            }
            .buttonStyle(PressableStyle())
            .padding(.horizontal, CM.Space.gutter)
            .accessibilityLabel("Vista previa del mapa: \(items.count) sedes con actividad este mes. Abrir mapa festivalero.")
        }
    }

    // F. Próximos festivales
    @ViewBuilder private var upcomingFestivals: some View {
        let editions = Array(catalog.editions(status: [.active, .upcoming]).prefix(6))
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Próximos festivales", kicker: "Calendario") {
                Button { model.selectedTab = .festivals } label: { SeeAllLabel() }
            }
            ScrollView(.horizontal) {
                LazyHStack(spacing: 12) {
                    ForEach(editions) { ref in
                        NavigationLink(value: Route.festival(id: ref.festival.id)) {
                            FestivalTicket(ref: ref).frame(width: 250)
                        }
                        .buttonStyle(PressableStyle())
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

    // G. Crítica reciente
    @ViewBuilder private var recentCriticism: some View {
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Crítica reciente", kicker: "Voces y publicaciones") {
                NavigationLink(value: Route.criticism) { SeeAllLabel() }
            }
            VStack(spacing: 10) {
                ForEach(catalog.recentReviews.prefix(4)) { review in
                    ReviewCard(review: review, film: catalog.film(review.filmId), showsFilm: true)
                }
            }
            .padding(.horizontal, CM.Space.gutter)
        }
    }

    // H. Últimas noticias
    @ViewBuilder private var latestNews: some View {
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Últimas noticias", kicker: "Selecciones, premios y convocatorias")
            VStack(spacing: 0) {
                ForEach(catalog.snapshot.news.sorted { $0.publishedAt > $1.publishedAt }.prefix(8)) { item in
                    NewsRow(item: item)
                    Divider().overlay(CM.hairline)
                }
            }
            .padding(.horizontal, CM.Space.gutter)
        }
    }

    private var footer: some View {
        NavigationLink(value: Route.sources) {
            Label("Fuentes, créditos y metodología", systemImage: "books.vertical")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(CM.electricBlue)
                .frame(minHeight: CM.minTap)
        }
        .padding(.horizontal, CM.Space.gutter)
    }
}

// MARK: - Hero

struct HeroCarousel: View {
    let catalog: Catalog
    let films: [Film]
    @State private var current: String?

    var body: some View {
        VStack(spacing: 10) {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 14) {
                    ForEach(films) { film in
                        HeroCard(catalog: catalog, film: film)
                            .containerRelativeFrame(.horizontal) { w, _ in w * 0.78 }
                            .id(film.id)
                            .cardEntrance()
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, CM.Space.gutter, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .scrollPosition(id: $current)

            HStack(spacing: 6) {
                ForEach(films) { film in
                    Capsule()
                        .fill(film.id == (current ?? films.first?.id) ? CM.projectorYellow : CM.secondaryText.opacity(0.4))
                        .frame(width: film.id == (current ?? films.first?.id) ? 18 : 6, height: 6)
                }
            }
            .animation(.easeOut(duration: 0.2), value: current)
            .accessibilityHidden(true)
        }
    }
}

struct HeroCard: View {
    let catalog: Catalog
    let film: Film

    var body: some View {
        NavigationLink(value: Route.film(id: film.id, transitionID: "hero-\(film.id)")) {
            PosterView(film: film, cornerRadius: CM.Radius.card)
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 6) {
                        StatusTag(status: film.status)
                        Text(film.title)
                            .font(CMFont.display(28, relativeTo: .title))
                            .foregroundStyle(CM.paperCream)
                            .lineLimit(3)
                            .minimumScaleFactor(0.75)
                        Text([film.year.map { String($0) }, film.directors.first.map { "Dir. \($0)" }].compactMap { $0 }.joined(separator: " · "))
                            .font(CMFont.mono(12))
                            .foregroundStyle(CM.paperCream.opacity(0.85))
                        Label("Ver ficha", systemImage: "arrow.up.right")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(CM.ink)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 34)
                            .background(Capsule().fill(CM.projectorYellow))
                            .padding(.top, 4)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        LinearGradient(colors: [.clear, CM.cinemaBlack.opacity(0.92)], startPoint: .top, endPoint: .bottom)
                            .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: CM.Radius.card, bottomTrailingRadius: CM.Radius.card, style: .continuous))
                    )
                }
                .heroSource("hero-\(film.id)")
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(film.title), \(film.status.label)")
    }
}

// MARK: - Noticias

struct NewsRow: View {
    let item: NewsItem

    var body: some View {
        Group {
            if let filmID = item.filmId {
                NavigationLink(value: Route.film(id: filmID, transitionID: nil)) { content(external: false) }
            } else if let festivalID = item.festivalId {
                NavigationLink(value: Route.festival(id: festivalID)) { content(external: false) }
            } else {
                Link(destination: item.url) { content(external: true) }
            }
        }
        .buttonStyle(.plain)
    }

    private func content(external: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(item.kind.label.uppercased())
                        .font(CMFont.mono(10, weight: .semibold))
                        .foregroundStyle(CM.liveRed)
                    Text(CineFormat.relative(item.publishedAt))
                        .font(CMFont.mono(10))
                        .foregroundStyle(CM.secondaryText)
                }
                Text(item.title)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(CM.paperCream)
                    .multilineTextAlignment(.leading)
                if let outlet = item.outlet {
                    Text(outlet).font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: external ? "arrow.up.right.square" : "chevron.right")
                .foregroundStyle(CM.secondaryText)
        }
        .padding(.vertical, 12)
        .frame(minHeight: CM.minTap)
        .contentShape(Rectangle())
    }
}
