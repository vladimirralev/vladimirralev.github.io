// Speech Analysis Tool - Main Application Logic
import { estimateFormants, detectVowel } from './algorithms.js';

class SpeechAnalyzer {
    constructor() {
        this.spectrogramCanvas = document.getElementById('spectrogramChart');
        this.spectrogramCtx = this.spectrogramCanvas.getContext('2d');
        this.vowelCanvas = document.getElementById('vowelChart');
        this.vowelCtx = this.vowelCanvas.getContext('2d');
        this.audioContext = null;
        this.sourceNode = null;
        this.analyser = null;
        this.isRunning = false;
        this.inputSource = 'mic';
        this.historySeconds = 10; // Keep 10 seconds of data
        this.dataHistory = [];
        this.formantHistory = [];
        this.vowelTrail = []; // Store recent F1/F2 points for fading trail
        this.lastFrameTime = 0;
        this.frameRate = 30; // Update at 30 fps
        
        // Chart dimensions (will be updated on resize)
        this.updateChartDimensions();
        
        // Formant display elements
        this.f1ValueElement = document.getElementById('f1Value');
        this.f2ValueElement = document.getElementById('f2Value');
        this.detectedVowelElement = document.getElementById('detectedVowel');
        
        // Bind UI elements
        this.inputSelect = document.getElementById('inputSelect');
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.micSelect = document.getElementById('micSelect');
        
        this.setupEventListeners();
        this.enumerateMicrophones();
        this.drawSpectrogramAxes();
        this.drawVowelChart();
    }
    
    updateChartDimensions() {
        // Update dimensions based on current canvas size
        this.spectrogramWidth = this.spectrogramCanvas.width;
        this.spectrogramHeight = this.spectrogramCanvas.height;
        this.vowelWidth = this.vowelCanvas.clientWidth;
        this.vowelHeight = this.vowelCanvas.clientHeight;
        // Set higher resolution for vowel chart to improve clarity
        this.vowelCanvas.width = this.vowelWidth * 2; // Double the internal resolution
        this.vowelCanvas.height = this.vowelHeight * 2;
        this.vowelCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        this.vowelCtx.scale(2, 2); // Scale context to match the display size
        this.freqBins = 2048; // Default frequency bins, updated later if needed
        // Ensure initial rendering matches resized rendering
        this.drawVowelChart();
    }
    
    setupEventListeners() {
        this.inputSelect.addEventListener('change', (e) => {
            this.inputSource = e.target.value;
        });
        
        this.startButton.addEventListener('click', () => this.start());
        this.stopButton.addEventListener('click', () => this.stop());
        
        // Handle window resize to update chart dimensions
        window.addEventListener('resize', () => {
            this.updateChartDimensions();
            this.drawSpectrogram();
            this.drawVowelChart();
        });
    }
    
    async enumerateMicrophones() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            this.micSelect.innerHTML = '';
            audioInputs.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${index + 1}`;
                this.micSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error enumerating microphones:', error);
        }
    }
    
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.dataHistory = []; // Reset history
        this.formantHistory = [];
        this.vowelTrail = [];
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096; // High resolution for better detail
            this.freqBins = this.analyser.frequencyBinCount;
            
            if (this.inputSource === 'mic') {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: this.micSelect.value }
                });
                this.sourceNode = this.audioContext.createMediaStreamSource(stream);
            } else if (this.inputSource === 'simulated') {
                // Generate simulated speech signal
                this.sourceNode = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                this.sourceNode.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                this.sourceNode.type = 'sine';
                this.sourceNode.frequency.value = 440;
                gainNode.gain.value = 0.1;
                this.sourceNode.start();
            } else {
                // Load test file
                const testIndex = parseInt(this.inputSource.replace('test', '')) - 1;
                const testFiles = ['test1.mp3', 'test2.mp3', 'test3.mp3', 'test4.mp3', 'test5.mp3'];
                const response = await fetch(`../${testFiles[testIndex]}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.sourceNode = this.audioContext.createBufferSource();
                this.sourceNode.buffer = audioBuffer;
                this.sourceNode.loop = true; // Enable looping for test files
                this.sourceNode.start();
            }
            
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            this.updateSpectrogram();
        } catch (error) {
            console.error('Error starting analysis:', error);
            this.isRunning = false;
        }
    }
    
    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        
        if (this.sourceNode) {
            // If using microphone, stop the stream tracks
            if (this.inputSource === 'mic' && this.sourceNode.mediaStream) {
                const tracks = this.sourceNode.mediaStream.getTracks();
                tracks.forEach(track => track.stop());
            }
            this.sourceNode.disconnect();
            if (this.sourceNode.stop) this.sourceNode.stop();
            this.sourceNode = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
    
    updateSpectrogram() {
        if (!this.isRunning) return;
        
        const now = performance.now();
        if (now - this.lastFrameTime < 1000 / this.frameRate) {
            requestAnimationFrame(() => this.updateSpectrogram());
            return;
        }
        this.lastFrameTime = now;
        
        const freqData = new Uint8Array(this.freqBins);
        this.analyser.getByteFrequencyData(freqData);
        
        this.dataHistory.push(freqData);
        const maxFrames = this.historySeconds * this.frameRate;
        if (this.dataHistory.length > maxFrames) {
            this.dataHistory.shift();
        }
        
        // Estimate formants for the last 100ms (approximately last 3 frames at 30fps)
        const formants = estimateFormants(freqData, this.audioContext.sampleRate);
        this.formantHistory.push(formants);
        if (this.formantHistory.length > 3) {
            this.formantHistory.shift();
        }
        
        // Update formant display and trail
        if (formants.f1 && formants.f2) {
            this.f1ValueElement.textContent = Math.round(formants.f1);
            this.f2ValueElement.textContent = Math.round(formants.f2);
            const vowel = detectVowel(formants.f1, formants.f2);
            this.detectedVowelElement.textContent = vowel || '-';
            this.vowelTrail.push({ f1: formants.f1, f2: formants.f2, timestamp: now });
            // Keep last 4 seconds of trail (at 30 fps)
            const trailDuration = 4000; // 4 seconds in milliseconds
            while (this.vowelTrail.length > 0 && now - this.vowelTrail[0].timestamp > trailDuration) {
                this.vowelTrail.shift();
            }
        } else {
            this.f1ValueElement.textContent = '0';
            this.f2ValueElement.textContent = '0';
            this.detectedVowelElement.textContent = '-';
        }
        
        this.drawSpectrogram();
        this.drawVowelChart();
        requestAnimationFrame(() => this.updateSpectrogram());
    }
    
    drawSpectrogram() {
        this.spectrogramCtx.clearRect(0, 0, this.spectrogramWidth, this.spectrogramHeight);
        
        const maxFreq = 3500; // Focus on 0-3500 Hz
        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * this.freqBins);
        const sliceWidth = this.spectrogramWidth / this.dataHistory.length;
        const binHeight = this.spectrogramHeight / maxBin;
        
        // Use image data for manual pixel calculation
        const imageData = this.spectrogramCtx.createImageData(this.spectrogramWidth, this.spectrogramHeight);
        for (let i = 0; i < this.dataHistory.length; i++) {
            const x = Math.floor(i * sliceWidth);
            const slice = this.dataHistory[i];
            
            for (let j = 0; j < maxBin; j++) {
                const y = Math.floor(this.spectrogramHeight - (j + 1) * binHeight);
                const value = slice[j];
                const rgb = this.getColorForValue(value);
                
                for (let dx = 0; dx < sliceWidth && x + dx < this.spectrogramWidth; dx++) {
                    for (let dy = 0; dy < binHeight && y + dy < this.spectrogramHeight; dy++) {
                        const pixelIndex = ((y + dy) * this.spectrogramWidth + (x + dx)) * 4;
                        imageData.data[pixelIndex] = rgb.r;
                        imageData.data[pixelIndex + 1] = rgb.g;
                        imageData.data[pixelIndex + 2] = rgb.b;
                        imageData.data[pixelIndex + 3] = 255;
                    }
                }
            }
        }
        this.spectrogramCtx.putImageData(imageData, 0, 0);
        
        // Draw formant lines (F1 and F2) on the spectrogram for the latest data
        if (this.formantHistory.length > 0) {
            const latestFormants = this.formantHistory[this.formantHistory.length - 1];
            if (latestFormants.f1 && latestFormants.f2) {
                const f1Y = this.spectrogramHeight - (latestFormants.f1 / maxFreq) * this.spectrogramHeight;
                const f2Y = this.spectrogramHeight - (latestFormants.f2 / maxFreq) * this.spectrogramHeight;
                
                this.spectrogramCtx.strokeStyle = 'rgba(0, 255, 255, 0.7)'; // Cyan for visibility
                this.spectrogramCtx.lineWidth = 2;
                
                // F1 line
                this.spectrogramCtx.beginPath();
                this.spectrogramCtx.moveTo(this.spectrogramWidth - sliceWidth, f1Y);
                this.spectrogramCtx.lineTo(this.spectrogramWidth, f1Y);
                this.spectrogramCtx.stroke();
                
                // F2 line
                this.spectrogramCtx.beginPath();
                this.spectrogramCtx.moveTo(this.spectrogramWidth - sliceWidth, f2Y);
                this.spectrogramCtx.lineTo(this.spectrogramWidth, f2Y);
                this.spectrogramCtx.stroke();
            }
        }
        
        // Draw axes last to ensure they are on top
        this.drawSpectrogramAxes();
    }
    
    getColorForValue(value) {
        if (value === 0) return { r: 0, g: 0, b: 0 };
        if (value < 85) return { r: value * 3, g: value * 3, b: 0 }; // Black to Yellow
        if (value < 170) return { r: 255, g: (value - 85) * 3, b: 0 }; // Yellow to Orange
        return { r: 255, g: (value - 170) * 1.5, b: 0 }; // Orange to Red
    }
    
    drawSpectrogramAxes() {
        this.spectrogramCtx.strokeStyle = 'rgba(170, 170, 170, 0.9)';
        this.spectrogramCtx.lineWidth = 1; // Thinner lines for axes
        this.spectrogramCtx.font = '10px Arial'; // Smaller font for labels
        this.spectrogramCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.spectrogramCtx.setLineDash([]);
        
        // Y-axis (Frequency)
        this.spectrogramCtx.beginPath();
        this.spectrogramCtx.moveTo(30, 0);
        this.spectrogramCtx.lineTo(30, this.spectrogramHeight);
        this.spectrogramCtx.stroke();
        const maxFreq = 3500;
        const freqStep = maxFreq / 7; // More divisions for clarity
        for (let i = 0; i <= 7; i++) {
            const y = this.spectrogramHeight - (i * (this.spectrogramHeight / 7));
            const freqLabel = Math.round(freqStep * i);
            this.spectrogramCtx.fillText(`${freqLabel} Hz`, 2, y + 4); // Adjusted position to prevent clipping
            this.spectrogramCtx.beginPath();
            this.spectrogramCtx.moveTo(25, y);
            this.spectrogramCtx.lineTo(35, y);
            this.spectrogramCtx.stroke();
        }
        
        // X-axis (Time)
        this.spectrogramCtx.beginPath();
        this.spectrogramCtx.moveTo(0, this.spectrogramHeight - 30);
        this.spectrogramCtx.lineTo(this.spectrogramWidth, this.spectrogramHeight - 30);
        this.spectrogramCtx.stroke();
        const timeStep = this.historySeconds / 5;
        for (let i = 0; i <= 5; i++) {
            const x = i * (this.spectrogramWidth / 5);
            const timeLabel = (timeStep * (5 - i)).toFixed(1); // Reverse the time labels
            // Adjusted position to prevent clipping at edges
            let labelX = x - 20;
            if (i === 0) labelX = x;
            else if (i === 5) labelX = x - 40;
            this.spectrogramCtx.fillText(`${timeLabel}s`, labelX, this.spectrogramHeight - 10);
            this.spectrogramCtx.beginPath();
            this.spectrogramCtx.moveTo(x, this.spectrogramHeight - 25);
            this.spectrogramCtx.lineTo(x, this.spectrogramHeight - 35);
            this.spectrogramCtx.stroke();
        }
    }
    
    drawVowelChart() {
        this.vowelCtx.clearRect(0, 0, this.vowelCanvas.width, this.vowelCanvas.height);
        this.drawVowelMap();
        
        // Draw fading trail for vowel movement (4 seconds of history)
        if (this.vowelTrail.length > 1) {
            const now = performance.now();
            const trailDuration = 4000; // 4 seconds
            for (let i = 0; i < this.vowelTrail.length - 1; i++) {
                const point1 = this.vowelTrail[i];
                const point2 = this.vowelTrail[i + 1];
                const x1 = this.vowelWidth - ((point1.f2 / 2500) * (this.vowelWidth - 40)) - 20;
                // Flip F1 axis: higher F1 values at bottom
                const y1 = this.vowelHeight - ((point1.f1 / 1000) * (this.vowelHeight - 40)) - 20;
                const x2 = this.vowelWidth - ((point2.f2 / 2500) * (this.vowelWidth - 40)) - 20;
                const y2 = this.vowelHeight - ((point2.f1 / 1000) * (this.vowelHeight - 40)) - 20;
                
                // Calculate opacity based on age of the point
                const age = now - point1.timestamp;
                const opacity = 1 - (age / trailDuration);
                
                this.vowelCtx.strokeStyle = `rgba(255, 100, 100, ${opacity * 0.6})`;
                this.vowelCtx.lineWidth = 2;
                this.vowelCtx.beginPath();
                this.vowelCtx.moveTo(x1, y1);
                this.vowelCtx.lineTo(x2, y2);
                this.vowelCtx.stroke();
                
                // Draw a small dot at each point with fading opacity
                this.vowelCtx.fillStyle = `rgba(255, 100, 100, ${opacity * 0.8})`;
                this.vowelCtx.beginPath();
                this.vowelCtx.arc(x1, y1, 3, 0, 2 * Math.PI);
                this.vowelCtx.fill();
            }
        }
        
        // Draw crosshair for current F1/F2 values
        if (this.formantHistory.length > 0) {
            const latestFormants = this.formantHistory[this.formantHistory.length - 1];
            if (latestFormants.f1 && latestFormants.f2) {
                const f1 = latestFormants.f1;
                const f2 = latestFormants.f2;
                const x = this.vowelWidth - ((f2 / 2500) * (this.vowelWidth - 40)) - 20;
                // Flip F1 axis: higher F1 values at bottom
                const y = this.vowelHeight - ((f1 / 1000) * (this.vowelHeight - 40)) - 20;
                
                this.vowelCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
                this.vowelCtx.lineWidth = 1;
                
                // Horizontal line
                this.vowelCtx.beginPath();
                this.vowelCtx.moveTo(0, y);
                this.vowelCtx.lineTo(this.vowelWidth, y);
                this.vowelCtx.stroke();
                
                // Vertical line
                this.vowelCtx.beginPath();
                this.vowelCtx.moveTo(x, 0);
                this.vowelCtx.lineTo(x, this.vowelHeight);
                this.vowelCtx.stroke();
                
                // Draw crosshair center
                this.vowelCtx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                this.vowelCtx.beginPath();
                this.vowelCtx.arc(x, y, 5, 0, 2 * Math.PI);
                this.vowelCtx.fill();
            }
        }
        
        // Draw axes last to ensure they are on top
        this.drawVowelAxes();
    }
    
    drawVowelAxes() {
        this.vowelCtx.strokeStyle = 'rgba(170, 170, 170, 0.5)';
        // Use even thinner lines
        const baseLineWidth = Math.max(0.3, Math.min(this.vowelWidth, this.vowelHeight) / 500);
        this.vowelCtx.lineWidth = baseLineWidth; // Even thinner line thickness for axes
        // Use even smaller font
        const baseFontSize = Math.max(5, Math.min(this.vowelWidth, this.vowelHeight) / 50);
        this.vowelCtx.font = `${baseFontSize}px Arial`; // Even smaller font size for labels
        this.vowelCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        this.vowelCtx.setLineDash([]);
        
        // F2 axis (X-axis, reversed: high F2 on left)
        this.vowelCtx.beginPath();
        this.vowelCtx.moveTo(20, this.vowelHeight - 20);
        this.vowelCtx.lineTo(this.vowelWidth - 20, this.vowelHeight - 20);
        this.vowelCtx.stroke();
        const f2Step = 2500 / 5;
        for (let i = 0; i <= 5; i++) {
            const x = this.vowelWidth - 20 - (i * ((this.vowelWidth - 40) / 5));
            const f2Label = Math.round(f2Step * i);
            // Adjust label position to prevent clipping at edges
            let labelX = x - (baseFontSize * 0.6);
            if (i === 0) labelX = x - (baseFontSize * 1.2);
            else if (i === 5) labelX = x - (baseFontSize * 0.3);
            this.vowelCtx.fillText(`${f2Label}`, labelX, this.vowelHeight - 5);
            this.vowelCtx.beginPath();
            this.vowelCtx.moveTo(x, this.vowelHeight - 15);
            this.vowelCtx.lineTo(x, this.vowelHeight - 25);
            this.vowelCtx.stroke();
        }
        // Position title far enough to avoid overlap, moved towards the edge
        this.vowelCtx.fillText('(F2, Hz)', this.vowelWidth - 280, this.vowelHeight - 2);
        
        // F1 axis (Y-axis, flipped: high F1 at bottom)
        this.vowelCtx.beginPath();
        this.vowelCtx.moveTo(this.vowelWidth - 60, 20);
        this.vowelCtx.lineTo(this.vowelWidth - 60, this.vowelHeight - 20);
        this.vowelCtx.stroke();
        const f1Step = 1000 / 5;
        for (let i = 0; i <= 5; i++) {
            // Flip the y position: higher F1 at bottom
            const y = this.vowelHeight - 20 - (i * ((this.vowelHeight - 40) / 5));
            const f1Label = Math.round(f1Step * i);
            // Adjust label position to prevent overlap and clipping
            this.vowelCtx.fillText(`${f1Label}`, this.vowelWidth - 55, y + (baseFontSize * 0.4));
            this.vowelCtx.beginPath();
            this.vowelCtx.moveTo(this.vowelWidth - 55, y);
            this.vowelCtx.lineTo(this.vowelWidth - 65, y);
            this.vowelCtx.stroke();
        }
        this.vowelCtx.save();
        this.vowelCtx.translate(this.vowelWidth - 50, this.vowelHeight / 2 + 40);
        this.vowelCtx.rotate(-Math.PI / 2);
        this.vowelCtx.fillText('(F1, Hz)', 0, 0);
        this.vowelCtx.restore();
    }
    
    drawVowelMap() {
        // Comprehensive IPA vowel chart positions in the F1/F2 space (approximate for a typical speaker)
        const vowels = [
            // Front Unrounded Vowels
            { ipa: 'i', f1: 270, f2: 2290, x: this.vowelWidth - ((2290 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((270 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'y', f1: 270, f2: 2100, x: this.vowelWidth - ((2100 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((270 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɪ', f1: 400, f2: 1990, x: this.vowelWidth - ((1990 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((400 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ʏ', f1: 400, f2: 1850, x: this.vowelWidth - ((1850 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((400 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'e', f1: 460, f2: 2200, x: this.vowelWidth - ((2200 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((460 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ø', f1: 460, f2: 1900, x: this.vowelWidth - ((1900 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((460 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɛ', f1: 660, f2: 1850, x: this.vowelWidth - ((1850 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((660 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'œ', f1: 660, f2: 1710, x: this.vowelWidth - ((1710 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((660 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'æ', f1: 800, f2: 1720, x: this.vowelWidth - ((1720 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((800 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'a', f1: 980, f2: 1550, x: this.vowelWidth - ((1550 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((980 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɶ', f1: 820, f2: 1530, x: this.vowelWidth - ((1530 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((820 / 1000) * (this.vowelHeight - 40)) - 20 },

            // Central Vowels
            { ipa: 'ɨ', f1: 320, f2: 1650, x: this.vowelWidth - ((1650 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((320 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ʉ', f1: 320, f2: 1500, x: this.vowelWidth - ((1500 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((320 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɘ', f1: 490, f2: 1600, x: this.vowelWidth - ((1600 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((490 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɵ', f1: 490, f2: 1450, x: this.vowelWidth - ((1450 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((490 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ə', f1: 550, f2: 1500, x: this.vowelWidth - ((1500 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((550 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɜ', f1: 690, f2: 1660, x: this.vowelWidth - ((1660 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((690 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɞ', f1: 690, f2: 1520, x: this.vowelWidth - ((1520 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((690 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɐ', f1: 760, f2: 1480, x: this.vowelWidth - ((1480 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((760 / 1000) * (this.vowelHeight - 40)) - 20 },

            // Back Unrounded Vowels
            { ipa: 'ɯ', f1: 300, f2: 1350, x: this.vowelWidth - ((1350 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((300 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɤ', f1: 440, f2: 1220, x: this.vowelWidth - ((1220 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((440 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ʌ', f1: 720, f2: 1240, x: this.vowelWidth - ((1240 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((720 / 1000) * (this.vowelHeight - 40)) - 20 },

            // Back Rounded Vowels
            { ipa: 'u', f1: 300, f2: 870, x: this.vowelWidth - ((870 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((300 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ʊ', f1: 430, f2: 1020, x: this.vowelWidth - ((1020 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((430 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'o', f1: 460, f2: 800, x: this.vowelWidth - ((800 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((460 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɔ', f1: 640, f2: 920, x: this.vowelWidth - ((920 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((640 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɑ', f1: 850, f2: 1220, x: this.vowelWidth - ((1220 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((850 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɒ', f1: 780, f2: 1000, x: this.vowelWidth - ((1000 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((780 / 1000) * (this.vowelHeight - 40)) - 20 },

            // Rhotacized Vowels
            { ipa: 'ɚ', f1: 480, f2: 1350, x: this.vowelWidth - ((1350 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((480 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɝ', f1: 500, f2: 1450, x: this.vowelWidth - ((1450 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((500 / 1000) * (this.vowelHeight - 40)) - 20 },

            // Nasalized Vowels (Estimates)
            { ipa: 'ĩ', f1: 300, f2: 2250, x: this.vowelWidth - ((2250 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((300 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɛ̃', f1: 680, f2: 1800, x: this.vowelWidth - ((1800 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((680 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ã', f1: 1000, f2: 1500, x: this.vowelWidth - ((1500 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((1000 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'ɔ̃', f1: 660, f2: 880, x: this.vowelWidth - ((880 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((660 / 1000) * (this.vowelHeight - 40)) - 20 },

            // Pharyngealized Vowels (Estimates)
            { ipa: 'iˤ', f1: 350, f2: 2100, x: this.vowelWidth - ((2100 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((350 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'aˤ', f1: 1050, f2: 1400, x: this.vowelWidth - ((1400 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((1050 / 1000) * (this.vowelHeight - 40)) - 20 },
            { ipa: 'uˤ', f1: 380, f2: 800, x: this.vowelWidth - ((800 / 2500) * (this.vowelWidth - 40)) - 20, y: this.vowelHeight - ((380 / 1000) * (this.vowelHeight - 40)) - 20 }
        ];
        
        // Draw vowel points, labels, and highlight ranges
        vowels.forEach(vowel => {
            // Draw highlight range (ellipse around vowel point)
            this.vowelCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            this.vowelCtx.lineWidth = 1;
            this.vowelCtx.beginPath();
            this.vowelCtx.ellipse(vowel.x, vowel.y, 35, 25, 0, 0, 2 * Math.PI);
            this.vowelCtx.stroke();
            
            // Draw vowel point
            this.vowelCtx.fillStyle = 'rgba(99, 99, 99, 0.6)';
            this.vowelCtx.beginPath();
            this.vowelCtx.arc(vowel.x, vowel.y, 3, 0, 2 * Math.PI);
            this.vowelCtx.fill();
            
            // Draw vowel label
            this.vowelCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.vowelCtx.beginPath();
            this.vowelCtx.font = '18px Arial'; // Smaller font for vowel labels
            this.vowelCtx.fillText(vowel.ipa, vowel.x + 5, vowel.y + 5);
        });
        
        // Draw approximate vowel trapezoid
        this.vowelCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.vowelCtx.lineWidth = 1;
        this.vowelCtx.beginPath();
        this.vowelCtx.moveTo(vowels[0].x, vowels[0].y); // i
        this.vowelCtx.lineTo(vowels[9].x, vowels[9].y); // a
        this.vowelCtx.lineTo(vowels[25].x, vowels[25].y); // ɔ
        this.vowelCtx.lineTo(vowels[22].x, vowels[22].y); // u
        this.vowelCtx.closePath();
        this.vowelCtx.stroke();
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new SpeechAnalyzer();
});
