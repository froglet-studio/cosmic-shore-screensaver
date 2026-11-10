// The settings and the Options… sheet: the same three choices as the Windows dialog (frame rate, every
// screen or the main one only, wide or close-up camera). Kept in ScreenSaverDefaults for this module; a
// missing or unknown value means the default.
import ScreenSaver

struct Settings {
  var fps = 30                 // 30 or 60
  var allScreens = true        // false: the main screen only, the others black
  var view = "lavalamp"        // "lavalamp" (the Home screen's wide orbit) or "vessel" (close-up)

  static let module = "games.froglet.cosmicshore.saver"

  private static var defaults: ScreenSaverDefaults? { ScreenSaverDefaults(forModuleWithName: module) }

  static func load() -> Settings {
    var s = Settings()
    guard let d = defaults else { return s }
    if d.integer(forKey: "fps") == 60 { s.fps = 60 }
    if d.string(forKey: "screens") == "main" { s.allScreens = false }
    if d.string(forKey: "view") == "vessel" { s.view = "vessel" }
    return s
  }

  func save() {
    guard let d = Settings.defaults else { return }
    d.set(fps, forKey: "fps")
    d.set(allScreens ? "all" : "main", forKey: "screens")
    d.set(view, forKey: "view")
    d.synchronize()
    HostLog.write("settings saved: fps=\(fps) screens=\(allScreens ? "all" : "main") view=\(view)")
  }
}

/// Built in code, so the bundle carries no nib. System Settings shows it as a sheet.
final class ConfigureSheetController: NSObject {
  let window: NSWindow
  private let fps = NSPopUpButton()
  private let screens = NSPopUpButton()
  private let view = NSPopUpButton()

  override init() {
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 210),
                      styleMask: [.titled], backing: .buffered, defer: true)
    super.init()
    window.title = "Cosmic Shore Screensaver"

    fps.addItems(withTitles: ["30 frames per second (lighter)", "60 frames per second (smoother)"])
    screens.addItems(withTitles: ["Every screen", "The main screen only"])
    view.addItems(withTitles: ["The Home screen's wide view", "Close-up on the vessel"])

    let current = Settings.load()
    fps.selectItem(at: current.fps == 60 ? 1 : 0)
    screens.selectItem(at: current.allScreens ? 0 : 1)
    view.selectItem(at: current.view == "vessel" ? 1 : 0)

    let grid = NSGridView(views: [
      [NSTextField(labelWithString: "Frame rate:"), fps],
      [NSTextField(labelWithString: "Show on:"), screens],
      [NSTextField(labelWithString: "Camera:"), view],
    ])
    grid.column(at: 0).xPlacement = .trailing
    grid.rowSpacing = 10
    grid.columnSpacing = 8

    let note = NSTextField(wrappingLabelWithString: "Runs offline and sends nothing anywhere.")
    note.textColor = .secondaryLabelColor
    note.font = .systemFont(ofSize: NSFont.smallSystemFontSize)

    let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelPressed))
    cancel.keyEquivalent = "\u{1b}"
    let ok = NSButton(title: "OK", target: self, action: #selector(okPressed))
    ok.keyEquivalent = "\r"
    let buttons = NSStackView(views: [NSView(), cancel, ok])
    buttons.orientation = .horizontal

    let stack = NSStackView(views: [grid, note, buttons])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 14
    stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
    stack.translatesAutoresizingMaskIntoConstraints = false
    buttons.translatesAutoresizingMaskIntoConstraints = false

    let content = NSView()
    content.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      stack.topAnchor.constraint(equalTo: content.topAnchor),
      stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
      buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -40),
    ])
    window.contentView = content
  }

  @objc private func okPressed() {
    var s = Settings()
    s.fps = fps.indexOfSelectedItem == 1 ? 60 : 30
    s.allScreens = screens.indexOfSelectedItem != 1
    s.view = view.indexOfSelectedItem == 1 ? "vessel" : "lavalamp"
    s.save()
    close()
  }

  @objc private func cancelPressed() { close() }

  private func close() {
    if let parent = window.sheetParent { parent.endSheet(window) } else { window.close() }
  }
}
