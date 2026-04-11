const canvas = document.getElementById('canvas2d');
const ctx = canvas.getContext('2d');

/**
 * Render height data as grayscale pixels on the 2D canvas.
 */
export function renderCanvas2D(heightData, mapSize) {
    canvas.width = mapSize;
    canvas.height = mapSize;

    const imageData = ctx.createImageData(mapSize, mapSize);
    const pixels = imageData.data;

    for (let i = 0; i < heightData.length; i++) {
        const gray = Math.floor(heightData[i] * 255);
        const p = i * 4;
        pixels[p] = gray;
        pixels[p + 1] = gray;
        pixels[p + 2] = gray;
        pixels[p + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
}

/**
 * Export the current canvas as a PNG download.
 */
export function exportPNG(seed, mapSize) {
    const link = document.createElement('a');
    link.download = `heightmap_seed${seed}_${mapSize}x${mapSize}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}
