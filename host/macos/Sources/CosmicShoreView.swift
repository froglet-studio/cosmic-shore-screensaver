// The macOS screensaver: a ScreenSaverView holding a WKWebView that shows the same page the Windows .scr
// embeds (npm run build:host -> dist-single/screensaver-host.html, copied into the bundle's Resources).
// Milestone M7 of docs/PHASE1_ASSESSMENT_AND_PLAN.md (§8.2). See host/macos/README.md.
//
// legacyScreenSaver (the process that hosts every third-party .saver since Catalina) has known faults on
// Sonoma, Sequoia and Tahoe, and this file works around each one:
// - stopAnimation is rarely called and old views are never destroyed, so they pile up: we exit the
//   process on the com.apple.screensaver.willstop distributed notification (the community standard,
//   AerialScreensaver/ScreenSaverMinimal).
// - isPreview and the frame can be misreported on Tahoe: a frame narrower than 400 pt is the preview too.
// - animateOneFrame is not a reliable clock: the page drives itself with requestAnimationFrame and its
//   own frame-rate cap, so animateOneFrame does nothing.
// - Every screen gets its own view and its own web page; nothing is shared between them.
// The page is served from a private scheme (cosmicshore://) by this file, from the bundle, and nothing
// else is served: the page's CSP allows only itself, and any other request or navigation is refused.
import ScreenSaver
import WebKit
import os

@objc(CosmicShoreView)
public final class CosmicShoreView: ScreenSaverView {
  private var webView: WKWebView?
  private let previewMode: Bool
  private let id = UInt32.random(in: 1...UInt32.max)
  private var configureController: ConfigureSheetController?

  public override init?(frame: NSRect, isPreview: Bool) {
    previewMode = isPreview || frame.width < 400
    super.init(frame: frame, isPreview: isPreview)
    setUpView()
  }

  public required init?(coder: NSCoder) {
    previewMode = false
    super.init(coder: coder)
    setUpView()
  }

  private func setUpView() {
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    animationTimeInterval = 1.0  // unused: the page keeps its own clock
    HostLog.write("view \(id): created, preview=\(previewMode), frame=\(Int(frame.width))x\(Int(frame.height))")

    DistributedNotificationCenter.default().addObserver(
      self, selector: #selector(screensaverWillStop(_:)),
      name: Notification.Name("com.apple.screensaver.willstop"), object: nil)
    let workspace = NSWorkspace.shared.notificationCenter
    workspace.addObserver(self, selector: #selector(screensDidSleep(_:)),
                          name: NSWorkspace.screensDidSleepNotification, object: nil)
    workspace.addObserver(self, selector: #selector(screensDidWake(_:)),
                          name: NSWorkspace.screensDidWakeNotification, object: nil)
  }

  deinit {
    DistributedNotificationCenter.default().removeObserver(self)
    NSWorkspace.shared.notificationCenter.removeObserver(self)
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────
  public override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil { startPageIfNeeded() }
  }

  public override func startAnimation() {
    super.startAnimation()
    startPageIfNeeded()
    webView?.isHidden = false
  }

  public override func stopAnimation() {
    super.stopAnimation()
    webView?.isHidden = true  // a hidden web view stops drawing
  }

  public override func animateOneFrame() {}

  public override func draw(_ rect: NSRect) {
    NSColor.black.setFill()
    rect.fill()
  }

  @objc private func screensaverWillStop(_ note: Notification) {
    // The thumbnail in System Settings lives in its own process and hears this notification too
    // whenever the real screensaver stops, so only the full-screen process leaves.
    guard !previewMode else { return }
    HostLog.write("view \(id): willstop, exit 0")
    exit(0)
  }

  @objc private func screensDidSleep(_ note: Notification) {
    HostLog.write("view \(id): displays asleep, page hidden")
    webView?.isHidden = true
  }

  @objc private func screensDidWake(_ note: Notification) {
    HostLog.write("view \(id): displays awake")
    webView?.isHidden = false
  }

  // ── the page ──────────────────────────────────────────────────────────────────────────────────
  private func startPageIfNeeded() {
    guard webView == nil, let window else { return }
    let settings = Settings.load()
    let isMainScreen = window.screen == nil || window.screen == NSScreen.screens.first
    if !previewMode && !settings.allScreens && !isMainScreen {
      HostLog.write("view \(id): not the main screen, stays black (setting: main screen only)")
      return
    }
    guard let page = Page.html else {
      HostLog.write("view \(id): screensaver-host.html is missing from the bundle")
      return
    }

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()  // nothing is stored on disk
    config.setURLSchemeHandler(PageServer(page: page), forURLScheme: Page.scheme)
    config.userContentController.add(WeakMessageHandler(self), name: "host")
    config.mediaTypesRequiringUserActionForPlayback = .all

    let view = PassiveWebView(frame: bounds, configuration: config)
    view.autoresizingMask = [.width, .height]
    view.setValue(false, forKey: "drawsBackground")  // black, not a white flash, until the page draws
    view.underPageBackgroundColor = .black
    view.navigationDelegate = self
    addSubview(view)
    webView = view

    let url = Page.url(mode: previewMode ? "p" : "s",
                       fps: previewMode ? 15 : settings.fps,
                       view: settings.view,
                       scale: previewMode ? "0.5" : "1",
                       seed: id)
    HostLog.write("view \(id): loading \(url.absoluteString)")
    view.load(URLRequest(url: url))
  }

  fileprivate func received(_ message: String) {
    if message == "ready" {
      HostLog.write("view \(id): scene ready")
    } else if message.hasPrefix("error") {
      HostLog.write("view \(id): page \(message)")
    }
    // "exit" is ignored: on the Mac the system ends the screensaver on input.
  }

  // ── settings ──────────────────────────────────────────────────────────────────────────────────
  public override var hasConfigureSheet: Bool { true }

  public override var configureSheet: NSWindow? {
    let controller = ConfigureSheetController()
    configureController = controller
    return controller.window
  }
}

// ── navigation: our page only; a crashed page reloads ───────────────────────────────────────────
extension CosmicShoreView: WKNavigationDelegate {
  public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                      decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let scheme = action.request.url?.scheme ?? ""
    decisionHandler(scheme == Page.scheme || scheme == "about" || scheme == "data" || scheme == "blob"
                    ? .allow : .cancel)
  }

  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    HostLog.write("view \(id): page process ended, reloading")
    webView.reload()
  }

  public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    HostLog.write("view \(id): navigation failed: \(error.localizedDescription)")
  }

  public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                      withError error: Error) {
    HostLog.write("view \(id): load failed: \(error.localizedDescription)")
  }
}

/// The web view never takes the mouse or the keyboard, so every event reaches the ScreenSaverView and
/// the system, which ends the screensaver on input as it does for any other one.
final class PassiveWebView: WKWebView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override var acceptsFirstResponder: Bool { false }
}

/// WKUserContentController keeps its handlers alive; this breaks the cycle with the view.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  private weak var target: CosmicShoreView?
  init(_ target: CosmicShoreView) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    if let text = message.body as? String { target?.received(text) }
  }
}

// ── the page and its server ─────────────────────────────────────────────────────────────────────
enum Page {
  static let scheme = "cosmicshore"
  static let path = "/index.html"

  /// Read once per process; every screen's view shares it.
  static let html: Data? = {
    let bundle = Bundle(for: CosmicShoreView.self)  // never Bundle.main: that is legacyScreenSaver
    guard let url = bundle.url(forResource: "screensaver-host", withExtension: "html") else { return nil }
    return try? Data(contentsOf: url)
  }()

  static func url(mode: String, fps: Int, view: String, scale: String, seed: UInt32) -> URL {
    var c = URLComponents()
    c.scheme = scheme
    c.host = "screensaver"
    c.path = path
    c.queryItems = [
      URLQueryItem(name: "host", value: "saver"),
      URLQueryItem(name: "mode", value: mode),
      URLQueryItem(name: "fps", value: String(fps)),
      URLQueryItem(name: "view", value: view),
      URLQueryItem(name: "scale", value: scale),
      URLQueryItem(name: "seed", value: String(seed)),
    ]
    return c.url!
  }
}

final class PageServer: NSObject, WKURLSchemeHandler {
  private let page: Data
  init(page: Data) { self.page = page }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, url.path == Page.path else {
      HostLog.write("refused \(task.request.url?.absoluteString ?? "?")")
      task.didFailWithError(URLError(.resourceUnavailable))
      return
    }
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(page.count),
      "Cache-Control": "no-store",
    ])!
    task.didReceive(response)
    task.didReceive(page)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// ── the log: unified logging, plus a file when COSMICSHORE_SAVER_LOG is set (the smoke test) ────
enum HostLog {
  private static let logger = Logger(subsystem: "games.froglet.cosmicshore.saver", category: "host")
  private static let queue = DispatchQueue(label: "games.froglet.cosmicshore.saver.log")
  private static let file: FileHandle? = {
    guard let path = ProcessInfo.processInfo.environment["COSMICSHORE_SAVER_LOG"] else { return nil }
    FileManager.default.createFile(atPath: path, contents: nil)
    return FileHandle(forWritingAtPath: path)
  }()

  static func write(_ text: String) {
    logger.log("\(text, privacy: .public)")
    guard let file else { return }
    let line = "\(Date().timeIntervalSince1970) \(text)\n"
    queue.sync {
      file.seekToEndOfFile()
      file.write(Data(line.utf8))
    }
  }
}
