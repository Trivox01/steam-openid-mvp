export function isMeaningfulArtworkPixels(pixels: Uint8ClampedArray) {
  if (pixels.length < 4) return false;
  let colorMinimum = 255;
  let colorMaximum = 0;
  let alphaMinimum = 255;
  let alphaMaximum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    colorMinimum = Math.min(colorMinimum, pixels[index], pixels[index + 1], pixels[index + 2]);
    colorMaximum = Math.max(colorMaximum, pixels[index], pixels[index + 1], pixels[index + 2]);
    alphaMinimum = Math.min(alphaMinimum, pixels[index + 3]);
    alphaMaximum = Math.max(alphaMaximum, pixels[index + 3]);
  }
  return colorMaximum - colorMinimum > 4 || alphaMaximum - alphaMinimum > 4;
}
