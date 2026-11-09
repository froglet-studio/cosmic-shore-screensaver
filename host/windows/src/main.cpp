// CosmicShore.scr: the Windows screensaver host.
//
// A thin Win32 program around one WebView2 per monitor. The page is the same three.js bundle as the
// landing-page preview, built into one HTML file (npm run build:host) and compiled into this file as a
// resource, so the .scr is a single file that needs no install, no network and no game.
//
// The screensaver contract (docs/PHASE1_ASSESSMENT_AND_PLAN.md §8.1):
//   (no args) or /c[:HWND]  settings dialog (modal to HWND when given)
//   /s                      run full screen on every monitor; any input exits
//   /p HWND  or  /p:HWND    preview inside the Screen Saver Settings thumbnail; exits when HWND goes away
//   /w                      our own: a normal window for testing (input does not exit)
// Windows may send any case and either ':' or a space before the HWND.

#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>

#include <cstdio>
#include <cwchar>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "WebView2.h"
#include "resource.h"

#ifndef SCR_VERSION_W
#define SCR_VERSION_W L"0.0.0"
#endif

namespace {

// ── constants ────────────────────────────────────────────────────────────────────────────────
// The page is served from this made-up origin by our own request handler; nothing leaves the machine.
constexpr wchar_t kOrigin[] = L"https://cosmicshore.example/";
constexpr wchar_t kPage[] = L"https://cosmicshore.example/index.html";
// Only the embedded page may run: inline scripts and styles, and data:/blob: for its own content.
constexpr wchar_t kHeaders[] =
    L"Content-Type: text/html; charset=utf-8\r\n"
    L"Cache-Control: no-store\r\n"
    L"Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    L"img-src data: blob:; connect-src data: blob:; worker-src blob:; base-uri 'none'; form-action 'none'";
constexpr wchar_t kWindowClass[] = L"CosmicShoreScreensaver";
constexpr wchar_t kWebView2Download[] = L"https://go.microsoft.com/fwlink/p/?LinkId=2124703";
constexpr COLORREF kBackground = RGB(2, 1, 8);  // the page's own background, so nothing flashes white
constexpr int kMoveThresholdPx = 8;             // mouse jitter below this does not exit
constexpr DWORD kGraceMs = 750;                 // input in the first moments (the click on "Preview") is ignored
constexpr UINT_PTR kTimerPoll = 1;

enum class Mode { Settings, Saver, Preview, Window };

struct Settings {
  int fps = 30;               // 30 or 60
  bool allScreens = true;     // false: the main screen only, the others black
  std::wstring view = L"lavalamp";  // "lavalamp" (the Home screen's wide orbit) or "vessel" (close-up)
};

struct Screen {
  HWND hwnd = nullptr;
  bool live = false;  // false: a black screen with no web view
  int index = 0;
  ICoreWebView2Controller* controller = nullptr;
  ICoreWebView2* webview = nullptr;
};

// ── state ────────────────────────────────────────────────────────────────────────────────────
Mode g_mode = Mode::Settings;
HWND g_previewParent = nullptr;
Settings g_settings;
std::vector<std::unique_ptr<Screen>> g_screens;
ICoreWebView2Environment* g_env = nullptr;
const BYTE* g_html = nullptr;
DWORD g_htmlSize = 0;
DWORD g_startTick = 0;
POINT g_cursorStart{};
bool g_cursorArmed = false;
bool g_quitting = false;
DWORD g_seed = 0;

// ── logging (only when COSMICSHORE_SCR_LOG names a file; CI uses it) ─────────────────────────
void Log(const wchar_t* fmt, ...) {
  static std::wstring path = [] {
    wchar_t buf[MAX_PATH] = {};
    return GetEnvironmentVariableW(L"COSMICSHORE_SCR_LOG", buf, MAX_PATH) ? std::wstring(buf) : std::wstring();
  }();
  if (path.empty()) return;
  wchar_t line[1024];
  va_list ap;
  va_start(ap, fmt);
  _vsnwprintf_s(line, _countof(line), _TRUNCATE, fmt, ap);
  va_end(ap);
  FILE* f = nullptr;
  if (_wfopen_s(&f, path.c_str(), L"a, ccs=UTF-8") == 0 && f) {
    fwprintf(f, L"[%lu] %ls\n", GetTickCount() - g_startTick, line);
    fclose(f);
  }
}

// ── a minimal COM callback, so no WRL is needed ──────────────────────────────────────────────
template <class I, class... A>
class Callback final : public I {
 public:
  Callback(REFIID iid, std::function<HRESULT(A...)> fn) : iid_(iid), fn_(std::move(fn)) {}
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** out) override {
    if (riid == IID_IUnknown || riid == iid_) {
      *out = static_cast<I*>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&ref_); }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG r = InterlockedDecrement(&ref_);
    if (r == 0) delete this;
    return r;
  }
  HRESULT STDMETHODCALLTYPE Invoke(A... args) override { return fn_(args...); }

 private:
  LONG ref_ = 1;
  IID iid_;
  std::function<HRESULT(A...)> fn_;
};

// ── paths and settings ───────────────────────────────────────────────────────────────────────
std::wstring KnownFolder(REFKNOWNFOLDERID id, const wchar_t* sub) {
  PWSTR base = nullptr;
  std::wstring out;
  if (SUCCEEDED(SHGetKnownFolderPath(id, KF_FLAG_CREATE, nullptr, &base))) out = base;
  CoTaskMemFree(base);
  if (out.empty()) return out;
  out += L"\\Froglet\\CosmicShoreScreensaver";
  if (sub) out += sub;
  SHCreateDirectoryExW(nullptr, out.c_str(), nullptr);
  return out;
}

std::wstring SettingsPath() {
  const std::wstring dir = KnownFolder(FOLDERID_RoamingAppData, nullptr);
  return dir.empty() ? dir : dir + L"\\settings.json";
}

// Reads one value of a flat JSON object; enough for the three keys we write ourselves.
std::string JsonValue(const std::string& s, const char* key) {
  const std::string k = std::string("\"") + key + "\"";
  size_t i = s.find(k);
  if (i == std::string::npos) return {};
  i = s.find(':', i + k.size());
  if (i == std::string::npos) return {};
  ++i;
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) ++i;
  if (i < s.size() && s[i] == '"') {
    const size_t j = s.find('"', i + 1);
    return j == std::string::npos ? std::string() : s.substr(i + 1, j - i - 1);
  }
  size_t j = i;
  while (j < s.size() && s[j] != ',' && s[j] != '}' && s[j] != ' ' && s[j] != '\r' && s[j] != '\n') ++j;
  return s.substr(i, j - i);
}

// A missing or corrupt file gives the defaults; an unknown value gives that key's default.
Settings LoadSettings() {
  Settings st;
  const std::wstring path = SettingsPath();
  FILE* f = nullptr;
  if (path.empty() || _wfopen_s(&f, path.c_str(), L"rb") != 0 || !f) return st;
  std::string s;
  char buf[512];
  size_t n;
  while ((n = fread(buf, 1, sizeof buf, f)) > 0 && s.size() < 8192) s.append(buf, n);
  fclose(f);
  const std::string fps = JsonValue(s, "fps");
  if (fps == "60") st.fps = 60;
  st.allScreens = JsonValue(s, "screens") != "main";
  if (JsonValue(s, "view") == "vessel") st.view = L"vessel";
  return st;
}

bool SaveSettings(const Settings& st) {
  const std::wstring path = SettingsPath();
  FILE* f = nullptr;
  if (path.empty() || _wfopen_s(&f, path.c_str(), L"wb") != 0 || !f) return false;
  fprintf(f, "{\n  \"fps\": %d,\n  \"screens\": \"%s\",\n  \"view\": \"%s\"\n}\n", st.fps,
          st.allScreens ? "all" : "main", st.view == L"vessel" ? "vessel" : "lavalamp");
  return fclose(f) == 0;
}

// ── the settings dialog (/c) ─────────────────────────────────────────────────────────────────
INT_PTR CALLBACK SettingsProc(HWND dlg, UINT msg, WPARAM wp, LPARAM) {
  switch (msg) {
    case WM_INITDIALOG: {
      const Settings st = LoadSettings();
      HWND fps = GetDlgItem(dlg, IDC_FPS);
      SendMessageW(fps, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"30 per second (lighter, recommended)"));
      SendMessageW(fps, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"60 per second (smoother)"));
      SendMessageW(fps, CB_SETCURSEL, st.fps == 60 ? 1 : 0, 0);
      HWND scr = GetDlgItem(dlg, IDC_SCREENS);
      SendMessageW(scr, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"Every screen"));
      SendMessageW(scr, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"Main screen only (others black)"));
      SendMessageW(scr, CB_SETCURSEL, st.allScreens ? 0 : 1, 0);
      HWND view = GetDlgItem(dlg, IDC_VIEW);
      SendMessageW(view, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"Wide (the Home screen)"));
      SendMessageW(view, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"Close-up on the vessel"));
      SendMessageW(view, CB_SETCURSEL, st.view == L"vessel" ? 1 : 0, 0);
      const std::wstring about = std::wstring(L"Version ") + SCR_VERSION_W +
                                 L". Runs offline; nothing is sent anywhere.\nSettings: " + SettingsPath();
      SetDlgItemTextW(dlg, IDC_VERSION, about.c_str());
      return TRUE;
    }
    case WM_COMMAND:
      if (LOWORD(wp) == IDOK) {
        Settings st;
        st.fps = SendDlgItemMessageW(dlg, IDC_FPS, CB_GETCURSEL, 0, 0) == 1 ? 60 : 30;
        st.allScreens = SendDlgItemMessageW(dlg, IDC_SCREENS, CB_GETCURSEL, 0, 0) != 1;
        st.view = SendDlgItemMessageW(dlg, IDC_VIEW, CB_GETCURSEL, 0, 0) == 1 ? L"vessel" : L"lavalamp";
        if (!SaveSettings(st))
          MessageBoxW(dlg, L"The settings could not be saved.", L"Cosmic Shore Screensaver", MB_ICONWARNING);
        EndDialog(dlg, IDOK);
        return TRUE;
      }
      if (LOWORD(wp) == IDCANCEL) {
        EndDialog(dlg, IDCANCEL);
        return TRUE;
      }
      break;
  }
  return FALSE;
}

// ── leaving ──────────────────────────────────────────────────────────────────────────────────
void Quit(const wchar_t* why) {
  if (g_quitting) return;
  g_quitting = true;
  Log(L"quit: %ls", why);
  // Hide first, so the desktop is back at once; closing the web views can take a moment longer.
  for (auto& s : g_screens) ShowWindow(s->hwnd, SW_HIDE);
  for (auto& s : g_screens) {
    if (s->controller) s->controller->Close();
  }
  PostQuitMessage(0);
}

bool InGrace() { return GetTickCount() - g_startTick < kGraceMs; }

void InputExit(const wchar_t* what) {
  if (g_mode != Mode::Saver || InGrace()) return;
  Quit(what);
}

void CheckCursor() {
  if (g_mode != Mode::Saver) return;
  POINT p;
  if (!GetCursorPos(&p)) return;
  if (!g_cursorArmed) {
    if (InGrace()) return;
    g_cursorStart = p;  // the grace period's movement does not count
    g_cursorArmed = true;
    return;
  }
  if (abs(p.x - g_cursorStart.x) > kMoveThresholdPx || abs(p.y - g_cursorStart.y) > kMoveThresholdPx)
    InputExit(L"mouse moved");
}

// Raw input reaches us whatever window (ours or the web view's) has focus: the backstop for exit on input.
void OnRawInput(LPARAM lp) {
  RAWINPUT ri;
  UINT size = sizeof ri;
  if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lp), RID_INPUT, &ri, &size, sizeof(RAWINPUTHEADER)) == UINT(-1))
    return;
  if (ri.header.dwType == RIM_TYPEKEYBOARD) {
    // Key down only: a key let go after the saver started (it was held before) is not new input.
    if (ri.data.keyboard.Message == WM_KEYDOWN || ri.data.keyboard.Message == WM_SYSKEYDOWN) InputExit(L"key");
  } else if (ri.header.dwType == RIM_TYPEMOUSE) {
    const USHORT downs = RI_MOUSE_BUTTON_1_DOWN | RI_MOUSE_BUTTON_2_DOWN | RI_MOUSE_BUTTON_3_DOWN |
                         RI_MOUSE_BUTTON_4_DOWN | RI_MOUSE_BUTTON_5_DOWN | RI_MOUSE_WHEEL | RI_MOUSE_HWHEEL;
    if (ri.data.mouse.usButtonFlags & downs) InputExit(L"mouse button or wheel");
    else CheckCursor();
  }
}

// ── the web views ────────────────────────────────────────────────────────────────────────────
std::wstring PageUrl(const Screen& s) {
  const bool preview = g_mode == Mode::Preview;
  wchar_t q[256];
  swprintf_s(q, L"?host=scr&mode=%ls&fps=%d&view=%ls&scale=%ls&seed=%lu",
             preview ? L"p" : g_mode == Mode::Window ? L"w" : L"s", preview ? 15 : g_settings.fps,
             g_settings.view.c_str(), preview ? L"0.5" : L"1", static_cast<unsigned long>(g_seed + 7919u * s.index));
  return std::wstring(kPage) + q;
}

void FitToWindow(Screen& s) {
  if (!s.controller) return;
  RECT rc;
  GetClientRect(s.hwnd, &rc);
  s.controller->put_Bounds(rc);
}

HRESULT ServeRequest(ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) {
  ICoreWebView2WebResourceRequest* req = nullptr;
  if (FAILED(args->get_Request(&req)) || !req) return S_OK;
  LPWSTR raw = nullptr;
  req->get_Uri(&raw);
  req->Release();
  std::wstring uri = raw ? raw : L"";
  CoTaskMemFree(raw);
  const std::wstring path = uri.substr(0, uri.find_first_of(L"?#"));
  ICoreWebView2WebResourceResponse* resp = nullptr;
  if (path == kPage || path == kOrigin) {
    IStream* body = SHCreateMemStream(g_html, g_htmlSize);
    g_env->CreateWebResourceResponse(body, 200, L"OK", kHeaders, &resp);
    if (body) body->Release();
  } else {
    // Everything else (a favicon, anything a future change might reach for) is refused: zero network.
    Log(L"blocked request: %ls", uri.c_str());
    g_env->CreateWebResourceResponse(nullptr, 403, L"Blocked", L"", &resp);
  }
  if (resp) {
    args->put_Response(resp);
    resp->Release();
  }
  return S_OK;
}

void ConfigureWebView(Screen& s) {
  ICoreWebView2Settings* st = nullptr;
  if (SUCCEEDED(s.webview->get_Settings(&st)) && st) {
    st->put_AreDefaultContextMenusEnabled(FALSE);
    st->put_AreDevToolsEnabled(FALSE);
    st->put_IsStatusBarEnabled(FALSE);
    st->put_IsZoomControlEnabled(FALSE);
    st->put_AreDefaultScriptDialogsEnabled(FALSE);
    ICoreWebView2Settings3* st3 = nullptr;
    if (SUCCEEDED(st->QueryInterface(IID_ICoreWebView2Settings3, reinterpret_cast<void**>(&st3))) && st3) {
      st3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
      st3->Release();
    }
    // SmartScreen checks a page's address with Microsoft; ours is our own embedded page, so turn it off.
    ICoreWebView2Settings8* st8 = nullptr;
    if (SUCCEEDED(st->QueryInterface(IID_ICoreWebView2Settings8, reinterpret_cast<void**>(&st8))) && st8) {
      st8->put_IsReputationCheckingRequired(FALSE);
      st8->Release();
    }
    st->Release();
  }

  ICoreWebView2Controller2* c2 = nullptr;
  if (SUCCEEDED(s.controller->QueryInterface(IID_ICoreWebView2Controller2, reinterpret_cast<void**>(&c2))) && c2) {
    c2->put_DefaultBackgroundColor(COREWEBVIEW2_COLOR{0xFF, 2, 1, 8});  // kBackground
    c2->Release();
  }

  s.webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
  EventRegistrationToken token;
  auto* serve = new Callback<ICoreWebView2WebResourceRequestedEventHandler, ICoreWebView2*,
                             ICoreWebView2WebResourceRequestedEventArgs*>(
      IID_ICoreWebView2WebResourceRequestedEventHandler, ServeRequest);
  s.webview->add_WebResourceRequested(serve, &token);
  serve->Release();

  // The page forwards input it sees ("exit") and says when its scene is up ("ready").
  const int index = s.index;
  auto* message = new Callback<ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2*,
                               ICoreWebView2WebMessageReceivedEventArgs*>(
      IID_ICoreWebView2WebMessageReceivedEventHandler,
      [index](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
        LPWSTR text = nullptr;
        if (SUCCEEDED(args->TryGetWebMessageAsString(&text)) && text) {
          if (wcscmp(text, L"exit") == 0) InputExit(L"page input");
          else if (wcscmp(text, L"ready") == 0) Log(L"screen %d: scene ready", index);
          else if (wcsncmp(text, L"error:", 6) == 0) Log(L"screen %d: page %ls", index, text);
          CoTaskMemFree(text);
        }
        return S_OK;
      });
  s.webview->add_WebMessageReceived(message, &token);
  message->Release();

  // A crashed page reloads; a lost browser process ends the screensaver rather than leave a dead screen.
  Screen* sp = &s;
  auto* failed = new Callback<ICoreWebView2ProcessFailedEventHandler, ICoreWebView2*,
                              ICoreWebView2ProcessFailedEventArgs*>(
      IID_ICoreWebView2ProcessFailedEventHandler,
      [sp](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
        COREWEBVIEW2_PROCESS_FAILED_KIND kind;
        args->get_ProcessFailedKind(&kind);
        Log(L"screen %d: web process failed (kind %d)", sp->index, static_cast<int>(kind));
        if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED) Quit(L"browser process exited");
        else if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED && sp->webview) sp->webview->Reload();
        return S_OK;
      });
  s.webview->add_ProcessFailed(failed, &token);
  failed->Release();
}

void CreateWebView(Screen& s) {
  Screen* sp = &s;
  auto* done = new Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, HRESULT,
                            ICoreWebView2Controller*>(
      IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler,
      [sp](HRESULT hr, ICoreWebView2Controller* controller) -> HRESULT {
        if (FAILED(hr) || !controller) {
          Log(L"screen %d: controller failed 0x%08lx", sp->index, static_cast<unsigned long>(hr));
          return S_OK;  // that screen stays black; input still exits
        }
        if (g_quitting) {
          controller->Close();
          return S_OK;
        }
        sp->controller = controller;
        controller->AddRef();
        controller->get_CoreWebView2(&sp->webview);
        ConfigureWebView(*sp);
        FitToWindow(*sp);
        if (g_mode == Mode::Saver && sp->index == 0) controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        const std::wstring url = PageUrl(*sp);
        Log(L"screen %d: navigate %ls", sp->index, url.c_str());
        sp->webview->Navigate(url.c_str());
        return S_OK;
      });
  g_env->CreateCoreWebView2Controller(s.hwnd, done);
  done->Release();
}

void StartWebViews() {
  // One environment (one browser process) shared by every screen. The data folder is ours under
  // %LOCALAPPDATA%: the .scr may sit in System32, where nothing can be written.
  const std::wstring data = KnownFolder(FOLDERID_LocalAppData, L"\\WebView2");
  // Background networking (component updates, field trials) off: the screensaver talks to nobody.
  SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                          L"--disable-background-networking --disable-component-update --no-pings");
  auto* done = new Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, HRESULT,
                            ICoreWebView2Environment*>(
      IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler,
      [](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
        if (FAILED(hr) || !env) {
          Log(L"environment failed 0x%08lx", static_cast<unsigned long>(hr));
          Quit(L"no environment");
          return S_OK;
        }
        g_env = env;
        env->AddRef();
        for (auto& s : g_screens)
          if (s->live) CreateWebView(*s);
        return S_OK;
      });
  const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, data.empty() ? nullptr : data.c_str(), nullptr, done);
  done->Release();
  if (FAILED(hr)) {
    Log(L"CreateCoreWebView2EnvironmentWithOptions 0x%08lx", static_cast<unsigned long>(hr));
    Quit(L"no environment");
  }
}

// ── windows ──────────────────────────────────────────────────────────────────────────────────
Screen* ScreenOf(HWND hwnd) {
  for (auto& s : g_screens)
    if (s->hwnd == hwnd) return s.get();
  return nullptr;
}

void SetAllVisible(BOOL visible) {
  for (auto& s : g_screens)
    if (s->controller) s->controller->put_IsVisible(visible);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  const bool saver = g_mode == Mode::Saver;
  switch (msg) {
    case WM_SIZE:
      if (Screen* s = ScreenOf(hwnd)) FitToWindow(*s);
      return 0;
    case WM_INPUT:
      OnRawInput(lp);
      break;  // DefWindowProc must still see WM_INPUT
    case WM_TIMER:
      if (wp == kTimerPoll) {
        if (g_mode == Mode::Preview && !IsWindow(g_previewParent)) Quit(L"preview parent gone");
        CheckCursor();
      }
      return 0;
    case WM_SETCURSOR:
      if (saver) {
        SetCursor(nullptr);
        return TRUE;
      }
      break;
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
    case WM_LBUTTONDOWN:
    case WM_RBUTTONDOWN:
    case WM_MBUTTONDOWN:
    case WM_XBUTTONDOWN:
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
      if (saver) {
        InputExit(L"window input");
        return 0;
      }
      break;
    case WM_SYSCOMMAND:
      // While running, do not let Windows start the screensaver again or the monitor power menu move us.
      if (saver && ((wp & 0xFFF0) == SC_SCREENSAVE || (wp & 0xFFF0) == SC_CLOSE)) return 0;
      break;
    case WM_DISPLAYCHANGE:
      // A monitor added, removed or changed: the simplest correct thing is to stop; Windows restarts us.
      if (saver) Quit(L"display change");
      break;
    case WM_POWERBROADCAST:
      if (wp == PBT_POWERSETTINGCHANGE) {
        // The displays went off: hide the web views so the page stops drawing (no CPU spin while asleep).
        const auto* ps = reinterpret_cast<const POWERBROADCAST_SETTING*>(lp);
        if (ps && ps->DataLength >= sizeof(DWORD)) {
          const DWORD state = *reinterpret_cast<const DWORD*>(ps->Data);
          Log(L"display state %lu", state);
          SetAllVisible(state == 0 ? FALSE : TRUE);
        }
        return TRUE;
      }
      break;
    case WM_CLOSE:
      Quit(L"window closed");
      return 0;
    case WM_DESTROY:
      // A preview window dies with the settings dialog it lives in.
      Quit(L"window destroyed");
      return 0;
    case WM_ERASEBKGND: {
      RECT rc;
      GetClientRect(hwnd, &rc);
      HBRUSH b = CreateSolidBrush(kBackground);
      FillRect(reinterpret_cast<HDC>(wp), &rc, b);
      DeleteObject(b);
      return 1;
    }
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

struct MonitorRect {
  RECT rc;
  bool primary;
};

BOOL CALLBACK CollectMonitor(HMONITOR mon, HDC, LPRECT, LPARAM user) {
  MONITORINFO mi{};
  mi.cbSize = sizeof mi;
  if (GetMonitorInfoW(mon, &mi)) {
    auto* list = reinterpret_cast<std::vector<MonitorRect>*>(user);
    const MonitorRect m{mi.rcMonitor, (mi.dwFlags & MONITORINFOF_PRIMARY) != 0};
    if (m.primary) list->insert(list->begin(), m);  // the main screen is screen 0
    else list->push_back(m);
  }
  return TRUE;
}

Screen& AddScreen(HWND hwnd, bool live) {
  auto s = std::make_unique<Screen>();
  s->hwnd = hwnd;
  s->live = live;
  s->index = static_cast<int>(g_screens.size());
  g_screens.push_back(std::move(s));
  return *g_screens.back();
}

bool CreateWindows(HINSTANCE inst) {
  WNDCLASSEXW wc{};
  wc.cbSize = sizeof wc;
  wc.lpfnWndProc = WndProc;
  wc.hInstance = inst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.lpszClassName = kWindowClass;
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
  if (!RegisterClassExW(&wc)) return false;

  if (g_mode == Mode::Preview) {
    RECT rc;
    GetClientRect(g_previewParent, &rc);
    HWND h = CreateWindowExW(0, kWindowClass, L"", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN, 0, 0, rc.right - rc.left,
                             rc.bottom - rc.top, g_previewParent, nullptr, inst, nullptr);
    if (!h) return false;
    AddScreen(h, true);
  } else if (g_mode == Mode::Window) {
    HWND h = CreateWindowExW(0, kWindowClass, L"Cosmic Shore Screensaver", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                             CW_USEDEFAULT, CW_USEDEFAULT, 1280, 760, nullptr, nullptr, inst, nullptr);
    if (!h) return false;
    AddScreen(h, true);
    ShowWindow(h, SW_SHOWNORMAL);
  } else {
    std::vector<MonitorRect> monitors;
    EnumDisplayMonitors(nullptr, nullptr, CollectMonitor, reinterpret_cast<LPARAM>(&monitors));
    if (monitors.empty()) monitors.push_back({{0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)}, true});
    for (const auto& m : monitors) {
      HWND h = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, kWindowClass, L"Cosmic Shore Screensaver",
                               WS_POPUP | WS_CLIPCHILDREN, m.rc.left, m.rc.top, m.rc.right - m.rc.left,
                               m.rc.bottom - m.rc.top, nullptr, nullptr, inst, nullptr);
      if (!h) continue;
      AddScreen(h, m.primary || g_settings.allScreens);
      ShowWindow(h, SW_SHOW);
    }
    if (g_screens.empty()) return false;
    Log(L"%zu screens", g_screens.size());
    SetForegroundWindow(g_screens.front()->hwnd);
    ShowCursor(FALSE);
  }

  HWND first = g_screens.front()->hwnd;
  if (g_mode == Mode::Saver) {
    RAWINPUTDEVICE rid[2] = {{0x01, 0x02, RIDEV_INPUTSINK, first}, {0x01, 0x06, RIDEV_INPUTSINK, first}};
    if (!RegisterRawInputDevices(rid, 2, sizeof rid[0])) Log(L"RegisterRawInputDevices failed %lu", GetLastError());
  }
  if (g_mode == Mode::Saver || g_mode == Mode::Preview) SetTimer(first, kTimerPoll, 100, nullptr);
  RegisterPowerSettingNotification(first, &GUID_CONSOLE_DISPLAY_STATE, DEVICE_NOTIFY_WINDOW_HANDLE);
  return true;
}

// ── arguments ────────────────────────────────────────────────────────────────────────────────
Mode ParseArgs(HWND& target) {
  target = nullptr;
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  Mode mode = Mode::Settings;
  if (argv && argc >= 2) {
    std::wstring a = argv[1];
    while (!a.empty() && (a[0] == L'/' || a[0] == L'-')) a.erase(0, 1);
    const wchar_t key = a.empty() ? L'c' : static_cast<wchar_t>(towlower(a[0]));
    std::wstring rest = a.size() > 1 ? a.substr(1) : std::wstring();
    if (!rest.empty() && rest[0] == L':') rest.erase(0, 1);
    if (rest.empty() && argc >= 3) rest = argv[2];
    if (!rest.empty()) target = reinterpret_cast<HWND>(static_cast<UINT_PTR>(wcstoull(rest.c_str(), nullptr, 10)));
    switch (key) {
      case L's': mode = Mode::Saver; break;
      case L'p': case L'l': mode = Mode::Preview; break;
      case L'w': mode = Mode::Window; break;
      default: mode = Mode::Settings; break;
    }
  }
  LocalFree(argv);
  return mode;
}

bool LoadPage() {
  HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(IDR_INDEX), MAKEINTRESOURCEW(10) /* RT_RCDATA */);
  if (!res) return false;
  HGLOBAL h = LoadResource(nullptr, res);
  g_html = h ? static_cast<const BYTE*>(LockResource(h)) : nullptr;
  g_htmlSize = SizeofResource(nullptr, res);
  return g_html && g_htmlSize > 0;
}

bool HasWebView2() {
  LPWSTR version = nullptr;
  const HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
  const bool ok = SUCCEEDED(hr) && version;
  if (ok) Log(L"WebView2 runtime %ls", version);
  CoTaskMemFree(version);
  return ok;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
  g_startTick = GetTickCount();
  g_mode = ParseArgs(g_previewParent);
  Log(L"start, mode %d, version %ls", static_cast<int>(g_mode), SCR_VERSION_W);

  INITCOMMONCONTROLSEX icc{sizeof icc, ICC_STANDARD_CLASSES};
  InitCommonControlsEx(&icc);

  if (g_mode == Mode::Settings) {
    HWND owner = g_previewParent && IsWindow(g_previewParent) ? g_previewParent : GetForegroundWindow();
    DialogBoxParamW(inst, MAKEINTRESOURCEW(IDD_SETTINGS), owner, SettingsProc, 0);
    return 0;
  }
  if (g_mode == Mode::Preview && (!g_previewParent || !IsWindow(g_previewParent))) return 0;

  // One running screensaver at a time (Windows can ask twice).
  HANDLE single = nullptr;
  if (g_mode == Mode::Saver) {
    single = CreateMutexW(nullptr, TRUE, L"Local\\CosmicShoreScreensaver.Run");
    if (GetLastError() == ERROR_ALREADY_EXISTS) return 0;
  }

  if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;
  if (!LoadPage()) return 1;
  if (!HasWebView2()) {
    if (g_mode != Mode::Preview) {
      const std::wstring text = std::wstring(L"Cosmic Shore Screensaver needs the Microsoft Edge WebView2 Runtime, "
                                             L"which comes with Windows 11 and most Windows 10 PCs.\n\n"
                                             L"Open Microsoft's download page now?\n") + kWebView2Download;
      if (MessageBoxW(nullptr, text.c_str(), L"Cosmic Shore Screensaver", MB_YESNO | MB_ICONINFORMATION) == IDYES)
        ShellExecuteW(nullptr, L"open", kWebView2Download, nullptr, nullptr, SW_SHOWNORMAL);
    }
    return 0;
  }

  g_settings = LoadSettings();
  g_seed = GetTickCount() ^ (GetCurrentProcessId() << 16);
  if (!CreateWindows(inst)) return 1;
  StartWebViews();

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  for (auto& s : g_screens) {
    if (s->webview) s->webview->Release();
    if (s->controller) s->controller->Release();
    if (IsWindow(s->hwnd)) DestroyWindow(s->hwnd);
  }
  if (g_env) g_env->Release();
  if (g_mode == Mode::Saver) ShowCursor(TRUE);
  CoUninitialize();
  if (single) CloseHandle(single);
  Log(L"exit 0");
  return 0;
}
