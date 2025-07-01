// Speech Analysis Tool - Main Application Logic
import { estimateFormants, detectVowel } from './algorithms.js';

class SpeechAnalyzer {
    constructor() {
        this.vowelCanvas = document.getElementById('vowelChart');
        this.vowelCtx = this.vowelCanvas.getContext('2d');
        this.spectrumCanvas = document.getElementById('spectrumChart');
        this.spectrumCtx = this.spectrumCanvas.getContext('2d');
        this.spectrumLogCanvas = document.getElementById('spectrumLogChart');
        this.spectrumLogCtx = this.spectrumLogCanvas.getContext('2d');
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
        
        // Formant and pitch display elements
        this.f1ValueElement = document.getElementById('f1Value');
        this.f2ValueElement = document.getElementById('f2Value');
        this.pitchValueElement = document.getElementById('pitchValue');
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
        this.fftSizeSelect = document.getElementById('fftSizeSelect');
        this.formantAlgorithmSelect = document.getElementById('formantAlgorithmSelect');
        this.formantAlgorithm = 'default'; // Default algorithm
        
        // Add 'density' algorithm to the dropdown
        const densityOption = document.createElement('option');
        densityOption.value = 'density';
        densityOption.text = 'Density';
        this.formantAlgorithmSelect.appendChild(densityOption);
        
        this.setupEventListeners();
        this.enumerateMicrophones();
        this.drawVowelChart();
        this.drawSpectrumAxes();
        this.drawSpectrumLogAxes();
        this.drawWaveformChart();
    }
    
    updateChartDimensions() {
        // Update dimensions based on current canvas size
        this.vowelWidth = this.vowelCanvas.clientWidth;
        this.vowelHeight = this.vowelCanvas.clientHeight;
        this.spectrumWidth = this.spectrumCanvas.clientWidth;
        this.spectrumHeight = this.spectrumCanvas.clientHeight;
        this.spectrumLogWidth = this.spectrumLogCanvas.clientWidth;
        this.spectrumLogHeight = this.spectrumLogCanvas.clientHeight;
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
        this.spectrumLogCanvas.width = this.spectrumLogWidth * 2;
        this.spectrumLogCanvas.height = this.spectrumLogHeight * 2;
        this.spectrumLogCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.spectrumLogCtx.scale(2, 2);
        this.waveformCanvas.width = this.waveformWidth * 2;
        this.waveformCanvas.height = this.waveformHeight * 2;
        this.waveformCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.waveformCtx.scale(2, 2);
        this.freqBins = 2048; // Default frequency bins, updated later if needed
        // Ensure initial rendering matches resized rendering
        this.drawVowelChart();
        this.drawSpectrumAxes();
        this.drawSpectrumLogAxes();
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
        this.fftSizeSelect.addEventListener('change', () => {
            if (this.isRunning) {
                this.stop();
                this.start();
            }
        });
        
        this.formantAlgorithmSelect.addEventListener('change', (e) => {
            this.formantAlgorithm = e.target.value;
            if (this.isRunning) {
                this.stop();
                this.start();
            }
        });
        
        // Handle waveform selection
        this.waveformCanvas.addEventListener('mousedown', (e) => this.startSelection(e));
        this.waveformCanvas.addEventListener('mousemove', (e) => this.updateSelection(e));
        this.waveformCanvas.addEventListener('mouseup', (e) => this.endSelection(e));
        
        // Handle window resize to update chart dimensions
        window.addEventListener('resize', () => {
            this.updateChartDimensions();
            this.drawVowelChart();
            this.drawSpectrum();
            this.drawSpectrumLog();
            this.drawWaveformChart();
        });

        // Handle mouse events for synthetic signal generation on vowel chart
        this.vowelCanvas.addEventListener('mousedown', (e) => this.startSyntheticSignal(e));
        this.vowelCanvas.addEventListener('mousemove', (e) => this.updateSyntheticSignal(e));
        this.vowelCanvas.addEventListener('mouseup', () => this.stopSyntheticSignal());
        this.vowelCanvas.addEventListener('mouseleave', () => this.stopSyntheticSignal());
    }

    startSyntheticSignal(e) {
        if (this.syntheticAudioContext) return;
        this.syntheticAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        const rect = this.vowelCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const { f1, f2 } = this.getFormantsFromPosition(x, y);
        this.syntheticF1 = f1;
        this.syntheticF2 = f2;
        this.generateSyntheticSignal(f1, f2);
        this.drawSyntheticCrosshair(x, y);
    }

    updateSyntheticSignal(e) {
        if (!this.syntheticAudioContext) return;
        const rect = this.vowelCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const { f1, f2 } = this.getFormantsFromPosition(x, y);
        this.syntheticF1 = f1;
        this.syntheticF2 = f2;
        const f3 = Math.min(3500, f2 * 1.5); // Calculate F3 based on F2
        // Update formant frequencies dynamically
        if (this.syntheticOsc1) {
            this.syntheticOsc1.frequency.setValueAtTime(f1, this.syntheticAudioContext.currentTime);
            this.syntheticOsc2.frequency.setValueAtTime(f2, this.syntheticAudioContext.currentTime);
            this.syntheticOsc3.frequency.setValueAtTime(f3, this.syntheticAudioContext.currentTime);
            // Update bandpass filter frequencies
            if (this.syntheticFilter1) {
                this.syntheticFilter1.frequency.setValueAtTime(f1, this.syntheticAudioContext.currentTime);
            }
            if (this.syntheticFilter2) {
                this.syntheticFilter2.frequency.setValueAtTime(f2, this.syntheticAudioContext.currentTime);
            }
            if (this.syntheticFilter3) {
                this.syntheticFilter3.frequency.setValueAtTime(f3, this.syntheticAudioContext.currentTime);
            }
        }
        this.drawSyntheticCrosshair(x, y);
    }

    stopSyntheticSignal() {
        if (!this.syntheticAudioContext) return;
        console.log('Stopping synthetic signal');
        if (this.syntheticOscPitch) {
            this.syntheticOscPitch.stop();
            this.syntheticOscPitch.disconnect();
            this.syntheticOscPitch = null;
        }
        if (this.syntheticOsc1) {
            this.syntheticOsc1.stop();
            this.syntheticOsc1.disconnect();
            this.syntheticOsc1 = null;
        }
        if (this.syntheticOsc2) {
            this.syntheticOsc2.stop();
            this.syntheticOsc2.disconnect();
            this.syntheticOsc2 = null;
        }
        if (this.syntheticOsc3) {
            this.syntheticOsc3.stop();
            this.syntheticOsc3.disconnect();
            this.syntheticOsc3 = null;
        }
        if (this.syntheticNoise) {
            this.syntheticNoise.stop();
            this.syntheticNoise.disconnect();
            this.syntheticNoise = null;
        }
        if (this.syntheticPitchMod) {
            this.syntheticPitchMod.stop();
            this.syntheticPitchMod.disconnect();
            this.syntheticPitchMod = null;
        }
        if (this.syntheticAmpMod) {
            this.syntheticAmpMod.stop();
            this.syntheticAmpMod.disconnect();
            this.syntheticAmpMod = null;
        }
        this.syntheticAudioContext.close();
        this.syntheticAudioContext = null;
        console.log('Audio context closed');
        this.drawVowelChart(); // Redraw to remove crosshair
    }

    getFormantsFromPosition(x, y) {
        // Convert canvas position to F1 and F2 frequencies
        const f2 = 2500 - ((x - 20) / (this.vowelWidth - 40)) * 2500;
        const f1 = 1000 - ((y - 20) / (this.vowelHeight - 40)) * 1000;
        return { f1: Math.max(100, Math.min(1000, f1)), f2: Math.max(500, Math.min(2500, f2)) };
    }

    generateSyntheticSignal(f1, f2) {
        if (!this.syntheticAudioContext) return;
        console.log('Generating synthetic signal with F1:', f1, 'F2:', f2);
        
        // Calculate F3 as approximately 1.5 * F2 for typical human vocal tract
        const f3 = Math.min(3500, f2 * 1.5);
        
        // Create oscillators for fundamental pitch, formants F1, F2, F3, and noise for breathiness
        this.syntheticOscPitch = this.syntheticAudioContext.createOscillator(); // Fundamental pitch (glottal source)
        this.syntheticOsc1 = this.syntheticAudioContext.createOscillator(); // F1 formant
        this.syntheticOsc2 = this.syntheticAudioContext.createOscillator(); // F2 formant
        this.syntheticOsc3 = this.syntheticAudioContext.createOscillator(); // F3 formant
        this.syntheticNoise = this.syntheticAudioContext.createBufferSource(); // Noise for breathiness
        this.syntheticPitchMod = this.syntheticAudioContext.createOscillator(); // LFO for pitch modulation
        this.syntheticAmpMod = this.syntheticAudioContext.createOscillator(); // LFO for amplitude modulation
        
        // Create gain nodes for each component
        const gainNodePitch = this.syntheticAudioContext.createGain();
        const gainNode1 = this.syntheticAudioContext.createGain();
        const gainNode2 = this.syntheticAudioContext.createGain();
        const gainNode3 = this.syntheticAudioContext.createGain();
        const gainNodeNoise = this.syntheticAudioContext.createGain();
        const gainNodePitchMod = this.syntheticAudioContext.createGain();
        const gainNodeAmpMod = this.syntheticAudioContext.createGain();
        const masterGain = this.syntheticAudioContext.createGain();
        
        // Create bandpass filters for formants to emphasize resonant frequencies and store them
        this.syntheticFilter1 = this.syntheticAudioContext.createBiquadFilter();
        this.syntheticFilter2 = this.syntheticAudioContext.createBiquadFilter();
        this.syntheticFilter3 = this.syntheticAudioContext.createBiquadFilter();
        this.syntheticNoiseFilter = this.syntheticAudioContext.createBiquadFilter();
        
        // Set oscillator properties for glottal source and formants
        this.syntheticOscPitch.type = 'sawtooth'; // Sawtooth for richer harmonics mimicking glottal pulse
        this.syntheticOsc1.type = 'sine'; // Sine for formants to simulate vocal tract resonance
        this.syntheticOsc2.type = 'sine';
        this.syntheticOsc3.type = 'sine';
        this.syntheticOscPitch.frequency.value = 120; // Fixed fundamental pitch (typical male voice range)
        this.syntheticOsc1.frequency.value = f1; // First formant
        this.syntheticOsc2.frequency.value = f2; // Second formant
        this.syntheticOsc3.frequency.value = f3; // Third formant
        
        // Set up LFOs for natural pitch and amplitude variation
        this.syntheticPitchMod.type = 'sine';
        this.syntheticPitchMod.frequency.value = 6; // 6 Hz for subtle pitch variation
        gainNodePitchMod.gain.value = 5; // ±5 Hz variation in pitch
        this.syntheticAmpMod.type = 'sine';
        this.syntheticAmpMod.frequency.value = 5; // 5 Hz for subtle amplitude variation
        gainNodeAmpMod.gain.value = 0.1; // ±10% variation in amplitude
        
        // Set up noise for breathiness
        const bufferSize = 2 * this.syntheticAudioContext.sampleRate;
        const noiseBuffer = this.syntheticAudioContext.createBuffer(1, bufferSize, this.syntheticAudioContext.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1; // White noise
        }
        this.syntheticNoise.buffer = noiseBuffer;
        this.syntheticNoise.loop = true;
        
        // Set gain values to balance components
        gainNodePitch.gain.value = 0.15; // Lower gain for pitch to balance with formants
        gainNode1.gain.value = 0.3; // Higher gain for F1 as it's prominent in voice
        gainNode2.gain.value = 0.25; // Slightly lower for F2
        gainNode3.gain.value = 0.15; // Even lower for F3
        gainNodeNoise.gain.value = 0.05; // Very low gain for breathiness
        masterGain.gain.value = 0.4; // Overall volume control
        
        // Set up bandpass filters for formants
        this.syntheticFilter1.type = 'bandpass';
        this.syntheticFilter1.frequency.value = f1;
        this.syntheticFilter1.Q.value = 8; // Moderate Q for natural resonance
        this.syntheticFilter2.type = 'bandpass';
        this.syntheticFilter2.frequency.value = f2;
        this.syntheticFilter2.Q.value = 8;
        this.syntheticFilter3.type = 'bandpass';
        this.syntheticFilter3.frequency.value = f3;
        this.syntheticFilter3.Q.value = 8;
        this.syntheticNoiseFilter.type = 'highpass';
        this.syntheticNoiseFilter.frequency.value = 500; // High-pass filter for breathiness noise
        this.syntheticNoiseFilter.Q.value = 1;
        
        // Connect audio graph for pitch and amplitude modulation
        this.syntheticPitchMod.connect(gainNodePitchMod);
        gainNodePitchMod.connect(this.syntheticOscPitch.frequency); // Modulate pitch frequency
        this.syntheticAmpMod.connect(gainNodeAmpMod);
        gainNodeAmpMod.connect(gainNodePitch.gain); // Modulate pitch amplitude
        
        // Connect oscillators and filters to gains
        this.syntheticOscPitch.connect(gainNodePitch);
        this.syntheticOsc1.connect(this.syntheticFilter1);
        this.syntheticFilter1.connect(gainNode1);
        this.syntheticOsc2.connect(this.syntheticFilter2);
        this.syntheticFilter2.connect(gainNode2);
        this.syntheticOsc3.connect(this.syntheticFilter3);
        this.syntheticFilter3.connect(gainNode3);
        this.syntheticNoise.connect(this.syntheticNoiseFilter);
        this.syntheticNoiseFilter.connect(gainNodeNoise);
        
        // Connect all gains to master gain
        gainNodePitch.connect(masterGain);
        gainNode1.connect(masterGain);
        gainNode2.connect(masterGain);
        gainNode3.connect(masterGain);
        gainNodeNoise.connect(masterGain);
        
        // Connect master gain to destination
        masterGain.connect(this.syntheticAudioContext.destination);
        
        // Start oscillators and noise
        this.syntheticOscPitch.start();
        this.syntheticOsc1.start();
        this.syntheticOsc2.start();
        this.syntheticOsc3.start();
        this.syntheticNoise.start();
        this.syntheticPitchMod.start();
        this.syntheticAmpMod.start();
        
        console.log('Synthetic signal started with fundamental pitch at 120 Hz, F1:', f1, 'F2:', f2, 'F3:', f3);
        console.log('Audio context state:', this.syntheticAudioContext.state);
    }

    drawSyntheticCrosshair(x, y) {
        this.drawVowelChart(); // Redraw base chart
        this.vowelCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
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
        // Center dot
        this.vowelCtx.fillStyle = 'rgba(0, 255, 0, 0.8)';
        this.vowelCtx.beginPath();
        this.vowelCtx.arc(x, y, 5, 0, 2 * Math.PI);
        this.vowelCtx.fill();
        // Display F1 and F2 values
        this.vowelCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.vowelCtx.font = '12px Arial';
        this.vowelCtx.fillText(`F1: ${Math.round(this.syntheticF1)} Hz`, x + 10, y - 10);
        this.vowelCtx.fillText(`F2: ${Math.round(this.syntheticF2)} Hz`, x + 10, y + 10);
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
            const fftSize = parseInt(this.fftSizeSelect.value);
            this.analyser.fftSize = fftSize; // Configurable FFT size
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
                const testFiles = ['test1.mp3', 'test2.mp3', 'test3.mp3', 'test4.mp3', 'test5.mp3', 'test6.mp3', 'test7.mp3', 'test8.mp3'];
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

        //reweigth freq data so higher frequencies have less power according to log rule with steeper dampening after 1700 hz and even steepr after 2000 hz
        for (let i = 0; i < freqData.length; i++) {
            const freq = i * this.audioContext.sampleRate / this.analyser.fftSize;
            if (freq > 50) {
                freqData[i] *= Math.exp(-0.0001 * (freq - 50));
            }
            if (freq > 2100) {
                freqData[i] *= Math.exp(-0.0004 * (freq - 2100));
            }
        }
        

        
        // Store spectrum data for history
        this.spectrumHistory.push(freqData.slice());
        const maxFrames = this.historySeconds * this.frameRate;
        if (this.spectrumHistory.length > maxFrames) {
            this.spectrumHistory.shift();
        }
        
        // Estimate formants for the last 100ms (approximately last 3 frames at 30fps)
        const formants = estimateFormants(freqData, this.audioContext.sampleRate, this.formantAlgorithm);
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
        
        // Update pitch display
        this.pitchValueElement.textContent = Math.round(pitch) || 0;
        
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
        this.drawSpectrumLog();
        requestAnimationFrame(() => this.updateCharts());
    }
    
    detectPitch(freqData, sampleRate) {
        // Use Harmonic Product Spectrum (HPS) for more accurate pitch detection, with normalization for low volume
        const binSize = sampleRate / (2 * freqData.length);
        const hpsLength = Math.floor(freqData.length / 3); // Limit to first third for efficiency
        const hps = new Array(hpsLength).fill(1);
        
        // Normalize frequency data to enhance sensitivity for low volume speech
        let maxAmp = 0;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxAmp) maxAmp = freqData[i];
        }
        const normalizedData = new Array(freqData.length);
        if (maxAmp > 0) {
            for (let i = 0; i < freqData.length; i++) {
                normalizedData[i] = (freqData[i] / maxAmp) * 255;
            }
        } else {
            for (let i = 0; i < freqData.length; i++) {
                normalizedData[i] = freqData[i];
            }
        }
        
        // Compute HPS by multiplying downsampled spectra
        for (let harmonic = 1; harmonic <= 3; harmonic++) {
            for (let i = 0; i < hpsLength; i++) {
                const index = Math.floor(i * harmonic);
                if (index < normalizedData.length) {
                    hps[i] *= normalizedData[index];
                }
            }
        }
        
        // Find the peak in HPS within the specified frequency range (50 Hz to 600 Hz)
        let maxAmplitude = 0;
        let pitchBin = 0;
        const minFreqBin = Math.floor(50 / binSize);
        const maxFreqBin = Math.ceil(600 / binSize);
        for (let i = minFreqBin; i <= maxFreqBin && i < hpsLength; i++) {
            if (hps[i] > maxAmplitude) {
                maxAmplitude = hps[i];
                pitchBin = i;
            }
        }
        
        // Refine the pitch by checking nearby bins for a stronger fundamental within range
        if (pitchBin > minFreqBin && pitchBin < maxFreqBin && pitchBin < hpsLength - 1) {
            const center = hps[pitchBin];
            const left = hps[pitchBin - 1];
            const right = hps[pitchBin + 1];
            if (left > center && left > right && pitchBin - 1 >= minFreqBin) {
                pitchBin--;
            } else if (right > center && right > left && pitchBin + 1 <= maxFreqBin) {
                pitchBin++;
            }
        }
        
        // Return the detected pitch frequency
        let pitch = pitchBin * binSize;
        
        // Apply a very low threshold to filter out only the weakest noise
        if (maxAmplitude < 1) {
            pitch = 0; // Consider it noise if amplitude is extremely low even after normalization
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
        let latestFormants = { f1: 0, f2: 0, f1WidthLower: 0, f1WidthUpper: 0 }; // Default empty object if no formants
        if (this.formantHistory.length > 0) {
            latestFormants = this.formantHistory[this.formantHistory.length - 1];
            if (latestFormants.f1 && latestFormants.f2) {
                const f1Y = (this.spectrumHeight) - (latestFormants.f1 / maxFreq) * (this.spectrumHeight);
                const f2Y = (this.spectrumHeight) - (latestFormants.f2 / maxFreq) * (this.spectrumHeight);
                
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

                // Draw F1 width bounds if available (for density algorithm)
                if (this.formantAlgorithm === 'density' && latestFormants.f1WidthLower && latestFormants.f1WidthUpper) {
                    const lowerY = (this.spectrumHeight) - (latestFormants.f1WidthLower / maxFreq) * (this.spectrumHeight);
                    const upperY = (this.spectrumHeight) - (latestFormants.f1WidthUpper / maxFreq) * (this.spectrumHeight);
                    
                    // Draw a translucent pink box to cover the width
                    this.spectrumCtx.fillStyle = 'rgba(255, 105, 180, 0.6)'; // Pink with 0.6 opacity
                    this.spectrumCtx.fillRect(0, upperY, voiceprintWidth, lowerY - upperY);
                    
                    this.spectrumCtx.strokeStyle = 'rgba(255, 165, 0, 0.5)'; // Orange for visibility
                    this.spectrumCtx.lineWidth = 1;
                    
                    // Lower bound line
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(voiceprintWidth - sliceWidth, lowerY);
                    this.spectrumCtx.lineTo(voiceprintWidth, lowerY);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.fillText(`${Math.round(latestFormants.f1WidthLower)} Hz`, voiceprintWidth - 60, lowerY - 5);
                    
                    // Upper bound line
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(voiceprintWidth - sliceWidth, upperY);
                    this.spectrumCtx.lineTo(voiceprintWidth, upperY);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.fillText(`${Math.round(latestFormants.f1WidthUpper)} Hz`, voiceprintWidth - 60, upperY - 5);
                }
                
                // Draw F2 width bounds if available (for density algorithm)
                if (this.formantAlgorithm === 'density' && latestFormants.f2WidthLower && latestFormants.f2WidthUpper) {
                    const lowerY = (this.spectrumHeight) - (latestFormants.f2WidthLower / maxFreq) * (this.spectrumHeight);
                    const upperY = (this.spectrumHeight) - (latestFormants.f2WidthUpper / maxFreq) * (this.spectrumHeight);
                    
                    // Draw a translucent yellow box to cover the width
                    this.spectrumCtx.fillStyle = 'rgba(255, 255, 0, 0.4)'; // Yellow with 0.6 opacity
                    this.spectrumCtx.fillRect(0, upperY, voiceprintWidth, lowerY - upperY);
                    
                    this.spectrumCtx.strokeStyle = 'rgba(255, 165, 0, 0.5)'; // Orange for visibility
                    this.spectrumCtx.lineWidth = 1;
                    
                    // Lower bound line
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(voiceprintWidth - sliceWidth, lowerY);
                    this.spectrumCtx.lineTo(voiceprintWidth, lowerY);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.fillText(`${Math.round(latestFormants.f2WidthLower)} Hz`, voiceprintWidth - 60, lowerY - 5);
                    
                    // Upper bound line
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(voiceprintWidth - sliceWidth, upperY);
                    this.spectrumCtx.lineTo(voiceprintWidth, upperY);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.fillText(`${Math.round(latestFormants.f2WidthUpper)} Hz`, voiceprintWidth - 60, upperY - 5);
                }
            }
        }
        
        // Draw live spectral analysis sidebar on the right (left part of the sidebar)
        this.drawLiveSpectrumSidebar(voiceprintWidth, maxFreq, maxBin, binHeight, latestFormants, false);
        
        // Draw musical note scale sidebar on the right (right part of the sidebar)
        this.drawPitchSidebar(voiceprintWidth + 200, maxFreq);
        
        // Draw axes last to ensure they are on top
        this.drawSpectrumAxes();
    }
    
    drawLiveSpectrumSidebar(voiceprintWidth, maxFreq, maxBin, binHeight, latestFormants, isLogarithmic = false, ctx = null, width = null, height = null) {
        const sidebarWidth = 100; // Each sidebar part is 100px at 2x resolution
        const targetCtx = ctx || this.spectrumCtx;
        const targetWidth = width || this.spectrumWidth;
        const targetHeight = height || this.spectrumHeight;
        const sidebarStartX = targetWidth - sidebarWidth - 100;
        
        // Clear the area for the spectral analysis
        targetCtx.clearRect(sidebarStartX, 0, sidebarWidth, targetHeight);
        
        // Draw background for spectral analysis sidebar
        targetCtx.fillStyle = 'rgba(3, 3, 3, 1.0)';
        targetCtx.fillRect(sidebarStartX, 0, sidebarWidth, targetHeight);
        
        // Draw border for sidebar
        targetCtx.strokeStyle = 'rgba(255, 255, 0, 0.6)'; // Bright yellow for visibility
        targetCtx.lineWidth = 1; // Thicker line to ensure visibility
        targetCtx.beginPath();
        targetCtx.moveTo(sidebarStartX, 0);
        targetCtx.lineTo(sidebarStartX, targetHeight);
        targetCtx.stroke();
        
        // Render the sidebar to match the latest vertical line from the voiceprint pixel by pixel
        if (this.spectrumHistory.length > 0) {
            const latestSpectrum = this.spectrumHistory[this.spectrumHistory.length - 1];
            const barWidth = sidebarWidth * 0.9; // Width of each bar extending to the right
            const adjustedBinHeight = targetHeight / maxBin; // Adjust bin height to display resolution
            const minFreq = 50; // Starting point for logarithmic scale
            const logMax = Math.log(maxFreq);
            const logMin = Math.log(minFreq);
            const logRange = logMax - logMin;
            
            // Calculate total power for normalization
            let totalPower = 0;
            for (let j = 0; j < maxBin; j++) {
                totalPower += latestSpectrum[j];
            }
            totalPower = Math.max(totalPower, 1); // Avoid division by zero
            
            let prevY = -1;
            let prevValue = 0;
            
            // Loop through the frequency bins to match the voiceprint's vertical line
            for (let j = 0; j < maxBin; j++) {
                // Calculate y position to match voiceprint using display resolution
                let y;
                if (isLogarithmic) {
                    const freq = (j / maxBin) * maxFreq;
                    const logFreq = Math.log(freq + 1); // Add 1 to avoid log(0)
                    const normalized = (logFreq - logMin) / logRange;
                    y = Math.floor(targetHeight - normalized * targetHeight);
                } else {
                    y = Math.floor(targetHeight - (j + 1) * adjustedBinHeight); // Scale back to canvas resolution
                }
                const rawValue = latestSpectrum[j];
                // Normalize power as proportion of total power
                const normalizedValue = rawValue / totalPower;
                // Apply logarithmic scaling to emphasize peaks (adding 1 to avoid log(0))
                const logValue = Math.log(1 + normalizedValue * 100) / Math.log(14) * 255;
                const value = Math.min(Math.max(logValue, 0), 255); // Clamp to valid range
                const rgb = this.getColorForPower(value);
                const powerWidth = (value / 255) * barWidth; // Scale width based on log value
                
                // Interpolate between data points if there are gaps (only for logarithmic scale)
                if (isLogarithmic && prevY !== -1 && Math.abs(y - prevY) > 1) {
                    const yDiff = y - prevY;
                    const valueDiff = value - prevValue;
                    const step = yDiff > 0 ? 1 : -1;
                    for (let k = step; yDiff > 0 ? k < yDiff : k > yDiff; k += step) {
                        const interpY = prevY + k;
                        const interpValue = Math.floor(prevValue + (valueDiff * (k / yDiff)));
                        const interpRgb = this.getColorForPower(interpValue);
                        const interpPowerWidth = (interpValue / 255) * barWidth;
                        if (interpY >= 0 && interpY < targetHeight) {
                            targetCtx.fillStyle = `rgb(${interpRgb.r}, ${interpRgb.g}, ${interpRgb.b})`;
                            targetCtx.fillRect(sidebarStartX + 2, interpY, interpPowerWidth, 1);
                        }
                    }
                }
                
                // Draw horizontal line for power matching the voiceprint pixel by pixel
                targetCtx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                targetCtx.fillRect(sidebarStartX + 2, y, powerWidth, adjustedBinHeight);
                
                prevY = y;
                prevValue = value;
            }
            
            // Draw F1 and F2 tracking lines on the sidebar aligned with voiceprint frequency axis
            if (latestFormants.f1 && latestFormants.f2) {
                let f1Y, f2Y;
                if (isLogarithmic) {
                    const logF1 = Math.log(latestFormants.f1 + 1); // Add 1 to avoid log(0)
                    const logF2 = Math.log(latestFormants.f2 + 1);
                    const normalizedF1 = (logF1 - logMin) / logRange;
                    const normalizedF2 = (logF2 - logMin) / logRange;
                    f1Y = targetHeight - normalizedF1 * targetHeight;
                    f2Y = targetHeight - normalizedF2 * targetHeight;
                } else {
                    f1Y = targetHeight - (latestFormants.f1 / maxFreq) * targetHeight;
                    f2Y = targetHeight - (latestFormants.f2 / maxFreq) * targetHeight;
                }
                
                targetCtx.strokeStyle = 'rgba(0, 255, 255, 0.7)'; // Cyan for visibility
                targetCtx.lineWidth = 2; // Thicker line for visibility
                targetCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                targetCtx.font = '12px Arial'; // Font for visibility
                
                // F1 line
                targetCtx.beginPath();
                targetCtx.moveTo(sidebarStartX, f1Y);
                targetCtx.lineTo(sidebarStartX + barWidth, f1Y);
                targetCtx.stroke();
                targetCtx.fillText(`${Math.round(latestFormants.f1)} Hz`, sidebarStartX + barWidth - 70, f1Y - 5);
                // Display F1 beam width if available
                if (this.formantAlgorithm === 'density' && latestFormants.f1WidthLower && latestFormants.f1WidthUpper) {
                    const f1Width = Math.abs(latestFormants.f1WidthUpper - latestFormants.f1WidthLower);
                    targetCtx.fillText(`${Math.round(f1Width)} Hz`, sidebarStartX + barWidth - 70, f1Y + 15);
                }
                
                // F2 line
                targetCtx.beginPath();
                targetCtx.moveTo(sidebarStartX, f2Y);
                targetCtx.lineTo(sidebarStartX + barWidth, f2Y);
                targetCtx.stroke();
                targetCtx.fillText(`${Math.round(latestFormants.f2)} Hz`, sidebarStartX + barWidth - 70, f2Y - 5);
                // Display F2 beam width if available
                if (this.formantAlgorithm === 'density' && latestFormants.f2WidthLower && latestFormants.f2WidthUpper) {
                    const f2Width = Math.abs(latestFormants.f2WidthUpper - latestFormants.f2WidthLower);
                    targetCtx.fillText(`${Math.round(f2Width)} Hz`, sidebarStartX + barWidth - 70, f2Y + 15);
                }
            }
        }
    }
    
    drawPitchSidebar(startX, maxFreq, ctx = null, width = null, height = null) {
        const sidebarWidth = 100; // 100px at display resolution
        const targetCtx = ctx || this.spectrumCtx;
        const targetWidth = width || this.spectrumWidth;
        const targetHeight = height || this.spectrumHeight;
        const sidebarStartX = targetWidth - sidebarWidth + 1;
        
        // Clear the sidebar area
        targetCtx.clearRect(sidebarStartX, 0, sidebarWidth, targetHeight);
        
        // Draw background for pitch sidebar with a subtle gradient
        const backgroundGradient = targetCtx.createLinearGradient(sidebarStartX, 0, sidebarStartX + sidebarWidth, 0);
        backgroundGradient.addColorStop(0, 'rgba(100, 100, 100, 0.5)');
        backgroundGradient.addColorStop(0.5, 'rgba(123, 121, 121, 0.6)');
        backgroundGradient.addColorStop(1, 'rgba(100, 100, 100, 0.5)');
        targetCtx.fillStyle = backgroundGradient;
        targetCtx.fillRect(sidebarStartX, 0, sidebarWidth, targetHeight);
        
        // Draw border for sidebar
        targetCtx.strokeStyle = 'rgba(170, 170, 170, 0.9)';
        targetCtx.lineWidth = 1;
        targetCtx.beginPath();
        targetCtx.moveTo(sidebarStartX, 0);
        targetCtx.lineTo(sidebarStartX, targetHeight);
        targetCtx.stroke();
        
        // Draw musical note scale grid
        this.drawMusicalNoteGrid(sidebarStartX, sidebarWidth, targetCtx, targetHeight);
        
        // Display detected pitch and tracker line
        if (this.pitchHistory && this.pitchHistory.length > 0) {
            const latestPitch = this.pitchHistory[this.pitchHistory.length - 1];
            if (latestPitch > 0) {
                const y = this.getPitchYPosition(latestPitch, targetHeight);
                const note = this.frequencyToNote(latestPitch);
                
                // Draw tracker line for pitch
                targetCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Red for visibility
                targetCtx.lineWidth = 2;
                targetCtx.beginPath();
                targetCtx.moveTo(sidebarStartX, y);
                targetCtx.lineTo(sidebarStartX + sidebarWidth, y);
                targetCtx.stroke();
                
                // Display pitch value and note
                targetCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                targetCtx.font = '12px Arial';
                targetCtx.fillText(`${Math.round(latestPitch)} Hz (${note})`, sidebarStartX + 10, y - 5);
            }
        }
        
        // Title for pitch sidebar
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        targetCtx.font = '12px Arial';
        targetCtx.fillText('Pitch Scale', sidebarStartX + 10, 20);
    }
    
    drawMusicalNoteGrid(startX, width, ctx = null, height = null) {
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
        
        const targetCtx = ctx || this.spectrumCtx;
        const targetHeight = height || this.spectrumHeight;
        targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        targetCtx.lineWidth = 1;
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // Increased contrast for labels
        targetCtx.font = '10px Arial';
        
        notes.forEach(note => {
            const y = this.getPitchYPosition(note.freq, targetHeight);
            const nextY = note.freq < 523.25 ? this.getPitchYPosition(notes[notes.findIndex(n => n.freq === note.freq) + 1].freq, targetHeight) : y - 10;
            const boxHeight = (y - nextY) * 0.8;
            
            // Create a shiny horizontal gradient for the box
            const gradient = targetCtx.createLinearGradient(startX, 0, startX + width, 0);
            gradient.addColorStop(0, 'rgba(100, 100, 100, 0.5)');
            gradient.addColorStop(0.5, 'rgba(150, 150, 150, 0.7)');
            gradient.addColorStop(1, 'rgba(100, 100, 100, 0.5)');
            targetCtx.fillStyle = gradient;
            targetCtx.fillRect(startX, nextY + (boxHeight * 0.1), width, boxHeight);
            
            // Draw line on top of the box
            targetCtx.beginPath();
            targetCtx.moveTo(startX, y);
            targetCtx.lineTo(startX + width, y);
            targetCtx.stroke();
            
            // Label major notes (C notes) with increased contrast
            if (note.name.startsWith('C')) {
                targetCtx.fillText(note.name, startX + 10, y - 5);
            }
        });
    }
    
    getPitchYPosition(frequency, height = null) {
        const targetHeight = height || this.spectrumHeight;
        const minFreq = 60; // C2
        const maxFreq = 550; // Roughly C5
        const logFreq = Math.log(frequency);
        const logMin = Math.log(minFreq);
        const logMax = Math.log(maxFreq);
        const normalized = (logFreq - logMin) / (logMax - logMin);
        return targetHeight - (normalized * targetHeight);
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
    
    drawSpectrumLogAxes() {
        this.spectrumLogCtx.strokeStyle = 'rgba(170, 170, 170, 0.9)';
        this.spectrumLogCtx.lineWidth = 1; // Thinner lines for axes
        this.spectrumLogCtx.font = '10px Arial'; // Smaller font for labels
        this.spectrumLogCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.spectrumLogCtx.setLineDash([]);
        
        // Y-axis (Frequency - Logarithmic)
        this.spectrumLogCtx.beginPath();
        this.spectrumLogCtx.moveTo(30, 0);
        this.spectrumLogCtx.lineTo(30, this.spectrumLogHeight);
        this.spectrumLogCtx.stroke();
        const maxFreq = 3500;
        const minFreq = 50; // Starting point for logarithmic scale
        const logMax = Math.log(maxFreq);
        const logMin = Math.log(minFreq);
        const logRange = logMax - logMin;
        const steps = [50, 100, 200, 400, 800, 1600, 3200]; // Logarithmic steps
        steps.forEach(freq => {
            const logFreq = Math.log(freq);
            const normalized = (logFreq - logMin) / logRange;
            const y = this.spectrumLogHeight - (normalized * this.spectrumLogHeight);
            this.spectrumLogCtx.fillText(`${freq} Hz`, 2, y + 4); // Adjusted position to prevent clipping
            this.spectrumLogCtx.beginPath();
            this.spectrumLogCtx.moveTo(25, y);
            this.spectrumLogCtx.lineTo(35, y);
            this.spectrumLogCtx.stroke();
        });
        
        // X-axis (Time)
        this.spectrumLogCtx.beginPath();
        this.spectrumLogCtx.moveTo(0, (this.spectrumLogHeight) - 30);
        this.spectrumLogCtx.lineTo(this.spectrumLogWidth, (this.spectrumLogHeight) - 30);
        this.spectrumLogCtx.stroke();
        const timeStep = this.historySeconds / 5;
        for (let i = 0; i <= 5; i++) {
            const x = i * ((this.spectrumLogWidth) / 5);
            const timeLabel = (timeStep * (5 - i)).toFixed(1); // Reverse the time labels
            // Adjusted position to prevent clipping at edges
            let labelX = x - 20;
            if (i === 0) labelX = x;
            else if (i === 5) labelX = x - 40;
            this.spectrumLogCtx.fillText(`${timeLabel}s`, labelX, (this.spectrumLogHeight * 2) - 10);
            this.spectrumLogCtx.beginPath();
            this.spectrumLogCtx.moveTo(x, (this.spectrumLogHeight) - 25);
            this.spectrumLogCtx.lineTo(x, (this.spectrumLogHeight) - 35);
            this.spectrumLogCtx.stroke();
        }
    }
    
    drawSpectrumLog() {
        this.spectrumLogCtx.clearRect(0, 0, this.spectrumLogWidth * 2, this.spectrumLogHeight * 2 - 200);
        
        const maxFreq = 3500; // Focus on 0-3500 Hz
        const minFreq = 50; // Starting point for logarithmic scale
        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * this.freqBins);
        const voiceprintWidth = (this.spectrumLogWidth * 2) - 400; // Reserve 400 pixels for two sidebars
        const sliceWidth = voiceprintWidth / (this.historySeconds * this.frameRate);
        const logMax = Math.log(maxFreq);
        const logMin = Math.log(minFreq);
        const logRange = logMax - logMin;
        const binHeight = (this.spectrumLogHeight * 2) / maxBin;
        
        // Use image data for manual pixel calculation for logarithmic voiceprint spectrum with higher resolution
        const imageData = this.spectrumLogCtx.createImageData(voiceprintWidth, this.spectrumLogHeight * 2);
        for (let i = 0; i < this.spectrumHistory.length; i++) {
            const x = Math.floor(i * sliceWidth);
            const slice = this.spectrumHistory[i];
            let prevY = -1;
            let prevValue = 0;
            
            for (let j = 0; j < maxBin; j++) {
                const freq = (j / maxBin) * maxFreq;
                const logFreq = Math.log(freq + 1); // Add 1 to avoid log(0)
                const normalized = (logFreq - logMin) / logRange;
                const y = Math.floor((this.spectrumLogHeight * 2) - (normalized * (this.spectrumLogHeight * 2)));
                const value = slice[j];
                const rgb = this.getColorForPower(value);
                
                // Interpolate between data points if there are gaps
                if (prevY !== -1 && Math.abs(y - prevY) > 1) {
                    const yDiff = y - prevY;
                    const valueDiff = value - prevValue;
                    const step = yDiff > 0 ? 1 : -1;
                    for (let k = step; yDiff > 0 ? k < yDiff : k > yDiff; k += step) {
                        const interpY = prevY + k;
                        const interpValue = Math.floor(prevValue + (valueDiff * (k / yDiff)));
                        const interpRgb = this.getColorForPower(interpValue);
                        for (let dx = 0; dx < sliceWidth && x + dx < voiceprintWidth; dx++) {
                            if (interpY >= 0 && interpY < this.spectrumLogHeight * 2) {
                                const pixelIndex = (interpY * voiceprintWidth + (x + dx)) * 4;
                                imageData.data[pixelIndex] = interpRgb.r;
                                imageData.data[pixelIndex + 1] = interpRgb.g;
                                imageData.data[pixelIndex + 2] = interpRgb.b;
                                imageData.data[pixelIndex + 3] = 255;
                            }
                        }
                    }
                }
                
                // Fill the current data point with a larger vertical span to cover gaps
                for (let dx = 0; dx < sliceWidth && x + dx < voiceprintWidth; dx++) {
                    for (let dy = -Math.ceil(binHeight/2); dy <= Math.ceil(binHeight/2) && y + dy < this.spectrumLogHeight * 2; dy++) {
                        if (y + dy >= 0) {
                            const pixelIndex = ((y + dy) * voiceprintWidth + (x + dx)) * 4;
                            imageData.data[pixelIndex] = rgb.r;
                            imageData.data[pixelIndex + 1] = rgb.g;
                            imageData.data[pixelIndex + 2] = rgb.b;
                            imageData.data[pixelIndex + 3] = 255;
                        }
                    }
                }
                
                prevY = y;
                prevValue = value;
            }
        }
        this.spectrumLogCtx.putImageData(imageData, 0, 0);
        
        // Draw formant lines (F1 and F2) on the logarithmic voiceprint spectrum for the latest data
        let latestFormants = { f1: 0, f2: 0, f1WidthLower: 0, f1WidthUpper: 0 }; // Default empty object if no formants
        if (this.formantHistory.length > 0) {
            latestFormants = this.formantHistory[this.formantHistory.length - 1];
            if (latestFormants.f1 && latestFormants.f2) {
                const logF1 = Math.log(latestFormants.f1 + 1) / logRange;
                const logF2 = Math.log(latestFormants.f2 + 1) / logRange;
                const f1Y = (this.spectrumLogHeight * 2) - (logF1 * (this.spectrumLogHeight * 2));
                const f2Y = (this.spectrumLogHeight * 2) - (logF2 * (this.spectrumLogHeight * 2));
                
                this.spectrumLogCtx.strokeStyle = 'rgba(0, 255, 255, 0.7)'; // Cyan for visibility
                this.spectrumLogCtx.lineWidth = 2;
                this.spectrumLogCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                this.spectrumLogCtx.font = '10px Arial';
                
                // F1 line
                this.spectrumLogCtx.beginPath();
                this.spectrumLogCtx.moveTo(voiceprintWidth - sliceWidth, f1Y);
                this.spectrumLogCtx.lineTo(voiceprintWidth, f1Y);
                this.spectrumLogCtx.stroke();
                this.spectrumLogCtx.fillText(`${Math.round(latestFormants.f1)} Hz`, voiceprintWidth - 60, f1Y - 5);
                
                // F2 line
                this.spectrumLogCtx.beginPath();
                this.spectrumLogCtx.moveTo(voiceprintWidth - sliceWidth, f2Y);
                this.spectrumLogCtx.lineTo(voiceprintWidth, f2Y);
                this.spectrumLogCtx.stroke();
                this.spectrumLogCtx.fillText(`${Math.round(latestFormants.f2)} Hz`, voiceprintWidth - 60, f2Y - 5);

                // Draw F1 width bounds if available (for density algorithm)
                if (this.formantAlgorithm === 'density' && latestFormants.f1WidthLower && latestFormants.f1WidthUpper) {
                    const logLower = Math.log(latestFormants.f1WidthLower + 1) / logRange;
                    const logUpper = Math.log(latestFormants.f1WidthUpper + 1) / logRange;
                    const lowerY = (this.spectrumLogHeight * 2) - (logLower * (this.spectrumLogHeight * 2));
                    const upperY = (this.spectrumLogHeight * 2) - (logUpper * (this.spectrumLogHeight * 2));
                    
                    // Draw a translucent pink box to cover the width
                    this.spectrumLogCtx.fillStyle = 'rgba(255, 105, 180, 0.6)'; // Pink with 0.6 opacity
                    this.spectrumLogCtx.fillRect(0, upperY, voiceprintWidth, lowerY - upperY);
                    
                    this.spectrumLogCtx.strokeStyle = 'rgba(255, 165, 0, 0.5)'; // Orange for visibility
                    this.spectrumLogCtx.lineWidth = 1;
                    
                    // Lower bound line
                    this.spectrumLogCtx.beginPath();
                    this.spectrumLogCtx.moveTo(voiceprintWidth - sliceWidth, lowerY);
                    this.spectrumLogCtx.lineTo(voiceprintWidth, lowerY);
                    this.spectrumLogCtx.stroke();
                    this.spectrumLogCtx.fillText(`${Math.round(latestFormants.f1WidthLower)} Hz`, voiceprintWidth - 60, lowerY - 5);
                    
                    // Upper bound line
                    this.spectrumLogCtx.beginPath();
                    this.spectrumLogCtx.moveTo(voiceprintWidth - sliceWidth, upperY);
                    this.spectrumLogCtx.lineTo(voiceprintWidth, upperY);
                    this.spectrumLogCtx.stroke();
                    this.spectrumLogCtx.fillText(`${Math.round(latestFormants.f1WidthUpper)} Hz`, voiceprintWidth - 60, upperY - 5);
                }
                
                // Draw F2 width bounds if available (for density algorithm)
                if (this.formantAlgorithm === 'density' && latestFormants.f2WidthLower && latestFormants.f2WidthUpper) {
                    const logLower = Math.log(latestFormants.f2WidthLower + 1) / logRange;
                    const logUpper = Math.log(latestFormants.f2WidthUpper + 1) / logRange;
                    const lowerY = (this.spectrumLogHeight * 2) - (logLower * (this.spectrumLogHeight * 2));
                    const upperY = (this.spectrumLogHeight * 2) - (logUpper * (this.spectrumLogHeight * 2));
                    
                    // Draw a translucent yellow box to cover the width
                    this.spectrumLogCtx.fillStyle = 'rgba(255, 255, 0, 0.6)'; // Yellow with 0.6 opacity
                    this.spectrumLogCtx.fillRect(0, upperY, voiceprintWidth, lowerY - upperY);
                    
                    this.spectrumLogCtx.strokeStyle = 'rgba(255, 165, 0, 0.5)'; // Orange for visibility
                    this.spectrumLogCtx.lineWidth = 1;
                    
                    // Lower bound line
                    this.spectrumLogCtx.beginPath();
                    this.spectrumLogCtx.moveTo(voiceprintWidth - sliceWidth, lowerY);
                    this.spectrumLogCtx.lineTo(voiceprintWidth, lowerY);
                    this.spectrumLogCtx.stroke();
                    this.spectrumLogCtx.fillText(`${Math.round(latestFormants.f2WidthLower)} Hz`, voiceprintWidth - 60, lowerY - 5);
                    
                    // Upper bound line
                    this.spectrumLogCtx.beginPath();
                    this.spectrumLogCtx.moveTo(voiceprintWidth - sliceWidth, upperY);
                    this.spectrumLogCtx.lineTo(voiceprintWidth, upperY);
                    this.spectrumLogCtx.stroke();
                    this.spectrumLogCtx.fillText(`${Math.round(latestFormants.f2WidthUpper)} Hz`, voiceprintWidth - 60, upperY - 5);
                }
            }
        }
        
        // Draw live spectral analysis sidebar on the right (left part of the sidebar) with logarithmic scale
        this.drawLiveSpectrumSidebar(voiceprintWidth, maxFreq, maxBin, binHeight, latestFormants, true, this.spectrumLogCtx, this.spectrumLogWidth, this.spectrumLogHeight);
        
        // Draw musical note scale sidebar on the right (right part of the sidebar)
        this.drawPitchSidebar(voiceprintWidth + 200, maxFreq, this.spectrumLogCtx, this.spectrumLogWidth, this.spectrumLogHeight);
        
        // Draw axes last to ensure they are on top
        this.drawSpectrumLogAxes();
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
