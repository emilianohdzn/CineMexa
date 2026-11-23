import SwiftUI
import MapKit

/// Mapa festivalero: dónde se proyectan, compiten o premian películas mexicanas.
/// Las coordenadas vienen persistidas en el backend (venues); la app nunca geocodifica.
struct FestivalMapView: View {
    let catalog: Catalog
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var position: MapCameraPosition = .region(Self.worldRegion)
    @State private var visibleRegion: MKCoordinateRegion = Self.worldRegion
    @State private var period: MapPeriod = .month
    @State private var kinds: Set<FestivalEventKind> = Set(FestivalEventKind.allCases)
    @State private var filmKind: FilmKind?
    @State private var query = ""
    @State private var selected: Catalog.MapItem?
    @State private var showsList = false

    static let worldRegion = MKCoordinateRegion(center: .init(latitude: 28, longitude: -45),
                                                span: .init(latitudeDelta: 100, longitudeDelta: 200))

    var body: some View {
        let items = catalog.mapItems(period: period, kinds: kinds, filmKind: filmKind, query: query)
        let clusters = MapClusterer.cluster(items, region: visibleRegion)

        Map(position: $position) {
            ForEach(clusters) { cluster in
                Annotation(cluster.title, coordinate: cluster.coordinate, anchor: .bottom) {
                    Button {
                        if cluster.items.count == 1 { selected = cluster.items[0] } else { zoom(into: cluster) }
                    } label: {
                        FestivalPin(count: cluster.items.count, hasAward: cluster.hasAward, isActive: cluster.isActiveNow)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(cluster.accessibilityLabel)
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .onMapCameraChange(frequency: .onEnd) { context in
            visibleRegion = context.region
        }
        .safeAreaInset(edge: .top) { filters(count: items.count) }
        .overlay(alignment: .bottomTrailing) {
            Button { showsList = true } label: {
                Label("Lista", systemImage: "list.bullet")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(CM.ink)
                    .padding(.horizontal, 14)
                    .frame(minHeight: CM.minTap)
                    .background(Capsule().fill(CM.projectorYellow))
            }
            .padding(16)
            .accessibilityLabel("Ver festivales del mapa en lista")
        }
        .sheet(item: $selected) { item in
            FestivalMapSheet(catalog: catalog, item: item)
                .presentationDetents([.medium, .large])
                .presentationBackground(CM.cinemaBlack)
        }
        .sheet(isPresented: $showsList) {
            NavigationStack {
                List(items) { item in
                    Button { showsList = false; selected = item } label: {
                        VStack(alignment: .leading) {
                            Text(item.festival.displayName).font(.headline)
                            Text("\(item.festival.city), \(CountryName.name(item.festival.country)) · \(item.events.count) participaciones")
                                .font(.caption).foregroundStyle(CM.secondaryText)
                        }
                    }
                }
                .overlay { if items.isEmpty { EmptyStateView(title: "Sin actividad", message: "No hay actividad confirmada con estos filtros.") } }
                .navigationTitle("Festivales en el mapa")
                .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
        }
        .navigationTitle("Mapa festivalero")
        .navigationBarTitleDisplayMode(.inline)
        .animation(.cm(reduceMotion), value: clusters.map(\.id))
    }

    private func zoom(into cluster: MapCluster) {
        let lats = cluster.items.map(\.coordinate.latitude)
        let lons = cluster.items.map(\.coordinate.longitude)
        let center = CLLocationCoordinate2D(latitude: (lats.min()! + lats.max()!) / 2, longitude: (lons.min()! + lons.max()!) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max((lats.max()! - lats.min()!) * 2.5, 0.4),
                                    longitudeDelta: max((lons.max()! - lons.min()!) * 2.5, 0.4))
        withAnimation(.cm(reduceMotion)) { position = .region(MKCoordinateRegion(center: center, span: span)) }
    }

    private func filters(count: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(CM.secondaryText)
                TextField("Buscar una película", text: $query)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .foregroundStyle(CM.secondaryText)
                        .accessibilityLabel("Borrar búsqueda")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: CM.minTap)
            .background(RoundedRectangle(cornerRadius: 12).fill(CM.deepSurface))

            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(MapPeriod.allCases) { p in
                        FilterChip(title: p.label, isSelected: period == p) { period = p }
                    }
                    Divider().frame(height: 24)
                    ForEach([FestivalEventKind.selection, .screening, .award], id: \.self) { k in
                        FilterChip(title: k.label, symbol: k.symbol, isSelected: kinds.contains(k)) {
                            if kinds.contains(k) { kinds.remove(k) } else { kinds.insert(k) }
                            if k == .screening {
                                if kinds.contains(.screening) { kinds.insert(.premiere) } else { kinds.remove(.premiere) }
                            }
                        }
                    }
                    Divider().frame(height: 24)
                    FilterChip(title: "Largos", isSelected: filmKind == .feature) { filmKind = filmKind == .feature ? nil : .feature }
                    FilterChip(title: "Cortos", isSelected: filmKind == .short) { filmKind = filmKind == .short ? nil : .short }
                }
            }
            .scrollIndicators(.hidden)

            Text(count == 0 ? "Sin actividad confirmada en este periodo" : "\(count) sedes con actividad documentada · \(period.label.lowercased())")
                .font(CMFont.mono(10, weight: .semibold))
                .foregroundStyle(CM.secondaryText)
        }
        .padding(.horizontal, CM.Space.l)
        .padding(.vertical, 10)
        .background(CM.cinemaBlack.opacity(0.94))
    }
}

// MARK: - Marcador

private struct FestivalPin: View {
    let count: Int
    let hasAward: Bool
    let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .fill(hasAward ? CM.projectorYellow : CM.paperCream)
                    .frame(width: count > 1 ? 40 : 32, height: count > 1 ? 40 : 32)
                if count > 1 {
                    Text("\(count)").font(CMFont.mono(14, weight: .semibold)).foregroundStyle(CM.ink)
                } else {
                    Image(systemName: hasAward ? "trophy.fill" : "film")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(CM.ink)
                }
            }
            .overlay(Circle().strokeBorder(isActive ? CM.liveRed : CM.cinemaBlack, lineWidth: 3))
            Triangle().fill(isActive ? CM.liveRed : CM.cinemaBlack).frame(width: 10, height: 7)
        }
        .frame(minWidth: CM.minTap, minHeight: CM.minTap)
        .scaleEffect(appeared || reduceMotion ? 1 : 0.2, anchor: .bottom)
        .onAppear {
            withAnimation(Animation.cm(reduceMotion)?.delay(Double.random(in: 0...0.25))) { appeared = true }
        }
    }
}

private struct Triangle: Shape {
    func path(in r: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: r.minX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
            p.closeSubpath()
        }
    }
}

// MARK: - Agrupación

struct MapCluster: Identifiable {
    let items: [Catalog.MapItem]
    var id: String { items.map(\.id).sorted().joined(separator: "+") }
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: items.map(\.coordinate.latitude).reduce(0, +) / Double(items.count),
                               longitude: items.map(\.coordinate.longitude).reduce(0, +) / Double(items.count))
    }
    var title: String { items.count == 1 ? items[0].festival.displayName : "\(items.count) festivales" }
    var hasAward: Bool { items.contains { $0.events.contains { $0.kind == .award } } }
    var isActiveNow: Bool {
        items.contains { item in item.festival.editions.contains { DateLogic.status(of: $0, now: Date()) == .active } }
    }
    var accessibilityLabel: String {
        if items.count == 1 {
            let f = items[0].festival
            return "\(f.displayName), \(f.city). \(items[0].events.count) participaciones mexicanas\(isActiveNow ? ", en curso" : "")"
        }
        return "\(items.count) festivales agrupados: \(items.map(\.festival.displayName).joined(separator: ", ")). Toca para acercar."
    }
}

/// Agrupación por cuadrícula según el área visible: evita marcadores encimados sin consultas extra.
enum MapClusterer {
    static func cluster(_ items: [Catalog.MapItem], region: MKCoordinateRegion, cellsAcross: Double = 9) -> [MapCluster] {
        let cellLon = max(region.span.longitudeDelta / cellsAcross, 0.0001)
        let cellLat = max(region.span.latitudeDelta / (cellsAcross * 1.6), 0.0001)
        var buckets: [String: [Catalog.MapItem]] = [:]
        for item in items {
            let key = "\(Int(floor(item.coordinate.latitude / cellLat)))|\(Int(floor(item.coordinate.longitude / cellLon)))"
            buckets[key, default: []].append(item)
        }
        return buckets.values.map { MapCluster(items: $0) }.sorted { $0.id < $1.id }
    }
}

// MARK: - Hoja del festival

struct FestivalMapSheet: View {
    let catalog: Catalog
    let item: Catalog.MapItem

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: CM.Space.l) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.festival.name)
                            .font(CMFont.display(26, relativeTo: .title2))
                            .foregroundStyle(CM.paperCream)
                        Text("\(item.festival.city), \(CountryName.name(item.festival.country))")
                            .font(.subheadline).foregroundStyle(CM.secondaryText)
                        ForEach(item.festival.editions) { edition in
                            let status = DateLogic.status(of: edition, now: Date())
                            HStack {
                                Label(status.label, systemImage: status.symbol)
                                Text(CineFormat.dayRange(edition.startsOn, edition.endsOn))
                            }
                            .font(CMFont.mono(11, weight: .semibold))
                            .foregroundStyle(status == .active ? CM.liveRed : CM.electricBlue)
                        }
                        if item.festival.venue.coordinatePrecision == "city" {
                            Label("Ubicación aproximada a nivel ciudad", systemImage: "mappin.and.ellipse")
                                .font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                        }
                    }

                    Text("Películas mexicanas").font(CMFont.headline(18)).foregroundStyle(CM.projectorYellow)
                    ForEach(groupedByFilm) { group in
                        let film = group.film
                        VStack(alignment: .leading, spacing: 6) {
                            NavigationLink(value: film.id) {
                                HStack {
                                    Text(film.title).font(.headline).foregroundStyle(CM.paperCream)
                                    Text(film.kind == .short ? "Corto" : "Largo").font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                                    Spacer()
                                    Image(systemName: "chevron.right").foregroundStyle(CM.secondaryText)
                                }
                                .frame(minHeight: CM.minTap)
                            }
                            ForEach(group.events) { ev in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Image(systemName: ev.kind.symbol).foregroundStyle(ev.kind == .award ? CM.projectorYellow : CM.electricBlue)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text([ev.kind.label, ev.awardName, ev.section].compactMap { $0 }.joined(separator: " · "))
                                            .font(.footnote).foregroundStyle(CM.paperCream)
                                        Text(ev.occursAt.map { CineFormat.dateTime($0) } ?? "Sin función con fecha confirmada")
                                            .font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                                    }
                                }
                            }
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: CM.Radius.card).fill(CM.deepSurface))
                    }

                    if let url = item.festival.editions.first?.programUrl ?? item.festival.websiteUrl {
                        Link(destination: url) {
                            Label("Programa oficial", systemImage: "arrow.up.right.square")
                                .font(.callout.weight(.bold))
                                .frame(maxWidth: .infinity, minHeight: CM.minTap)
                                .foregroundStyle(CM.ink)
                                .background(Capsule().fill(CM.projectorYellow))
                        }
                    }
                }
                .padding(CM.Space.gutter)
            }
            .navigationDestination(for: String.self) { filmID in
                FilmDetailView(catalog: catalog, filmID: filmID)
                    .background(CM.cinemaBlack.ignoresSafeArea())
            }
        }
    }

    private var groupedByFilm: [Catalog.FilmEvents] { catalog.groupByFilm(item.events) }
}
