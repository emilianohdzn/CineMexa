import SwiftUI

// MARK: - Póster

/// Póster vertical 2:3. Usa RemoteImage/ImagePipeline sobre URLCache (configurada en CineMexaApp)
/// y nunca estira la imagen: la recorta con aspect fill dentro del marco 2:3.
struct PosterView: View {
    let film: Film
    var cornerRadius: CGFloat = CM.Radius.poster
    /// Sin texto en el placeholder: para miniaturas o cuando el título ya va encima.
    var compactPlaceholder = false

    @Environment(\.displayScale) private var displayScale
    @State private var width: CGFloat = 0

    var body: some View {
        Color.clear
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
            .overlay {
                if let url = film.poster?.url, width > 0 {
                    // Se pide el tamaño de TMDB que cubre el ancho real en píxeles y se decodifica a esa medida.
                    let pixels = width * displayScale
                    RemoteImage(url: url.tmdbResized(ImageSizing.posterSize(forPixelWidth: pixels)), maxPixel: (pixels * 1.5).rounded(.up)) {
                        PosterPlaceholder(title: film.title, year: film.year, compact: compactPlaceholder)
                    } loading: {
                        SkeletonBlock()
                    }
                } else if film.poster == nil {
                    PosterPlaceholder(title: film.title, year: film.year, compact: compactPlaceholder)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).strokeBorder(CM.hairline))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(film.poster == nil ? "Sin póster disponible: \(film.title)" : "Póster de \(film.title)"))
            .accessibilityAddTraits(.isImage)
    }
}

// MARK: - Etiquetas

/// Etiqueta impresa: texto + símbolo (el color nunca es el único indicador).
struct TagLabel: View {
    let text: String
    let symbol: String
    var tint: Color = CM.projectorYellow
    var filled = false

    var body: some View {
        Label(text, systemImage: symbol)
            .font(CMFont.mono(11, weight: .semibold))
            .textCase(.uppercase)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(filled ? CM.ink : tint)
            .background {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(filled ? tint : tint.opacity(0.12))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(tint.opacity(filled ? 0 : 0.5), lineWidth: 1)
            }
    }
}

struct StatusTag: View {
    let status: FilmStatus
    var body: some View {
        TagLabel(text: status.label, symbol: status.symbol, tint: tint, filled: status == .inTheaters)
    }
    private var tint: Color {
        switch status {
        case .inTheaters, .releaseIdentified: CM.liveRed
        case .festival: CM.projectorYellow
        case .upcoming: CM.electricBlue
        case .archive: CM.secondaryText
        }
    }
}

struct VerificationTag: View {
    let provenance: Provenance
    var body: some View {
        Label {
            Text("\(provenance.verification.label) · \(provenance.source)")
        } icon: {
            Image(systemName: provenance.verification.symbol)
        }
        .font(CMFont.mono(10))
        .foregroundStyle(CM.secondaryText)
        .accessibilityLabel("Estado del dato: \(provenance.verification.label). Fuente: \(provenance.source)")
    }
}

// MARK: - Encabezados de sección

struct SectionHeader<Trailing: View>: View {
    let title: String
    var kicker: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                if let kicker {
                    Text(kicker)
                        .font(CMFont.mono(11, weight: .semibold))
                        .foregroundStyle(CM.projectorYellow)
                        .textCase(.uppercase)
                }
                Text(title)
                    .font(CMFont.display(26, relativeTo: .title2))
                    .foregroundStyle(CM.paperCream)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, CM.Space.gutter)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(title: String, kicker: String? = nil) {
        self.init(title: title, kicker: kicker, trailing: { EmptyView() })
    }
}

/// Botón "Ver todo" con objetivo táctil suficiente.
struct SeeAllLabel: View {
    var text = "Ver todo"
    var body: some View {
        HStack(spacing: 4) {
            Text(text)
            Image(systemName: "chevron.right")
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(CM.electricBlue)
        .frame(minHeight: CM.minTap)
        .contentShape(Rectangle())
    }
}

// MARK: - Chips de filtro

struct FilterChip: View {
    let title: String
    var symbol: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol) }
                Text(title)
                if isSelected { Image(systemName: "checkmark").font(.caption.weight(.bold)) }
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .foregroundStyle(isSelected ? CM.ink : CM.paperCream)
            .background(Capsule().fill(isSelected ? CM.projectorYellow : CM.deepSurface))
            .overlay(Capsule().strokeBorder(isSelected ? Color.clear : CM.hairline))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: isSelected)
    }
}

// MARK: - Estados

struct SkeletonBlock: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Rectangle()
            .fill(CM.raisedSurface)
            .opacity(pulse ? 0.55 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
            .accessibilityHidden(true)
    }
}

struct LoadingSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.xl) {
                SkeletonBlock().frame(width: 180, height: 28).clipShape(Capsule())
                SkeletonBlock().frame(height: 420).clipShape(RoundedRectangle(cornerRadius: CM.Radius.card))
                HStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { _ in
                        SkeletonBlock().aspectRatio(2.0 / 3.0, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: CM.Radius.poster))
                    }
                }
            }
            .padding(CM.Space.gutter)
        }
        .scrollDisabled(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Cargando Cine Mexa")
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String
    var symbol = "film.stack"

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: symbol)
                .font(CMFont.headline(20))
                .foregroundStyle(CM.paperCream)
        } description: {
            Text(message).foregroundStyle(CM.secondaryText)
        }
    }
}

struct ErrorStateView: View {
    let message: String
    let retry: () async -> Void
    var body: some View {
        ContentUnavailableView {
            Label("No pudimos cargar Cine Mexa", systemImage: "wifi.exclamationmark")
                .font(CMFont.headline(20))
                .foregroundStyle(CM.paperCream)
        } description: {
            Text(message).foregroundStyle(CM.secondaryText)
        } actions: {
            Button("Reintentar") { Task { await retry() } }
                .buttonStyle(.borderedProminent)
                .tint(CM.projectorYellow)
                .foregroundStyle(CM.ink)
        }
    }
}

/// Aviso permanente cuando se muestran datos ficticios.
struct DemoBanner: View {
    var body: some View {
        Label("Modo demostración · datos ficticios", systemImage: "theatermasks.fill")
            .font(CMFont.mono(11, weight: .semibold))
            .foregroundStyle(CM.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(CM.projectorYellow))
            .accessibilityLabel("Modo demostración. Todos los datos que ves son ficticios.")
    }
}

/// Estado de sincronización honesto: nunca dice "en vivo" si no lo es.
struct SyncStatusLine: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
            Text(text)
        }
        .font(CMFont.mono(11))
        .foregroundStyle(model.isShowingCachedData ? CM.liveRed : CM.secondaryText)
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        if model.catalog?.isDemo == true { return "theatermasks" }
        return model.isShowingCachedData ? "exclamationmark.arrow.circlepath" : "arrow.triangle.2.circlepath"
    }

    private var text: String {
        guard let catalog = model.catalog else { return "Sin datos" }
        if catalog.isDemo { return "Datos de demostración" }
        let when = CineFormat.relative(catalog.snapshot.meta.generatedAt)
        return model.isShowingCachedData ? "Actualización pendiente · datos de \(when)" : "Actualizado \(when)"
    }
}

// MARK: - Boleto

/// Forma de boleto con muescas laterales, para tarjetas de festivales y convocatorias.
struct TicketShape: Shape {
    var notchRadius: CGFloat = 9
    var notchPosition: CGFloat = 0.68
    var cornerRadius: CGFloat = CM.Radius.card

    func path(in rect: CGRect) -> Path {
        let body = Path(roundedRect: rect, cornerRadius: cornerRadius, style: .continuous)
        let y = rect.minY + rect.height * notchPosition
        var notches = Path()
        notches.addEllipse(in: CGRect(x: rect.minX - notchRadius, y: y - notchRadius, width: notchRadius * 2, height: notchRadius * 2))
        notches.addEllipse(in: CGRect(x: rect.maxX - notchRadius, y: y - notchRadius, width: notchRadius * 2, height: notchRadius * 2))
        return body.subtracting(notches)
    }
}

extension View {
    func ticketBackground(_ color: Color = CM.deepSurface) -> some View {
        background(TicketShape().fill(color))
    }
}
