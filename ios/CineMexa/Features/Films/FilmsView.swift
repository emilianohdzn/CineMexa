import SwiftUI

/// Catálogo y descubrimiento. La crítica vive aquí como sección destacada.
struct FilmsView: View {
    let catalog: Catalog
    @State private var filter: FilmFilter = .all
    @State private var refinements = FilmRefinements()
    @State private var showsRefinements = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .title2) private var criticismBadge: CGFloat = 48

    /// Dos columnas; una sola en tamaños de accesibilidad para que título y estado no se partan.
    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 14, alignment: .top), count: typeSize.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        let films = catalog.films(matching: filter, refinements: refinementsWithStreaming)
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.xl) {
                criticismEntry
                filterBar
                if refinements.isActive { activeRefinements }
                if films.isEmpty {
                    EmptyStateView(title: "Sin resultados", message: "No hay películas que cumplan estos filtros. Prueba con otra combinación.", symbol: "line.3.horizontal.decrease.circle")
                        .padding(.top, CM.Space.xxl)
                } else {
                    LazyVGrid(columns: columns, spacing: 22) {
                        ForEach(films) { film in
                            FilmCard(catalog: catalog, film: film, section: "grid")
                        }
                    }
                    .padding(.horizontal, CM.Space.gutter)
                    .animation(.cm(reduceMotion), value: films.map(\.id))
                }
            }
            .padding(.vertical, CM.Space.m)
        }
        .navigationTitle("Películas")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showsRefinements = true } label: {
                    Image(systemName: refinements.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("Más filtros")
            }
        }
        .sheet(isPresented: $showsRefinements) {
            RefinementSheet(catalog: catalog, refinements: $refinements)
                .presentationDetents([.medium, .large])
                .presentationBackground(CM.cinemaBlack)
        }
    }

    private var refinementsWithStreaming: FilmRefinements {
        var r = refinements
        r.filmsWithStreaming = Set(catalog.snapshot.streaming.map(\.filmId))
        return r
    }

    private var criticismEntry: some View {
        NavigationLink(value: Route.criticism) {
            // Con texto de accesibilidad el círculo se come el ancho y "Crítica" se parte: el ícono va arriba.
            let layout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
            layout {
                Image(systemName: "text.quote")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(CM.ink)
                    .frame(width: criticismBadge, height: criticismBadge)
                    .background(Circle().fill(CM.projectorYellow))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Crítica")
                        .font(CMFont.display(24, relativeTo: .title2))
                        .foregroundStyle(CM.ink)
                    Text("\(catalog.recentReviews.count) reseñas enlazadas a su publicación original")
                        .font(.footnote)
                        .foregroundStyle(CM.creamSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !typeSize.isAccessibilitySize {
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(CM.ink)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .ticketBackground(CM.paperCream)
        }
        .buttonStyle(PressableStyle())
        .padding(.horizontal, CM.Space.gutter)
    }

    private var filterBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(FilmFilter.allCases) { f in
                    FilterChip(title: f.label, isSelected: filter == f) { filter = f }
                }
            }
            .padding(.horizontal, CM.Space.gutter)
        }
        .scrollIndicators(.hidden)
    }

    private var activeRefinements: some View {
        HStack {
            Text([refinements.year.map { String($0) }, refinements.genre, refinements.director, refinements.participation?.label,
                  refinements.streamingOnly ? "En streaming" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(CMFont.mono(11))
                .foregroundStyle(CM.electricBlue)
            Spacer()
            Button("Limpiar") { refinements = FilmRefinements() }
                .font(.footnote.weight(.semibold))
                .frame(minHeight: CM.minTap)
        }
        .padding(.horizontal, CM.Space.gutter)
    }
}

private struct RefinementSheet: View {
    let catalog: Catalog
    @Binding var refinements: FilmRefinements
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Año", selection: $refinements.year) {
                    Text("Cualquiera").tag(Int?.none)
                    ForEach(catalog.allYears, id: \.self) { Text(String($0)).tag(Int?.some($0)) }
                }
                Picker("Género", selection: $refinements.genre) {
                    Text("Cualquiera").tag(String?.none)
                    ForEach(catalog.allGenres, id: \.self) { Text($0).tag(String?.some($0)) }
                }
                Picker("Dirección", selection: $refinements.director) {
                    Text("Cualquiera").tag(String?.none)
                    ForEach(catalog.allDirectors, id: \.self) { Text($0).tag(String?.some($0)) }
                }
                Picker("Producción", selection: $refinements.participation) {
                    Text("Cualquiera").tag(MexicanParticipation?.none)
                    ForEach([MexicanParticipation.majority, .coproduction, .minority], id: \.self) {
                        Text($0.label).tag(MexicanParticipation?.some($0))
                    }
                }
                Toggle("Disponible en streaming en México", isOn: $refinements.streamingOnly)
            }
            .scrollContentBackground(.hidden)
            .navigationTitle("Filtros")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Limpiar") { refinements = FilmRefinements() } }
                ToolbarItem(placement: .topBarTrailing) { Button("Listo") { dismiss() }.bold() }
            }
        }
    }
}
