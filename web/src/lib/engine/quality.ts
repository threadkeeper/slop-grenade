/** Bound Android's high-density canvas to keep memory and rendering work manageable. */
export const ANDROID_CANVAS_PIXEL_BUDGET = 3_200_000;

/** Desktop retains its existing quality limit; Android uses up to three device pixels per CSS pixel. */
export function stageQuality(native: boolean, desktopMaxDpr: number): { maxDpr: number; maxPixels: number } {
  return native
    ? { maxDpr: 3, maxPixels: ANDROID_CANVAS_PIXEL_BUDGET }
    : { maxDpr: desktopMaxDpr, maxPixels: Infinity };
}
