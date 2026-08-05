class PitchDetector {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.buffer = null;
    this.isRunning = false;
  }

  async start(onPitchDetected) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    const source = this.audioContext.createMediaStreamSource(this.stream);
    source.connect(this.analyser);

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.isRunning = true;

    const detect = () => {
      if (!this.isRunning) return;
      this.analyser.getFloatTimeDomainData(this.buffer);
      const freq = this.autoCorrelate(this.buffer, this.audioContext.sampleRate);
      if (freq > 0) onPitchDetected(freq);
      requestAnimationFrame(detect);
    };
    detect();
  }

  stop() {
    this.isRunning = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioContext) this.audioContext.close();
  }

  autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let r1 = 0, r2 = SIZE - 1;
    const threshold = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buffer[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
    }

    const buf2 = buffer.slice(r1, r2);
    const c = new Array(buf2.length).fill(0);
    for (let i = 0; i < buf2.length; i++) {
      for (let j = 0; j < buf2.length - i; j++) {
        c[i] += buf2[j] * buf2[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < buf2.length; i++) {
      if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }

    let T0 = maxpos;
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 -= b / (2 * a);

    return sampleRate / T0;
  }
}