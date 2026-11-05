# M2: Home screen stills from Unity

The screensaver's M2 milestone ends with a **side-by-side check**: stills of the real Home screen next to the
same views in the screensaver, for Caleb to judge. This page is for whoever on the team has the game open in
Unity. It takes about 15 minutes, and **nothing in the game project is changed or committed**.

## What you need

- Unity with the Cosmic Shore project on the latest `bleeding-edge`.
- A way to take a screenshot: **Win + Shift + S** on Windows, **Cmd + Shift + 4** on a Mac.

## Set up (once)

1. Open the scene **`Assets/_Scenes/Menu_Main.unity`**.
2. In the **Game** view's toolbar, set the resolution dropdown to **1920x1080 (Full HD)** (add it with the **+**
   at the bottom of the list if it is not there). Set **Scale** to the smallest value that still shows the whole
   frame.
3. In the same toolbar, turn on **Maximize on Play** and turn **Stats** and **Gizmos** off.

## Round 1: the wide shot (LavaLamp)

The Home screen boots into the wide shot and then switches to a random other view every 45 seconds. These
steps keep it on the wide shot.

1. Press **Play** and wait until the menu has faded in and the Squirrel is flying (about 5 seconds).
2. In the **Hierarchy**, select the object named **`Game`**. In the Inspector, find **Main Menu Camera
   Controller** and **untick Random Switch Enabled**. (A change made in Play mode is undone when Play stops,
   so the scene is not changed.)
3. Take **three** screenshots of the Game view, about **20 seconds apart**. Try to catch one where the crystal
   is easy to see.
4. Stop Play.

## Round 2: the vessel close-up (OrbitVessel)

1. With Play stopped, select **`Game`** again and set **Initial Config Index** from **4** to **0**.
2. Press **Play**, wait about 5 seconds, then untick **Random Switch Enabled** as before.
3. Take **two** screenshots, about 10 seconds apart, with the Squirrel in view.
4. Stop Play, then **set Initial Config Index back to 4**. If Unity asks whether to save the scene, choose
   **Don't Save**.

## Send them

Name the files `lavalamp-1.png`, `lavalamp-2.png`, `lavalamp-3.png`, `vessel-1.png` and `vessel-2.png`, and
send them to Caleb, or drop them into the screensaver project's chat. Please also say which `bleeding-edge`
commit the project was on. Unity shows it in the version control panel, or see `git log -1` in the project folder.

## What happens next

The screensaver gets the same five views (the same camera numbers, frozen at the same moments), and the stills
are laid out side by side on one page. Caleb decides whether the look passes. If parts don't pass, the plan's
§3.3 fallback says what to do about them.
