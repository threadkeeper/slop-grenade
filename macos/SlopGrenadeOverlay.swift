import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let apiBase = "http://127.0.0.1:8090"
    private var statusItem: NSStatusItem?
    private var overlayWindow: NSWindow?
    private var webView: WKWebView?
    private var daemonProcess: Process?
    private var readinessTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        ensureRustDaemonRunning()
        setupMenuBar()
        setupOverlayWindow()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleScreenChange),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        waitForDaemonAndLoadOverlay()
    }

    func applicationWillTerminate(_ notification: Notification) {
        readinessTimer?.invalidate()
        if let proc = daemonProcess, proc.isRunning {
            proc.terminate()
        }
    }

    private func setupMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.title = "💥"
            button.toolTip = "Slop Grenade — M365 AI Slop Detector & Screen Overlay"
        }

        let menu = NSMenu()
        menu.addItem(withTitle: "Open Habit Dashboard (http://127.0.0.1:8090/)", action: #selector(openDashboard), keyEquivalent: "d")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Lob a test grenade at the left edge", action: #selector(lobLeftGrenade), keyEquivalent: "")
        menu.addItem(withTitle: "Lob a test grenade at the right edge", action: #selector(lobRightGrenade), keyEquivalent: "")
        menu.addItem(withTitle: "Toss some fruit", action: #selector(tossFruit), keyEquivalent: "")
        menu.addItem(withTitle: "Full test fire", action: #selector(fullTestFire), keyEquivalent: "t")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Squeegee left edge", action: #selector(squeegeeLeft), keyEquivalent: "")
        menu.addItem(withTitle: "Squeegee right edge", action: #selector(squeegeeRight), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit Slop Grenade", action: #selector(quitApp), keyEquivalent: "q")

        for menuItem in menu.items {
            menuItem.target = self
        }
        item.menu = menu
        self.statusItem = item
    }

    private func setupOverlayWindow() {
        let frame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]

        let config = WKWebViewConfiguration()
        let view = WKWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: config)
        view.autoresizingMask = [.width, .height]
        view.setValue(false, forKey: "drawsBackground")

        window.contentView = view
        window.orderFrontRegardless()

        self.overlayWindow = window
        self.webView = view
    }

    @objc private func handleScreenChange() {
        guard let screen = NSScreen.main, let window = overlayWindow else { return }
        window.setFrame(screen.frame, display: true)
    }

    private func waitForDaemonAndLoadOverlay() {
        let check: () -> Bool = { [weak self] in
            guard let self = self else { return true }
            if self.isDaemonHealthy() {
                if let url = URL(string: "\(self.apiBase)/?mode=overlay") {
                    self.webView?.load(URLRequest(url: url))
                }
                if CommandLine.arguments.contains("--showcase") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                        self.fullTestFire()
                    }
                }
                return true
            }
            return false
        }

        if check() { return }
        readinessTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] timer in
            if check() {
                timer.invalidate()
                self?.readinessTimer = nil
            }
        }
    }

    private func ensureRustDaemonRunning() {
        if isDaemonHealthy() { return }

        let fm = FileManager.default
        let execURL = Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])
        let macOSDir = execURL.deletingLastPathComponent()
        let resourcesDir = Bundle.main.resourceURL ?? macOSDir.deletingLastPathComponent().appendingPathComponent("Resources")

        let daemonCandidates = [
            macOSDir.appendingPathComponent("slop-grenade").path,
            macOSDir.deletingLastPathComponent().appendingPathComponent("slop-grenade").path,
            macOSDir.appendingPathComponent("../rust/target/release/slop-grenade").standardized.path
        ]

        guard let daemonPath = daemonCandidates.first(where: { fm.isExecutableFile(atPath: $0) }) else {
            return
        }

        let webCandidates = [
            resourcesDir.appendingPathComponent("web/build").path,
            macOSDir.appendingPathComponent("web/build").path,
            macOSDir.appendingPathComponent("../web/build").standardized.path
        ]

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: daemonPath)
        proc.currentDirectoryURL = URL(fileURLWithPath: daemonPath).deletingLastPathComponent()

        var env = ProcessInfo.processInfo.environment
        let home = fm.homeDirectoryForCurrentUser.path
        let extraPaths = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "\(home)/.local/bin",
            "\(home)/.npm-global/bin"
        ]
        let existingPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = (extraPaths + [existingPath]).joined(separator: ":")

        if let webDir = webCandidates.first(where: { fm.fileExists(atPath: $0) }) {
            env["WEB_ASSET_DIR"] = webDir
        }
        proc.environment = env
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice

        do {
            try proc.run()
            self.daemonProcess = proc
        } catch {
            // Daemon could not be started automatically
        }
    }

    private func isDaemonHealthy() -> Bool {
        guard let url = URL(string: "\(apiBase)/api/v1/health") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 0.8
        let sem = DispatchSemaphore(value: 0)
        var healthy = false
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            if let http = resp as? HTTPURLResponse, http.statusCode == 200 {
                healthy = true
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 1.0)
        return healthy
    }

    @objc private func openDashboard() {
        if let url = URL(string: "\(apiBase)/") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func lobLeftGrenade() {
        evalOverlay("window.__slopGrenadeStage?.world.trigger('slop_grenade', 'left');")
    }

    @objc private func lobRightGrenade() {
        evalOverlay("window.__slopGrenadeStage?.world.trigger('slop_grenade', 'right');")
    }

    @objc private func tossFruit() {
        evalOverlay("""
        (function() {
          const w = window.__slopGrenadeStage?.world;
          if (!w) return;
          for (let i = 0; i < 4; i++) {
            setTimeout(() => w.trigger('innocent_fruit', i % 2 === 0 ? 'left' : 'right'), i * 600);
          }
        })();
        """)
    }

    @objc private func fullTestFire() {
        evalOverlay("""
        (function() {
          const w = window.__slopGrenadeStage?.world;
          if (!w) return;
          const seq = [
            [0, 'peaceful_cloud', 'right'],
            [300, 'slop_grenade', 'left'],
            [1200, 'slop_splat', 'right'],
            [2000, 'human_sparkle', 'left'],
            [4200, 'innocent_fruit', 'left'],
            [4800, 'innocent_fruit', 'right'],
            [5600, 'slop_grenade', 'right'],
            [6400, 'innocent_fruit', 'left'],
            [7500, 'peaceful_cloud', 'left'],
            [8000, 'human_sparkle', 'right']
          ];
          for (const [delay, tier, side] of seq) {
            setTimeout(() => w.trigger(tier, side), delay);
          }
        })();
        """)
    }

    @objc private func squeegeeLeft() {
        triggerSqueegee(side: "left")
    }

    @objc private func squeegeeRight() {
        triggerSqueegee(side: "right")
    }

    private func triggerSqueegee(side: String) {
        evalOverlay("window.__slopGrenadeStage?.world.squeegee('\(side)');")
        guard let url = URL(string: "\(apiBase)/api/v1/squeegee") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{\"side\":\"\(side)\"}".data(using: .utf8)
        URLSession.shared.dataTask(with: req).resume()
    }

    private func evalOverlay(_ script: String) {
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
