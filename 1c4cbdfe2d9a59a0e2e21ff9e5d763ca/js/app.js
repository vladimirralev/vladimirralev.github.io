import { AudioEngine } from './audio.js';
import { Visualizer } from './ui.js';

class App {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.visualizer = new Visualizer(this.audioEngine);

        this.initUI();
        this.animate();
    }

    initUI() {
        const micBtn = document.getElementById('mic-btn');
        const fileBtn = document.getElementById('file-btn');

        micBtn.addEventListener('click', async () => {
            const span = micBtn.querySelector('span');
            if (this.audioEngine.isRunning) {
                this.audioEngine.stop();
                micBtn.classList.remove('active');
                span.textContent = 'Microphone';
            } else {
                try {
                    await this.audioEngine.startMic();
                    micBtn.classList.add('active');
                    span.textContent = 'Stop Mic';
                } catch (e) {
                    console.error('Mic error:', e);
                    alert('Could not access microphone');
                }
            }
        });

        fileBtn.addEventListener('click', () => {
            alert('File loading not implemented yet');
        });

        const testToneBtn = document.getElementById('test-tone-btn');
        testToneBtn.addEventListener('click', () => {
            this.audioEngine.startTestTone();
        });

        const logBtn = document.getElementById('log-scale-btn');
        logBtn.addEventListener('click', (e) => {
            const btn = e.target;
            const isLog = !btn.classList.contains('active');
            if (isLog) btn.classList.add('active');
            else btn.classList.remove('active');

            this.visualizer.setLogScale(isLog);
        });

        // Settings Listeners
        document.getElementById('pitch-algo').addEventListener('change', (e) => {
            if (this.audioEngine.dsp) {
                this.audioEngine.dsp.setPitchAlgorithm(e.target.value);
                console.log('Pitch Algorithm set to:', e.target.value);
            }
        });

        document.getElementById('formant-algo').addEventListener('change', (e) => {
            if (this.audioEngine.dsp) {
                this.audioEngine.dsp.setFormantAlgorithm(e.target.value);
                console.log('Formant Algorithm set to:', e.target.value);
            }
        });

        document.getElementById('fft-size').addEventListener('change', (e) => {
            const size = parseInt(e.target.value);
            this.audioEngine.setFFTSize(size);
        });
    }

    animate() {
        if (!this.audioEngine.isRunning) {
            requestAnimationFrame(() => this.animate()); // Keep requesting frames even if not running, to allow starting later
            return;
        }

        try {
            const data = this.audioEngine.getAnalysisData();
            if (data) {
                this.visualizer.draw(data);
            }
        } catch (e) {
            console.error('Animation Loop Error:', e);
            // Stop engine to prevent spam
            this.audioEngine.stop();

            // Show error on screen
            const ctx = this.visualizer.specCtx;
            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.fillStyle = 'white';
            ctx.font = '20px monospace';
            ctx.fillText('CRITICAL ERROR:', 20, 50);
            ctx.fillText(e.message, 20, 80);
            ctx.font = '14px monospace';
            ctx.fillText(e.stack.split('\n')[0], 20, 110);
            requestAnimationFrame(() => this.animate()); // Continue requesting frames to keep error visible
            return;
        }

        requestAnimationFrame(() => this.animate());
    }
}

// Start app when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.app = app;
    window.visualizer = app.visualizer;
    window.audioEngine = app.audioEngine;
});
