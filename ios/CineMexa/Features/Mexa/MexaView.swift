import SwiftUI

/// "Pregúntale a Mexa": preguntas sobre el catálogo respondidas desde los datos de Cine Mexa, siempre con sus fuentes.
/// Fase A sin modelo de lenguaje: entiende un conjunto cerrado de preguntas y, si no tiene datos, lo dice.
struct MexaView: View {
    let open: (Route) -> Void
    var client = MexaClient(config: LiveConfig.load())

    @State private var question = ""
    @State private var answer: MexaAnswer?
    @State private var error: String?
    @State private var loading = false
    @FocusState private var focused: Bool

    private let examples = ["¿Qué está en tendencia?", "Próximos estrenos", "¿Cuándo es el FICM?", "Premios en San Sebastián", "Películas de 2025"]

    var body: some View {
        List {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    TextField("Pregunta sobre el cine mexicano", text: $question, axis: .vertical)
                        .focused($focused)
                        .submitLabel(.send)
                        .onSubmit { Task { await ask() } }
                        .foregroundStyle(CM.paperCream)
                        .accessibilityIdentifier("mexa-pregunta")
                    Button { Task { await ask() } } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                    .disabled(question.trimmingCharacters(in: .whitespaces).count < 3 || loading)
                    .accessibilityLabel("Preguntar")
                    .frame(minWidth: CM.minTap, minHeight: CM.minTap)
                }
            } footer: {
                Text("Mexa responde sólo con datos del catálogo y muestra de dónde salen. No usa inteligencia artificial generativa.")
            }

            if loading {
                Section { ProgressView("Buscando en el catálogo…").foregroundStyle(CM.secondaryText) }
            } else if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(CM.secondaryText) }
            } else if let answer {
                answerSections(answer)
            } else {
                Section("Prueba con") {
                    ForEach(examples, id: \.self) { e in
                        Button(e) { question = e; Task { await ask() } }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Pregúntale a Mexa")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { focused = answer == nil }
    }

    @ViewBuilder private func answerSections(_ a: MexaAnswer) -> some View {
        Section {
            Text(a.text)
                .foregroundStyle(CM.paperCream)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("mexa-respuesta")
        }
        if let options = a.options, !options.isEmpty {
            Section("¿Cuál de estas?") {
                ForEach(options, id: \.self) { o in
                    Button(o.label) { open(.film(id: o.filmId, transitionID: nil)) }
                }
            }
        }
        let linked = a.items.filter { $0.filmId != nil || $0.festivalId != nil }
        if !linked.isEmpty {
            Section("Abrir") {
                ForEach(linked, id: \.self) { item in
                    Button {
                        if let id = item.filmId { open(.film(id: id, transitionID: nil)) }
                        else if let id = item.festivalId { open(.festival(id: id)) }
                    } label: {
                        Label(item.label, systemImage: item.filmId != nil ? "film" : "mappin.and.ellipse")
                    }
                }
            }
        }
        if !a.citations.isEmpty {
            Section("Fuentes") {
                ForEach(a.citations, id: \.self) { c in
                    VStack(alignment: .leading, spacing: 2) {
                        if let link = c.link {
                            Link(c.label, destination: link)
                        } else {
                            Text(c.label).foregroundStyle(CM.paperCream)
                        }
                        Text([c.source, c.verification].joined(separator: " · "))
                            .font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                    }
                }
            }
        }
    }

    private func ask() async {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 3, !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            answer = try await client.ask(q)
        } catch {
            answer = nil
            self.error = (error as? LocalizedError)?.errorDescription ?? "Mexa no pudo responder. Intenta de nuevo."
        }
    }
}
