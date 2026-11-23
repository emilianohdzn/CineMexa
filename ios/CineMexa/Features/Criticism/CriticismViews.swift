import SwiftUI

/// Tarjeta editorial de reseña. Nunca copia el artículo: enlaza a la publicación original.
/// La puntuación y el extracto sólo aparecen si el contrato los trae (licencia confirmada en backend).
struct ReviewCard: View {
    let review: Review
    var film: Film?
    var showsFilm = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(review.outlet.uppercased())
                    .font(CMFont.mono(11, weight: .semibold))
                    .foregroundStyle(CM.creamRed)
                Spacer()
                Text(CineFormat.shortDate(review.publishedAt))
                    .font(CMFont.mono(10))
                    .foregroundStyle(CM.creamSecondary)
            }
            if showsFilm, let film {
                Text(film.title)
                    .font(CMFont.headline(15, relativeTo: .subheadline))
                    .foregroundStyle(CM.creamSecondary)
            }
            Text(review.title)
                .font(CMFont.headline(20))
                .foregroundStyle(CM.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let critic = review.criticName {
                Text("por \(critic)").font(.footnote.italic()).foregroundStyle(CM.creamSecondary)
            }
            if let excerpt = review.excerpt {
                Text(excerpt)
                    .font(.callout)
                    .foregroundStyle(CM.ink.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let score = review.score, let scale = review.scoreScale {
                Text("Puntuación: \(CineFormat.number(score)) / \(CineFormat.number(scale))")
                    .font(CMFont.mono(12, weight: .semibold))
                    .foregroundStyle(CM.ink)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 4).strokeBorder(CM.ink, lineWidth: 1.5))
            }
            Button {
                openURL(review.url)
            } label: {
                Label("Leer crítica completa", systemImage: "arrow.up.right")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(CM.paperCream)
                    .padding(.horizontal, 14)
                    .frame(minHeight: CM.minTap)
                    .background(Capsule().fill(CM.ink))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Abre \(review.outlet) en el navegador")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: CM.Radius.card, style: .continuous).fill(CM.paperCream))
    }
}

/// Síntesis propia identificada como resumen automatizado y con su fuente enlazada.
struct AutomatedSummaryCard: View {
    let review: Review
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Resumen automatizado", systemImage: "sparkles")
                .font(CMFont.mono(11, weight: .semibold))
                .foregroundStyle(CM.electricBlue)
            if let text = review.excerpt {
                Text(text).font(.callout).foregroundStyle(CM.paperCream)
            }
            Link(destination: review.url) {
                Label("Ver fuentes", systemImage: "link").font(.footnote.weight(.semibold))
            }
            .frame(minHeight: CM.minTap)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: CM.Radius.card).strokeBorder(CM.electricBlue.opacity(0.5)))
    }
}

/// Módulo de crítica dentro de la ficha.
struct FilmCriticismSection: View {
    let catalog: Catalog
    let film: Film

    var body: some View {
        let all = catalog.reviewsByFilm[film.id] ?? []
        let summaries = all.filter(\.isAutomatedSummary)
        let reviews = all.filter { !$0.isAutomatedSummary }
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Crítica", kicker: reviews.isEmpty ? nil : "\(reviews.count) \(reviews.count == 1 ? "reseña" : "reseñas")")
            VStack(spacing: 12) {
                ForEach(summaries) { AutomatedSummaryCard(review: $0) }
                if reviews.isEmpty {
                    EmptyStateView(title: "Aún sin reseñas verificadas",
                                   message: "Cuando un medio publique una crítica de esta película la enlazaremos aquí.",
                                   symbol: "text.quote")
                } else {
                    ForEach(reviews) { ReviewCard(review: $0) }
                }
            }
            .padding(.horizontal, CM.Space.gutter)
        }
    }
}

/// Feed de crítica con búsqueda por título o publicación.
struct CriticismFeedView: View {
    let catalog: Catalog
    @State private var query = ""
    @State private var outlet: String?

    var body: some View {
        let outlets = Array(Set(catalog.recentReviews.map(\.outlet))).sorted()
        let reviews = catalog.recentReviews.filter { r in
            let q = Catalog.fold(query)
            let matchesQuery = q.isEmpty || [r.title, r.outlet, r.criticName ?? "", catalog.film(r.filmId)?.title ?? ""]
                .contains { Catalog.fold($0).contains(q) }
            return matchesQuery && (outlet == nil || r.outlet == outlet)
        }
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.l) {
                Text("Distintas voces, publicaciones y perspectivas. Cada reseña abre el texto original.")
                    .font(.callout)
                    .foregroundStyle(CM.secondaryText)
                    .padding(.horizontal, CM.Space.gutter)
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        FilterChip(title: "Todas", isSelected: outlet == nil) { outlet = nil }
                        ForEach(outlets, id: \.self) { o in
                            FilterChip(title: o, isSelected: outlet == o) { outlet = o }
                        }
                    }
                    .padding(.horizontal, CM.Space.gutter)
                }
                .scrollIndicators(.hidden)
                if reviews.isEmpty {
                    EmptyStateView(title: "Sin reseñas", message: "No encontramos reseñas con esa búsqueda.", symbol: "text.magnifyingglass")
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(reviews) { review in
                            VStack(alignment: .leading, spacing: 6) {
                                if let film = catalog.film(review.filmId) {
                                    NavigationLink(value: Route.film(id: film.id, transitionID: nil)) {
                                        Label(film.title, systemImage: "film")
                                            .font(.footnote.weight(.semibold))
                                            .foregroundStyle(CM.electricBlue)
                                            .frame(minHeight: CM.minTap)
                                    }
                                }
                                ReviewCard(review: review)
                            }
                        }
                    }
                    .padding(.horizontal, CM.Space.gutter)
                }
            }
            .padding(.vertical, CM.Space.m)
        }
        .searchable(text: $query, prompt: "Título, medio o crítico")
        .navigationTitle("Crítica")
    }
}
