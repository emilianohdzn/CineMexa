import SwiftUI

/// Imagen remota con ImagePipeline: miniatura del tamaño que ocupa en pantalla, caché, reintentos y sin quedarse
/// en "fallo" cuando la celda sólo salió de pantalla. `failure` se muestra únicamente ante un error real (404, datos
/// ilegibles o red caída tras los reintentos).
struct RemoteImage<Failure: View, Loading: View>: View {
    let url: URL
    /// Lado mayor en píxeles que se va a dibujar.
    let maxPixel: CGFloat
    @ViewBuilder var failure: () -> Failure
    @ViewBuilder var loading: () -> Loading

    @State private var image: UIImage?
    @State private var failed = false

    init(url: URL, maxPixel: CGFloat, @ViewBuilder failure: @escaping () -> Failure, @ViewBuilder loading: @escaping () -> Loading) {
        self.url = url
        self.maxPixel = maxPixel
        self.failure = failure
        self.loading = loading
        _image = State(initialValue: ImagePipeline.shared.cachedImage(for: url, maxPixel: maxPixel))
    }

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if failed {
                failure()
            } else {
                loading()
            }
        }
        .task(id: "\(url.absoluteString)#\(Int(maxPixel))") { await load() }
    }

    private func load() async {
        guard maxPixel > 0 else { return }
        if let hit = ImagePipeline.shared.cachedImage(for: url, maxPixel: maxPixel) {
            image = hit
            return
        }
        failed = false
        do {
            let loaded = try await ImagePipeline.shared.image(for: url, maxPixel: maxPixel)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        } catch is CancellationError {
            // La vista desapareció: no es un fallo.
        } catch let error as URLError where error.code == .cancelled {
            // Igual que arriba.
        } catch {
            failed = true
        }
    }
}

/// Elige el tamaño de TMDB que cubre `pixels` de ancho sin pedir de más.
enum ImageSizing {
    static func posterSize(forPixelWidth pixels: CGFloat) -> TMDBImageSize {
        switch pixels {
        case ..<93: .w92
        case ..<186: .w185
        case ..<343: .w342
        case ..<501: .w500
        default: .w780
        }
    }
    static func backdropSize(forPixelWidth pixels: CGFloat) -> TMDBImageSize {
        pixels <= 780 ? .w780 : .w1280
    }
}
