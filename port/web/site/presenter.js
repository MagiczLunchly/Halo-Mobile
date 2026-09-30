'use strict';
// Copy and close each frame instead of retaining a transferred GPU-backed canvas image.
function createHaloPresenter(canvas, mode, beforePresent, afterPresent, getGate) {
  const context = mode === 'bitmap' ? canvas.getContext('bitmaprenderer') :
    canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) throw new Error('The frame presentation context is unavailable.');
  return bitmap => {
    try {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      beforePresent(bitmap);
      if (mode === 'bitmap') context.transferFromImageBitmap(bitmap);
      else context.drawImage(bitmap, 0, 0);
      afterPresent();
    } finally {
      try { bitmap.close(); }
      finally {
        const gate = getGate();
        if (gate) Atomics.store(gate, 0, 0);
      }
    }
  };
}
if (typeof module !== 'undefined') module.exports = { createHaloPresenter };

// Keep a fixed pixel buffer when a browser retains transferred GPU frame images.
function createHaloPixelPresenter(canvas, beforePresent, afterPresent, getGate) {
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context) throw new Error('The pixel presentation context is unavailable.');
  let image, rows;
  return (buffer, width, height) => {
    try {
      if (!image || image.width !== width || image.height !== height) {
        canvas.width = width; canvas.height = height;
        image = context.createImageData(width, height);
        const source = new Uint8Array(buffer), stride = width * 4;
        rows = Array.from({length:height}, (_, row) => source.subarray(row * stride, (row + 1) * stride));
      }
      // WebGL is bottom-up; ImageData is top-down. Reuse every row view and allocation.
      for (let row = 0; row < height; row++) image.data.set(rows[height - row - 1], row * width * 4);
      context.putImageData(image, 0, 0);
      beforePresent(canvas);
      afterPresent();
    } finally {
      const gate = getGate();
      if (gate) Atomics.store(gate, 0, 0);
    }
  };
}
if (typeof module !== 'undefined') module.exports.createHaloPixelPresenter = createHaloPixelPresenter;
