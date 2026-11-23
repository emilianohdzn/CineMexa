import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("live.baseUrl") private var baseUrl = ""
    @AppStorage("live.anonKey") private var anonKey = ""

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                Picker("Datos", selection: $model.mode) {
                    Text("Demostración").tag(DataMode.demo)
                    Text("En vivo").tag(DataMode.live)
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Modo de datos")
            } footer: {
                Text(model.mode == .demo
                     ? "Los datos de demostración son ficticios y siempre se identifican como tales."
                     : model.isLiveConfigured ? "Datos del backend de Cine Mexa. Si una actualización falla, verás el último dato válido con aviso."
                                              : "El modo en vivo necesita la URL del backend y su clave pública.")
            }

            Section {
                TextField("https://tu-proyecto.supabase.co", text: $baseUrl)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Clave pública (anon)", text: $anonKey)
                Button("Recargar catálogo") { Task { await model.load(force: true) } }
            } header: {
                Text("Backend")
            } footer: {
                Text("Usa sólo la clave pública (anon/publishable). La app nunca debe contener claves de servicio ni de proveedores.")
            }

            if let error = model.lastError {
                Section("Último error") {
                    Text(error).font(.footnote).foregroundStyle(CM.liveRed)
                }
            }

            Section {
                Picker("Ciudad", selection: $model.city) {
                    Text("Todas").tag(String?.none)
                    ForEach(model.catalog?.cities ?? [], id: \.self) { Text($0).tag(String?.some($0)) }
                }
            } header: {
                Text("Disponibilidad local")
            } footer: {
                Text("Elige tu ciudad manualmente. Cine Mexa no solicita tu ubicación.")
            }

            Section("Acerca de") {
                LabeledContent("Versión", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                LabeledContent("Contrato de datos", value: "v\(model.catalog?.snapshot.meta.apiVersion ?? "1")")
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Configuración")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Fuentes y créditos: atribuciones obligatorias por proveedor activado.
struct SourcesView: View {
    let catalog: Catalog

    var body: some View {
        List {
            Section {
                Text("Cine Mexa reúne información de fuentes externas. Cada dato conserva su fuente, fecha de consulta y estado de verificación.")
                    .font(.callout).foregroundStyle(CM.paperCream)
            }
            Section("Proveedores") {
                ForEach(catalog.snapshot.meta.sources) { s in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(s.name).font(.headline).foregroundStyle(CM.paperCream)
                            Spacer()
                            Text(statusLabel(s.status)).font(CMFont.mono(10, weight: .semibold)).foregroundStyle(s.status == "ok" ? CM.electricBlue : CM.secondaryText)
                        }
                        if let a = s.attribution { Text(a).font(.footnote).foregroundStyle(CM.secondaryText) }
                        if let at = s.lastSyncAt {
                            Text("Última sincronización: \(CineFormat.dateTime(at))").font(CMFont.mono(10)).foregroundStyle(CM.secondaryText)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            // Atribución fija de TMDB (exigida por sus términos), aunque el catálogo no la traiga.
            Section("The Movie Database (TMDB)") {
                Text("Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.")
                    .font(.footnote).foregroundStyle(CM.paperCream)
                Link("themoviedb.org", destination: URL(string: "https://www.themoviedb.org")!)
                    .font(.footnote)
            }
            Section("Estados de los datos") {
                ForEach([VerificationStatus.verified, .editorial, .automatic, .demo], id: \.self) { v in
                    Label(v.label, systemImage: v.symbol)
                }
                Text("La disponibilidad estimada por fecha de estreno nunca se muestra como una función real. Las puntuaciones y extractos de reseñas sólo aparecen con autorización.")
                    .font(.footnote).foregroundStyle(CM.secondaryText)
            }
            Section("Tipografías") {
                Text("Fredoka — SIL Open Font License 1.1, The Fredoka Project Authors.")
                Text("IBM Plex Mono — SIL Open Font License 1.1, IBM Corp.")
            }
            .font(.footnote)
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Fuentes y créditos")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func statusLabel(_ s: String) -> String {
        switch s {
        case "ok": "ACTIVA"
        case "pending": "PENDIENTE"
        case "failed": "CON FALLAS"
        case "not_configured": "SIN CONFIGURAR"
        default: s.uppercased()
        }
    }
}
