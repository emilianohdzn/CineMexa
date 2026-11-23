import SwiftUI

/// Festivales y calendario: activos, próximos, calendario mensual y convocatorias.
struct FestivalsView: View {
    let catalog: Catalog

    enum Mode: String, CaseIterable, Identifiable {
        case agenda, calendar, calls
        var id: String { rawValue }
        var label: String {
            switch self {
            case .agenda: "Agenda"
            case .calendar: "Calendario"
            case .calls: "Convocatorias"
            }
        }
    }

    @State private var mode: Mode = .agenda

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.xl) {
                Picker("Vista", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, CM.Space.gutter)

                if catalog.isDemo {
                    DemoBanner().padding(.horizontal, CM.Space.gutter)
                }

                switch mode {
                case .agenda: agenda
                case .calendar: MonthCalendarView(catalog: catalog)
                case .calls: calls
                }
            }
            .padding(.vertical, CM.Space.m)
        }
        .navigationTitle("Festivales")
    }

    @ViewBuilder private var agenda: some View {
        let active = catalog.editions(status: [.active])
        let upcoming = catalog.editions(status: [.upcoming])
        let past = catalog.editions(status: [.past]).reversed()
        section("En curso", kicker: "Ahora", active, emptyText: "No hay festivales en curso con fechas confirmadas.")
        section("Próximos", kicker: "Lo que viene", upcoming, emptyText: "No hay próximas ediciones confirmadas.")
        section("Recientes", kicker: "Ya pasaron", Array(past.prefix(6)), emptyText: nil)
        Text("Cada edición se verifica de forma individual. No asumimos que un festival repite sus fechas cada año.")
            .font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
            .padding(.horizontal, CM.Space.gutter)
    }

    @ViewBuilder
    private func section(_ title: String, kicker: String, _ refs: [Catalog.EditionRef], emptyText: String?) -> some View {
        if !refs.isEmpty || emptyText != nil {
            VStack(alignment: .leading, spacing: CM.Space.m) {
                SectionHeader(title: title, kicker: kicker)
                if refs.isEmpty, let emptyText {
                    Text(emptyText).font(.callout).foregroundStyle(CM.secondaryText).padding(.horizontal, CM.Space.gutter)
                }
                VStack(spacing: 12) {
                    ForEach(refs) { ref in
                        NavigationLink(value: Route.festival(id: ref.festival.id)) { FestivalTicket(ref: ref) }
                            .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, CM.Space.gutter)
            }
        }
    }

    @ViewBuilder private var calls: some View {
        let open = catalog.openCalls()
        VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: "Convocatorias abiertas", kicker: "Para cineastas")
            if open.isEmpty {
                EmptyStateView(title: "Sin convocatorias abiertas", message: "Cuando un festival publique una convocatoria con fecha límite confirmada aparecerá aquí.", symbol: "envelope.open")
            }
            VStack(spacing: 12) {
                ForEach(open) { ref in CallCard(ref: ref) }
            }
            .padding(.horizontal, CM.Space.gutter)
        }
    }
}

/// Tarjeta-boleto de una edición de festival.
struct FestivalTicket: View {
    let ref: Catalog.EditionRef

    var body: some View {
        let status = DateLogic.status(of: ref.edition, now: Date())
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TagLabel(text: status.label, symbol: status.symbol, tint: status == .active ? CM.liveRed : CM.electricBlue, filled: status == .active)
                Spacer()
                Text(ref.festival.country).font(CMFont.mono(11, weight: .semibold)).foregroundStyle(CM.secondaryText)
            }
            Text(ref.festival.displayName)
                .font(CMFont.display(24, relativeTo: .title2))
                .foregroundStyle(CM.paperCream)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(ref.festival.city).font(.subheadline).foregroundStyle(CM.secondaryText)
            DashedDivider()
            HStack {
                Text(CineFormat.dayRange(ref.edition.startsOn, ref.edition.endsOn))
                    .font(CMFont.mono(12, weight: .semibold))
                    .foregroundStyle(CM.projectorYellow)
                Spacer()
                if ref.edition.callDeadline != nil {
                    Label("Convocatoria", systemImage: "envelope.open").font(CMFont.mono(10)).foregroundStyle(CM.electricBlue)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ticketBackground()
        .accessibilityElement(children: .combine)
    }
}

struct DashedDivider: View {
    var body: some View {
        Line()
            .stroke(CM.secondaryText.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
    private struct Line: Shape {
        func path(in r: CGRect) -> Path { Path { p in p.move(to: CGPoint(x: r.minX, y: r.midY)); p.addLine(to: CGPoint(x: r.maxX, y: r.midY)) } }
    }
}

struct CallCard: View {
    let ref: Catalog.EditionRef

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ref.festival.displayName).font(CMFont.headline(20)).foregroundStyle(CM.ink)
            if let deadline = ref.edition.callDeadline {
                let days = Calendar.current.dateComponents([.day], from: Date(), to: deadline).day ?? 0
                Label("Fecha límite: \(CineFormat.dateTime(deadline))", systemImage: "hourglass")
                    .font(CMFont.mono(12, weight: .semibold)).foregroundStyle(CM.creamRed)
                Text(days <= 0 ? "Cierra hoy" : "Faltan \(days) \(days == 1 ? "día" : "días")")
                    .font(.footnote.weight(.semibold)).foregroundStyle(CM.creamSecondary)
            }
            HStack {
                if let url = ref.edition.callUrl {
                    Link(destination: url) {
                        Label("Convocatoria original", systemImage: "arrow.up.right")
                            .font(.footnote.weight(.bold)).foregroundStyle(CM.paperCream)
                            .padding(.horizontal, 14).frame(minHeight: CM.minTap)
                            .background(Capsule().fill(CM.ink))
                    }
                }
                Spacer()
                DeadlineReminderButton(ref: ref)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ticketBackground(CM.paperCream)
    }
}
