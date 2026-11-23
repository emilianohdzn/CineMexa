import SwiftUI

/// "Su recorrido": festival → estreno → premios → salas → streaming. Cada hito con fecha y fuente.
struct FilmTimelineSection: View {
    let catalog: Catalog
    let film: Film

    var body: some View {
        let events = catalog.timelineByFilm[film.id] ?? []
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Su recorrido", kicker: "Festivales, salas y ventanas")
            if events.isEmpty {
                EmptyStateView(title: "Sin recorrido documentado", message: "Aún no tenemos hitos verificados para esta película.", symbol: "point.topleft.down.to.point.bottomright.curvepath")
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        TimelineRow(event: event, isFirst: index == 0, isLast: index == events.count - 1)
                    }
                }
                .padding(.horizontal, CM.Space.gutter)
            }
        }
    }
}

private struct TimelineRow: View {
    let event: TimelineEvent
    let isFirst: Bool
    let isLast: Bool

    private var isFuture: Bool { event.date > Date() }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Rectangle().fill(isFirst ? Color.clear : CM.secondaryText.opacity(0.35)).frame(width: 2, height: 10)
                Image(systemName: event.kind.symbol)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(event.kind == .award ? CM.ink : CM.paperCream)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(event.kind == .award ? CM.projectorYellow : CM.raisedSurface))
                    .overlay(Circle().strokeBorder(isFuture ? CM.electricBlue : Color.clear, style: StrokeStyle(lineWidth: 1.5, dash: [3])))
                Rectangle().fill(isLast ? Color.clear : CM.secondaryText.opacity(0.35)).frame(width: 2).frame(maxHeight: .infinity)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(CineFormat.shortDate(event.date) + (isFuture ? " · próximo" : ""))
                    .font(CMFont.mono(11, weight: .semibold))
                    .foregroundStyle(isFuture ? CM.electricBlue : CM.secondaryText)
                Text(event.label).font(.callout.weight(.semibold)).foregroundStyle(CM.paperCream)
                if let place = event.place {
                    Text(place).font(.footnote).foregroundStyle(CM.secondaryText)
                }
                if let url = event.provenance.sourceUrl {
                    Link(destination: url) {
                        Text("Fuente: \(url.host() ?? event.provenance.source)")
                            .font(CMFont.mono(10))
                            .foregroundStyle(CM.electricBlue)
                    }
                    .frame(minHeight: 32)
                } else {
                    Text("Fuente: \(event.provenance.source)").font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 16)
        }
        .accessibilityElement(children: .combine)
    }
}
