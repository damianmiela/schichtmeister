/**
 * Deterministic color generation from qualification abbreviation.
 * Produces a visually distinct, saturated color by hashing the abbreviation
 * into HSL space.  The same abbreviation always yields the same hex color.
 */

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // Use char code × position-dependent prime to spread similar strings apart
    hash = (hash * 31 + str.charCodeAt(i) * (i + 1)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Generate a hex color deterministically from a qualification abbreviation.
 * Produces medium-saturation, medium-lightness colors that look good as pill
 * backgrounds with either white or black text.
 */
export function generateColorFromAbbreviation(abbreviation: string): string {
  const h = hashCode(abbreviation.toUpperCase());
  const hue = h % 360;
  // Keep saturation in 55-75% range and lightness in 35-50% so pills are
  // readable with white text in most cases
  const saturation = 55 + (h % 21); // 55-75
  const lightness = 35 + ((h >> 8) % 16); // 35-50
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Returns the relative luminance of a hex color (0-1 range).
 * Used to determine whether to use white or black text.
 */
export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Returns "#fff" or "#000" depending on which gives better contrast
 * against the given background hex color.
 */
export function contrastTextColor(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.35 ? "#000" : "#fff";
}
