// What the app shows when conversations need the person: words for the tray, and a small dot to lay over the taskbar icon on Windows.
// (macOS and Linux show the count itself through the operating system's own badge.) The dot is drawn here so no binary is kept.

export const needsYouLabel = (count: number): string => {
  return count === 1 ? "1 conversation needs you" : `${String(count)} conversations need you`;
};

// A round amber dot with a white rim, as BGRA pixels (the order Electron's bitmap images use).
export const badgeBitmap = (size: number): Buffer => {
  const pixels = Buffer.alloc(size * size * 4);
  const middle = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - middle, y - middle);
      const [b, g, r, a] = distance <= size / 2 - 3 ? [11, 158, 245, 255] : distance <= size / 2 - 0.5 ? [255, 255, 255, 255] : [0, 0, 0, 0];
      const i = (y * size + x) * 4;
      pixels[i] = b;
      pixels[i + 1] = g;
      pixels[i + 2] = r;
      pixels[i + 3] = a;
    }
  }
  return pixels;
};
