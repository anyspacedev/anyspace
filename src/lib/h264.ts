// Incremental H.264 Annex-B deframer.
//
// scrcpy emits a continuous H.264 Annex-B byte stream with no per-frame
// framing (`send_frame_meta=false` server flag). We buffer incoming bytes,
// split on start codes (00 00 00 01 / 00 00 01), and group NAL units into
// access units (AUs) — one AU per WebCodecs `EncodedVideoChunk`.
//
// AU boundary heuristic: scrcpy's libx264-baseline output puts at most one
// VCL NAL (types 1..5) per frame, optionally preceded by SPS/PPS/SEI. So
// every VCL NAL terminates the current AU. This matches what we see from
// real devices and Pixel-class AVDs.

const NAL_TYPE_NON_IDR = 1;
const NAL_TYPE_IDR = 5;

export class AnnexbDeframer {
  private buf: Uint8Array = new Uint8Array(0);
  private currentAU: Uint8Array[] = [];

  /** Push a raw byte chunk; returns any complete access units that resulted. */
  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.length === 0) return [];
    this.buf = concat(this.buf, chunk);
    const completedAUs: Uint8Array[] = [];
    for (const nal of this.extractNalus()) {
      const type = nal[0] & 0x1f;
      this.currentAU.push(nal);
      if (type >= NAL_TYPE_NON_IDR && type <= NAL_TYPE_IDR) {
        completedAUs.push(serializeAU(this.currentAU));
        this.currentAU = [];
      }
    }
    return completedAUs;
  }

  reset(): void {
    this.buf = new Uint8Array(0);
    this.currentAU = [];
  }

  // Find every start code; return NAL units between consecutive start codes,
  // keep the tail starting at the last start code in `this.buf`.
  private extractNalus(): Uint8Array[] {
    const positions: { offset: number; codeLen: number }[] = [];
    const b = this.buf;
    let i = 0;
    while (i + 2 < b.length) {
      const long =
        b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0 &&
        i + 3 < b.length && b[i + 3] === 1;
      const short = !long && b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1;
      if (long) {
        positions.push({ offset: i, codeLen: 4 });
        i += 4;
      } else if (short) {
        positions.push({ offset: i, codeLen: 3 });
        i += 3;
      } else {
        i++;
      }
    }
    if (positions.length < 2) return [];
    const nals: Uint8Array[] = [];
    for (let j = 0; j < positions.length - 1; j++) {
      const start = positions[j].offset + positions[j].codeLen;
      const end = positions[j + 1].offset;
      if (end > start) nals.push(b.slice(start, end));
    }
    // Preserve tail (the partial NAL after the last start code) for the next push.
    this.buf = b.slice(positions[positions.length - 1].offset);
    return nals;
  }
}

/** True if any NAL in this Annex-B-encoded AU is an IDR (type 5). */
export function isKeyAU(au: Uint8Array): boolean {
  let i = 0;
  while (i + 4 < au.length) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 0 && au[i + 3] === 1) {
      const type = au[i + 4] & 0x1f;
      if (type === NAL_TYPE_IDR) return true;
      i += 5;
    } else {
      i++;
    }
  }
  return false;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function serializeAU(nals: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const n of nals) total += 4 + n.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const n of nals) {
    out[off] = 0;
    out[off + 1] = 0;
    out[off + 2] = 0;
    out[off + 3] = 1;
    out.set(n, off + 4);
    off += 4 + n.length;
  }
  return out;
}
