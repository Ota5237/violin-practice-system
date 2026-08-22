class PitchDetector {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.buffer = null;
    this.isRunning = false;
    this.startToken = 0; // 呼び出しごとに増分し、古い start() 呼び出しを無効化する
  }

  // getUserMedia() の待ち時間中に stop() や別の start() が呼ばれると、
  // 古い呼び出しが後から解決してマイクを二重起動してしまう。
  // start()ごとにトークンを発行し、待っている間にトークンが変わっていたら
  // その呼び出しは中断されたとみなして何もしない。
  async start(onPitchDetected) {
    const token = ++this.startToken;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return;
    }

    if (token !== this.startToken) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    this.stream = stream;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    const source = this.audioContext.createMediaStreamSource(this.stream);
    source.connect(this.analyser);

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.isRunning = true;

    const detect = () => {
      if (!this.isRunning || token !== this.startToken) return;
      this.analyser.getFloatTimeDomainData(this.buffer);
      const freq = this.autoCorrelate(this.buffer, this.audioContext.sampleRate);
      if (freq > 0) onPitchDetected(freq);
      requestAnimationFrame(detect);
    };
    detect();
  }

  stop() {
    this.startToken++; // 進行中の start() があれば無効化する
    this.isRunning = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioContext) this.audioContext.close();
    this.stream = null;
    this.audioContext = null;
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