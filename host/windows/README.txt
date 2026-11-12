Cosmic Shore Screensaver {{VERSION}}
====================================

The Cosmic Shore Home screen as a Windows screensaver: vessels chasing the crystal through the Garland.
It runs on its own. It does not need the game, an account or the internet, and it sends nothing anywhere.

Needs: Windows 10 or 11 (64-bit) with the Microsoft Edge WebView2 Runtime, which comes with Windows 11
and nearly every Windows 10 PC. If it is missing, the screensaver offers Microsoft's download page.


INSTALL
-------
1. Extract this zip (right-click it > Extract All...).
2. Copy CosmicShore.scr into C:\Windows\System32. Windows asks for administrator permission;
   click Continue. (Screen Saver Settings only lists screensavers kept in that folder. Right-click >
   "Install" from anywhere else selects it once, but it drops out of the list when you pick another.)
3. Open Screen Saver Settings (Start > type "screen saver"), choose "Cosmic Shore", set the wait
   time and click OK.

This early build is not code-signed yet, so Windows warns you the first time:
  "Windows protected your PC"  ->  click "More info", then "Run anyway".
Some antivirus programs are also wary of unsigned screensavers. A signed build comes later.

Settings (frame rate, which screens, wide or close-up camera, the colour set) are under "Settings..." in
Screen Saver Settings. They are kept in %APPDATA%\Froglet\CosmicShoreScreensaver\settings.json.


TRY IT WITHOUT INSTALLING
-------------------------
Double-click CosmicShore.scr to open its settings, or right-click it and choose "Test" to run it.
Move the mouse or press any key to leave.


UNINSTALL
---------
Pick another screensaver (or None) in Screen Saver Settings and delete
C:\Windows\System32\CosmicShore.scr.
To remove everything it stored, also delete %APPDATA%\Froglet\CosmicShoreScreensaver and
%LOCALAPPDATA%\Froglet\CosmicShoreScreensaver.


https://www.froglet.games  -  Froglet Games, Inc.
