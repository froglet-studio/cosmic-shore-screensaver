import * as THREE from 'three';

/**
 * The game's domain colours, copied from the game repo's
 * Assets/_SO_Assets/Color Palettes/OriginalColorSetSO.asset (linear HDR values, as Unity stores them).
 * Index order matches the export's domain table: Jade, Ruby, Blue, Gold.
 */
export interface DomainColors {
  inside: THREE.Color;   // InsideBlockColor (HDR, > 1 blooms)
  outside: THREE.Color;  // OutsideBlockColor
  superInside: THREE.Color;
  superOutside: THREE.Color;
  ship1: THREE.Color;    // ShipColor1 (hull body)
  ship2: THREE.Color;    // ShipColor2 (domain trim)
  trail: THREE.Color;    // TrailHighlightColor
}

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export const DOMAINS: DomainColors[] = [
  { // Jade
    inside: c(0, 0.5884546, 1.1353014), outside: c(0, 0.16, 0.34),
    superInside: c(1.012825, 1.1209937, 1.4980391), superOutside: c(0.03529412, 0.20392157, 0.36862746),
    ship1: c(0, 0.04901961, 0.09411765), ship2: c(0, 0.3882353, 0.7490196), trail: c(0.05490196, 0.7529412, 0.7137255),
  },
  { // Ruby
    inside: c(0.5490196, 0, 1.4980392), outside: c(0.11906711, 0.006783697, 0.30817598),
    superInside: c(0.83832616, 0.73017627, 1.4980392), superOutside: c(0.21176471, 0.12156863, 0.70980394),
    ship1: c(0.03529412, 0, 0.09411765), ship2: c(0.27450982, 0, 0.7490196), trail: c(0.7843137, 0, 0.7647059),
  },
  { // Blue
    inside: c(0.46681717, 0.53749484, 1.2167859), outside: c(0.023529412, 0.023529412, 0.34901962),
    superInside: c(1.3237392, 1.3400798, 1.4980394), superOutside: c(0, 0, 0.54901963),
    ship1: c(0, 0, 0.48235294), ship2: c(0, 0, 0.5019608), trail: c(0.4, 0.5, 1),
  },
  { // Gold
    inside: c(0.9964046, 0.4048625, 0.0185709), outside: c(0.23899364, 0.124818474, 0),
    superInside: c(1.4980395, 1.1186504, 0.5323221), superOutside: c(0.59607846, 0.28627452, 0.003921569),
    ship1: c(0.47058824, 0.23529412, 0.043137256), ship2: c(1.2203892, 0.6122575, 0.03070152), trail: c(1, 0.65654284, 0),
  },
];

export const JADE = 0;
