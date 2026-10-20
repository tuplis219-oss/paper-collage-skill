/*!
 * paper-collage.js — 纯前端“照片 + 纸张拼贴”海报生成器（无依赖，Canvas 2D）
 *
 *   const { canvas, layout } = PaperCollage.render(img, { template: 'jigsaw' });
 *   const results = await PaperCollage.renderBatch(fileList);   // 3–20 张
 *   const withText = PaperCollage.drawText(canvas, layout, '用户输入的文字');
 *
 * 输出画布比例 = 输入照片比例；文字区域留空，坐标在 layout.text_regions。
 */
(function (global) {
  'use strict';

  var PAPER_AGED = [233, 219, 192];
  var PAPER_CREAM = [241, 235, 222];
  var PAPER_NOTE = [250, 249, 245];
  var PAPER_HOLE = [236, 228, 214];
  var NOTEBOOK = [244, 238, 226];
  var BG_WHITE = '#fafafc';
  var TEXT_COLOR = '#2b2723';

  // v1.2: 配色来自输入照片，纸张透明度仅用于压在照片上的图层。
  // 结构性留白背景（例如拼图、打孔、留白卡片的非照片半区）保留不透明。
  function rgbHex(c) {
    return '#' + c.map(function (v) { return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2); }).join('');
  }
  function blendRgb(a, b, t) { return a.map(function (v, i) { return Math.round(v * (1 - t) + b[i] * t); }); }
  function rgbLum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function analyzeImage(img) {
    var sz = srcSize(img), sample = mk(90, 90), ctx = g2d(sample);
    ctx.drawImage(img, 0, 0, sample.width, sample.height);
    var data = ctx.getImageData(0, 0, 90, 90).data;
    function stats(x0, y0, x1, y1) {
      var sums = [0, 0, 0], sat = 0, n = 0, dark = 0, light = 0;
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
        var i = (y * 90 + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        sums[0] += r; sums[1] += g; sums[2] += b;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        sat += mx ? (mx - mn) / mx : 0;
        var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (lum < 0.25) dark++;
        if (lum > 0.7) light++;
        n++;
      }
      var mean = sums.map(function (v) { return Math.round(v / n); });
      return { meanRgb: mean, luminance: +rgbLum(mean).toFixed(3), saturation: +(sat / n).toFixed(3),
        warmth: +((mean[0] - mean[2]) / 255).toFixed(3), darkRatio: +(dark / n).toFixed(3), brightRatio: +(light / n).toFixed(3) };
    }
    return { size: sz, aspect: +(sz[0] / sz[1]).toFixed(4), full: stats(0, 0, 90, 90),
      bottom: stats(0, 65, 90, 90), top: stats(0, 0, 90, 25),
      left: stats(0, 0, 35, 90), right: stats(55, 0, 90, 90), center: stats(25, 25, 65, 65) };
  }
  function resolvePalette(analysis, template, opts) {
    opts = opts || {};
    var f = analysis.full;
    var warm = f.warmth > 0.115 && f.luminance > 0.37;
    var dark = f.luminance < 0.235;
    var fresh = !dark && !warm && f.luminance > 0.37 && f.saturation > 0.37;
    var material = warm ? 'warm_aged' : fresh ? 'clean_soft' : 'cool_fiber';
    var presets = {
      warm_aged: { aged: [217, 192, 159], cream: [232, 215, 191], note: [244, 236, 218], hole: [223, 205, 178], notebook: [238, 224, 202], accent: [119, 83, 57] },
      clean_soft: { aged: [211, 221, 200], cream: [229, 234, 216], note: [245, 247, 237], hole: [223, 230, 212], notebook: [237, 241, 225], accent: [99, 121, 84] },
      cool_fiber: { aged: dark ? [127, 138, 134] : [157, 172, 164], cream: dark ? [170, 180, 172] : [193, 204, 193], note: dark ? [201, 208, 198] : [227, 233, 221], hole: dark ? [156, 168, 158] : [199, 210, 200], notebook: dark ? [181, 190, 181] : [214, 223, 211], accent: [83, 103, 98] }
    };
    var base = presets[material];
    // 原片颜色略微渗入纸张；限制渗色幅度以保持可读性。
    var sourceTint = blendRgb(f.meanRgb, [152, 153, 147], 0.62);
    var tint = warm ? 0.035 : 0.085;
    var paper = {};
    ['aged', 'cream', 'note', 'hole', 'notebook'].forEach(function (k) { paper[k] = blendRgb(base[k], sourceTint, tint); });
    paper.disc = paper.hole;
    paper.background = rgbHex(paper.note);
    paper.accent = base.accent;
    var placement = template === 'bottom_strip' ? analysis.bottom : template === 'frame_window' || template === 'frame_polaroid' ? analysis.center : analysis.full;
    // 不透明度的目的是确保底图持续可见，而不是使所有纸张尽可能透明。
    var opacity = warm ? 0.52 : fresh ? 0.45 : dark ? 0.35 : 0.40;
    if (placement.luminance < 0.21) opacity -= 0.025;
    if (placement.saturation > 0.48) opacity -= 0.02;
    opacity = clamp(opacity, 0.26, 0.60);
    if (opts.opacity != null) {
      if (typeof opts.opacity !== 'number' || !isFinite(opts.opacity)) throw new Error('opacity must be a number');
      opacity = clamp(opts.opacity, 0.08, 1);
    }
    if (opts.paperColor) {
      var hex = opts.paperColor;
      if (!/^#[a-f0-9]{6}$/i.test(hex)) throw new Error('paperColor must be #RRGGBB');
      var rgb = [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
      ['aged', 'cream', 'note', 'hole', 'notebook', 'disc'].forEach(function (k) { paper[k] = rgb.slice(); });
      paper.background = hex;
    }
    if (opts.palette === 'classic') {
      paper = { aged: PAPER_AGED.slice(), cream: PAPER_CREAM.slice(), note: PAPER_NOTE.slice(),
        hole: PAPER_HOLE.slice(), notebook: NOTEBOOK.slice(), disc: [238,230,216], background: BG_WHITE,
        accent: [150,125,95] };
      material = 'warm_aged'; opacity = opts.opacity == null ? 1 : opacity;
    }
    var renderedRgb = blendRgb(placement.meanRgb, paper.aged, opacity);
    function readable(rgb) { return rgbLum(rgb) < 0.49 ? '#F3F1E9' : '#242A26'; }
    var textColor = readable(renderedRgb);
    var noteTextColor = readable(blendRgb(analysis.center.meanRgb, paper.note, Math.min(0.86, opacity + 0.25)));
    var bookTextColor = readable(blendRgb(analysis.center.meanRgb, paper.cream, Math.min(0.78, opacity + 0.13)));
    return {
      mode: opts.palette === 'classic' ? 'classic' : 'auto', strategy: 'photo-first', material: material,
      paper: paper, paperOpacity: +opacity.toFixed(3), frameOpacity: +clamp(opacity + 0.18, 0.34, 0.8).toFixed(3),
      bookOpacity: +clamp(opacity + 0.13, 0.34, 0.78).toFixed(3), textColor: textColor,
      noteTextColor: noteTextColor, bookTextColor: bookTextColor, structuralTextColor: readable(paper.note),
      placementLuminance: placement.luminance, photoLuminance: f.luminance,
      reason: '根据全图和覆盖区域统计生成调色板；照片叠加纸透明，结构性留白保持不透明'
    };
  }

  function chooseTemplate(analysis, opts) {
    opts = opts || {};
    var allowed = (opts.allowed && opts.allowed.length ? opts.allowed.slice() : Object.keys(TEMPLATES));
    function ok(id) { return allowed.indexOf(id) >= 0; }
    var aspect = analysis.aspect, f = analysis.full, b = analysis.bottom, c = analysis.center;
    var vertical = aspect < 0.88, square = aspect >= 0.88 && aspect <= 1.12, landscape = aspect > 1.12;
    var dark = f.luminance < 0.235 || f.darkRatio > 0.62;
    var warmVintage = f.warmth > 0.115 && f.luminance > 0.44;
    var brightFresh = !warmVintage && f.luminance > 0.38 && f.saturation > 0.40;
    var structured = landscape || (Math.abs(analysis.left.luminance - analysis.right.luminance) < 0.07 && c.saturation > 0.30 && b.darkRatio > 0.42);
    var minimalist = brightFresh && b.saturation > 0.45 && c.luminance > 0.42;
    var candidates = [];
    function add(id, score, reason) { if (ok(id)) candidates.push({ id:id, score:score, reason:reason }); }

    if (dark && vertical) {
      add('bottom_strip', 92, '竖图且整体偏暗，适合底部半透明纸条，保留上方氛围');
      add('frame_window', 68, '暗调照片也适合留白框，但遮挡应更克制');
      add('jigsaw', 48, '可做情绪化碎片效果，但优先级较低');
    }
    if (minimalist && vertical) {
      add('circle_holes', 90, '明亮开阔的竖图适合轻量打孔结构，避免厚重纸区');
      add('split_card', 66, '也适合留白卡片，但不如圆孔轻盈');
      add('bottom_strip', 54, '可用底条，但会增加底部重量');
    }
    if (warmVintage && (square || vertical)) {
      add('frame_polaroid', 91, '暖色复古题材适合相片感模板');
      add('book_overlay', 74, '静物和文字氛围也适合书页覆盖');
      add('split_card', 55, '可做卡片感留白');
    }
    if (structured) {
      add('frame_window', 89, '结构感或横图优先保留秩序，用开窗框更稳');
      add('split_card', 72, '横向画面也适合留白卡片结构');
      add('notebook', 58, '如果想更文档化，可用横线本');
    }
    if (!candidates.length) {
      if (vertical) {
        add('bottom_strip', 70, '通用竖图模板');
        add('split_card', 64, '通用竖图备用模板');
        add('frame_window', 60, '通用竖图留白结构');
      } else if (square) {
        add('frame_polaroid', 70, '近方图适合相片感结构');
        add('split_card', 66, '近方图也适合卡片式留白');
        add('book_overlay', 60, '近方静物图可尝试书页结构');
      } else {
        add('frame_window', 70, '通用横图模板');
        add('split_card', 66, '通用横图备用模板');
        add('notebook', 58, '横图可用横线本');
      }
    }
    candidates.sort(function (a, b) { return b.score - a.score; });
    return { template: candidates[0].id, reason: candidates[0].reason, ranked: candidates };
  }



  // ------------------------------------------------------------ helpers

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function g2d(c) { return c.getContext('2d'); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function srcSize(img) {
    return [img.naturalWidth || img.videoWidth || img.width, img.naturalHeight || img.videoHeight || img.height];
  }

  function drawCover(ctx, img, x, y, w, h, fx, fy) {
    var s = srcSize(img), iw = s[0], ih = s[1];
    var k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
    ctx.drawImage(img, (iw - sw) * (fx == null ? 0.5 : fx), (ih - sh) * (fy == null ? 0.5 : fy), sw, sh, x, y, w, h);
  }
  function cover(img, w, h, fx, fy) {
    var c = mk(w, h);
    drawCover(g2d(c), img, 0, 0, c.width, c.height, fx, fy);
    return c;
  }
  function crop(src, x, y, w, h) {
    var c = mk(w, h);
    g2d(c).drawImage(src, Math.round(x), Math.round(y), c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }

  function noiseGrid(rand, w, h, scale) {
    var gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2, g = new Float32Array(gw * gh);
    for (var i = 0; i < g.length; i++) g[i] = rand() - 0.5;
    return { g: g, gw: gw, s: scale };
  }
  function sample(n, x, y) {
    x /= n.s; y /= n.s;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * n.gw + x0, g = n.g;
    var a = g[i], b = g[i + 1], c = g[i + n.gw], d = g[i + n.gw + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** Procedural paper texture. aged ∈ [0,1] darkens edges and adds stains/specks. */
  function paper(w, h, color, rand, aged, material) {
    aged = aged || 0; material = material || 'warm_aged';
    var c = mk(w, h); w = c.width; h = c.height;
    var ctx = g2d(c), im = ctx.createImageData(w, h), d = im.data;
    var n1 = noiseGrid(rand, w, h, 6), n2 = noiseGrid(rand, w, h, 50), n3 = noiseGrid(rand, w, h, 25);
    var coarse = 12 * (0.6 + aged);
    for (var y = 0, p = 0; y < h; y++) {
      for (var x = 0; x < w; x++, p += 4) {
        var n = (rand() - 0.5) * 7 + sample(n1, x, y) * 9 + sample(n2, x, y) * coarse * 1.6;
        var r = color[0] + n, g = color[1] + n, b = color[2] + n;
        if (aged > 0) {
          var dd = Math.min(Math.min(x, w - 1 - x) / w, Math.min(y, h - 1 - y) / h);
          var e = Math.max(0, 1 - dd * 9); e *= e;
          var k = e * 45 * aged, st = Math.max(0, sample(n3, x, y) * 1.6 - 0.32) * 120 * aged;
          // 冷纸均匀压暗、不泛黄；浅植物纸更干净；旧书纸才使用暖边。
          var damp = material === 'clean_soft' ? 0.33 : 1;
          if (material === 'warm_aged') {
            r -= (k * 0.7 + st * 0.6) * damp; g -= (k + st * 0.9) * damp; b -= (k * 1.5 + st * 1.3) * damp;
          } else {
            var z = (k + st * 0.7) * damp;
            r -= z; g -= z * 0.96; b -= z * 0.99;
          }
        }
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    if (aged > 0) {
      ctx.fillStyle = material === 'warm_aged' ? 'rgb(150,125,95)' : material === 'clean_soft' ? 'rgb(151,157,141)' : 'rgb(98,112,105)';
      var count = Math.floor((w * h) / 40000 * aged * (material === 'clean_soft' ? 0.28 : 0.65)) + 1;
      for (var i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, 0.5 + rand() * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return c;
  }

  /** Clip a layer to a rectangle with slightly irregular (hand-cut) edges. */
  function roughEdges(layer, rand, amp, step) {
    var w = layer.width, h = layer.height, c = mk(w, h), ctx = g2d(c), x, y;
    step = step || 5;
    ctx.beginPath();
    ctx.moveTo(0, rand() * amp);
    for (x = 0; x < w; x += step) ctx.lineTo(x, rand() * amp);
    for (y = 0; y < h; y += step) ctx.lineTo(w - rand() * amp, y);
    for (x = w; x > 0; x -= step) ctx.lineTo(x, h - rand() * amp);
    for (y = h; y > 0; y -= step) ctx.lineTo(rand() * amp, y);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(layer, 0, 0);
    return c;
  }

  function drawShadowed(ctx, layer, x, y, blur, ox, oy, alpha) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,' + alpha + ')';
    ctx.shadowBlur = Math.max(1, blur * 2);
    ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy;
    ctx.drawImage(layer, Math.round(x), Math.round(y));
    ctx.restore();
  }

  function drawPaperOverlay(ctx, layer, x, y, alpha, blur, ox, oy, shadow) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    // 阴影也随透明度变轻，避免出现深色实体边框的错觉。
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,' + clamp(shadow, 0, 1) + ')';
      ctx.shadowBlur = Math.max(1, blur * 2);
      ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy;
    }
    ctx.drawImage(layer, Math.round(x), Math.round(y));
    ctx.restore();
  }

  function blurCanvas(src, radius) {
    var f = Math.max(1, radius / 1.2), w = src.width, h = src.height;
    var small = mk(w / f, h / f), sc = g2d(small);
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(src, 0, 0, small.width, small.height);
    var out = mk(w, h), oc = g2d(out);
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(small, 0, 0, w, h);
    return out;
  }

  function levels(d, cutoff) {
    var lo = [0, 0, 0], hi = [255, 255, 255], total = d.length / 4;
    for (var ch = 0; ch < 3; ch++) {
      var hist = new Uint32Array(256), i, acc = 0, lim = total * cutoff;
      for (i = ch; i < d.length; i += 4) hist[d[i]]++;
      for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > lim) { lo[ch] = i; break; } }
      for (acc = 0, i = 255; i >= 0; i--) { acc += hist[i]; if (acc > lim) { hi[ch] = i; break; } }
      if (hi[ch] <= lo[ch]) { lo[ch] = 0; hi[ch] = 255; }
    }
    return { lo: lo, hi: hi };
  }

  /** Vintage brown monochrome (black → #2e2216, mid → #a88a5e, white → #ead6ad). */
  function sepia(src, colorMix) {
    var c = mk(src.width, src.height), ctx = g2d(c);
    ctx.drawImage(src, 0, 0);
    var im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
    var L = levels(d, 0.01);
    var A = [46, 34, 22], M = [168, 138, 94], B = [234, 214, 173];
    for (var p = 0; p < d.length; p += 4) {
      var r = (d[p] - L.lo[0]) / (L.hi[0] - L.lo[0]);
      var g = (d[p + 1] - L.lo[1]) / (L.hi[1] - L.lo[1]);
      var b = (d[p + 2] - L.lo[2]) / (L.hi[2] - L.lo[2]);
      var v = clamp(0.299 * r + 0.587 * g + 0.114 * b, 0, 1);
      for (var ch = 0; ch < 3; ch++) {
        var tone = v < 0.5 ? A[ch] + (M[ch] - A[ch]) * v * 2 : M[ch] + (B[ch] - M[ch]) * (v - 0.5) * 2;
        d[p + ch] = colorMix ? tone * (1 - colorMix) + d[p + ch] * colorMix : tone;
      }
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  function orientation(W, H) {
    if (H > W * 1.15) return 'portrait';
    if (W > H * 1.15) return 'landscape';
    return 'square';
  }

  function Ctx(img, W, H, seed, analysis, palette) {
    this.img = img; this.W = W; this.H = H;
    this.analysis = analysis; this.palette = palette;
    this.m = Math.min(W, H);
    this.orient = orientation(W, H);
    this.rand = mulberry32(seed);
    this.regions = [];
    this.font = Math.max(10, Math.round(this.m * 0.032));
  }
  Ctx.prototype.uniform = function (a, b) { return a + (b - a) * this.rand(); };
  Ctx.prototype.region = function (id, box, extra) {
    var x0 = Math.round(box[0]), y0 = Math.round(box[1]), x1 = Math.round(box[2]), y1 = Math.round(box[3]);
    var r = {
      id: id, order: this.regions.length,
      x: x0, y: y0, w: x1 - x0, h: y1 - y0,
      rel: { x: +(x0 / this.W).toFixed(4), y: +(y0 / this.H).toFixed(4), w: +((x1 - x0) / this.W).toFixed(4), h: +((y1 - y0) / this.H).toFixed(4) },
      font_size: this.font, line_height: Math.round(this.font * 1.35),
      color: this.palette.textColor, writing_mode: 'horizontal-tb'
    };
    for (var k in extra || {}) r[k] = extra[k];
    this.regions.push(r);
  };

  // ---------------------------------------------------------- templates

  /** 参考图 1 / 3：左侧磨砂纸（+便签），右侧做旧纸框开窗。 */
  function frameWindow(c, polaroid) {
    var W = c.W, H = c.H, m = c.m, rand = c.rand;
    var can = cover(c.img, W, H), ctx = g2d(can);
    var tb = c.orient === 'portrait' ? [0.25, 0.75] : c.orient === 'square' ? [0.18, 0.82] : [0.12, 0.88];
    var lr = c.orient === 'landscape' ? [0.05, 0.49, 0.95] : [0.035, 0.48, 0.965];

    var L = [lr[0] * W, tb[0] * H], lw = (lr[1] - lr[0]) * W, lh = (tb[1] - tb[0]) * H;
    var frosted = blurCanvas(crop(can, L[0], L[1], lw, lh), m * 0.006);
    ctx.drawImage(frosted, Math.round(L[0]), Math.round(L[1]));
    drawPaperOverlay(ctx, paper(lw, lh, polaroid ? c.palette.paper.aged : c.palette.paper.cream, rand, polaroid ? 0.3 : 0, c.palette.material), L[0], L[1], Math.min(0.72, c.palette.paperOpacity + 0.12));

    if (!polaroid) {
      var nx = L[0] + lw * 0.225, ny = L[1] + lh * 0.3, nw = lw * 0.55, nh = lh * 0.47;
      var note = roughEdges(paper(nw, nh, c.palette.paper.note, rand, 0, c.palette.material), rand, m * 0.004);
      drawPaperOverlay(ctx, note, nx, ny, Math.min(0.86, c.palette.paperOpacity + 0.25), m * 0.006, m * 0.002, m * 0.004, 0.21);
      var p = m * 0.018;
      c.region('note', [nx + p, ny + p, nx + nw - p, ny + nh - p], { color: c.palette.noteTextColor });
    }

    var R = [lr[1] * W, tb[0] * H, lr[2] * W, tb[1] * H], rw = R[2] - R[0], rh = R[3] - R[1];
    var band = Math.min(m * 0.09, rw * 0.2, rh * 0.2);
    var win = [band, band * 0.95, rw - band, rh - band];
    var frame = paper(rw, rh, c.palette.paper.aged, rand, 0.8, c.palette.material), fc = g2d(frame);
    fc.globalCompositeOperation = 'destination-out';
    fc.fillRect(win[0], win[1], win[2] - win[0], win[3] - win[1]);
    drawPaperOverlay(ctx, frame, R[0], R[1], c.palette.frameOpacity, m * 0.006, m * 0.002, m * 0.004, 0.22);

    if (polaroid) {
      var inset = m * 0.012, border = m * 0.018;
      var px0 = R[0] + win[0] + inset, py0 = R[1] + win[1] + inset;
      var pw = win[2] - win[0] - 2 * inset, ph = win[3] - win[1] - 2 * inset;
      var card = paper(pw, ph, c.palette.paper.note, rand, 0, c.palette.material);
      g2d(card).drawImage(sepia(cover(c.img, pw - 2 * border, ph - 3.6 * border)), Math.round(border), Math.round(border));
      drawShadowed(ctx, card, px0, py0, m * 0.008, m * 0.003, m * 0.005, 0.4);
      var tw = m * 0.025, th = m * 0.08, tape = mk(tw, th), tc = g2d(tape);
      tc.fillStyle = 'rgb(60,52,44)'; tc.fillRect(0, 0, tape.width, tape.height);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(roughEdges(tape, rand, 1.5), Math.round(px0 + pw * 0.48), Math.round(py0 - th * 0.45));
      ctx.globalAlpha = 1;
      c.region('photo_caption', [px0 + border, py0 + ph - border * 2.4, px0 + pw - border, py0 + ph - border * 0.4],
        { font_size: Math.round(c.font * 0.8), line_height: Math.round(c.font * 1.05) });
    }

    var q = m * 0.01, x0 = R[0], y0 = R[1];
    c.region('frame_top', [x0 + q, y0 + q, R[2] - q, y0 + win[1] - q]);
    c.region('frame_left', [x0 + q, y0 + win[1], x0 + win[0] - q, y0 + win[3]]);
    c.region('frame_right', [x0 + win[2] + q, y0 + win[1], R[2] - q, y0 + win[3]]);
    c.region('frame_bottom', [x0 + q, y0 + win[3] + q, R[2] - q, R[3] - q]);
    return can;
  }

  function splitRects(c, frac) {
    if (c.orient === 'landscape') {
      var aw = Math.round(c.W * frac);
      return { vertical: false, A: [0, 0, aw, c.H], B: [aw, 0, c.W - aw, c.H] };
    }
    var ah = Math.round(c.H * frac);
    return { vertical: true, A: [0, 0, c.W, ah], B: [0, ah, c.W, c.H - ah] };
  }

  /** 参考图 2：照片 + 中央白卡片，另一半留白 + 小方图。横图左右分。 */
  function splitCard(c) {
    var W = c.W, H = c.H, m = c.m, s = splitRects(c, 0.5), A = s.A, B = s.B;
    var can = mk(W, H), ctx = g2d(can);
    ctx.fillStyle = c.palette.paper.background; ctx.fillRect(0, 0, W, H);
    var photoA = cover(c.img, A[2], A[3]);
    ctx.drawImage(photoA, A[0], A[1]);

    var side = Math.round(Math.min(0.42 * Math.min(A[2], A[3]), 0.28 * Math.max(A[2], A[3])));
    var cx = Math.round(A[0] + (A[2] - side) / 2);
    var cy = Math.round(s.vertical ? A[1] + A[3] * 0.29 : A[1] + (A[3] - side) / 2 - A[3] * 0.05);
    drawPaperOverlay(ctx, paper(side, side, c.palette.paper.note, c.rand, 0, c.palette.material), cx, cy, Math.min(0.86, c.palette.paperOpacity + 0.25), m * 0.004, 0, m * 0.002, 0.13);
    var p = side * 0.06;
    c.region('card', [cx + p, cy + p * 1.2, cx + side - p, cy + side - p], { color: c.palette.noteTextColor });

    var sx = cx - A[0], sy = Math.min(A[3] - side, cy - A[1] + Math.round(side * 0.6));
    ctx.drawImage(crop(photoA, sx, sy, side, side), Math.round(B[0] + (B[2] - side) / 2), Math.round(B[1] + (B[3] - side) / 2));
    return can;
  }

  /** 参考图 4：照片以复古色印在横线本上，向文字区渐隐。 */
  function notebook(c) {
    var W = c.W, H = c.H, m = c.m;
    var lh = Math.max(12, Math.round(m * 0.036));
    var base = paper(W, H, c.palette.paper.notebook, c.rand, 0.15, c.palette.material), bc = g2d(base);
    bc.strokeStyle = rgbHex(blendRgb(c.palette.paper.notebook, c.palette.paper.accent, 0.25));
    bc.lineWidth = Math.max(1, Math.round(m * 0.0012));
    for (var y = lh * 2; y < H; y += lh) { bc.beginPath(); bc.moveTo(0, y + 0.5); bc.lineTo(W, y + 0.5); bc.stroke(); }

    var ph = cover(c.img, W, H);
    var printed = mk(W, H), pc = g2d(printed);
    pc.drawImage(base, 0, 0);
    pc.globalCompositeOperation = 'multiply';
    pc.drawImage(sepia(ph, c.palette.material === 'warm_aged' ? 0.25 : 0.82), 0, 0);

    var right = [0.56 * W, 0.40 * H, 0.97 * W, 0.70 * H];
    var bottom = [0.03 * W, 0.71 * H, 0.97 * W, 0.98 * H];
    var feather = m * 0.04;
    var bd = bc.getImageData(0, 0, W, H), pd = pc.getImageData(0, 0, W, H).data, d = bd.data;
    for (var yy = 0, i = 0; yy < H; yy++) {
      for (var xx = 0; xx < W; xx++, i += 4) {
        var a = 1 - smooth(((yy / H) * 0.95 + (xx / W) * 0.35 - 0.40) / 0.38);
        if (a > 0.001) {
          for (var k = 0; k < 2; k++) {
            var r = k ? bottom : right;
            var sd = Math.max(r[0] - xx, xx - r[2], r[1] - yy, yy - r[3]);
            a *= 1 - 0.88 * clamp(0.5 - sd / (2 * feather), 0, 1);
          }
          d[i] += (pd[i] - d[i]) * a; d[i + 1] += (pd[i + 1] - d[i + 1]) * a; d[i + 2] += (pd[i + 2] - d[i + 2]) * a;
        }
      }
    }
    bc.putImageData(bd, 0, 0);

    function snap(b) { return [b[0], Math.ceil(b[1] / lh) * lh, b[2], Math.floor(b[3] / lh) * lh]; }
    var extra = { line_height: lh, font_size: Math.round(lh * 0.72), align_to_rules: true, color: c.palette.structuralTextColor };
    c.region('right_column', snap(right), extra);
    c.region('bottom', snap(bottom), extra);
    return base;
  }

  /** 参考图 5：摊开的书压在照片上，左页印照片，右页写字。 */
  function bookOverlay(c) {
    var W = c.W, H = c.H, m = c.m;
    var can = cover(c.img, W, H), ctx = g2d(can);
    var B = c.orient === 'portrait' ? [0.025, 0.25, 0.965, 0.755]
      : c.orient === 'square' ? [0.04, 0.18, 0.96, 0.82] : [0.08, 0.1, 0.92, 0.9];
    var bx = Math.round(B[0] * W), by = Math.round(B[1] * H), bw = Math.round((B[2] - B[0]) * W), bh = Math.round((B[3] - B[1]) * H);
    var page = paper(bw, bh, c.palette.paper.cream, c.rand, 0.35, c.palette.material), pctx = g2d(page);
    var pd = pctx.getImageData(0, 0, bw, bh), d = pd.data;
    var src = g2d(can).getImageData(bx, by, bw, bh).data, L = levels(src, 0.01);
    for (var y = 0, i = 0; y < bh; y++) {
      var yr = y / bh, fadeTop = clamp(1 - yr / 0.2, 0, 1) * 0.9;
      for (var x = 0; x < bw; x++, i += 4) {
        var xr = x / bw;
        var a = xr < 0.5 ? 1 : Math.max(fadeTop, clamp(1 - (xr - 0.5) / 0.05, 0, 1));
        var spine = 1 - Math.exp(-Math.pow((xr - 0.5) / 0.012, 2)) * 0.28;
        var r = clamp((src[i] - L.lo[0]) / (L.hi[0] - L.lo[0]), 0, 1) * 255;
        var g = clamp((src[i + 1] - L.lo[1]) / (L.hi[1] - L.lo[1]), 0, 1) * 255;
        var b = clamp((src[i + 2] - L.lo[2]) / (L.hi[2] - L.lo[2]), 0, 1) * 255;
        var gray = 0.299 * r + 0.587 * g + 0.114 * b;
        var px = [r * 0.65 + gray * 0.35, g * 0.65 + gray * 0.35, b * 0.65 + gray * 0.35];
        for (var ch = 0; ch < 3; ch++) {
          var paperV = d[i + ch], printedV = paperV * (95 + px[ch] * 0.63) / 255;
          d[i + ch] = (paperV + (printedV - paperV) * a) * spine;
        }
      }
    }
    pctx.putImageData(pd, 0, 0);
    var step = Math.max(1, Math.round(m * 0.002));
    for (var e = 0; e < 4; e++) {
      pctx.strokeStyle = e % 2 ? 'rgb(200,188,166)' : 'rgb(168,154,130)';
      pctx.beginPath(); pctx.moveTo(bw - 0.5 - e * step, 0); pctx.lineTo(bw - 0.5 - e * step, bh); pctx.stroke();
    }
    drawPaperOverlay(ctx, page, bx, by, c.palette.bookOpacity, m * 0.01, m * 0.004, m * 0.008, 0.2);
    c.region('right_page', [bx + bw * 0.535, by + bh * 0.2, bx + bw * 0.95, by + bh * 0.96], { color: c.palette.bookTextColor });
    return can;
  }

  /** 参考图 6：照片上贴纸圆片，纸面上对应圆孔露出照片。无文字。 */
  function circleHoles(c) {
    var W = c.W, H = c.H, m = c.m, s = splitRects(c, 0.57), A = s.A, B = s.B;
    var can = paper(W, H, c.palette.paper.hole, c.rand, 0.2, c.palette.material), ctx = g2d(can);
    var top = cover(c.img, A[2], A[3]);
    ctx.drawImage(top, A[0], A[1]);
    var band = s.vertical
      ? [0.08 * W, B[1] + 0.12 * B[3], 0.92 * W, B[1] + 0.78 * B[3]]
      : [B[0] + 0.1 * B[2], 0.12 * H, B[0] + 0.9 * B[2], 0.88 * H];

    var discs = [], holes = [], n = 28, t;
    for (var i = 0; i < n; i++) {
      var r = c.uniform(0.018, 0.042) * m, x, y, hx, hy;
      for (t = 0; t < 60; t++) {
        x = c.uniform(r, A[2] - r); y = c.uniform(r, A[3] - r);
        if (discs.every(function (q) { return Math.hypot(x - q[0], y - q[1]) > r + q[2] + m * 0.01; })) break;
      }
      for (t = 0; t < 200; t++) {
        hx = c.uniform(band[0] + r, band[2] - r); hy = c.uniform(band[1] + r, band[3] - r);
        if (holes.every(function (q) { return Math.hypot(hx - q[0], hy - q[1]) > r + q[2] - m * 0.004; })) break;
      }
      discs.push([x, y, r]); holes.push([hx, hy, r]);
    }

    discs.forEach(function (dsc, idx) {
      var hl = holes[idx], r = dsc[2], sz = Math.round(2 * r);
      ctx.save();
      ctx.beginPath(); ctx.arc(hl[0], hl[1], r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(top, Math.round(dsc[0] - r), Math.round(dsc[1] - r), sz, sz, Math.round(hl[0] - r), Math.round(hl[1] - r), sz, sz);
      ctx.shadowColor = 'rgba(40,34,28,0.55)';
      ctx.shadowBlur = r * 0.25; ctx.shadowOffsetX = r * 0.07; ctx.shadowOffsetY = r * 0.07;
      ctx.beginPath(); ctx.arc(hl[0], hl[1], r * 2, 0, Math.PI * 2); ctx.arc(hl[0], hl[1], r, 0, Math.PI * 2, true);
      ctx.fillStyle = '#000'; ctx.fill();
      ctx.restore();

      var disc = paper(sz, sz, c.palette.paper.disc, c.rand, 0.1, c.palette.material), dc = g2d(disc);
      dc.globalCompositeOperation = 'destination-in';
      dc.beginPath(); dc.arc(sz / 2, sz / 2, sz / 2 - 0.5, 0, Math.PI * 2); dc.fill();
      ctx.globalAlpha = Math.min(0.90, c.palette.paperOpacity + 0.26);
      drawShadowed(ctx, disc, A[0] + dsc[0] - r, A[1] + dsc[1] - r, Math.max(1, sz / 25), 1, 2, 0.25);
      ctx.globalAlpha = 1;
    });
    return can;
  }

  function tabEdge(a, b, sign) {
    if (!sign) return [a, b];
    var pts = [[0, 0], [0.37, 0], [0.41, 0.07]], cx = 0.5, cy = 0.18, r = 0.13;
    var a0 = 232 * Math.PI / 180, a1 = -52 * Math.PI / 180;
    for (var i = 1; i < 16; i++) { var t = a0 + (a1 - a0) * i / 16; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    pts.push([0.59, 0.07], [0.63, 0], [1, 0]);
    var dx = b[0] - a[0], dy = b[1] - a[1];
    return pts.map(function (p) { return [a[0] + p[0] * dx - sign * p[1] * dy, a[1] + p[0] * dy + sign * p[1] * dx]; });
  }

  /** 参考图 7：照片切成拼图，缺失的拼块放在文字旁。 */
  function jigsaw(c) {
    var W = c.W, H = c.H, m = c.m, rand = c.rand, s = splitRects(c, s0(c)), A = s.A, B = s.B;
    function s0(cc) { return cc.orient === 'landscape' ? 0.55 : 0.545; }
    var pw = A[2], ph = A[3];
    var target = m * 0.055;
    var cols = Math.max(4, Math.round(pw / target)), rows = Math.max(3, Math.round(ph / target));
    var px = pw / cols, py = ph / rows, r, cc;
    function sgn() { return rand() < 0.5 ? -1 : 1; }
    var hedge = [], vedge = [];
    for (r = 0; r <= rows; r++) {
      hedge.push([]);
      for (cc = 0; cc < cols; cc++) hedge[r].push(tabEdge([cc * px, r * py], [(cc + 1) * px, r * py], r === 0 || r === rows ? 0 : sgn()));
    }
    for (r = 0; r < rows; r++) {
      vedge.push([]);
      for (cc = 0; cc <= cols; cc++) vedge[r].push(tabEdge([cc * px, r * py], [cc * px, (r + 1) * py], cc === 0 || cc === cols ? 0 : sgn()));
    }
    function piecePoly(r, cc) {
      return hedge[r][cc].concat(vedge[r][cc + 1], hedge[r + 1][cc].slice().reverse(), vedge[r][cc].slice().reverse());
    }
    function polyPath(ctx, pts, ox, oy) {
      ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + ox, pts[i][1] + oy);
      ctx.closePath();
    }

    var top = cover(c.img, pw, ph), tc = g2d(top), lw = Math.max(1, Math.round(m * 0.0015));
    function strokeEdges(color, off) {
      tc.strokeStyle = color; tc.lineWidth = lw; tc.beginPath();
      function line(pts) { tc.moveTo(pts[0][0] + off, pts[0][1] + off); for (var i = 1; i < pts.length; i++) tc.lineTo(pts[i][0] + off, pts[i][1] + off); }
      for (var r = 1; r < rows; r++) for (var cc = 0; cc < cols; cc++) line(hedge[r][cc]);
      for (r = 0; r < rows; r++) for (cc = 1; cc < cols; cc++) line(vedge[r][cc]);
      tc.stroke();
    }
    strokeEdges('rgba(255,255,255,0.24)', 1);
    strokeEdges('rgba(20,20,20,0.43)', 0);

    var start = [Math.floor(rows * 0.45), Math.floor(cols * (s.vertical ? 0.68 : 0.6))];
    var chosen = {}, list = [start]; chosen[start.join()] = 1;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 0]];
    for (var guard = 0; list.length < 14 && guard < 5000; guard++) {
      var base = list[Math.floor(rand() * list.length)], dv = dirs[Math.floor(rand() * dirs.length)];
      var nr = base[0] + dv[0], nc = base[1] + dv[1];
      if (nr >= 1 && nr < rows - 1 && nc >= 1 && nc < cols - 1 && !chosen[nr + ',' + nc]) { chosen[nr + ',' + nc] = 1; list.push([nr, nc]); }
    }
    var polys = list.map(function (p) { return piecePoly(p[0], p[1]); });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polys.forEach(function (pl) { pl.forEach(function (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }); });
    minX = Math.floor(minX) - 2; minY = Math.floor(minY) - 2; maxX = Math.ceil(maxX) + 2; maxY = Math.ceil(maxY) + 2;
    var cw = maxX - minX, ch = maxY - minY;

    var cluster = mk(cw, ch), cl = g2d(cluster);
    cl.beginPath(); polys.forEach(function (pl) { polyPath(cl, pl, -minX, -minY); }); cl.fill();
    cl.globalCompositeOperation = 'source-in';
    cl.drawImage(top, -minX, -minY);

    var can = mk(W, H), ctx = g2d(can);
    ctx.fillStyle = c.palette.paper.background; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(top, A[0], A[1]);
    ctx.beginPath(); polys.forEach(function (pl) { polyPath(ctx, pl, A[0], A[1]); });
    ctx.fill();

    var area = s.vertical ? [0.56 * W, B[1] + 0.04 * B[3], 0.95 * W, H - 0.04 * B[3]]
      : [B[0] + 0.08 * B[2], 0.06 * H, B[0] + 0.92 * B[2], 0.5 * H];
    var k = Math.min(1, (area[2] - area[0]) / cw, (area[3] - area[1]) / ch);
    var piece = cluster;
    if (k < 1) { piece = mk(cw * k, ch * k); g2d(piece).drawImage(cluster, 0, 0, piece.width, piece.height); }
    var ox = Math.round((area[0] + area[2]) / 2 - piece.width / 2), oy = Math.round((area[1] + area[3]) / 2 - piece.height / 2);
    drawShadowed(ctx, piece, ox, oy, m * 0.008, m * 0.003, m * 0.006, 0.4);

    if (s.vertical) c.region('text', [0.05 * W, B[1] + 0.12 * B[3], Math.min(ox - 0.02 * W, 0.56 * W), H - 0.15 * B[3]], { color: c.palette.structuralTextColor });
    else c.region('text', [B[0] + 0.1 * B[2], Math.max(oy + piece.height + 0.05 * H, 0.55 * H), B[0] + 0.9 * B[2], 0.93 * H], { color: c.palette.structuralTextColor });
    return can;
  }

  /** 参考图 8：照片 + 底部撕边纸条。 */
  function bottomStrip(c) {
    var W = c.W, H = c.H, m = c.m;
    var frac = c.orient === 'portrait' ? 0.18 : c.orient === 'square' ? 0.2 : 0.22;
    var stripTop = Math.round(H * (1 - frac)), amp = m * 0.006;
    var can = cover(c.img, W, H, 0.5, 0.35), ctx = g2d(can);
    var sh = H - stripTop + Math.ceil(amp * 2);
    var strip = paper(W, sh, c.palette.paper.aged, c.rand, 0.4, c.palette.material), sc = g2d(strip);
    sc.globalCompositeOperation = 'destination-in';
    sc.beginPath(); sc.moveTo(0, sh);
    for (var x = 0; x <= W + 4; x += 4) sc.lineTo(x, c.rand() * amp * 2);
    sc.lineTo(W, sh); sc.closePath(); sc.fill();
    drawPaperOverlay(ctx, strip, 0, stripTop - Math.ceil(amp * 2), c.palette.paperOpacity, m * 0.006, 0, -m * 0.002, 0.14);
    var s = H - stripTop;
    c.region('strip', [0.03 * W, stripTop + 0.2 * s, 0.97 * W, H - 0.12 * s]);
    return can;
  }

  var TEMPLATES = {
    frame_window:   { name: '纸框开窗', desc: '左侧磨砂半透明纸 + 白便签，右侧做旧纸框开窗露出照片，文字环绕窗口', fn: function (c) { return frameWindow(c, false); } },
    split_card:     { name: '留白卡片', desc: '一半照片 + 中央白卡片，另一半留白放一块小方图（横图左右分）', fn: splitCard },
    frame_polaroid: { name: '复古相片', desc: '左侧做旧磨砂纸，右侧纸框中嵌一张带胶带的棕褐色老照片', fn: function (c) { return frameWindow(c, true); } },
    notebook:       { name: '横线本',   desc: '照片以复古色印在横线本上，向文字区渐隐', fn: notebook },
    book_overlay:   { name: '摊开的书', desc: '摊开的书压在照片上，左页印照片，右页写字', fn: bookOverlay },
    circle_holes:   { name: '圆形打孔', desc: '照片上贴纸圆片，纸面上对应圆孔露出照片（无文字）', fn: circleHoles },
    jigsaw:         { name: '拼图',     desc: '照片切成拼图，缺失的拼块放在文字旁', fn: jigsaw },
    bottom_strip:   { name: '底部纸条', desc: '照片 + 底部撕边做旧纸条写字', fn: bottomStrip }
  };

  // ---------------------------------------------------------------- api

  /**
   * @param {CanvasImageSource} img
   * @param {{template?:string, seed?:number, maxSide?:number, width?:number, height?:number, palette?:'auto'|'classic', opacity?:number, paperColor?:string}} opts
   *   默认输出尺寸 = 照片原尺寸（长边超过 maxSide=2048 时等比缩小），即保持照片比例。
   */
  function render(img, opts) {
    opts = opts || {};
    var sz = srcSize(img), W = opts.width, H = opts.height;
    if (!W || !H) {
      var maxSide = opts.maxSide || 2048, k = Math.min(1, maxSide / Math.max(sz[0], sz[1]));
      W = Math.round(sz[0] * k); H = Math.round(sz[1] * k);
    }
    var seed = opts.seed == null ? 7 : opts.seed;
    var analysis = analyzeImage(img);
    var decision = (!opts.template || opts.template === 'auto') ? chooseTemplate(analysis, opts) : { template: opts.template, reason: '用户显式指定模板', ranked: [] };
    var tpl = decision.template || 'frame_window';
    if (!TEMPLATES[tpl]) throw new Error('unknown template: ' + tpl);
    var palette = resolvePalette(analysis, tpl, opts);
    palette.templateReason = decision.reason;
    palette.templateCandidates = decision.ranked;
    var c = new Ctx(img, W, H, seed, analysis, palette);
    var canvas = TEMPLATES[tpl].fn(c);
    return {
      canvas: canvas,
      layout: { template: tpl, width: W, height: H, orientation: c.orient, seed: seed, text_regions: c.regions, design: palette, analysis: analysis }
    };
  }

  /** 为 n 张照片分配模板：尽量不重复，n ≤ 8 时全部不同。 */
  function pickTemplates(n, seed, allowed) {
    var names = (allowed && allowed.length ? allowed : Object.keys(TEMPLATES)).slice(), out = [], rand = mulberry32(seed || 1);
    while (out.length < n) {
      var round = names.slice();
      for (var i = round.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = round[i]; round[i] = round[j]; round[j] = t; }
      if (out.length && round[0] === out[out.length - 1] && round.length > 1) round.push(round.shift());
      out = out.concat(round);
    }
    return out.slice(0, n);
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var url = typeof src === 'string' ? src : URL.createObjectURL(src);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('failed to load image: ' + (src.name || src))); };
      img.src = url;
    });
  }

  /**
   * 批量生成。sources: File / Blob / URL / HTMLImageElement 数组（建议 3–20 张）。
   * opts.templates 可指定每张的模板；不指定则自动分配。
   */
  function renderBatch(sources, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(sources);
    var forcedTemplates = opts.templates || null;
    return list.reduce(function (p, src, i) {
      return p.then(function (acc) {
        var getImg = src instanceof HTMLImageElement || src instanceof HTMLCanvasElement ? Promise.resolve(src) : loadImage(src);
        return getImg.then(function (img) {
          var tpl = forcedTemplates ? forcedTemplates[i] : 'auto';
          var res = render(img, { template: tpl, seed: (opts.seed || 7) + i, maxSide: opts.maxSide, palette: opts.palette, opacity: opts.opacity, paperColor: opts.paperColor, allowed: opts.allowed });
          res.source = img; res.index = i;
          if (opts.onProgress) opts.onProgress(i + 1, list.length, res);
          acc.push(res);
          return new Promise(function (r) { setTimeout(function () { r(acc); }, 0); });
        });
      });
    }, Promise.resolve([]));
  }

  function tokenize(text) {
    var re = /\n|[A-Za-z0-9'’\-]+[,.!?;:]?|\s+|./gu, out = [], m;
    while ((m = re.exec(text))) out.push(m[0]);
    return out;
  }

  /**
   * 把用户文字画到成品图的副本上。
   * text 为字符串：按 order 依次流入各区域（区域写满自动换到下一个）。
   * text 为对象：{ regionId: '文字' } 分别填写。
   */
  function drawText(canvas, layout, text, opts) {
    opts = opts || {};
    var out = mk(canvas.width, canvas.height), ctx = g2d(out);
    ctx.drawImage(canvas, 0, 0);
    var family = opts.fontFamily || '"Ma Shan Zheng", "ZCOOL KuaiLe", "KaiTi", "STKaiti", cursive';
    var regions = layout.text_regions.slice().sort(function (a, b) { return a.order - b.order; });
    var shared = typeof text === 'string' ? tokenize(text) : null;

    regions.forEach(function (r) {
      var tokens = shared || tokenize((text && text[r.id]) || '');
      if (!tokens.length) return;
      var size = opts.fontSize || r.font_size, lh = r.align_to_rules ? r.line_height : Math.round(size * 1.35);
      ctx.font = size + 'px ' + family;
      ctx.fillStyle = opts.color || r.color;
      ctx.textBaseline = 'alphabetic';
      var lineNo = 0, maxLines = Math.max(1, Math.floor(r.h / lh)), line = '';
      function baseline(n) { return r.align_to_rules ? r.y + (n + 1) * lh - lh * 0.2 : r.y + n * lh + size; }
      function flush() { ctx.fillText(line.replace(/^\s+/, ''), r.x, baseline(lineNo)); lineNo++; line = ''; }
      while (tokens.length && lineNo < maxLines) {
        var t = tokens[0];
        if (t === '\n') { tokens.shift(); flush(); continue; }
        var noBreakBefore = /^[，。、；：？！）》」』”’,.;:?!)]/.test(t);
        if (ctx.measureText(line + t).width <= r.w || !line || noBreakBefore) {
          if (!line && ctx.measureText(t).width > r.w && t.length > 1) { tokens[0] = t.slice(1); t = t[0]; } else tokens.shift();
          line += t;
        } else flush();
      }
      if (line && lineNo < maxLines) flush();
    });
    return out;
  }

  global.PaperCollage = {
    version: '1.2.0',
    templates: Object.keys(TEMPLATES).map(function (k) { return { id: k, name: TEMPLATES[k].name, desc: TEMPLATES[k].desc }; }),
    render: render,
    analyzeImage: analyzeImage,
    resolvePalette: resolvePalette,
    chooseTemplate: chooseTemplate,
    renderBatch: renderBatch,
    pickTemplates: pickTemplates,
    drawText: drawText,
    loadImage: loadImage,
    orientation: orientation
  };
})(typeof window !== 'undefined' ? window : this);
