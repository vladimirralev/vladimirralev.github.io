// Speech Analysis Tool - Main Application Logic
import { estimateFormants, detectVowel } from './algorithms.js';

class SpeechAnalyzer {
    constructor() {
        this.vowelCanvas = document.getElementById('vowelChart');
        this.vowelCtx = this.vowelCanvas.getContext('2d');
        this.spectrumCanvas = document.getElementById('spectrumChart');
        this.spectrumCtx = this.spectrumCanvas.getContext('2d');
        this.waveformCanvas = document.getElementById('waveformChart');
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.audioContext = null;
        this.sourceNode = null;
        this.analyser = null;
        this.isRunning = false;
        this.inputSource = 'mic';
        this.formantHistory = [];
        this.vowelTrail = []; // Store recent F1/F2 points for fading trail
        this.spectrumHistory = []; // Store spectrum data for last 5 seconds
        this.lastFrameTime = 0;
        this.frameRate = 30; // Update at 30 fps
        this.historySeconds = 5; // Keep 5 seconds of spectrum data
        this.recordedAudioBuffer = null;
        this.recordingStream = null;
        this.isRecording = false;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.waveformData = [];
        
        // Chart dimensions (will be updated on resize)
        this.updateChartDimensions();
        
        // Formant display elements
        this.f1ValueElement = document.getElementById('f1Value');
        this.f2ValueElement = document.getElementById('f2Value');
        this.detectedVowelElement = document.getElementById('detectedVowel');
        this.selectionStartElement = document.getElementById('selectionStart');
        this.selectionEndElement = document.getElementById('selectionEnd');
        
        // Bind UI elements
        this.inputSelect = document.getElementById('inputSelect');
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.micSelect = document.getElementById('micSelect');
        this.recordButton = document.getElementById('recordButton');
        this.stopRecordButton = document.getElementById('stopRecordButton');
        this.playSelectionButton = document.getElementById('playSelectionButton');
        
        this.setupEventListeners();
        this.enumerateMicrophones();
        this.drawVowelChart();
        this.drawSpectrumAxes();
        this.drawWaveformChart();
    }
    
    updateChartDimensions() {
        // Update dimensions based on current canvas size
        this.vowelWidth = this.vowelCanvas.clientWidth;
        this.vowelHeight = this.vowelCanvas.clientHeight;
        this.spectrumWidth = this.spectrumCanvas.clientWidth;
        this.spectrumHeight = this.spectrumCanvas.clientHeight;
        this.waveformWidth = this.waveformCanvas.clientWidth;
        this.waveformHeight = this.waveformCanvas.clientHeight;
        // Set higher resolution for charts to improve clarity
        this.vowelCanvas.width = this.vowelWidth * 2; // Double the internal resolution
        this.vowelCanvas.height = this.vowelHeight * 2;
        this.vowelCtx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        this.vowelCtx.scale(2, 2); // Scale context to match the display size
        this.spectrumCanvas.width = this.spectrumWidth * 2;
        this.spectrumCanvas.height = this.spectrumHeight * 2;
        this.spectrumCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.spectrumCtx.scale(2, 2);
        this.waveformCanvas.width = this.waveformWidth * 2;
        this.waveformCanvas.height = this.waveformHeight * 2;
        this.waveformCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.waveformCtx.scale(2, 2);
        this.freqBins = 2048; // Default frequency bins, updated later if needed
        // Ensure initial rendering matches resized rendering
        this.drawVowelChart();
        this.drawSpectrumAxes();
        this.drawWaveformChart();
    }
    
    setupEventListeners() {
        this.inputSelect.addEventListener('change', (e) => {
            this.inputSource = e.target.value;
        });
        
        this.startButton.addEventListener('click', () => this.start());
        this.stopButton.addEventListener('click', () => this.stop());
        this.recordButton.addEventListener('click', () => this.startRecording());
        this.stopRecordButton.addEventListener('click', () => this.stopRecording());
        this.playSelectionButton.addEventListener('click', () => this.playSelection());
        
        // Handle waveform selection
        this.waveformCanvas.addEventListener('mousedown', (e) => this.startSelection(e));
        this.waveformCanvas.addEventListener('mousemove', (e) => this.updateSelection(e));
        this.waveformCanvas.addEventListener('mouseup', (e) => this.endSelection(e));
        
        // Handle window resize to update chart dimensions
        window.addEventListener('resize', () => {
            this.updateChartDimensions();
            this.drawVowelChart();
            this.drawSpectrum();
            this.drawWaveformChart();
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
        this.formantHistory = [];
        this.vowelTrail = [];
        this.spectrumHistory = [];
        
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
                const testFiles = ['test1.mp3', 'test2.mp3', 'test3.mp3', 'test4.mp3', 'test5.mp3', 'test6.mp3', 'test7.mp3'];
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
            this.updateCharts();
        } catch (error) {
            console.error('Error starting analysis:', error);
            this.isRunning = false;
        }
    }
    
    async startRecording() {
        if (this.isRecording) return;
        this.isRecording = true;
        this.recordedAudioBuffer = null;
        this.waveformData = [];
        this.recordedChunks = [];
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: this.micSelect.value }
            });
            this.recordingStream = stream;
            const mediaRecorder = new MediaRecorder(stream);
            
            // Initialize audio context for real-time analysis
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096;
            this.freqBins = this.analyser.frequencyBinCount;
            this.sourceNode = this.audioContext.createMediaStreamSource(stream);
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            this.isRunning = true;
            this.formantHistory = [];
            this.vowelTrail = [];
            this.spectrumHistory = [];
            this.updateCharts();
            
            // Handle recording data for waveform visualization
            mediaRecorder.ondataavailable = async (e) => {
                this.recordedChunks.push(e.data);
                // Process for real-time waveform update
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.recordedAudioBuffer = audioBuffer;
                this.updateWaveformData();
                this.drawWaveformChart();
            };
            
            mediaRecorder.onstop = async () => {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                this.recordedAudioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.updateWaveformData();
                this.drawWaveformChart();
                stream.getTracks().forEach(track => track.stop());
                this.isRecording = false;
                this.stopRecordButton.disabled = true;
                this.recordButton.disabled = false;
            };
            
            mediaRecorder.start(100); // Capture data every 100ms for real-time updates
            this.stopRecordButton.disabled = false;
            this.recordButton.disabled = true;
        } catch (error) {
            console.error('Error starting recording:', error);
            this.isRecording = false;
            this.isRunning = false;
        }
    }
    
    stopRecording() {
        if (!this.isRecording) return;
        this.recordingStream.getTracks().forEach(track => track.stop());
        this.stopRecordButton.disabled = true;
        this.recordButton.disabled = false;
        // The onstop event will handle the rest
        // Stop real-time analysis
        this.stop();
    }
    
    updateWaveformData() {
        if (!this.recordedAudioBuffer) return;
        const channelData = this.recordedAudioBuffer.getChannelData(0);
        const step = Math.floor(channelData.length / (this.waveformWidth * 2));
        this.waveformData = [];
        for (let i = 0; i < this.waveformWidth * 2; i++) {
            let maxVal = 0;
            for (let j = 0; j < step; j++) {
                const index = i * step + j;
                if (index < channelData.length) {
                    const val = Math.abs(channelData[index]);
                    if (val > maxVal) maxVal = val;
                }
            }
            this.waveformData.push(maxVal);
        }
    }
    
    drawWaveformChart() {
        this.waveformCtx.clearRect(0, 0, this.waveformWidth * 2, this.waveformHeight * 2);
        this.drawWaveformAxes();
        
        if (this.waveformData.length > 0) {
            const widthPerSample = (this.waveformWidth * 2) / this.waveformData.length;
            const maxAmplitude = Math.max(...this.waveformData);
            const heightScale = maxAmplitude > 0 ? ((this.waveformHeight * 2) * 0.8) / maxAmplitude : 1;
            
            // Draw waveform with gradient
            for (let i = 0; i < this.waveformData.length; i++) {
                const height = this.waveformData[i] * heightScale;
                const x = i * widthPerSample;
                const yUp = ((this.waveformHeight * 2) / 2) - (height / 2);
                const yDown = ((this.waveformHeight * 2) / 2) + (height / 2);
                
                // Create gradient for each segment
                const gradient = this.waveformCtx.createLinearGradient(x, yUp, x, yDown);
                gradient.addColorStop(0, 'rgba(100, 100, 255, 0.8)');
                gradient.addColorStop(0.5, 'rgba(150, 100, 255, 0.9)');
                gradient.addColorStop(1, 'rgba(200, 100, 255, 0.8)');
                
                this.waveformCtx.fillStyle = gradient;
                this.waveformCtx.fillRect(x, yUp, widthPerSample, height);
            }
            
            // Draw selection
            if (this.selectionStart !== this.selectionEnd) {
                const startX = Math.min(this.selectionStart, this.selectionEnd) * (this.waveformWidth);
                const endX = Math.max(this.selectionStart, this.selectionEnd) * (this.waveformWidth);
                this.waveformCtx.fillStyle = 'rgba(255, 255, 0, 0.3)';
                this.waveformCtx.fillRect(startX, 0, endX - startX, this.waveformHeight * 2);
                
                // Draw selection markers
                this.waveformCtx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
                this.waveformCtx.lineWidth = 2;
                this.waveformCtx.beginPath();
                this.waveformCtx.moveTo(startX, 0);
                this.waveformCtx.lineTo(startX, this.waveformHeight * 2);
                this.waveformCtx.moveTo(endX, 0);
                this.waveformCtx.lineTo(endX, this.waveformHeight * 2);
                this.waveformCtx.stroke();
            }
        }
    }
    
    drawWaveformAxes() {
        this.waveformCtx.strokeStyle = 'rgba(170, 170, 170, 0.9)';
        this.waveformCtx.lineWidth = 1;
        this.waveformCtx.font = '10px Arial';
        this.waveformCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.waveformCtx.setLineDash([]);
        
        // X-axis (Time)
        this.waveformCtx.beginPath();
        this.waveformCtx.moveTo(0, (this.waveformHeight * 2) / 2);
        this.waveformCtx.lineTo(this.waveformWidth * 2, (this.waveformHeight * 2) / 2);
        this.waveformCtx.stroke();
        
        if (this.recordedAudioBuffer) {
            const duration = this.recordedAudioBuffer.duration;
            const timeStep = duration / 5;
            for (let i = 0; i <= 5; i++) {
                const x = i * ((this.waveformWidth * 2) / 5);
                const timeLabel = (timeStep * i).toFixed(1);
                this.waveformCtx.fillText(`${timeLabel}s`, x - 10, (this.waveformHeight * 2) / 2 + 15);
                this.waveformCtx.beginPath();
                this.waveformCtx.moveTo(x, (this.waveformHeight * 2) / 2 - 5);
                this.waveformCtx.lineTo(x, (this.waveformHeight * 2) / 2 + 5);
                this.waveformCtx.stroke();
            }
        } else {
            for (let i = 0; i <= 5; i++) {
                const x = i * ((this.waveformWidth * 2) / 5);
                const timeLabel = "0.0";
                this.waveformCtx.fillText(`${timeLabel}s`, x - 10, (this.waveformHeight * 2) / 2 + 15);
                this.waveformCtx.beginPath();
                this.waveformCtx.moveTo(x, (this.waveformHeight * 2) / 2 - 5);
                this.waveformCtx.lineTo(x, (this.waveformHeight * 2) / 2 + 5);
                this.waveformCtx.stroke();
            }
        }
    }
    
    startSelection(e) {
        if (!this.recordedAudioBuffer) return;
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        this.selectionStart = Math.max(0, Math.min(1, x / this.waveformWidth));
        this.selectionEnd = this.selectionStart;
        this.isSelecting = true;
        this.updateSelectionDisplay();
        this.drawWaveformChart();
    }
    
    updateSelection(e) {
        if (!this.recordedAudioBuffer || !this.isSelecting) return;
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        this.selectionEnd = Math.max(0, Math.min(1, x / this.waveformWidth));
        this.updateSelectionDisplay();
        this.drawWaveformChart();
    }
    
    endSelection(e) {
        if (!this.recordedAudioBuffer || !this.isSelecting) return;
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        this.selectionEnd = Math.max(0, Math.min(1, x / this.waveformWidth));
        this.isSelecting = false;
        if (this.selectionStart > this.selectionEnd) {
            [this.selectionStart, this.selectionEnd] = [this.selectionEnd, this.selectionStart];
        }
        this.updateSelectionDisplay();
        this.drawWaveformChart();
    }
    
    updateSelectionDisplay() {
        if (!this.recordedAudioBuffer) {
            this.selectionStartElement.textContent = "0.0";
            this.selectionEndElement.textContent = "0.0";
            return;
        }
        const duration = this.recordedAudioBuffer.duration;
        const startTime = this.selectionStart * duration;
        const endTime = this.selectionEnd * duration;
        this.selectionStartElement.textContent = startTime.toFixed(1);
        this.selectionEndElement.textContent = endTime.toFixed(1);
    }
    
    async playSelection() {
        if (!this.recordedAudioBuffer || this.selectionStart === this.selectionEnd) return;
        this.stop();
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096;
            this.freqBins = this.analyser.frequencyBinCount;
            
            const duration = this.recordedAudioBuffer.duration;
            const startTime = this.selectionStart * duration;
            const endTime = this.selectionEnd * duration;
            const selectionDuration = endTime - startTime;
            
            this.sourceNode = this.audioContext.createBufferSource();
            this.sourceNode.buffer = this.recordedAudioBuffer;
            this.sourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            this.sourceNode.start(0, startTime, selectionDuration);
            this.isRunning = true;
            this.formantHistory = [];
            this.vowelTrail = [];
            this.spectrumHistory = [];
            this.updateCharts();
            
            setTimeout(() => {
                this.stop();
            }, selectionDuration * 1000);
        } catch (error) {
            console.error('Error playing selection:', error);
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
    
    updateCharts() {
        if (!this.isRunning) return;
        
        const now = performance.now();
        if (now - this.lastFrameTime < 1000 / this.frameRate) {
            requestAnimationFrame(() => this.updateCharts());
            return;
        }
        this.lastFrameTime = now;
        
        const freqData = new Uint8Array(this.freqBins);
        this.analyser.getByteFrequencyData(freqData);
        
        // Store spectrum data for history
        this.spectrumHistory.push(freqData.slice());
        const maxFrames = this.historySeconds * this.frameRate;
        if (this.spectrumHistory.length > maxFrames) {
            this.spectrumHistory.shift();
        }
        
        // Estimate formants for the last 100ms (approximately last 3 frames at 30fps)
        const formants = estimateFormants(freqData, this.audioContext.sampleRate);
        this.formantHistory.push(formants);
        if (this.formantHistory.length > 3) {
            this.formantHistory.shift();
        }
        
        // Detect pitch
        const pitch = this.detectPitch(freqData, this.audioContext.sampleRate);
        this.pitchHistory = this.pitchHistory || [];
        this.pitchHistory.push(pitch);
        if (this.pitchHistory.length > 3) {
            this.pitchHistory.shift();
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
        
        this.drawVowelChart();
        this.drawSpectrum();
        requestAnimationFrame(() => this.updateCharts());
    }
    
    detectPitch(freqData, sampleRate) {
        // Use Harmonic Product Spectrum (HPS) for more accurate pitch detection
        const binSize = sampleRate / (2 * freqData.length);
        const hpsLength = Math.floor(freqData.length / 3); // Limit to first third for efficiency
        const hps = new Array(hpsLength).fill(1);
        
        // Compute HPS by multiplying downsampled spectra
        for (let harmonic = 1; harmonic <= 3; harmonic++) {
            for (let i = 0; i < hpsLength; i++) {
                const index = Math.floor(i * harmonic);
                if (index < freqData.length) {
                    hps[i] *= freqData[index];
                }
            }
        }
        
        // Find the peak in HPS
        let maxAmplitude = 0;
        let pitchBin = 0;
        for (let i = 0; i < hpsLength; i++) {
            if (hps[i] > maxAmplitude) {
                maxAmplitude = hps[i];
                pitchBin = i;
            }
        }
        
        // Refine the pitch by checking nearby bins for a stronger fundamental
        if (pitchBin > 0 && pitchBin < hpsLength - 1) {
            const center = hps[pitchBin];
            const left = hps[pitchBin - 1];
            const right = hps[pitchBin + 1];
            if (left > center && left > right) {
                pitchBin--;
            } else if (right > center && right > left) {
                pitchBin++;
            }
        }
        
        // Return the detected pitch frequency
        let pitch = pitchBin * binSize;
        
        // Apply a threshold to filter out noise
        if (maxAmplitude < 0) {
            pitch = 0; // Consider it noise if amplitude is too low
        }
        
        return pitch;
    }
    
    
    drawSpectrum() {
        this.spectrumCtx.clearRect(0, 0, this.spectrumWidth * 2, this.spectrumHeight * 2 - 200);
        
        const maxFreq = 3500; // Focus on 0-3500 Hz
        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * this.freqBins);
        const voiceprintWidth = (this.spectrumWidth * 2) - 400; // Reserve 400 pixels (200px wide at 2x resolution) for two sidebars
        const sliceWidth = voiceprintWidth / (this.historySeconds * this.frameRate);
        const binHeight = (this.spectrumHeight * 2) / maxBin;
        
        // Use image data for manual pixel calculation for voiceprint spectrum
        const imageData = this.spectrumCtx.createImageData(voiceprintWidth, this.spectrumHeight * 2);
        for (let i = 0; i < this.spectrumHistory.length; i++) {
            const x = Math.floor(i * sliceWidth);
            const slice = this.spectrumHistory[i];
            
            for (let j = 0; j < maxBin; j++) {
                const y = Math.floor((this.spectrumHeight * 2) - (j + 1) * binHeight);
                const value = slice[j];
                const rgb = this.getColorForPower(value);
                
                for (let dx = 0; dx < sliceWidth && x + dx < voiceprintWidth; dx++) {
                    for (let dy = 0; dy < binHeight && y + dy < this.spectrumHeight * 2; dy++) {
                        const pixelIndex = ((y + dy) * voiceprintWidth + (x + dx)) * 4;
                        imageData.data[pixelIndex] = rgb.r;
                        imageData.data[pixelIndex + 1] = rgb.g;
                        imageData.data[pixelIndex + 2] = rgb.b;
                        imageData.data[pixelIndex + 3] = 255;
                    }
                }
            }
        }
        this.spectrumCtx.putImageData(imageData, 0, 0);
        
        // Draw formant lines (F1 and F2) on the voiceprint spectrum for the latest data
        let latestFormants = { f1: 0, f2: 0 }; // Default empty object if no formants
        if (this.formantHistory.length > 0) {
            latestFormants = this.formantHistory[this.formantHistory.length - 1];
            if (latestFormants.f1 && latestFormants.f2) {
                const f1Y = (this.spectrumHeight * 2) - (latestFormants.f1 / maxFreq) * (this.spectrumHeight * 2);
                const f2Y = (this.spectrumHeight * 2) - (latestFormants.f2 / maxFreq) * (this.spectrumHeight * 2);
                
                this.spectrumCtx.strokeStyle = 'rgba(0, 255, 255, 0.7)'; // Cyan for visibility
                this.spectrumCtx.lineWidth = 2;
                this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                this.spectrumCtx.font = '10px Arial';
                
                // F1 line
                this.spectrumCtx.beginPath();
                this.spectrumCtx.moveTo(voiceprintWidth - sliceWidth, f1Y);
                this.spectrumCtx.lineTo(voiceprintWidth, f1Y);
                this.spectrumCtx.stroke();
                this.spectrumCtx.fillText(`${Math.round(latestFormants.f1)} Hz`, voiceprintWidth - 60, f1Y - 5);
                
                // F2 line
                this.spectrumCtx.beginPath();
                this.spectrumCtx.moveTo(voiceprintWidth - sliceWidth, f2Y);
                this.spectrumCtx.lineTo(voiceprintWidth, f2Y);
                this.spectrumCtx.stroke();
                this.spectrumCtx.fillText(`${Math.round(latestFormants.f2)} Hz`, voiceprintWidth - 60, f2Y - 5);
            }
        }
        
        // Draw live spectral analysis sidebar on the right (left part of the sidebar)
        this.drawLiveSpectrumSidebar(voiceprintWidth, maxFreq, maxBin, binHeight, latestFormants);
        
        // Draw musical note scale sidebar on the right (right part of the sidebar)
        this.drawPitchSidebar(voiceprintWidth + 200, maxFreq);
        
        // Draw axes last to ensure they are on top
        this.drawSpectrumAxes();
    }
    
    drawLiveSpectrumSidebar(voiceprintWidth, maxFreq, maxBin, binHeight, latestFormants) {
        const sidebarWidth = 100; // Each sidebar part is 100px at 2x resolution
        const sidebarStartX = this.spectrumWidth - sidebarWidth -100;
        
        // Clear the area for the spectral analysis
        this.spectrumCtx.clearRect(sidebarStartX, 0, sidebarWidth, this.spectrumHeight);
        
        // Draw background for spectral analysis sidebar
        this.spectrumCtx.fillStyle = 'rgba(3, 3, 3, 1.0)';
        this.spectrumCtx.fillRect(sidebarStartX, 0, sidebarWidth, this.spectrumHeight);
        
        // Draw border for sidebar
        this.spectrumCtx.strokeStyle = 'rgba(255, 255, 0, 0.6)'; // Bright yellow for visibility
        this.spectrumCtx.lineWidth = 1; // Thicker line to ensure visibility
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(sidebarStartX, 0);
        this.spectrumCtx.lineTo(sidebarStartX, this.spectrumHeight);
        this.spectrumCtx.stroke();
        
        // Render the sidebar to match the latest vertical line from the voiceprint pixel by pixel
        if (this.spectrumHistory.length > 0) {
            const latestSpectrum = this.spectrumHistory[this.spectrumHistory.length - 1];
            const barWidth = sidebarWidth * 0.9; // Width of each bar extending to the right
            const adjustedBinHeight = (this.spectrumHeight) / maxBin; // Adjust bin height to display resolution
            
            // Calculate total power for normalization
            let totalPower = 0;
            for (let j = 0; j < maxBin; j++) {
                totalPower += latestSpectrum[j];
            }
            totalPower = Math.max(totalPower, 1); // Avoid division by zero
            
            // Loop through the frequency bins to match the voiceprint's vertical line
            for (let j = 0; j < maxBin; j++) {
                // Calculate y position to match voiceprint using display resolution
                const y = Math.floor((this.spectrumHeight) - (j + 1) * adjustedBinHeight); // Scale back to canvas resolution
                const rawValue = latestSpectrum[j];
                // Normalize power as proportion of total power
                const normalizedValue = rawValue / totalPower;
                // Apply logarithmic scaling to emphasize peaks (adding 1 to avoid log(0))
                const logValue = Math.log(1 + normalizedValue * 100) / Math.log(14) * 255;
                const value = Math.min(Math.max(logValue, 0), 255); // Clamp to valid range
                const rgb = this.getColorForPower(value);
                const powerWidth = (value / 255) * barWidth; // Scale width based on log value
                
                // Draw horizontal line for power matching the voiceprint pixel by pixel
                this.spectrumCtx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                this.spectrumCtx.fillRect(sidebarStartX + 2, y, powerWidth, adjustedBinHeight);
            }
            
            // Draw F1 and F2 tracking lines on the sidebar aligned with voiceprint frequency axis
            if (latestFormants.f1 && latestFormants.f2) {
                const f1Y = (this.spectrumHeight) - (latestFormants.f1 / maxFreq) * (this.spectrumHeight);
                const f2Y = (this.spectrumHeight) - (latestFormants.f2 / maxFreq) * (this.spectrumHeight);
                
                this.spectrumCtx.strokeStyle = 'rgba(0, 255, 255, 0.7)'; // Cyan for visibility
                this.spectrumCtx.lineWidth = 2; // Thicker line for visibility
                this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                this.spectrumCtx.font = '12px Arial'; // Font for visibility
                
                // F1 line
                this.spectrumCtx.beginPath();
                this.spectrumCtx.moveTo(sidebarStartX, f1Y);
                this.spectrumCtx.lineTo(sidebarStartX + barWidth, f1Y);
                this.spectrumCtx.stroke();
                this.spectrumCtx.fillText(`${Math.round(latestFormants.f1)} Hz`, sidebarStartX + barWidth - 70, f1Y - 5);
                
                // F2 line
                this.spectrumCtx.beginPath();
                this.spectrumCtx.moveTo(sidebarStartX, f2Y);
                this.spectrumCtx.lineTo(sidebarStartX + barWidth, f2Y);
                this.spectrumCtx.stroke();
                this.spectrumCtx.fillText(`${Math.round(latestFormants.f2)} Hz`, sidebarStartX + barWidth - 70, f2Y - 5);
            }
        }
    }
    
    drawPitchSidebar(startX, maxFreq) {
        const sidebarWidth = 100; // 100px at display resolution
        const sidebarStartX = this.spectrumWidth - sidebarWidth + 1;
        
        // Clear the sidebar area
        this.spectrumCtx.clearRect(sidebarStartX, 0, sidebarWidth, this.spectrumHeight);
        
        // Draw background for pitch sidebar
        this.spectrumCtx.fillStyle = 'rgba(123, 121, 121, 0.5)';
        this.spectrumCtx.fillRect(sidebarStartX, 0, sidebarWidth, this.spectrumHeight);
        
        // Draw border for sidebar
        this.spectrumCtx.strokeStyle = 'rgba(170, 170, 170, 0.9)';
        this.spectrumCtx.lineWidth = 1;
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(sidebarStartX, 0);
        this.spectrumCtx.lineTo(sidebarStartX, this.spectrumHeight);
        this.spectrumCtx.stroke();
        
        // Draw musical note scale grid
        this.drawMusicalNoteGrid(sidebarStartX, sidebarWidth);
        
        // Display detected pitch and tracker line
        if (this.pitchHistory && this.pitchHistory.length > 0) {
            const latestPitch = this.pitchHistory[this.pitchHistory.length - 1];
            if (latestPitch > 0) {
                const y = this.getPitchYPosition(latestPitch);
                const note = this.frequencyToNote(latestPitch);
                
                // Draw tracker line for pitch
                this.spectrumCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red for visibility
                this.spectrumCtx.lineWidth = 2;
                this.spectrumCtx.beginPath();
                this.spectrumCtx.moveTo(sidebarStartX, y);
                this.spectrumCtx.lineTo(sidebarStartX + sidebarWidth, y);
                this.spectrumCtx.stroke();
                
                // Display pitch value and note
                this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                this.spectrumCtx.font = '12px Arial';
                this.spectrumCtx.fillText(`${Math.round(latestPitch)} Hz (${note})`, sidebarStartX + 10, y - 5);
            }
        }
        
        // Title for pitch sidebar
        this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.spectrumCtx.font = '12px Arial';
        this.spectrumCtx.fillText('Pitch Scale', sidebarStartX + 10, 20);
    }
    
    drawMusicalNoteGrid(startX, width) {
        const notes = [
            { name: 'C2', freq: 65.41 },
            { name: 'C#2/Db2', freq: 69.30 },
            { name: 'D2', freq: 73.42 },
            { name: 'D#2/Eb2', freq: 77.78 },
            { name: 'E2', freq: 82.41 },
            { name: 'F2', freq: 87.31 },
            { name: 'F#2/Gb2', freq: 92.50 },
            { name: 'G2', freq: 98.00 },
            { name: 'G#2/Ab2', freq: 103.83 },
            { name: 'A2', freq: 110.00 },
            { name: 'A#2/Bb2', freq: 116.54 },
            { name: 'B2', freq: 123.47 },
            { name: 'C3', freq: 130.81 },
            { name: 'C#3/Db3', freq: 138.59 },
            { name: 'D3', freq: 146.83 },
            { name: 'D#3/Eb3', freq: 155.56 },
            { name: 'E3', freq: 164.81 },
            { name: 'F3', freq: 174.61 },
            { name: 'F#3/Gb3', freq: 185.00 },
            { name: 'G3', freq: 196.00 },
            { name: 'G#3/Ab3', freq: 207.65 },
            { name: 'A3', freq: 220.00 },
            { name: 'A#3/Bb3', freq: 233.08 },
            { name: 'B3', freq: 246.94 },
            { name: 'C4', freq: 261.63 },
            { name: 'C#4/Db4', freq: 277.18 },
            { name: 'D4', freq: 293.66 },
            { name: 'D#4/Eb4', freq: 311.13 },
            { name: 'E4', freq: 329.63 },
            { name: 'F4', freq: 349.23 },
            { name: 'F#4/Gb4', freq: 369.99 },
            { name: 'G4', freq: 392.00 },
            { name: 'G#4/Ab4', freq: 415.30 },
            { name: 'A4', freq: 440.00 },
            { name: 'A#4/Bb4', freq: 466.16 },
            { name: 'B4', freq: 493.88 },
            { name: 'C5', freq: 523.25 }
        ];
        
        this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.spectrumCtx.lineWidth = 1;
        this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        this.spectrumCtx.font = '10px Arial';
        
        notes.forEach(note => {
            const y = this.getPitchYPosition(note.freq);
            this.spectrumCtx.beginPath();
            this.spectrumCtx.moveTo(startX, y);
            this.spectrumCtx.lineTo(startX + width, y);
            this.spectrumCtx.stroke();
            
            // Label major notes (C notes)
            if (note.name.startsWith('C')) {
                this.spectrumCtx.fillText(note.name, startX + 10, y - 5);
            }
        });
    }
    
    getPitchYPosition(frequency) {
        const minFreq = 60; // C2
        const maxFreq = 550; // Roughly C5
        const logFreq = Math.log(frequency);
        const logMin = Math.log(minFreq);
        const logMax = Math.log(maxFreq);
        const normalized = (logFreq - logMin) / (logMax - logMin);
        return this.spectrumHeight - (normalized * this.spectrumHeight);
    }
    
    frequencyToNote(frequency) {
        const notes = [
            { name: 'C2', freq: 65.41 },
            { name: 'C#2', freq: 69.30 },
            { name: 'D2', freq: 73.42 },
            { name: 'D#2', freq: 77.78 },
            { name: 'E2', freq: 82.41 },
            { name: 'F2', freq: 87.31 },
            { name: 'F#2', freq: 92.50 },
            { name: 'G2', freq: 98.00 },
            { name: 'G#2', freq: 103.83 },
            { name: 'A2', freq: 110.00 },
            { name: 'A#2', freq: 116.54 },
            { name: 'B2', freq: 123.47 },
            { name: 'C3', freq: 130.81 },
            { name: 'C#3', freq: 138.59 },
            { name: 'D3', freq: 146.83 },
            { name: 'D#3', freq: 155.56 },
            { name: 'E3', freq: 164.81 },
            { name: 'F3', freq: 174.61 },
            { name: 'F#3', freq: 185.00 },
            { name: 'G3', freq: 196.00 },
            { name: 'G#3', freq: 207.65 },
            { name: 'A3', freq: 220.00 },
            { name: 'A#3', freq: 233.08 },
            { name: 'B3', freq: 246.94 },
            { name: 'C4', freq: 261.63 },
            { name: 'C#4', freq: 277.18 },
            { name: 'D4', freq: 293.66 },
            { name: 'D#4', freq: 311.13 },
            { name: 'E4', freq: 329.63 },
            { name: 'F4', freq: 349.23 },
            { name: 'F#4', freq: 369.99 },
            { name: 'G4', freq: 392.00 },
            { name: 'G#4', freq: 415.30 },
            { name: 'A4', freq: 440.00 },
            { name: 'A#4', freq: 466.16 },
            { name: 'B4', freq: 493.88 },
            { name: 'C5', freq: 523.25 }
        ];
        
        let closestNote = notes[0].name;
        let minDiff = Math.abs(frequency - notes[0].freq);
        
        for (let i = 1; i < notes.length; i++) {
            const diff = Math.abs(frequency - notes[i].freq);
            if (diff < minDiff) {
                minDiff = diff;
                closestNote = notes[i].name;
            }
        }
        
        return closestNote;
    }
    
    getColorForPower(value) {
        if (value === 0) return { r: 0, g: 0, b: 0 }; // Black for zero power
        if (value < 85) return { r: 0, g: value * 3, b: value * 3 }; // Black to Cyan
        if (value < 170) return { r: (value - 85) * 3, g: 255, b: 0 }; // Cyan to Yellow
        return { r: 255, g: 255 - ((value - 170) * 3), b: 0 }; // Yellow to Red (max power)
    }
    
    drawSpectrumAxes() {
        this.spectrumCtx.strokeStyle = 'rgba(170, 170, 170, 0.9)';
        this.spectrumCtx.lineWidth = 1; // Thinner lines for axes
        this.spectrumCtx.font = '10px Arial'; // Smaller font for labels
        this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.spectrumCtx.setLineDash([]);
        
        // Y-axis (Frequency)
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(30, 0);
        this.spectrumCtx.lineTo(30, this.spectrumHeight);
        this.spectrumCtx.stroke();
        const maxFreq = 3500;
        const freqStep = maxFreq / 7; // More divisions for clarity
        for (let i = 0; i <= 7; i++) {
            const y = (this.spectrumHeight) - (i * ((this.spectrumHeight) / 7));
            const freqLabel = Math.round(freqStep * i);
            this.spectrumCtx.fillText(`${freqLabel} Hz`, 2, y + 4); // Adjusted position to prevent clipping
            this.spectrumCtx.beginPath();
            this.spectrumCtx.moveTo(25, y);
            this.spectrumCtx.lineTo(35, y);
            this.spectrumCtx.stroke();
        }
        
        // X-axis (Time)
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(0, (this.spectrumHeight) - 30);
        this.spectrumCtx.lineTo(this.spectrumWidth, (this.spectrumHeight) - 30);
        this.spectrumCtx.stroke();
        const timeStep = this.historySeconds / 5;
        for (let i = 0; i <= 5; i++) {
            const x = i * ((this.spectrumWidth) / 5);
            const timeLabel = (timeStep * (5 - i)).toFixed(1); // Reverse the time labels
            // Adjusted position to prevent clipping at edges
            let labelX = x - 20;
            if (i === 0) labelX = x;
            else if (i === 5) labelX = x - 40;
            this.spectrumCtx.fillText(`${timeLabel}s`, labelX, (this.spectrumHeight * 2) - 10);
            this.spectrumCtx.beginPath();
            this.spectrumCtx.moveTo(x, (this.spectrumHeight) - 25);
            this.spectrumCtx.lineTo(x, (this.spectrumHeight) - 35);
            this.spectrumCtx.stroke();
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
