import { DSP } from './dsp.js';

export class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.0; // No smoothing for raw data

        this.source = null;
        this.isRunning = false;

        this.dsp = new DSP(this.ctx.sampleRate);

        // Buffers
        this.timeData = new Float32Array(this.analyser.fftSize);
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    setFFTSize(size) {
        this.analyser.fftSize = size;
        this.timeData = new Float32Array(this.analyser.fftSize);
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        console.log(`FFT Size updated to ${size}, Bin Count: ${this.analyser.frequencyBinCount}`);
    }

    get sampleRate() {
        return this.ctx.sampleRate;
    }

    async startMic() {
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.source = this.ctx.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        this.isRunning = true;
    }

    stop() {
        if (this.source) {
            this.source.disconnect();
            // Stop tracks if it's a stream
            if (this.source.mediaStream) {
                this.source.mediaStream.getTracks().forEach(t => t.stop());
            }
            this.source = null;
        }
        this.isRunning = false;
    }

    async loadUrl(url) {
        try {
            this.stop();

            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            this.source = this.ctx.createBufferSource();
            this.source.buffer = audioBuffer;
            this.source.connect(this.analyser);
            this.source.connect(this.ctx.destination); // Connect to speakers too
            this.source.loop = true;
            this.source.start(0);

            this.isRunning = true;

            if (this.ctx.state === 'suspended') {
                await this.ctx.resume();
            }
        } catch (e) {
            console.error('Error loading audio:', e);
            alert('Failed to load audio URL');
        }
    }

    async startTestTone() {
        this.stop();
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(2000, this.ctx.currentTime + 2); // Sweep 200 -> 2000Hz

        // LFO for vibrato to make it interesting
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 5;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 10;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start();

        this.source = osc;
        this.source.connect(this.analyser);
        this.source.connect(this.ctx.destination);
        this.source.start();
        this.isRunning = true;

        // Stop after 5 seconds
        setTimeout(() => {
            if (this.source === osc) this.stop();
        }, 5000);
    }

    getAnalysisData() {
        this.analyser.getFloatTimeDomainData(this.timeData);
        this.analyser.getByteFrequencyData(this.freqData);

        const pitch = this.dsp.getPitch(this.timeData);
        const formants = this.dsp.getFormants(this.timeData);

        return {
            timeData: this.timeData,
            freqData: this.freqData,
            pitch: pitch,
            formants: formants,
            sampleRate: this.ctx.sampleRate
        };
    }
}
