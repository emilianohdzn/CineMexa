import SwiftUI
import Charts

/// Las 5 que están dando de qué hablar. El ranking se calcula en el servidor
/// (packages/core/src/trendScore.ts); la app sólo lo presenta con sus fuentes.
struct TrendsView: View {
    let catalog: Catalog
    @State private var window: TrendWindow = .week
    @State private var showsMethodology = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.xl) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(catalog.trends(window)?.label ?? "Tendencias digitales")
                        .font(CMFont.mono(12, weight: .semibold))
                        .foregroundStyle(CM.projectorYellow)
                        .textCase(.uppercase)
                    Text("Las 5 que están dando de qué hablar")
                        .font(CMFont.display(34))
                        .foregroundStyle(CM.paperCream)
                        .fixedSize(horizontal: false, vertical: true)
                    if catalog.isDemo { DemoBanner() }
                }
                .padding(.horizontal, CM.Space.gutter)

                Picker("Periodo", selection: $window) {
                    ForEach(TrendWindow.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, CM.Space.gutter)
                .sensoryFeedback(.selection, trigger: window)

                if let ranking = catalog.trends(window), !ranking.entries.isEmpty {
                    rankingList(ranking)
                    chart(ranking)
                    sources(ranking)
                    if ranking.sourcesUsed.allSatisfy({ $0 == "youtube" || $0 == "media" }) {
                        Text("Refleja el crecimiento de visualizaciones de los tráilers disponibles en YouTube, no toda la conversación digital sobre el cine mexicano.")
                            .font(.footnote)
                            .foregroundStyle(CM.secondaryText)
                            .padding(.horizontal, CM.Space.gutter)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    EmptyStateView(title: "Sin datos suficientes",
                                   message: "Todavía no hay películas con evidencia suficiente en este periodo. El ranking mide el crecimiento de visualizaciones de los tráilers oficiales en YouTube entre mediciones reales; necesita varias mediciones (cada 6 horas) para comparar con días anteriores. No mostramos posiciones sin datos verificables.",
                                   symbol: "chart.line.downtrend.xyaxis")
                }
            }
            .padding(.vertical, CM.Space.m)
            .animation(.cm(reduceMotion), value: window)
        }
        .navigationTitle("Trends")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showsMethodology = true } label: { Image(systemName: "info.circle") }
                    .accessibilityLabel("Cómo calculamos el ranking")
            }
        }
        .sheet(isPresented: $showsMethodology) {
            MethodologySheet().presentationBackground(CM.cinemaBlack)
        }
    }

    private func rankingList(_ ranking: TrendRanking) -> some View {
        VStack(spacing: 12) {
            ForEach(ranking.entries, id: \.filmId) { entry in
                if let film = catalog.film(entry.filmId) {
                    NavigationLink(value: Route.film(id: film.id, transitionID: "trend-\(film.id)")) {
                        RankRow(entry: entry, film: film, compact: false)
                            .heroSource("trend-\(film.id)")
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            if ranking.entries.count < 5 {
                Text("Sólo \(ranking.entries.count) películas tienen evidencia suficiente en este periodo.")
                    .font(.footnote).foregroundStyle(CM.secondaryText)
            }
        }
        .padding(.horizontal, CM.Space.gutter)
    }

    private func chart(_ ranking: TrendRanking) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Evolución del índice").font(CMFont.headline(18)).foregroundStyle(CM.paperCream)
            Chart(ranking.history, id: \.self) { point in
                LineMark(x: .value("Fecha", point.date), y: .value("Índice", point.score))
                    .foregroundStyle(by: .value("Película", catalog.film(point.filmId)?.title ?? point.filmId))
                    .interpolationMethod(.monotone)
                    .symbol(by: .value("Película", catalog.film(point.filmId)?.title ?? point.filmId))
            }
            .chartYScale(domain: 0...100)
            .chartForegroundStyleScale(range: [CM.projectorYellow, CM.liveRed, CM.electricBlue, CM.paperCream, CM.secondaryText])
            .chartLegend(position: .bottom, alignment: .leading)
            .frame(height: 240)
            .accessibilityLabel("Gráfica de la evolución del índice de tendencia de las cinco películas")
            Text("Índice 0–100. 50 = interés típico entre las películas analizadas en el periodo.")
                .font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: CM.Radius.card).fill(CM.deepSurface))
        .padding(.horizontal, CM.Space.gutter)
    }

    private func sources(_ ranking: TrendRanking) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Fuentes usadas: \(ranking.sourcesUsed.map(sourceName).joined(separator: ", "))")
            Text("Calculado \(CineFormat.relative(ranking.computedAt)) · \(ranking.methodologyVersion)")
            Text("No usamos la popularidad general de TMDB ni cifras de redes sin integración legítima.")
        }
        .font(CMFont.mono(10))
        .foregroundStyle(CM.secondaryText)
        .padding(.horizontal, CM.Space.gutter)
    }

    private func sourceName(_ id: String) -> String {
        switch id {
        case "youtube": "YouTube"
        case "media": "menciones en medios"
        case "google_trends": "Google Trends"
        default: id
        }
    }
}

/// Fila de ranking: número grande, póster, cambio de posición y la señal que lo explica.
struct RankRow: View {
    let entry: TrendEntry
    let film: Film
    var compact: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("\(entry.rank)")
                .font(CMFont.display(compact ? 40 : 56, relativeTo: .largeTitle))
                .foregroundStyle(entry.rank == 1 ? CM.projectorYellow : CM.paperCream)
                .frame(width: compact ? 34 : 46)
                .minimumScaleFactor(0.6)
            PosterView(film: film, cornerRadius: 6, compactPlaceholder: true)
                .frame(width: compact ? 48 : 64)
            VStack(alignment: .leading, spacing: 4) {
                Text(film.title)
                    .font(.headline)
                    .foregroundStyle(CM.paperCream)
                    .lineLimit(2)
                Text(entry.explanation)
                    .font(.footnote)
                    .foregroundStyle(CM.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if !compact {
                    Text("Índice \(entry.score)")
                        .font(CMFont.mono(11, weight: .semibold))
                        .foregroundStyle(CM.electricBlue)
                }
            }
            Spacer(minLength: 4)
            RankChange(rank: entry.rank, previous: entry.previousRank)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: CM.Radius.card).fill(CM.deepSurface))
        .accessibilityElement(children: .combine)
    }
}

struct RankChange: View {
    let rank: Int
    let previous: Int?

    var body: some View {
        let (symbol, text, color): (String, String, Color) = {
            guard let previous else { return ("sparkle", "Nuevo", CM.electricBlue) }
            if previous > rank { return ("arrow.up", "+\(previous - rank)", CM.projectorYellow) }
            if previous < rank { return ("arrow.down", "−\(rank - previous)", CM.liveRed) }
            return ("equal", "=", CM.secondaryText)
        }()
        VStack(spacing: 2) {
            Image(systemName: symbol).font(.caption.weight(.bold))
            Text(text).font(CMFont.mono(11, weight: .semibold))
        }
        .foregroundStyle(color)
        .frame(minWidth: 36)
        .accessibilityLabel(accessibility)
    }

    private var accessibility: String {
        guard let previous else { return "Nueva en el ranking" }
        if previous > rank { return "Subió \(previous - rank) posiciones" }
        if previous < rank { return "Bajó \(rank - previous) posiciones" }
        return "Sin cambio de posición"
    }
}

private struct MethodologySheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Cómo calculamos el ranking").font(CMFont.display(28)).foregroundStyle(CM.paperCream)
                    Group {
                        Text("1. Para cada película y fuente comparamos la actividad del periodo elegido contra el promedio de los tres periodos anteriores.")
                        Text("2. Medimos el crecimiento relativo con un logaritmo suavizado, para que una película con poca actividad no salte por unos cuantos clics y una con audiencia histórica enorme no gane sólo por tamaño.")
                        Text("3. Estandarizamos cada señal entre las películas candidatas (mediana y desviación absoluta) y combinamos 70 % crecimiento y 30 % actividad reciente.")
                        Text("4. Sólo entran películas con evidencia mínima en al menos una fuente digital. Las menciones en medios suman, pero por sí solas no bastan.")
                        Text("5. Si sólo usamos YouTube y medios, el ranking se llama «Tendencias digitales». Si hay menos de cinco películas con datos suficientes, mostramos sólo esas.")
                        Text("6. Guardamos una instantánea de cada cálculo para medir los cambios de posición.")
                    }
                    .font(.callout)
                    .foregroundStyle(CM.paperCream.opacity(0.9))
                    Text("Versión trend_score/1.0 · docs/TRENDS-METHODOLOGY.md")
                        .font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                }
                .padding(CM.Space.gutter)
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Listo") { dismiss() } } }
        }
    }
}
