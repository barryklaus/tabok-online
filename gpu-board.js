(function () {
  'use strict';

  const DESIGN = { width: 1802, height: 1972 };
  const TEXTURES = {
    P: 'assets/exp-purple-stone-v1.png',
    T: 'assets/exp-teal-stone-v1.png',
    G: 'assets/exp-grey-stone-v1.png',
    wall: 'assets/ruin-wall-texture.png'
  };

  function hexVertices(cx, cy, w = 48, h = 41.5, slope = 24) {
    return [[cx - slope, cy - h], [cx + slope, cy - h], [cx + w, cy],
      [cx + slope, cy + h], [cx - slope, cy + h], [cx - w, cy]];
  }

  function tracePolygon(ctx, vertices) {
    ctx.beginPath();
    ctx.moveTo(vertices[0][0], vertices[0][1]);
    for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i][0], vertices[i][1]);
    ctx.closePath();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to load board texture: ' + src));
      image.src = src;
    });
  }

  function seeded(cell, salt = 0) {
    let value = Math.imul(cell.q + 31, 73856093) ^ Math.imul(cell.r + 47, 19349663) ^ salt;
    value ^= value >>> 13;
    return Math.abs(value);
  }

  class TabokGPUBoard {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.app = null;
      this.backend = 'svg';
      this.preferredScale = this.chooseAutomaticScale();
      this.renderScale = this.preferredScale;
      this.ready = this.init();
    }

    chooseAutomaticScale() {
      const mobile = matchMedia('(max-width: 700px)').matches;
      const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
      const lowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
      if (mobile || lowMemory) return 0.72;
      if (lowCores) return 0.84;
      return 1;
    }

    async init() {
      const rendererOverride = new URLSearchParams(location.search).get('renderer');
      const directFileLaunch = location.protocol === 'file:';
      const firefox = /Firefox\//.test(navigator.userAgent);
      const preferred = rendererOverride === 'webgpu' ? 'webgpu' :
        rendererOverride === 'webgl' || directFileLaunch || firefox || !navigator.gpu ? 'webgl' : 'webgpu';
      this.compatibilityReason = directFileLaunch ? 'direct file launch' : firefox ? 'Firefox compatibility' : '';
      try {
        await this.initRenderer(preferred);
        this.backend = preferred;
      } catch (error) {
        if (preferred !== 'webgpu') throw error;
        console.warn('TABOK WebGPU initialization failed; retrying with WebGL.', error);
        try { this.app.destroy(false, { children: true, texture: true }); } catch (_) {}
        await this.initRenderer('webgl');
        this.backend = 'webgl';
      }

      this.app.stage.eventMode = 'none';
      this.app.stage.scale.set(this.renderScale);
      await this.drawCachedBoard();
      this.drawHauntingPortal();
      this.drawAtmosphere();
      this.app.ticker.add(ticker => this.animate(ticker.deltaMS));
      document.documentElement.classList.add('webgl-enabled');
      document.documentElement.dataset.gpuBackend = this.backend;
      window.dispatchEvent(new CustomEvent('tabok-gpu-ready', { detail: { backend: this.backend } }));
      return this;
    }

    async initRenderer(preference) {
      this.app = new PIXI.Application();
      await this.app.init({
        canvas: this.canvas,
        width: Math.round(DESIGN.width * this.renderScale),
        height: Math.round(DESIGN.height * this.renderScale),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: false,
        preference,
        powerPreference: 'high-performance',
        resolution: 1,
        hello: false
      });

    }

    async drawCachedBoard() {
      const [purple, teal, grey, wall] = await Promise.all([
        loadImage(TEXTURES.P), loadImage(TEXTURES.T), loadImage(TEXTURES.G), loadImage(TEXTURES.wall)
      ]);
      const images = { P: purple, T: teal, G: grey };
      const canvas = document.createElement('canvas');
      canvas.width = DESIGN.width;
      canvas.height = DESIGN.height;
      const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      const hub = this.config.portal;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(901, 1005, 790, 924, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = ctx.createPattern(wall, 'repeat');
      ctx.fillRect(90, 45, 1620, 1870);
      const wallShade = ctx.createRadialGradient(901, 965, 280, 901, 1005, 930);
      wallShade.addColorStop(0, 'rgba(45,31,37,.24)');
      wallShade.addColorStop(.62, 'rgba(15,12,10,.48)');
      wallShade.addColorStop(1, 'rgba(2,2,2,.92)');
      ctx.fillStyle = wallShade;
      ctx.fillRect(60, 20, 1680, 1930);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(178,128,76,.62)';
      ctx.lineWidth = 19;
      ctx.beginPath(); ctx.ellipse(901, 1005, 765, 899, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(28,18,13,.94)';
      ctx.lineWidth = 11;
      ctx.beginPath(); ctx.ellipse(901, 1005, 742, 876, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([42, 16, 8, 16]);
      ctx.strokeStyle = 'rgba(211,157,89,.2)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(901, 1005, 724, 856, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      const ordered = [...this.config.cells].sort((a, b) => a.y - b.y || a.x - b.x);
      for (const cell of ordered) this.paintHex(ctx, cell, images);

      ctx.save();
      ctx.translate(hub.x, hub.y);
      ctx.fillStyle = '#09070b';
      ctx.beginPath(); ctx.arc(0, 0, 143, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(180,126,178,.5)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(0, 0, 125, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([4, 14]);
      ctx.strokeStyle = 'rgba(242,199,129,.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 111, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        ctx.save();
        ctx.rotate(angle); ctx.translate(0, -124); ctx.rotate(-angle);
        ctx.strokeStyle = 'rgba(235,173,225,.52)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 9); ctx.lineTo(-7, 0); ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      const light = ctx.createRadialGradient(hub.x, hub.y, 80, hub.x, hub.y, 790);
      light.addColorStop(0, 'rgba(239,111,215,.13)');
      light.addColorStop(.42, 'rgba(110,69,124,.045)');
      light.addColorStop(1, 'rgba(0,0,0,.22)');
      ctx.fillStyle = light;
      ctx.fillRect(70, 40, 1660, 1890);

      const texture = PIXI.Texture.from(canvas);
      texture.source.scaleMode = 'linear';
      this.boardSprite = new PIXI.Sprite(texture);
      this.app.stage.addChild(this.boardSprite);
      this.staticCanvas = canvas;
    }

    paintHex(ctx, cell, images) {
      const vertices = hexVertices(cell.x, cell.y);
      const playable = Boolean(images[cell.type]);
      ctx.save();
      tracePolygon(ctx, vertices);
      ctx.clip();

      if (playable) {
        const image = images[cell.type];
        const cropSize = 310;
        const maxCrop = image.width - cropSize;
        const sx = seeded(cell, 17) % Math.max(1, maxCrop);
        const sy = seeded(cell, 71) % Math.max(1, maxCrop);
        ctx.filter = 'saturate(1.14) contrast(1.08) brightness(1.08)';
        ctx.drawImage(image, sx, sy, cropSize, cropSize, cell.x - 51, cell.y - 45, 102, 90);
        ctx.filter = 'none';
        const bevel = ctx.createLinearGradient(cell.x - 42, cell.y - 38, cell.x + 42, cell.y + 38);
        bevel.addColorStop(0, 'rgba(255,236,196,.23)');
        bevel.addColorStop(.28, 'rgba(255,255,255,.025)');
        bevel.addColorStop(.72, 'rgba(12,8,7,.04)');
        bevel.addColorStop(1, 'rgba(0,0,0,.38)');
        ctx.fillStyle = bevel;
        ctx.fillRect(cell.x - 52, cell.y - 46, 104, 92);
        const motif = seeded(cell, 113) % 5;
        ctx.strokeStyle = 'rgba(245,221,175,.13)';
        ctx.lineWidth = 2;
        if (motif < 2) {
          ctx.beginPath(); ctx.arc(cell.x, cell.y, 15 + motif * 4, .25, Math.PI * 1.72); ctx.stroke();
        } else if (motif === 2) {
          ctx.beginPath();
          ctx.moveTo(cell.x - 21, cell.y + 15); ctx.lineTo(cell.x - 5, cell.y - 4);
          ctx.lineTo(cell.x + 8, cell.y + 2); ctx.lineTo(cell.x + 23, cell.y - 16); ctx.stroke();
        }
      } else if (cell.type === 'W') {
        const parchment = ctx.createLinearGradient(cell.x - 42, cell.y - 38, cell.x + 42, cell.y + 38);
        parchment.addColorStop(0, '#f2dca9'); parchment.addColorStop(.5, '#c5a875'); parchment.addColorStop(1, '#725636');
        ctx.fillStyle = parchment;
        ctx.fillRect(cell.x - 52, cell.y - 46, 104, 92);
      } else {
        ctx.fillStyle = seeded(cell) % 4 === 0 ? '#211a15' : '#17130f';
        ctx.fillRect(cell.x - 52, cell.y - 46, 104, 92);
        ctx.fillStyle = 'rgba(0,0,0,.2)';
        ctx.beginPath(); ctx.arc(cell.x + 10, cell.y - 9, 25, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      ctx.save();
      tracePolygon(ctx, vertices);
      ctx.strokeStyle = playable ? 'rgba(20,13,10,.96)' : cell.type === 'W' ? '#412d1c' : '#0b0907';
      ctx.lineWidth = playable ? 4 : 5;
      ctx.stroke();
      if (playable) {
        ctx.strokeStyle = 'rgba(255,226,173,.09)';
        ctx.lineWidth = 1.35;
        tracePolygon(ctx, hexVertices(cell.x, cell.y, 44.5, 38, 22));
        ctx.stroke();
      }
      ctx.restore();
    }

    drawHauntingPortal() {
      const root = new PIXI.Container();
      root.position.set(this.config.portal.x, this.config.portal.y);
      const auraCanvas = document.createElement('canvas');
      auraCanvas.width = auraCanvas.height = 320;
      const auraCtx = auraCanvas.getContext('2d');
      const auraGradient = auraCtx.createRadialGradient(160, 160, 14, 160, 160, 154);
      auraGradient.addColorStop(0, 'rgba(255,224,249,.48)');
      auraGradient.addColorStop(.18, 'rgba(204,64,191,.35)');
      auraGradient.addColorStop(.52, 'rgba(83,35,133,.18)');
      auraGradient.addColorStop(1, 'rgba(20,8,28,0)');
      auraCtx.fillStyle = auraGradient;
      auraCtx.fillRect(0, 0, 320, 320);
      const aura = new PIXI.Sprite(PIXI.Texture.from(auraCanvas));
      aura.anchor.set(.5);

      const abyss = new PIXI.Graphics()
        .ellipse(0, 0, 83, 71).fill({ color: 0x07050b, alpha: 1 })
        .ellipse(0, 0, 78, 66).stroke({ color: 0x5f326e, width: 8, alpha: .9 })
        .ellipse(0, 0, 61, 49).stroke({ color: 0xc552ad, width: 5, alpha: .72 });
      const outerSigils = new PIXI.Container();
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const sigil = new PIXI.Graphics().poly([0, -8, 6, 0, 0, 8, -6, 0]).stroke({ color: 0xf0b4df, width: 2, alpha: .56 });
        sigil.position.set(Math.cos(angle) * 100, Math.sin(angle) * 100);
        sigil.rotation = angle;
        outerSigils.addChild(sigil);
      }

      const clockwise = new PIXI.Container();
      const counter = new PIXI.Container();
      const specs = [
        [clockwise, 69, -2.72, -.24, 0xe35ebb, 9, .75],
        [clockwise, 50, .18, 2.5, 0xa16de1, 6, .76],
        [counter, 36, -1.85, .48, 0x86d6df, 5, .68],
        [counter, 57, 1.24, 3.3, 0xf2bd8b, 3, .52]
      ];
      for (const [host, radius, start, end, color, width, alpha] of specs) {
        host.addChild(new PIXI.Graphics().arc(0, 0, radius, start, end).stroke({ color, width, alpha }));
      }

      const eye = new PIXI.Container();
      const iris = new PIXI.Graphics()
        .ellipse(0, 0, 29, 18).fill({ color: 0x9b3e91, alpha: .92 })
        .ellipse(0, 0, 17, 15).fill({ color: 0x120817, alpha: 1 })
        .ellipse(-5, -5, 4, 3).fill({ color: 0xffe9f7, alpha: .9 });
      eye.addChild(iris);

      const orbiters = new PIXI.Container();
      const motes = [];
      for (let i = 0; i < 8; i++) {
        const mote = new PIXI.Graphics().circle(0, 0, i % 3 === 0 ? 2.8 : 1.7).fill({ color: i % 2 ? 0xffb7e4 : 0x9bdcf1, alpha: .8 });
        mote._angle = i * Math.PI / 4;
        mote._radius = 88 + (i % 3) * 9;
        orbiters.addChild(mote);
        motes.push(mote);
      }

      root.addChild(aura, outerSigils, abyss, clockwise, counter, eye, orbiters);
      this.portal = { root, aura, abyss, clockwise, counter, outerSigils, eye, iris, motes, time: 0 };
      this.app.stage.addChild(root);
    }

    drawAtmosphere() {
      const host = new PIXI.Container();
      this.motes = [];
      const texture = this.app.renderer.generateTexture(new PIXI.Graphics().circle(3, 3, 3).fill(0xffdfad));
      for (let i = 0; i < 14; i++) {
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(.5);
        sprite.position.set(245 + (i * 263 % 1310), 255 + (i * 397 % 1440));
        sprite.scale.set(i % 4 === 0 ? 1.05 : .62);
        sprite._baseY = sprite.y;
        sprite._phase = i * .47;
        host.addChild(sprite);
        this.motes.push(sprite);
      }
      this.app.stage.addChild(host);
    }

    animate(deltaMS) {
      if (document.documentElement.classList.contains('effects-paused')) return;
      const delta = Math.min(deltaMS, 34) / 1000;
      const portal = this.portal;
      portal.time += delta;
      portal.clockwise.rotation += delta * .29;
      portal.counter.rotation -= delta * .18;
      portal.outerSigils.rotation -= delta * .055;
      const breath = Math.sin(portal.time * 1.36);
      const pulse = 1 + breath * .035;
      portal.aura.scale.set(pulse);
      portal.aura.alpha = .78 + breath * .09;
      portal.eye.scale.y = .92 + Math.sin(portal.time * .74) * .08;
      portal.eye.x = Math.sin(portal.time * .47) * 3.5;
      portal.iris.rotation = Math.sin(portal.time * .38) * .12;
      portal.motes.forEach((mote, index) => {
        mote._angle += delta * (.16 + index % 3 * .035);
        mote.position.set(Math.cos(mote._angle) * mote._radius, Math.sin(mote._angle) * mote._radius * .82);
        mote.alpha = .34 + (Math.sin(portal.time * 1.4 + index) + 1) * .26;
      });
      this.motes.forEach(mote => {
        mote._phase += delta * .42;
        mote.y = mote._baseY + Math.sin(mote._phase) * 6;
        mote.alpha = .09 + (Math.sin(mote._phase * 1.7) + 1) * .055;
      });
    }

    setRenderScale(scale) {
      if (!this.app.renderer || Math.abs(scale - this.renderScale) < .01) return;
      this.renderScale = scale;
      this.app.renderer.resize(Math.round(DESIGN.width * scale), Math.round(DESIGN.height * scale));
      this.app.stage.scale.set(scale);
    }

    setQuality(quality) {
      if (!this.app.renderer || !this.motes || !this.portal) return;
      const mobile = matchMedia('(max-width: 700px)').matches;
      const scale = quality === 'full' ? (mobile ? .86 : 1) : quality === 'lite' ? (mobile ? .58 : .68) : this.preferredScale;
      this.setRenderScale(scale);
      this.motes.forEach((mote, index) => { mote.visible = quality !== 'lite' || index < 4; });
      this.portal.motes.forEach((mote, index) => { mote.visible = quality !== 'lite' || index < 4; });
    }

    destroy() {
      this.app.destroy(false, { children: true, texture: true });
    }
  }

  window.TabokGPUBoard = TabokGPUBoard;
})();
