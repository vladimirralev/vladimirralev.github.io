export class Visualizer {
    constructor(audioEngine) {
        this.audioEngine = audioEngine;

        this.specCanvas = document.getElementById('spectrogram-canvas');
        this.specCtx = this.specCanvas.getContext('2d');



        this.trackCanvas = document.getElementById('tracker-canvas');
        this.trackCtx = this.trackCanvas.getContext('2d');

        this.isLogScale = true;

        // Offscreen canvas for scrolling spectrogram
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');

        this.backingCanvas = document.createElement('canvas');
        this.backingCtx = this.backingCanvas.getContext('2d');

        this.vowelMap = new VowelMap();

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const specRect = this.specCanvas.parentElement.getBoundingClientRect();
        this.specCanvas.width = specRect.width;
        this.specCanvas.height = specRect.height;



        const trackRect = this.trackCanvas.parentElement.getBoundingClientRect();
        this.trackCanvas.width = trackRect.width;
        this.trackCanvas.height = trackRect.height;

        this.tempCanvas.width = this.specCanvas.width;
        this.tempCanvas.height = this.specCanvas.height;

        this.backingCanvas.width = this.specCanvas.width;
        this.backingCanvas.height = this.specCanvas.height;

        if (this.vowelMap) this.vowelMap.resize();

        this.drawIdleState();
    }

    drawIdleState() {
        // Spectrogram Idle State
        const ctx = this.specCtx;
        const width = this.specCanvas.width;
        const height = this.specCanvas.height;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Draw grid
        for (let i = 0; i < width; i += 50) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, height);
            ctx.stroke();
        }
        for (let i = 0; i < height; i += 50) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(width, i);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Spectrogram Area - Ready', width / 2, height / 2);

        // Tracker Idle State
        const tCtx = this.trackCtx;
        const tWidth = this.trackCanvas.width;
        const tHeight = this.trackCanvas.height;

        tCtx.fillStyle = '#050505';
        tCtx.fillRect(0, 0, tWidth, tHeight);

        tCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        tCtx.lineWidth = 1;

        for (let i = 0; i < tHeight; i += 50) {
            tCtx.beginPath();
            tCtx.moveTo(0, i);
            tCtx.lineTo(tWidth, i);
            tCtx.stroke();
        }

        tCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        tCtx.font = '14px sans-serif';
        tCtx.textAlign = 'center';
        tCtx.fillText('Tracker', tWidth / 2, tHeight / 2);
    }

    setLogScale(isLog) {
        this.isLogScale = isLog;
    }

    draw(data) {
        console.log('Visualizer draw:', data.pitch, data.formants);
        this.lastPitch = data.pitch;
        this.lastFormants = data.formants;
        this.drawSpectrogram(data.freqData);
        this.drawTracker(data);
    }

    getInterpolatedValue(freqData, index) {
        const i = Math.floor(index);
        const frac = index - i;

        if (i < 0) return freqData[0];
        if (i >= freqData.length - 1) return freqData[freqData.length - 1];

        // Linear interpolation
        const v1 = freqData[i];
        const v2 = freqData[i + 1];
        return v1 + (v2 - v1) * frac;
    }

    drawSpectrogram(freqData) {
        const width = this.specCanvas.width;
        const height = this.specCanvas.height;

        // 1. Scroll Backing Canvas
        // Copy current backing state to temp
        this.tempCtx.clearRect(0, 0, width, height);
        this.tempCtx.drawImage(this.backingCanvas, 0, 0);

        // Draw shifted back to backing
        this.backingCtx.clearRect(0, 0, width, height);
        this.backingCtx.drawImage(this.tempCanvas, -1, 0);

        // 2. Draw new column at x = width - 1 on Backing Canvas
        const binCount = freqData.length;
        const imgData = this.backingCtx.createImageData(1, height);
        const pixels = imgData.data;

        const minBin = 3; // ~65Hz start for log scale
        const maxBin = binCount - 1;
        // Pre-calculate log constants
        const logMaxMin = Math.log(maxBin / minBin);

        for (let y = 0; y < height; y++) {
            const normalizedY = 1 - (y / height);
            let value;

            if (this.isLogScale) {
                // bin = minBin * (maxBin/minBin)^normalizedY
                // We use float index for interpolation
                const binIndex = minBin * Math.exp(normalizedY * logMaxMin);
                value = this.getInterpolatedValue(freqData, binIndex);
            } else {
                const binIndex = normalizedY * (binCount - 1);
                value = this.getInterpolatedValue(freqData, binIndex);
            }

            // Color map: Black -> Yellow -> Red
            let r, g, b;
            if (value < 128) {
                r = value * 2;
                g = value * 2;
                b = 0;
            } else {
                r = 255;
                g = 255 - (value - 128) * 2;
                b = 0;
            }

            const pixelIndex = (y * 4);
            pixels[pixelIndex] = r;
            pixels[pixelIndex + 1] = g;
            pixels[pixelIndex + 2] = b;
            pixels[pixelIndex + 3] = 255;
        }

        this.backingCtx.putImageData(imgData, width - 1, 0);

        // 3. Draw History Overlay Lines (Pitch and Formants) on Backing Canvas
        // Helper to draw a frequency band
        const drawBand = (freq, r, g, b, isHistory) => {
            const sr = this.audioEngine.sampleRate || this.audioEngine.ctx.sampleRate || 44100;
            const y = this.freqToY(freq, sr / 2, height);

            // Debug logging
            // console.log(`drawBand: freq=${freq}, y=${y}, h=${height}, w=${width}, isHistory=${isHistory}`);

            if (y < 0) return;

            const bandwidth = this.measureBandwidth(freqData, freq, sr);
            const halfHeight = (this.freqToY(freq - bandwidth / 2, sr / 2, height) - this.freqToY(freq + bandwidth / 2, sr / 2, height)) / 2;

            let h = Math.max(3, Math.abs(halfHeight * 2)); // Force min height 3px

            // Limit width/height to 3% of total canvas height (was 5%)
            const maxHeight = height * 0.03;
            if (h > maxHeight) h = maxHeight;

            if (isHistory) {
                // Draw trail on backing canvas (persistent)
                // Use solid low opacity for history to avoid expensive gradients on backing canvas
                this.backingCtx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
                this.backingCtx.fillRect(width - 4, y - h / 2, 4, h);
            } else {
                // Draw live line on main canvas (transient) with Gradient
                const gradient = this.specCtx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
                gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.0)`);   // Fade out completely at edges
                gradient.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.1)`);
                gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.7)`); // Center intensity
                gradient.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, 0.1)`);
                gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.0)`);

                this.specCtx.fillStyle = gradient;
                this.specCtx.fillRect(0, y - h / 2, width, h);
            }
        };

        // Draw Pitch History
        if (this.lastPitch) {
            drawBand(this.lastPitch, 0, 255, 0, true);
        }

        // Draw Formant History
        if (this.lastFormants) {
            const colors = [[255, 149, 0], [0, 255, 255], [255, 255, 0]]; // Orange, Cyan, Yellow
            this.lastFormants.forEach((f, i) => {
                const [r, g, b] = colors[i % colors.length];
                drawBand(f, r, g, b, true);
            });
        }

        // 4. Render Backing Canvas to Main Screen
        this.specCtx.clearRect(0, 0, width, height);
        this.specCtx.drawImage(this.backingCanvas, 0, 0);

        // 4b. Draw Frequency Grid (Ruler)
        const sr = this.audioEngine.sampleRate || 44100;
        const maxFreq = sr / 2;

        this.specCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        this.specCtx.font = '10px sans-serif';
        this.specCtx.textAlign = 'right';

        let gridFreqs = [];
        if (this.isLogScale) {
            gridFreqs = [100, 200, 500, 1000, 2000, 3000, 4000, 5000, 10000];
        } else {
            for (let f = 0; f < maxFreq; f += 2000) {
                if (f > 0) gridFreqs.push(f);
            }
        }

        this.specCtx.beginPath();
        this.specCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        this.specCtx.lineWidth = 1;

        gridFreqs.forEach(f => {
            if (f < maxFreq) {
                const y = this.freqToY(f, maxFreq, height);
                if (y >= 0 && y <= height) {
                    // Line
                    this.specCtx.moveTo(0, y);
                    this.specCtx.lineTo(width, y);

                    // Label
                    this.specCtx.fillText(`${f >= 1000 ? f / 1000 + 'k' : f}`, width - 5, y - 2);
                }
            }
        });
        this.specCtx.stroke();
        this.specCtx.textAlign = 'left'; // Reset

        // DEBUG: Log dimensions once
        if (Math.random() < 0.01) {
            console.log(`SpecCanvas: ${width}x${height}, SampleRate: ${this.audioEngine.sampleRate}`);
        }

        // 5. Draw Live Overlay Lines on Main Screen (Transient)

        // Draw Pitch Live
        if (this.lastPitch) {
            drawBand(this.lastPitch, 0, 255, 0, false);

            // DEBUG PANEL
            this.specCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            this.specCtx.font = '13px "SF Mono", "Fira Code", "Roboto Mono", monospace'; // Cooler font
            const sr = this.audioEngine.sampleRate || this.audioEngine.ctx.sampleRate || 44100;
            const y = this.freqToY(this.lastPitch, sr / 2, height);
            const bw = this.measureBandwidth(freqData, this.lastPitch, sr);

            // Move to bottom-left to avoid vowel map
            const debugY = height - 120;
            const debugX = 60;
            const lineHeight = 18;

            this.specCtx.fillText(`Pitch: ${Math.round(this.lastPitch)} Hz`, debugX, debugY);
            this.specCtx.fillText(`Y: ${y.toFixed(1)} px`, debugX, debugY + lineHeight);
            this.specCtx.fillText(`BW: ${bw.toFixed(1)} Hz`, debugX, debugY + lineHeight * 2);

            if (this.lastFormants && this.lastFormants.length >= 2) {
                this.specCtx.fillStyle = '#FF9500'; // Orange for F1
                this.specCtx.fillText(`F1: ${Math.round(this.lastFormants[0])} Hz`, debugX, debugY + lineHeight * 3);
                this.specCtx.fillStyle = '#00ffff'; // Cyan for F2
                this.specCtx.fillText(`F2: ${Math.round(this.lastFormants[1])} Hz`, debugX, debugY + lineHeight * 4);
                this.specCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // Reset
            }

            this.specCtx.fillText(`SR: ${sr} Hz`, debugX, debugY + lineHeight * 5);
            this.specCtx.fillText(`Algo: ${this.audioEngine.dsp.pitchAlgo.toUpperCase()}`, debugX, debugY + lineHeight * 6);

            if (isNaN(y)) {
                console.error('NaN Y detected:', {
                    pitch: this.lastPitch,
                    sampleRate: this.audioEngine.sampleRate,
                    height: height,
                    maxFreq: this.audioEngine.sampleRate / 2
                });
            }
        } else {
            this.specCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            this.specCtx.font = '14px monospace';
            this.specCtx.fillText(`No Pitch Detected`, 10, height - 100);
            this.specCtx.fillText(`Canvas: ${width}x${height}`, 10, height - 80);
        }

        // Draw Formant Live
        if (this.lastFormants) {
            const liveColors = [[255, 149, 0], [0, 255, 255], [255, 255, 0]];
            this.lastFormants.forEach((f, i) => {
                // console.log('Drawing Live Formant:', i, f);
                const [r, g, b] = liveColors[i % liveColors.length];
                drawBand(f, r, g, b, false);
            });
        }
    }

    measureBandwidth(freqData, centerFreq, sampleRate) {
        const binCount = freqData.length;
        const maxFreq = sampleRate / 2;
        const centerBin = Math.round(centerFreq / (maxFreq / binCount));

        if (centerBin < 0 || centerBin >= binCount) return 50; // Default fallback

        const peakVal = freqData[centerBin];
        const threshold = peakVal * 0.7; // -3dB approx

        let lowBin = centerBin;
        while (lowBin > 0 && freqData[lowBin] > threshold) {
            lowBin--;
        }

        let highBin = centerBin;
        while (highBin < binCount - 1 && freqData[highBin] > threshold) {
            highBin++;
        }

        const lowFreq = lowBin * (maxFreq / binCount);
        const highFreq = highBin * (maxFreq / binCount);

        let bw = highFreq - lowFreq;
        if (bw < 50) bw = 50; // Minimum visual width
        if (bw > 1000) bw = 1000; // Cap visual width
        return bw;
    }

    drawTracker(data) {
        const width = this.trackCanvas.width;
        const height = this.trackCanvas.height;
        const ctx = this.trackCtx;
        const binCount = data.freqData.length;

        // Initialize average buffer if needed
        if (!this.avgFreqData || this.avgFreqData.length !== binCount) {
            this.avgFreqData = new Float32Array(binCount);
        }

        // Update average (Exponential Moving Average)
        const alpha = 0.05; // Smoothing factor (lower = slower)
        for (let i = 0; i < binCount; i++) {
            this.avgFreqData[i] = this.avgFreqData[i] * (1 - alpha) + data.freqData[i] * alpha;
        }

        ctx.clearRect(0, 0, width, height);

        const minBin = 3; // ~65Hz start for log scale
        const maxBin = binCount - 1;
        const logMaxMin = Math.log(maxBin / minBin);

        // Helper to get Y for a bin index (inverse of drawSpectrogram mapping)
        // We iterate pixels Y and find value, which is easier for drawing bars/filled shapes

        // Draw Live Spectrum (Blue Bars)
        ctx.fillStyle = 'rgba(0, 122, 255, 0.6)'; // Blue with opacity

        for (let y = 0; y < height; y++) {
            const normalizedY = 1 - (y / height);
            let value;

            if (this.isLogScale) {
                const binIndex = minBin * Math.exp(normalizedY * logMaxMin);
                value = this.getInterpolatedValue(data.freqData, binIndex);
            } else {
                const binIndex = normalizedY * (binCount - 1);
                value = this.getInterpolatedValue(data.freqData, binIndex);
            }

            const normValue = value / 255;
            const barLength = normValue * width;
            ctx.fillRect(0, y, barLength, 1);
        }

        // Draw Averaged Spectrum (White Line)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;

        for (let y = 0; y < height; y++) {
            const normalizedY = 1 - (y / height);
            let value;

            if (this.isLogScale) {
                const binIndex = minBin * Math.exp(normalizedY * logMaxMin);
                value = this.getInterpolatedValue(this.avgFreqData, binIndex);
            } else {
                const binIndex = normalizedY * (binCount - 1);
                value = this.getInterpolatedValue(this.avgFreqData, binIndex);
            }

            const normValue = value / 255;
            const x = normValue * width;

            if (y === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw Pitch
        if (data.pitch) {
            const pitchY = this.freqToY(data.pitch, data.sampleRate / 2, height);
            if (pitchY >= 0) {
                ctx.beginPath();
                ctx.moveTo(0, pitchY);
                ctx.lineTo(width, pitchY);
                ctx.strokeStyle = '#00ff00'; // Green for Pitch
                ctx.lineWidth = 2;
                ctx.stroke();

                // Label
                ctx.fillStyle = '#00ff00';
                ctx.font = '10px sans-serif';
                ctx.fillText(`F0: ${Math.round(data.pitch)}Hz`, 5, pitchY - 2);
            }
        }

        // Draw Formants
        if (data.formants && data.formants.length > 0) {
            const colors = ['#FF9500', '#00ffff', '#ffff00']; // Orange, Cyan, Yellow
            data.formants.forEach((f, i) => {
                const y = this.freqToY(f, data.sampleRate / 2, height);
                if (y >= 0) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(width, y);
                    ctx.strokeStyle = colors[i % colors.length];
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]); // Dashed line for formants
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Label
                    ctx.fillStyle = colors[i % colors.length];
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'right';
                    ctx.fillText(`F${i + 1}: ${Math.round(f)}Hz`, width - 5, y - 2);
                    ctx.textAlign = 'left'; // Reset
                }
            });
        }

        // Update Vowel Map
        if (this.vowelMap) {
            const f1 = data.formants[0];
            const f2 = data.formants[1];
            if (f1 && f2) {
                this.vowelMap.draw(f1, f2);
            } else {
                this.vowelMap.drawIdle();
            }
        }
    }

    freqToY(freq, maxFreq, canvasHeight) {
        const height = canvasHeight || this.trackCanvas.height;
        if (freq <= 0 || freq > maxFreq) return -1;

        let normalizedY;
        if (this.isLogScale) {
            const binCount = this.audioEngine.analyser.frequencyBinCount;
            const minBin = 3; // ~65Hz start for log scale
            const maxBin = binCount - 1;

            const binIndex = freq / (maxFreq / binCount);

            if (binIndex < minBin) normalizedY = 0;
            else {
                // bin = minBin * (maxBin/minBin)^normalizedY
                // bin/minBin = (maxBin/minBin)^normalizedY
                // log(bin/minBin) = normalizedY * log(maxBin/minBin)
                // normalizedY = log(bin/minBin) / log(maxBin/minBin)
                normalizedY = Math.log(binIndex / minBin) / Math.log(maxBin / minBin);
            }
        } else {
            normalizedY = freq / maxFreq;
        }

        // y = height * (1 - normalizedY)
        return height * (1 - normalizedY);
    }
}

class VowelMap {
    constructor() {
        this.canvas = document.getElementById('vowel-map-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Standard Vowel Formants (approximate for average adult male)
        // F1 (Y axis), F2 (X axis)
        this.vowels = [
            { name: 'i', f1: 270, f2: 2290, color: '#FF4136' }, // Beet
            { name: 'u', f1: 300, f2: 870, color: '#0074D9' },  // Boot
            { name: 'a', f1: 730, f2: 1090, color: '#2ECC40' }, // Hot
            { name: 'æ', f1: 660, f2: 1720, color: '#FFDC00' }, // Bat
            { name: 'e', f1: 390, f2: 1990, color: '#FF851B' }, // Bet
            { name: 'o', f1: 570, f2: 840, color: '#B10DC9' },  // Caught
        ];

        // Chart Boundaries
        this.minF1 = 200; this.maxF1 = 1000;
        this.minF2 = 500; this.maxF2 = 2500;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        // 30% of parent
        this.canvas.width = rect.width * 0.3;
        this.canvas.height = rect.height * 0.3;
        this.drawBackground();
    }

    drawIdle() {
        this.drawBackground();
    }

    draw(f1, f2) {
        this.drawBackground();
        this.drawCrosshair(f1, f2);
    }

    drawBackground() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, width, height);

        // Draw Vowel Regions
        this.vowels.forEach(v => {
            const x = this.f2ToX(v.f2);
            const y = this.f1ToY(v.f1);

            // Gradient Area
            const radius = width * 0.15;
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `${v.color}66`); // 40% opacity
            gradient.addColorStop(1, `${v.color}00`); // 0% opacity

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Solid Dot
            ctx.fillStyle = v.color;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();

            // Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(v.name, x, y - 5);
        });

        // Axis Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('F1 (Open)', 5, height - 5);
        ctx.textAlign = 'right';
        ctx.fillText('F2 (Front)', width - 5, 10);
    }

    drawCrosshair(f1, f2) {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const ctx = this.ctx;

        const x = this.f2ToX(f2);
        const y = this.f1ToY(f1);

        // Clamp to canvas
        if (x < 0 || x > width || y < 0 || y > height) return;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        // Horizontal Line (F1)
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        // Vertical Line (F2)
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.setLineDash([]);

        // Intersection Dot
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // F1 maps to Y (Low F1 = Top, High F1 = Bottom) - Standard is inverted?
    // Actually standard IPA:
    // Y: Close (Low F1) -> Open (High F1). Usually plotted Top -> Bottom.
    // X: Front (High F2) -> Back (Low F2). Usually plotted Left -> Right.

    f1ToY(f1) {
        // Map minF1..maxF1 to 0..height
        const normalized = (f1 - this.minF1) / (this.maxF1 - this.minF1);
        return normalized * this.canvas.height;
    }

    f2ToX(f2) {
        // Map maxF2..minF2 to 0..width (Inverted X axis)
        const normalized = (f2 - this.minF2) / (this.maxF2 - this.minF2);
        // We want High F2 at 0 (Left), Low F2 at Width (Right)
        return (1 - normalized) * this.canvas.width;
    }
}
