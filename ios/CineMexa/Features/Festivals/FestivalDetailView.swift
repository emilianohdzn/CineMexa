import SwiftUI
import SwiftData
import EventKit
import EventKitUI
import UserNotifications

struct FestivalDetailView: View {
    let catalog: Catalog
    let festivalID: String
    @State private var calendarEdition: FestivalEdition?

    var body: some View {
        if let festival = catalog.festival(festivalID) {
            content(festival)
        } else {
            EmptyStateView(title: "Festival no encontrado", message: "Puede que esta edición ya no esté publicada.")
        }
    }

    private func content(_ festival: Festival) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CM.Space.xl) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(festival.city.uppercased() + " · " + CountryName.name(festival.country).uppercased())
                        .font(CMFont.mono(11, weight: .semibold))
                        .foregroundStyle(CM.projectorYellow)
                    Text(festival.name)
                        .font(CMFont.display(32))
                        .foregroundStyle(CM.paperCream)
                        .fixedSize(horizontal: false, vertical: true)
                    if !festival.focus.isEmpty {
                        Text(festival.focus.map(focusLabel).joined(separator: " · "))
                            .font(CMFont.mono(11)).foregroundStyle(CM.electricBlue)
                    }
                    FestivalFavoriteButton(festival: festival)
                }
                .padding(.horizontal, CM.Space.gutter)

                ForEach(festival.editions) { edition in
                    EditionCard(festival: festival, edition: edition) { calendarEdition = edition }
                        .padding(.horizontal, CM.Space.gutter)
                }

                let films = catalog.mexicanFilms(in: festival)
                VStack(alignment: .leading, spacing: CM.Space.m) {
                    SectionHeader(title: "Películas mexicanas", kicker: films.isEmpty ? nil : "\(films.count) títulos")
                    if films.isEmpty {
                        Text("Aún no hay películas mexicanas confirmadas en esta edición.")
                            .font(.callout).foregroundStyle(CM.secondaryText).padding(.horizontal, CM.Space.gutter)
                    }
                    ForEach(films) { group in
                        NavigationLink(value: Route.film(id: group.film.id, transitionID: nil)) {
                            HStack(alignment: .top, spacing: 12) {
                                PosterView(film: group.film, cornerRadius: 6).frame(width: 64)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(group.film.title).font(.headline).foregroundStyle(CM.paperCream)
                                    ForEach(group.events) { ev in
                                        Label([ev.kind.label, ev.awardName, ev.section].compactMap { $0 }.joined(separator: " · "), systemImage: ev.kind.symbol)
                                            .font(.footnote).foregroundStyle(ev.kind == .award ? CM.projectorYellow : CM.secondaryText)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: CM.Radius.card).fill(CM.deepSurface))
                        }
                        .buttonStyle(PressableStyle())
                        .padding(.horizontal, CM.Space.gutter)
                    }
                }

                if let site = festival.websiteUrl {
                    Link(destination: site) {
                        Label("Sitio oficial", systemImage: "safari").font(.callout.weight(.semibold)).frame(minHeight: CM.minTap)
                    }
                    .padding(.horizontal, CM.Space.gutter)
                }
                VerificationTag(provenance: festival.provenance).padding(.horizontal, CM.Space.gutter)
            }
            .padding(.vertical, CM.Space.m)
        }
        .navigationTitle(festival.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $calendarEdition) { edition in
            AddToCalendarSheet(festival: festival, edition: edition).ignoresSafeArea()
        }
    }

    private func focusLabel(_ f: String) -> String {
        switch f {
        case "shorts": "Cortometraje"
        case "documentary": "Documental"
        case "animation": "Animación"
        default: f
        }
    }
}

private struct EditionCard: View {
    let festival: Festival
    let edition: FestivalEdition
    let addToCalendar: () -> Void

    var body: some View {
        let status = DateLogic.status(of: edition, now: Date())
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TagLabel(text: status.label, symbol: status.symbol, tint: status == .active ? CM.liveRed : CM.electricBlue, filled: status == .active)
                Spacer()
                Text(edition.label).font(CMFont.mono(11)).foregroundStyle(CM.secondaryText)
            }
            Text(CineFormat.dayRange(edition.startsOn, edition.endsOn))
                .font(CMFont.display(22, relativeTo: .title3))
                .foregroundStyle(CM.paperCream)
            Text("Horario local del festival: \(edition.timezone)").font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
            DashedDivider()
            HStack(spacing: 10) {
                if edition.startsOn != nil, status != .past, status != .cancelled {
                    Button(action: addToCalendar) {
                        Label("Agregar al calendario", systemImage: "calendar.badge.plus")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(CM.ink)
                            .padding(.horizontal, 12)
                            .frame(minHeight: CM.minTap)
                            .background(Capsule().fill(CM.projectorYellow))
                    }
                    .buttonStyle(.plain)
                }
                if let program = edition.programUrl {
                    Link(destination: program) {
                        Label("Programa", systemImage: "arrow.up.right").font(.footnote.weight(.semibold)).frame(minHeight: CM.minTap)
                    }
                }
            }
            if edition.callDeadline != nil {
                CallCard(ref: Catalog.EditionRef(festival: festival, edition: edition))
            }
        }
        .padding(16)
        .ticketBackground()
    }
}

private struct FestivalFavoriteButton: View {
    let festival: Festival
    @Environment(\.modelContext) private var context
    @Query private var saved: [FavoriteItem]

    init(festival: Festival) {
        self.festival = festival
        let key = FavoriteItem.key(.festival, festival.id)
        _saved = Query(filter: #Predicate<FavoriteItem> { $0.key == key })
    }

    var body: some View {
        let isSaved = !saved.isEmpty
        Button {
            Favorites.toggle(.festival, festival.id, title: festival.displayName, in: context)
        } label: {
            Label(isSaved ? "En favoritos" : "Guardar festival", systemImage: isSaved ? "heart.fill" : "heart")
                .font(.footnote.weight(.bold))
                .foregroundStyle(isSaved ? CM.ink : CM.paperCream)
                .padding(.horizontal, 14)
                .frame(minHeight: CM.minTap)
                .background(Capsule().fill(isSaved ? CM.projectorYellow : CM.deepSurface))
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: isSaved)
        .symbolEffect(.bounce, value: isSaved)
    }
}

/// Recordatorio local de fecha límite: pide permiso de notificaciones sólo al tocarlo.
struct DeadlineReminderButton: View {
    let ref: Catalog.EditionRef
    @State private var scheduled = false
    @State private var message: String?

    var body: some View {
        Button {
            Task { await schedule() }
        } label: {
            Label(scheduled ? "Recordatorio listo" : "Recordarme", systemImage: scheduled ? "bell.badge.fill" : "bell")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(CM.ink)
                .frame(minHeight: CM.minTap)
        }
        .buttonStyle(.plain)
        .disabled(scheduled)
        .sensoryFeedback(.success, trigger: scheduled)
        .alert("Recordatorio", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("Entendido", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
        .task { await refreshState() }
    }

    private var identifier: String { "deadline-\(ref.edition.id)" }

    private func refreshState() async {
        let pending = await UNUserNotificationCenter.current().pendingNotificationRequests()
        scheduled = pending.contains { $0.identifier == identifier }
    }

    private func schedule() async {
        guard let deadline = ref.edition.callDeadline else { return }
        let center = UNUserNotificationCenter.current()
        do {
            guard try await center.requestAuthorization(options: [.alert, .sound]) else {
                message = "Activa las notificaciones de Cine Mexa en Ajustes para recibir recordatorios."
                return
            }
            // Tres días antes, o una hora antes si ya falta menos.
            var fireDate = deadline.addingTimeInterval(-3 * 86_400)
            if fireDate <= Date() { fireDate = deadline.addingTimeInterval(-3_600) }
            guard fireDate > Date() else {
                message = "La fecha límite está demasiado cerca para programar un recordatorio."
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "Cierra la convocatoria de \(ref.festival.displayName)"
            content.body = "Fecha límite: \(CineFormat.dateTime(deadline))."
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fireDate)
            let request = UNNotificationRequest(identifier: identifier, content: content,
                                                trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
            try await center.add(request)
            scheduled = true
        } catch {
            message = "No se pudo programar el recordatorio. \(error.localizedDescription)"
        }
    }
}

/// Hoja nativa de evento: el usuario confirma explícitamente antes de guardarlo.
/// EKEventEditViewController no requiere permiso completo de calendario (iOS 17+).
struct AddToCalendarSheet: UIViewControllerRepresentable {
    let festival: Festival
    let edition: FestivalEdition
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = festival.name
        event.location = "\(festival.city), \(CountryName.name(festival.country))"
        event.url = edition.programUrl ?? festival.websiteUrl
        event.isAllDay = true
        let tz = TimeZone(identifier: edition.timezone) ?? .current
        event.timeZone = tz
        if let s = edition.startsOn.flatMap({ DateLogic.parseDay($0, timeZone: tz) }),
           let e = edition.endsOn.flatMap({ DateLogic.parseDay($0, timeZone: tz) }) {
            event.startDate = s
            event.endDate = e
        }
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let dismiss: DismissAction
        init(dismiss: DismissAction) { self.dismiss = dismiss }
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            dismiss()
        }
    }
}
