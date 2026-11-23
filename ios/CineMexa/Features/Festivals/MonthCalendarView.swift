import SwiftUI

/// Calendario mensual editorial (Paper Cream). Cambia de mes y muestra los festivales de cada día.
struct MonthCalendarView: View {
    let catalog: Catalog
    @State private var month: Date = Calendar.current.startOfMonth(for: Date())
    @State private var selectedDay: String = DateLogic.calendarDay(Date(), timeZone: .current)
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.locale = CineFormat.locale
        c.firstWeekday = 2 // lunes
        return c
    }

    var body: some View {
        VStack(alignment: .leading, spacing: CM.Space.l) {
            VStack(spacing: 12) {
                header
                weekdayRow
                grid
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: CM.Radius.card).fill(CM.paperCream))
            .padding(.horizontal, CM.Space.gutter)

            dayDetail
        }
        .animation(.cm(reduceMotion), value: month)
    }

    private var header: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: CM.minTap, height: CM.minTap) }
                .accessibilityLabel("Mes anterior")
            Spacer()
            Text(CineFormat.sentenceCase(month.formatted(.dateTime.month(.wide).year().locale(CineFormat.locale))))
                .font(CMFont.display(22, relativeTo: .title3))
                .foregroundStyle(CM.ink)
                .contentTransition(.numericText())
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: CM.minTap, height: CM.minTap) }
                .accessibilityLabel("Mes siguiente")
        }
        .foregroundStyle(CM.ink)
        .font(.headline)
    }

    private var weekdayRow: some View {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let ordered = Array(symbols[(calendar.firstWeekday - 1)...] + symbols[..<(calendar.firstWeekday - 1)])
        return HStack {
            ForEach(Array(ordered.enumerated()), id: \.offset) { _, s in
                Text(s.uppercased()).font(CMFont.mono(11, weight: .semibold)).foregroundStyle(CM.creamSecondary).frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    private var grid: some View {
        let days = monthDays()
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
            ForEach(days.indices, id: \.self) { i in
                if let date = days[i] {
                    dayCell(date)
                } else {
                    Color.clear.frame(height: 44)
                }
            }
        }
    }

    private func dayCell(_ date: Date) -> some View {
        let key = DateLogic.calendarDay(date, timeZone: .current)
        let count = catalog.editions(activeOn: key).count
        let isSelected = key == selectedDay
        let isToday = key == DateLogic.calendarDay(Date(), timeZone: .current)
        return Button { selectedDay = key } label: {
            VStack(spacing: 3) {
                Text("\(calendar.component(.day, from: date))")
                    .font(CMFont.mono(14, weight: isToday ? .semibold : .regular))
                    .foregroundStyle(isSelected ? CM.paperCream : CM.ink)
                HStack(spacing: 2) {
                    ForEach(0..<min(count, 3), id: \.self) { _ in
                        Circle().fill(isSelected ? CM.projectorYellow : CM.creamRed).frame(width: 5, height: 5)
                    }
                }
                .frame(height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 8).fill(isSelected ? CM.ink : Color.clear))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(isToday && !isSelected ? CM.ink : Color.clear, lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(date.formatted(.dateTime.day().month(.wide).locale(CineFormat.locale))), \(count == 0 ? "sin festivales" : "\(count) festivales")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var dayDetail: some View {
        let refs = catalog.editions(activeOn: selectedDay)
        let date = DateLogic.parseDay(selectedDay) ?? Date()
        return VStack(alignment: .leading, spacing: CM.Space.m) {
            SectionHeader(title: CineFormat.sentenceCase(CineFormat.longDate(date)), kicker: "Festivales este día")
            if refs.isEmpty {
                Text("No hay festivales con fechas confirmadas este día.")
                    .font(.callout).foregroundStyle(CM.secondaryText).padding(.horizontal, CM.Space.gutter)
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

    private func shift(_ months: Int) {
        if let m = calendar.date(byAdding: .month, value: months, to: month) {
            month = calendar.startOfMonth(for: m)
            selectedDay = DateLogic.calendarDay(month, timeZone: .current)
        }
    }

    /// Celdas del mes con huecos iniciales (nil) para alinear con el primer día de la semana.
    private func monthDays() -> [Date?] {
        guard let range = calendar.range(of: .day, in: .month, for: month) else { return [] }
        let weekday = calendar.component(.weekday, from: month)
        let leading = (weekday - calendar.firstWeekday + 7) % 7
        var cells: [Date?] = Array(repeating: nil, count: leading)
        for d in range {
            cells.append(calendar.date(byAdding: .day, value: d - 1, to: month))
        }
        return cells
    }
}

extension Calendar {
    func startOfMonth(for date: Date) -> Date {
        self.date(from: dateComponents([.year, .month], from: date)) ?? date
    }
}
