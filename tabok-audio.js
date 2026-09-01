(function () {
  'use strict';

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const state = {
    context: null,
    master: null,
    effects: null,
    ambience: null,
    ambienceNodes: [],
    muted: localStorage.getItem('tabok-muted') === '1',
    ready: false
  };

  function context() {
    if (!AudioContextClass) return null;
    if (!state.context) {
      const ctx = state.context = new AudioContextClass({ latencyHint: 'interactive' });
      state.master = ctx.createGain();
      state.effects = ctx.createGain();
      state.ambience = ctx.createGain();
      state.master.gain.value = state.muted ? 0 : .58;
      state.effects.gain.value = .8;
      state.ambience.gain.value = .22;
      state.effects.connect(state.master);
      state.ambience.connect(state.master);
      state.master.connect(ctx.destination);
    }
    return state.context;
  }

  async function unlock() {
    const ctx = context();
    if (!ctx) return false;
    if (!state.ready) {
      state.ready = true;
      startAmbience();
      updateButton();
    }
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
    }
    return true;
  }

  function envelope(gain, now, peak, attack, hold, release) {
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(.0001, now);
    gain.exponentialRampToValueAtTime(Math.max(.001, peak), now + attack);
    gain.setValueAtTime(Math.max(.001, peak), now + attack + hold);
    gain.exponentialRampToValueAtTime(.0001, now + attack + hold + release);
  }

  function tone(frequency, duration = .2, options = {}) {
    const ctx = context();
    if (!ctx || state.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime + (options.delay || 0);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    if (options.to) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), now + duration);
    if (options.detune) oscillator.detune.value = options.detune;
    filter.type = options.filterType || 'lowpass';
    filter.frequency.value = options.filter || 3600;
    filter.Q.value = options.q || .7;
    envelope(gain.gain, now, options.volume || .14, options.attack || .008, options.hold || .02, Math.max(.03, duration));
    oscillator.connect(filter).connect(gain).connect(state.effects);
    oscillator.start(now);
    oscillator.stop(now + duration + .16);
  }

  function noise(duration = .22, options = {}) {
    const ctx = context();
    if (!ctx || state.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime + (options.delay || 0);
    const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = options.type || 'bandpass';
    filter.frequency.value = options.frequency || 900;
    filter.Q.value = options.q || 1.2;
    envelope(gain.gain, now, options.volume || .08, .006, .01, duration);
    source.connect(filter).connect(gain).connect(state.effects);
    source.start(now);
  }

  function chord(notes, options = {}) {
    notes.forEach((note, index) => tone(note, options.duration || .55, {
      type: options.type || 'sine', volume: (options.volume || .1) / Math.sqrt(notes.length),
      attack: options.attack || .025, filter: options.filter || 2500,
      delay: (options.delay || 0) + index * (options.stagger || .035), to: options.to && options.to[index]
    }));
  }

  function play(name) {
    if (!state.ready || state.muted) return;
    switch (name) {
      case 'dice':
        noise(.12, { frequency: 1600, volume: .055 });
        tone(210, .1, { type: 'triangle', to: 285, volume: .08 });
        tone(330, .08, { type: 'triangle', volume: .055, delay: .09 });
        break;
      case 'step':
        noise(.09, { frequency: 240 + Math.random() * 100, q: .7, volume: .045 });
        tone(72 + Math.random() * 10, .08, { type: 'sine', to: 48, volume: .05 });
        break;
      case 'take':
        chord([523.25, 659.25, 783.99], { duration: .26, volume: .11, stagger: .045, type: 'triangle' });
        break;
      case 'give':
        chord([440, 554.37], { duration: .3, volume: .09, stagger: .09, type: 'sine' });
        break;
      case 'steal':
        tone(330, .32, { type: 'sawtooth', to: 145, filter: 1300, volume: .09 });
        noise(.18, { frequency: 1250, volume: .045, delay: .04 });
        break;
      case 'resolve':
        chord([392, 587.33, 783.99], { duration: .42, volume: .12, stagger: .025 });
        break;
      case 'rune':
        chord([220, 329.63, 493.88, 739.99], { duration: .8, volume: .14, stagger: .07, type: 'triangle' });
        break;
      case 'portal':
        tone(95, 1.15, { type: 'sine', to: 520, volume: .16, attack: .12, filter: 1800 });
        chord([261.63, 392, 622.25], { duration: 1, volume: .12, delay: .18, stagger: .09 });
        break;
      case 'cross':
        chord([261.63, 329.63, 392, 523.25, 659.25], { duration: 1.1, volume: .18, stagger: .08, type: 'triangle' });
        break;
      case 'reject':
        chord([246.94, 207.65, 155.56], { duration: .65, volume: .15, stagger: .11, type: 'sawtooth', filter: 1100 });
        break;
      case 'monster':
        tone(67, .55, { type: 'sawtooth', to: 42, filter: 410, volume: .16 });
        noise(.35, { frequency: 190, q: .6, volume: .075 });
        break;
      case 'major':
        tone(43, 1.8, { type: 'sawtooth', to: 25, filter: 300, volume: .24, attack: .05 });
        tone(86, 1.35, { type: 'square', to: 39, filter: 240, volume: .1, delay: .15 });
        noise(1.3, { frequency: 120, q: .5, volume: .13 });
        break;
      case 'damage':
        noise(.32, { frequency: 520, q: .8, volume: .13 });
        tone(118, .34, { type: 'square', to: 52, filter: 700, volume: .15 });
        break;
      case 'shield':
        tone(740, .38, { type: 'triangle', to: 310, volume: .12, filter: 2600 });
        noise(.18, { frequency: 2400, volume: .06 });
        break;
      case 'death':
        chord([196, 164.81, 130.81, 98], { duration: .9, volume: .16, stagger: .15, type: 'sawtooth', filter: 720 });
        break;
      case 'omen':
        tone(580, .9, { type: 'sine', to: 210, volume: .055, attack: .18, filter: 1200 });
        break;
      default:
        tone(330, .18, { type: 'triangle', volume: .06 });
    }
  }

  function startAmbience() {
    const ctx = context();
    if (!ctx || state.ambienceNodes.length) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = .8;
    filter.connect(state.ambience);
    [43.65, 65.41].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index ? -7 : 4;
      gain.gain.value = index ? .06 : .045;
      oscillator.connect(gain).connect(filter);
      oscillator.start();
      state.ambienceNodes.push(oscillator, gain);
    });
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * .985 + white * .015;
      data[i] = last * .24;
    }
    const wind = ctx.createBufferSource();
    const windFilter = ctx.createBiquadFilter();
    const windGain = ctx.createGain();
    wind.buffer = buffer;
    wind.loop = true;
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 310;
    windFilter.Q.value = .45;
    windGain.gain.value = .12;
    wind.connect(windFilter).connect(windGain).connect(state.ambience);
    wind.start();
    state.ambienceNodes.push(wind, windFilter, windGain, filter);
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    localStorage.setItem('tabok-muted', state.muted ? '1' : '0');
    if (state.master && state.context) {
      state.master.gain.cancelScheduledValues(state.context.currentTime);
      state.master.gain.setTargetAtTime(state.muted ? 0 : .58, state.context.currentTime, .025);
    }
    updateButton();
  }

  function updateButton() {
    const button = document.getElementById('soundToggle');
    if (!button) return;
    const supported = Boolean(AudioContextClass);
    button.textContent = !supported ? 'Sound unavailable' : state.muted ? 'Sound off' : state.ready ? 'Sound on' : 'Enable sound';
    button.disabled = !supported;
    button.dataset.audioReady = String(state.ready);
    button.dataset.audioSupported = String(supported);
    button.setAttribute('aria-pressed', String(!state.muted));
    button.title = state.muted ? 'Unmute TABOK' : 'Mute TABOK';
  }

  function installControl() {
    if (document.getElementById('soundToggle')) return;
    const button = document.createElement('button');
    button.id = 'soundToggle';
    button.className = 'sound-toggle';
    button.type = 'button';
    button.addEventListener('click', async event => {
      event.stopPropagation();
      if (!state.ready) {
        await unlock();
        setMuted(false);
        play('resolve');
      } else setMuted(!state.muted);
    });
    document.querySelector('.top-status')?.before(button);
    updateButton();

    const overlay = document.getElementById('messageOverlay');
    if (overlay) {
      let previousScene = '';
      const observer = new MutationObserver(() => {
        if (overlay.classList.contains('hidden')) return;
        const scene = (document.getElementById('messageEyebrow')?.textContent || '') + ' ' +
          (document.getElementById('messageTitle')?.textContent || '');
        if (!scene.trim() || scene === previousScene) return;
        previousScene = scene;
        if (/Answer.or.Die|Last Breath/i.test(scene)) play('omen');
        else if (/reject/i.test(scene)) play('reject');
        else if (/Portal|Reckoning|Judgment/i.test(scene)) play('portal');
      });
      observer.observe(overlay, { attributes: true, childList: true, subtree: true, characterData: true });
    }
  }

  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installControl);
  else installControl();

  window.TabokAudio = { play, unlock, setMuted, get muted() { return state.muted; }, get ready() { return state.ready; } };
})();
