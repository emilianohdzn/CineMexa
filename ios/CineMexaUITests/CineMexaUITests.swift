import XCTest

/// Pruebas de interfaz: navegación principal y estados de error. Corren con datos de demostración o con una red que
/// falla a propósito (ver UITestLaunch en la app), así que no dependen del backend ni de la conexión.
final class CineMexaUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ mode: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-uiTesting"]
        app.launchEnvironment["CINEMEXA_UI_MODE"] = mode
        app.launch()
        return app
    }

    func testLasCincoPestanasAbren() {
        let app = launch("demo")
        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 10))
        for name in ["Películas", "Mapa", "Trends", "Festivales", "Radar"] {
            let button = tabs.buttons[name]
            XCTAssertTrue(button.exists, "Falta la pestaña \(name)")
            button.tap()
            XCTAssertTrue(button.isSelected, "La pestaña \(name) no quedó seleccionada")
        }
    }

    func testDePeliculasALaFichaYDeRegreso() {
        let app = launch("demo")
        app.tabBars.buttons["Películas"].tap()
        let card = app.buttons.matching(identifier: "tarjeta-pelicula").firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        card.tap()
        XCTAssertTrue(app.otherElements["ficha-pelicula"].waitForExistence(timeout: 5)
                      || app.scrollViews["ficha-pelicula"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5))
    }

    func testBusquedaGlobalAbre() {
        let app = launch("demo")
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        app.navigationBars.buttons["Buscar"].firstMatch.tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5) || app.textFields.firstMatch.waitForExistence(timeout: 5))
    }

    func testSinConexionMuestraErrorYReintentar() {
        let app = launch("sin-conexion")
        XCTAssertTrue(app.staticTexts["No pudimos cargar Cine Mexa"].waitForExistence(timeout: 10))
        let retry = app.buttons["reintentar"]
        XCTAssertTrue(retry.exists)
        retry.tap()
        XCTAssertTrue(app.staticTexts["No pudimos cargar Cine Mexa"].waitForExistence(timeout: 10),
                      "Sin red, reintentar vuelve al mismo estado de error y nunca muestra datos de demostración")
        XCTAssertFalse(app.buttons.matching(identifier: "tarjeta-pelicula").firstMatch.exists)
    }
}
