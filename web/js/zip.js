// A small .zip writer and reader for debug bundles: written uncompressed (pictures are JPEG already);
// read uncompressed or deflated (a bundle re-zipped by Windows), using the browser's own decompressor.
(function (root) {
  'use strict';
  var T = new Uint32Array(256);
  for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  function crc32(u8) { var c = 0xffffffff; for (var i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  var enc = new TextEncoder();
  function bytes(d) { return typeof d === 'string' ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d); }

  /** files: [{ name, data: string | Uint8Array | ArrayBuffer }] -> Uint8Array of a .zip */
  function zip(files) {
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = bytes(f.data), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]), out = new Uint8Array(all.reduce(function (s, p) { return s + p.length; }, 0)), at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  /** a .zip's files: Promise<{ [name]: Uint8Array }> */
  function unzip(buf) {
    var u8 = new Uint8Array(buf), v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), end = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) return Promise.reject(new Error('Not a .zip file'));
    var count = v.getUint16(end + 10, true), p = v.getUint32(end + 16, true), dec = new TextDecoder(), jobs = [];
    for (var n = 0; n < count; n++) {
      var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      var start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), data = u8.subarray(start, start + csize);
      jobs.push((function (name, method, data) {
        if (method === 0) return Promise.resolve([name, data]);
        if (method === 8 && typeof DecompressionStream !== 'undefined') return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return [name, new Uint8Array(b)]; });
        return Promise.resolve([name, null]);
      })(name, method, data));
      p += 46 + nlen + xlen + clen;
    }
    return Promise.all(jobs).then(function (l) { var o = {}; l.forEach(function (x) { if (!/\/$/.test(x[0])) o[x[0]] = x[1]; }); return o; });
  }
  root.VoraxZip = { zip: zip, unzip: unzip, crc32: crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
