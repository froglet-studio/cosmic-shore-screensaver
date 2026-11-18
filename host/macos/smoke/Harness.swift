// The macOS smoke test's stand-in for legacyScreenSaver: it loads CosmicShore.saver the way the system
// does (NSBundle, principal class, init(frame:isPreview:)), puts the view in a window and runs it.
//   harness run <CosmicShore.saver> s|p <snapshot.png>   full screen (s) or a 320x200 preview (p);
//                                                       once the page says "ready" (read from the log
//                                                       COSMICSHORE_SAVER_LOG) it waits 4 s, saves a
//                                                       snapshot of the web view, prints "lit=<0..1>"
//                                                       and keeps running
//   harness willstop                                    posts com.apple.screensaver.willstop
//   harness sheet <CosmicShore.saver>                   builds the Options sheet; prints its size
// Smoke test only: never shipped.
import AppKit
import ScreenSaver
import WebKit

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("harness: \(message)\n".utf8))
  exit(3)
}

func loadView(_ path: String, frame: NSRect, preview: Bool) -> ScreenSaverView {
  guard let bundle = Bundle(path: path) else { fail("no bundle at \(path)") }
  guard bundle.load() else { fail("bundle did not load") }
  guard let cls = bundle.principalClass as? ScreenSaverView.Type else { fail("principal class is not a ScreenSaverView") }
  guard let view = cls.init(frame: frame, isPreview: preview) else { fail("init(frame:isPreview:) returned nil") }
  return view
}

/// Share of pixels brighter than a dark floor: a black page reads near 0, the scene clearly above.
func litFraction(_ image: NSImage) -> Double {
  guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return 0 }
  var lit = 0, total = 0
  let step = max(1, min(rep.pixelsWide, rep.pixelsHigh) / 200)
  for y in stride(from: 0, to: rep.pixelsHigh, by: step) {
    for x in stride(from: 0, to: rep.pixelsWide, by: step) {
      guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
      total += 1
      if c.redComponent + c.greenComponent + c.blueComponent > 0.12 { lit += 1 }
    }
  }
  return total == 0 ? 0 : Double(lit) / Double(total)
}

func firstWebView(in view: NSView) -> WKWebView? {
  if let w = view as? WKWebView { return w }
  for sub in view.subviews { if let w = firstWebView(in: sub) { return w } }
  return nil
}

let args = CommandLine.arguments
_ = NSApplication.shared
guard args.count >= 2 else { fail("usage: harness run|willstop|sheet ...") }

switch args[1] {
case "willstop":
  DistributedNotificationCenter.default().postNotificationName(
    Notification.Name("com.apple.screensaver.willstop"), object: nil, userInfo: nil, deliverImmediately: true)
  print("posted com.apple.screensaver.willstop")

case "sheet":
  guard args.count >= 3 else { fail("usage: harness sheet <saver>") }
  let view = loadView(args[2], frame: NSRect(x: 0, y: 0, width: 800, height: 500), preview: false)
  guard view.hasConfigureSheet, let sheet = view.configureSheet else { fail("no configure sheet") }
  sheet.layoutIfNeeded()
  print("sheet: \(Int(sheet.frame.width))x\(Int(sheet.frame.height)) \"\(sheet.title)\"")

case "run":
  guard args.count >= 5 else { fail("usage: harness run <saver> s|p <snapshot.png>") }
  let preview = args[3] == "p"
  let snapshotPath = args[4]
  let app = NSApplication.shared
  app.setActivationPolicy(.regular)
  guard let screen = NSScreen.main else { fail("no screen") }
  let rect = preview ? NSRect(x: 200, y: 200, width: 320, height: 200) : screen.frame
  let window = NSWindow(contentRect: rect, styleMask: preview ? [.titled] : [.borderless],
                        backing: .buffered, defer: false)
  if !preview { window.level = .screenSaver }
  let view = loadView(args[2], frame: NSRect(origin: .zero, size: rect.size), preview: preview)
  window.contentView = view
  window.makeKeyAndOrderFront(nil)
  view.startAnimation()
  app.activate(ignoringOtherApps: true)

  let log = ProcessInfo.processInfo.environment["COSMICSHORE_SAVER_LOG"] ?? ""
  var readyAt: Date?
  var shot = false
  Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { timer in
    if readyAt == nil, let text = try? String(contentsOfFile: log, encoding: .utf8), text.contains("scene ready") {
      readyAt = Date()
    }
    guard let ready = readyAt, !shot, Date().timeIntervalSince(ready) > 4 else { return }
    shot = true
    timer.invalidate()
    guard let web = firstWebView(in: view) else { fail("no web view inside the screensaver view") }
    web.takeSnapshot(with: nil) { image, error in
      guard let image else { print("snapshot failed: \(error?.localizedDescription ?? "?")"); return }
      if let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
         let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: snapshotPath))
      }
      print(String(format: "lit=%.3f", litFraction(image)))
      fflush(stdout)
    }
  }
  app.run()

default:
  fail("unknown command \(args[1])")
}
