/**
 * image-filter.js — Universal High-Performance Photo Adjustment Engine
 * --------------------------------------------------------------------
 * Supports:
 *   - Brightness (-50 to +50)
 *   - Contrast (-50 to +50)
 *   - Saturation (-50 to +50)
 *   - Warmth (-50 to +50)
 *   - Preset Filters: 'normal' (ธรรมชาติ), 'warm' (อบอุ่น), 'soft' (ละมุน), 'classic' (คลาสสิก), 'bw' (ขาวดำ)
 *
 * Uses hardware-accelerated WebGL for 60fps real-time responsiveness on
 * all mobile devices (iOS / Android) and desktop computers, with automatic
 * graceful fallback to Canvas 2D.
 */
(() => {
  'use strict';

  const VS_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const FS_SOURCE = `
    precision mediump float;
    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform float u_brightness; // -0.5 .. 0.5
    uniform float u_contrast;   // -0.5 .. 0.5
    uniform float u_saturation; // -0.5 .. 0.5
    uniform float u_warmth;     // -0.5 .. 0.5
    uniform int u_preset;       // 0: normal, 1: warm, 2: soft, 3: classic, 4: bw

    void main() {
      vec4 color = texture2D(u_image, v_texCoord);
      vec3 rgb = color.rgb;

      // 1. Preset Filter Baseline
      if (u_preset == 1) {
        // อบอุ่น (Warm Golden Glow)
        rgb.r += 0.09;
        rgb.g += 0.04;
        rgb.b -= 0.06;
      } else if (u_preset == 2) {
        // ละมุน (Soft Pastel Aura)
        rgb = mix(rgb, vec3(1.0, 0.96, 0.92), 0.12);
        rgb = (rgb - 0.5) * 0.92 + 0.5;
        rgb += 0.03;
      } else if (u_preset == 3) {
        // คลาสสิก (Classic Rich Nostalgia)
        float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
        rgb = mix(vec3(lum), rgb, 0.70);
        rgb = (rgb - 0.5) * 1.15 + 0.5;
        rgb.r += 0.07;
        rgb.b -= 0.03;
      } else if (u_preset == 4) {
        // ขาวดำ (B&W Rich Monotone)
        float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
        rgb = vec3(lum);
      }

      // 2. Brightness (-0.5 .. 0.5)
      rgb += u_brightness;

      // 3. Contrast (-0.5 .. 0.5)
      float cFactor = 1.0 + u_contrast * 1.5;
      rgb = (rgb - 0.5) * cFactor + 0.5;

      // 4. Saturation (-0.5 .. 0.5)
      float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
      float sFactor = max(0.0, 1.0 + u_saturation * 1.5);
      rgb = mix(vec3(lum), rgb, sFactor);

      // 5. Warmth Slider (-0.5 .. 0.5)
      if (u_warmth > 0.0) {
        rgb.r += u_warmth * 0.28;
        rgb.g += u_warmth * 0.10;
        rgb.b -= u_warmth * 0.22;
      } else if (u_warmth < 0.0) {
        float w = -u_warmth;
        rgb.b += w * 0.28;
        rgb.g += w * 0.08;
        rgb.r -= w * 0.22;
      }

      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
    }
  `;

  class PhotoFilterProcessor {
    constructor() {
      this.glCanvas = null;
      this.gl = null;
      this.program = null;
      this.texture = null;
      this.textureLoaded = false;
      this.lastSource = null;
      this.attribs = {};
      this.uniforms = {};
      this.isGlReady = false;

      // 2D Fallback canvas
      this.fallbackCanvas = null;

      this.initGL();
    }

    initGL() {
      try {
        this.glCanvas = document.createElement('canvas');
        const opts = { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: true };
        this.gl = this.glCanvas.getContext('webgl', opts) || this.glCanvas.getContext('experimental-webgl', opts);
        if (!this.gl) {
          console.warn('[ImageFilter] WebGL unavailable, falling back to 2D canvas.');
          return;
        }

        const gl = this.gl;
        const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
        if (!vs || !fs) return;

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.warn('[ImageFilter] Program link error:', gl.getProgramInfoLog(program));
          return;
        }

        this.program = program;
        gl.useProgram(program);

        // Attribute Locations
        this.attribs.position = gl.getAttribLocation(program, 'a_position');
        this.attribs.texCoord = gl.getAttribLocation(program, 'a_texCoord');

        // Uniform Locations
        this.uniforms.image = gl.getUniformLocation(program, 'u_image');
        this.uniforms.brightness = gl.getUniformLocation(program, 'u_brightness');
        this.uniforms.contrast = gl.getUniformLocation(program, 'u_contrast');
        this.uniforms.saturation = gl.getUniformLocation(program, 'u_saturation');
        this.uniforms.warmth = gl.getUniformLocation(program, 'u_warmth');
        this.uniforms.preset = gl.getUniformLocation(program, 'u_preset');

        // Setup geometry (Fullscreen Quad)
        const posBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
          -1,  1,
           1, -1,
           1,  1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

        // Texture coordinates (Flipped Y so 2D drawImage renders upright)
        const texBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          0, 1,
          1, 1,
          0, 0,
          0, 0,
          1, 1,
          1, 0,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.attribs.texCoord);
        gl.vertexAttribPointer(this.attribs.texCoord, 2, gl.FLOAT, false, 0, 0);

        // Texture setup
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.isGlReady = true;
      } catch (err) {
        console.warn('[ImageFilter] WebGL init exception:', err);
        this.isGlReady = false;
      }
    }

    compileShader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[ImageFilter] Shader compile error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    loadSource(imageElement) {
      if (!imageElement) return;
      this.lastSource = imageElement;
      const w = imageElement.width || imageElement.videoWidth;
      const h = imageElement.height || imageElement.videoHeight;
      if (!w || !h) return;

      if (this.isGlReady) {
        const gl = this.gl;
        this.glCanvas.width = w;
        this.glCanvas.height = h;
        gl.viewport(0, 0, w, h);

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageElement);
        this.textureLoaded = true;
      }
    }

    render(adjustments = {}) {
      if (!this.lastSource) return null;

      const brightness = (adjustments.brightness || 0) / 100; // -0.5 .. +0.5
      const contrast = (adjustments.contrast || 0) / 100;     // -0.5 .. +0.5
      const saturation = (adjustments.saturation || 0) / 100; // -0.5 .. +0.5
      const warmth = (adjustments.warmth || 0) / 100;         // -0.5 .. +0.5

      let presetCode = 0;
      switch (adjustments.filter) {
        case 'warm': presetCode = 1; break;
        case 'soft': presetCode = 2; break;
        case 'classic': presetCode = 3; break;
        case 'bw': presetCode = 4; break;
        default: presetCode = 0; break;
      }

      if (this.isGlReady && this.textureLoaded) {
        const gl = this.gl;
        gl.useProgram(this.program);
        gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);

        gl.uniform1i(this.uniforms.image, 0);
        gl.uniform1f(this.uniforms.brightness, brightness);
        gl.uniform1f(this.uniforms.contrast, contrast);
        gl.uniform1f(this.uniforms.saturation, saturation);
        gl.uniform1f(this.uniforms.warmth, warmth);
        gl.uniform1i(this.uniforms.preset, presetCode);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return this.glCanvas;
      }

      // 2D Fallback
      return this.render2DFallback(adjustments);
    }

    render2DFallback(adjustments) {
      if (!this.fallbackCanvas) {
        this.fallbackCanvas = document.createElement('canvas');
      }
      const img = this.lastSource;
      const w = img.width;
      const h = img.height;
      this.fallbackCanvas.width = w;
      this.fallbackCanvas.height = h;
      const ctx = this.fallbackCanvas.getContext('2d');

      const b = 100 + (adjustments.brightness || 0);
      const c = 100 + (adjustments.contrast || 0);
      const s = 100 + (adjustments.saturation || 0);
      let fStr = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;

      if (adjustments.filter === 'warm') fStr += ' sepia(25%)';
      else if (adjustments.filter === 'soft') fStr += ' brightness(105%) contrast(90%)';
      else if (adjustments.filter === 'classic') fStr += ' contrast(115%) sepia(15%)';
      else if (adjustments.filter === 'bw') fStr += ' grayscale(100%)';

      ctx.save();
      try {
        ctx.filter = fStr;
      } catch (e) {}

      ctx.drawImage(img, 0, 0, w, h);

      // Warmth tint
      const warmthVal = adjustments.warmth || 0;
      if (warmthVal !== 0) {
        ctx.globalCompositeOperation = 'source-over';
        const alpha = (Math.abs(warmthVal) / 100) * 0.28;
        ctx.fillStyle = warmthVal > 0 ? `rgba(245, 158, 11, ${alpha})` : `rgba(59, 130, 246, ${alpha})`;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();

      return this.fallbackCanvas;
    }
  }

  // Export globally
  window.PhotoFilterProcessor = PhotoFilterProcessor;
  window.photoFilter = new PhotoFilterProcessor();
})();
