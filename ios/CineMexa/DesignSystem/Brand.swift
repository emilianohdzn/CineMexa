import SwiftUI

/// La X de MEXA: dos tiras de película que se cruzan.
/// La tira amarilla (proyector) pasa sobre la roja (en vivo) y lleva perforaciones en ambos bordes.
/// Misma construcción que docs/brand/app-icon.svg.
struct XMark: View {
    var size: CGFloat = 28
    var perforated = true

    var body: some View {
        let length = size * 1.13
        let thickness = size * 0.28
        let corner = thickness * 0.22
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(CM.liveRed)
                .frame(width: length, height: thickness)
                .rotationEffect(.degrees(-45))
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(CM.projectorYellow)
                .frame(width: length, height: thickness)
                .overlay {
                    if perforated {
                        VStack {
                            sprocketRow(thickness: thickness, length: length)
                            Spacer(minLength: 0)
                            sprocketRow(thickness: thickness, length: length)
                        }
                        .padding(.vertical, thickness * 0.15)
                    }
                }
                .rotationEffect(.degrees(45))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func sprocketRow(thickness: CGFloat, length: CGFloat) -> some View {
        let hole = thickness * 0.14
        let count = max(Int(length / (hole * 2.6)), 3)
        return HStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: hole * 0.25)
                    .fill(CM.cinemaBlack)
                    .frame(width: hole, height: hole)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, thickness * 0.3)
    }
}

/// Logotipo tipográfico CINE MEXA. La X se dibuja con XMark.
struct Wordmark: View {
    var size: CGFloat = 26
    var color: Color = CM.paperCream

    var body: some View {
        HStack(alignment: .center, spacing: size * 0.06) {
            Text("CINE")
                .padding(.trailing, size * 0.22)
            Text("ME")
            XMark(size: size * 0.82, perforated: size > 22)
                .padding(.horizontal, size * 0.02)
            Text("A")
        }
        .font(CMFont.display(size, relativeTo: .title))
        .tracking(size * 0.02)
        .foregroundStyle(color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Cine Mexa")
        .accessibilityAddTraits(.isHeader)
    }
}

/// Placeholder de póster cuando no existe una imagen autorizada.
/// Nunca simula un póster oficial: muestra el título y lo indica.
struct PosterPlaceholder: View {
    let title: String
    var year: Int?
    var compact = false

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [CM.raisedSurface, CM.deepSurface], startPoint: .top, endPoint: .bottom)
            if compact {
                GeometryReader { geo in
                    XMark(size: min(geo.size.width, geo.size.height) * 0.6, perforated: false)
                        .opacity(0.35)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                XMark(size: 120, perforated: true)
                    .opacity(0.10)
                    .offset(x: 40, y: -60)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            }
            if !compact { details }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title). Póster no disponible")
    }

    private var details: some View {
            VStack(alignment: .leading, spacing: 6) {
                Spacer(minLength: 0)
                Text(title)
                    .font(CMFont.headline(17, relativeTo: .headline))
                    .foregroundStyle(CM.paperCream)
                    .lineLimit(4)
                    .minimumScaleFactor(0.7)
                if let year {
                    Text(String(year))
                        .font(CMFont.mono(11))
                        .foregroundStyle(CM.secondaryText)
                }
                Label("Imagen no disponible", systemImage: "photo.badge.exclamationmark")
                    .font(CMFont.mono(9))
                    .foregroundStyle(CM.secondaryText)
                    .labelStyle(.titleAndIcon)
            }
            .padding(10)
    }
}
