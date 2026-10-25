/** Shared portrait layout. Coordinates are measured from the top-left. */
export const WIDTH = 720;
export const HEIGHT = 1560;
export const BOARD_X = 360;
export const BOARD_Y = 646;
export const TRAY_X = 84;
export const TRAY_STEP = 92;
export const TRAY_Y = 1244;
export const TRAY_SCALE = 0.95;
export const RESERVE_Y = 1115;
export const RESERVE_SCALE = 0.78;
/** White face is y=4..98 in the 132px tile; its 26px slice borders stay fixed. */
export function tileFaceCenterY(height: number): number {
  const faceTop = 4;
  const faceBottom = 26 + ((98 - 26) * (height - 52)) / 80;
  return (faceTop + faceBottom - height) / 2;
}
export const SKIN_NAMES = [
  'button-blue',
  'button-gold',
  'panel',
  'tile',
  'tray',
  'side-badge',
  'nav',
  'round-dark',
  'round-blue',
  'badge-red',
  'pill-dark',
  'button-pink',
  'button-amber',
];
