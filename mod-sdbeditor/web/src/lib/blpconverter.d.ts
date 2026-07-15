/**
 * BLPFile - js-blp library type definitions
 * Supports BLP image format decoding (DXT1/DXT3/DXT5 and uncompressed)
 */

declare class BLPFile {
  /**
   * Image width in pixels
   */
  width: number;

  /**
   * Image height in pixels
   */
  height: number;

  /**
   * Scaled width (width / scale factor)
   */
  scaledWidth: number;

  /**
   * Scaled height (height / scale factor)
   */
  scaledHeight: number;

  /**
   * Static constant representing DXT1 compression.
   */
  static readonly DXT1: number;

  /**
   * Static constant representing DXT3 compression.
   */
  static readonly DXT3: number;

  /**
   * Static constant representing DXT5 compression.
   */
  static readonly DXT5: number;

  /**
   * Construct a new BLPFile instance.
   * @param data - ArrayBuffer, Uint8Array, or Buffer containing BLP file data
   */
  constructor(data: ArrayBuffer | Uint8Array | Buffer);

  /**
   * Get pixel data from a mipmap level.
   * @param mipmap - Mipmap level index (0 = full resolution)
   * @param canvas - Optional Canvas element to render pixels to
   * @returns Pixel data as ImageData, Uint8Array, or Bufo
   */
  getPixels(mipmap: number, canvas?: HTMLCanvasElement): ImageData | Uint8Array | any;
}

export default BLPFile;
export { BLPFile };
