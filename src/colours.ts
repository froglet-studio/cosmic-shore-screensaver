import * as THREE from 'three';
import { COLOUR_SETS, DEFAULT_COLOUR_SET, type ColourSetData, type RGB } from './palette';

/**
 * The colour set the screensaver wears: one of the game's own (src/palette.ts, generated from its catalog).
 *
 * Chosen once, at start, from:
 * 1. `?colours=<id>` (the Windows and macOS hosts pass the id their settings saved);
 * 2. in the web preview only, the last choice made with its Colours menu (localStorage);
 * 3. otherwise the set the game paints with by default.
 * An unknown id falls through to the next. Changing the set reloads the page (the preview) or takes effect the next
 * time the screensaver starts (the hosts), so nothing here repaints a running scene.
 */
export const PREVIEW_STORAGE_KEY = 'cosmicshore.screensaver.colours';

const byId = (id: string | null | undefined): ColourSetData | undefined =>
  id ? COLOUR_SETS.find((s) => s.id === id) : undefined;

function storedChoice(): string | null {
  if (!(window as unknown as { __PREVIEW?: boolean }).__PREVIEW) return null;
  try {
    return localStorage.getItem(PREVIEW_STORAGE_KEY);
  } catch {
    return null; // storage blocked (private window, sandboxed frame): the default
  }
}

export const WORN: ColourSetData =
  byId(new URLSearchParams(location.search).get('colours')) ??
  byId(storedChoice()) ??
  byId(DEFAULT_COLOUR_SET) ??
  COLOUR_SETS[0];

/** The game's domain colours (linear HDR values, as Unity stores them), as the worn set paints them. */
export interface DomainColors {
  inside: THREE.Color;
  outside: THREE.Color;
  superInside: THREE.Color;
  superOutside: THREE.Color;
  ship1: THREE.Color;
  ship2: THREE.Color;
  trail: THREE.Color;
}

const color = (c: RGB) => new THREE.Color(c[0], c[1], c[2]);

/** Index order matches the export's domain table: Jade, Ruby, Blue, Gold. */
export const DOMAINS: DomainColors[] = WORN.domains.map((d) => ({
  inside: color(d.inside),
  outside: color(d.outside),
  superInside: color(d.superInside),
  superOutside: color(d.superOutside),
  ship1: color(d.ship1),
  ship2: color(d.ship2),
  trail: color(d.trail),
}));

export const JADE = 0;

/**
 * A material colour as the worn set paints it (the game's colour trace, looked up by the exporter), linear; or
 * `authored` (also linear) when no set retraces that colour. `key` is `<material>.<property>`, e.g.
 * `cage._Edge_Color`; the materials are listed in tools/export/export_palette.py.
 */
export function traced(key: string, authored: THREE.Color): THREE.Color {
  const c = WORN.world[key];
  return c ? color(c) : authored;
}

/** Choose a set in the web preview: remember it and start again in it. */
export function chooseInPreview(id: string): void {
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, id);
  } catch {
    // not remembered; the reload below still shows it once
  }
  const url = new URL(location.href);
  url.searchParams.set('colours', id);
  location.replace(url.toString());
}
