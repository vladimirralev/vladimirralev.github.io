export class DSP {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.pitchAlgo = 'yin'; // Default to YIN
        this.formantAlgo = 'lpc'; // Default to LPC for now
    }

    setPitchAlgorithm(algo) {
        this.pitchAlgo = algo;
    }

    setFormantAlgorithm(algo) {
        this.formantAlgo = algo;
    }

    getPitch(timeData) {
        if (this.pitchAlgo === 'yin') {
            return this.getPitchYIN(timeData);
        }
        return this.getPitchAutocorrelation(timeData);
    }

    getFormants(timeData) {
        if (this.formantAlgo === 'mfcc') {
            return this.getFormantsMFCC(timeData);
        }
        if (this.formantAlgo === 'cepstral') {
            return this.getFormantsCepstral(timeData);
        }
        return this.getFormantsLPC(timeData);
    }

    getPitchAutocorrelation(timeData) {
        // Simple Autocorrelation
        let bestOffset = -1;
        let maxCorrelation = 0;
        let rms = 0;

        // Calculate RMS to gate silence
        for (let i = 0; i < timeData.length; i++) {
            rms += timeData[i] * timeData[i];
        }
        rms = Math.sqrt(rms / timeData.length);
        if (rms < 0.001) return null; // Silence

        const minPeriod = Math.floor(this.sampleRate / 2000); // Max 2000Hz
        const maxPeriod = Math.floor(this.sampleRate / 50);   // Min 50Hz

        for (let offset = minPeriod; offset < maxPeriod; offset++) {
            let correlation = 0;
            for (let i = 0; i < timeData.length - offset; i++) {
                correlation += timeData[i] * timeData[i + offset];
            }

            // Normalize
            if (correlation > maxCorrelation) {
                maxCorrelation = correlation;
                bestOffset = offset;
            }
        }

        if (maxCorrelation > 0.5 && bestOffset !== -1) { // Threshold
            return this.sampleRate / bestOffset;
        }

        return null;
    }

    getPitchYIN(timeData) {
        const threshold = 0.15; // YIN threshold
        const bufferSize = timeData.length;
        // Use half buffer size for difference function to avoid running out of data
        const yinBufferLength = Math.floor(bufferSize / 2);
        const yinBuffer = new Float32Array(yinBufferLength);

        // 0. RMS Check for Silence
        let rms = 0;
        for (let i = 0; i < bufferSize; i++) {
            rms += timeData[i] * timeData[i];
        }
        rms = Math.sqrt(rms / bufferSize);
        if (rms < 0.001) return null;

        // 1. Difference Function
        for (let t = 0; t < yinBufferLength; t++) {
            yinBuffer[t] = 0;
        }
        for (let t = 1; t < yinBufferLength; t++) {
            for (let i = 0; i < yinBufferLength; i++) {
                const delta = timeData[i] - timeData[i + t];
                yinBuffer[t] += delta * delta;
            }
        }

        // 2. Cumulative Mean Normalized Difference Function
        yinBuffer[0] = 1;
        let runningSum = 0;
        for (let t = 1; t < yinBufferLength; t++) {
            runningSum += yinBuffer[t];
            if (runningSum > 0) {
                yinBuffer[t] *= t / runningSum;
            } else {
                yinBuffer[t] = 1; // Fallback if sum is 0 (perfect silence/flat)
            }
        }

        // 3. Absolute Threshold
        let tau = -1;
        for (let t = 2; t < yinBufferLength; t++) {
            if (yinBuffer[t] < threshold) {
                while (t + 1 < yinBufferLength && yinBuffer[t + 1] < yinBuffer[t]) {
                    t++;
                }
                tau = t;
                break;
            }
        }

        // 4. Parabolic Interpolation
        if (tau !== -1) {
            const betterTau = this.parabolicInterpolation(yinBuffer, tau);
            return this.sampleRate / betterTau;
        }

        // 5. Global Minimum (if no threshold match)
        let minVal = Number.POSITIVE_INFINITY;
        let minTau = -1;
        for (let t = 2; t < yinBufferLength; t++) {
            if (yinBuffer[t] < minVal) {
                minVal = yinBuffer[t];
                minTau = t;
            }
        }

        if (minTau !== -1 && minVal < 0.5) { // Relaxed threshold for fallback
            const betterTau = this.parabolicInterpolation(yinBuffer, minTau);
            return this.sampleRate / betterTau;
        }

        return null;
    }

    parabolicInterpolation(array, x) {
        const x0 = x < 1 ? x : x - 1;
        const x2 = x + 1 < array.length ? x + 1 : x;
        if (x0 === x) return x;
        if (x2 === x) return x;

        const s0 = array[x0];
        const s1 = array[x];
        const s2 = array[x2];

        const newx = x + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
        return newx;
    }

    getFormantsLPC(timeData) {
        // ... (Existing LPC implementation)
        const n = timeData.length;
        const order = 12; // LPC order

        // 1. Apply Hamming Window
        const windowed = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            windowed[i] = timeData[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
        }

        // 2. Autocorrelation (up to order)
        const r = new Float32Array(order + 1);
        for (let k = 0; k <= order; k++) {
            let sum = 0;
            for (let i = 0; i < n - k; i++) {
                sum += windowed[i] * windowed[i + k];
            }
            r[k] = sum;
        }

        if (r[0] === 0) return []; // Silence

        // 3. Levinson-Durbin Recursion
        const a = new Float32Array(order + 1);
        a[0] = 1;
        let e = r[0];

        // Temporary array for recursion
        const a_prev = new Float32Array(order + 1);

        for (let k = 1; k <= order; k++) {
            let sum = 0;
            for (let j = 1; j < k; j++) {
                sum += a_prev[j] * r[k - j];
            }

            const k_coeff = -(r[k] + sum) / e;

            a[k] = k_coeff;
            for (let j = 1; j < k; j++) {
                a[j] = a_prev[j] + k_coeff * a_prev[k - j];
            }

            e = e * (1 - k_coeff * k_coeff);

            // Update a_prev
            for (let j = 0; j <= k; j++) a_prev[j] = a[j];
        }

        // 4. Calculate LPC Spectrum and find peaks
        const formants = [];
        const numPoints = 512;
        let lastMag = 0;
        let lastSlope = 0; // +1 for up, -1 for down

        for (let i = 0; i < numPoints; i++) {
            const w = (Math.PI * i) / numPoints; // 0 to PI (Nyquist)

            // Evaluate A(z) at z = e^(jw)
            let re = 0;
            let im = 0;
            for (let k = 0; k <= order; k++) {
                re += a[k] * Math.cos(-w * k);
                im += a[k] * Math.sin(-w * k);
            }

            const mag = 1 / Math.sqrt(re * re + im * im);

            // Peak picking
            if (mag < lastMag && lastSlope > 0) {
                // Local maximum found at i-1
                const freq = ((i - 1) / numPoints) * (this.sampleRate / 2);
                if (freq > 200 && freq < 5000) { // Filter reasonable range
                    formants.push(freq);
                }
            }

            if (mag > lastMag) lastSlope = 1;
            else if (mag < lastMag) lastSlope = -1;

            lastMag = mag;
        }

        return formants.slice(0, 3); // Return top 3 formants
    }

    getFormantsCepstral(timeData) {
        const n = timeData.length;

        // 0. Pre-emphasis (Disabled - causing high freq boost)
        // const preEmphasis = new Float32Array(n);
        // preEmphasis[0] = timeData[0];
        // for (let i = 1; i < n; i++) {
        //     preEmphasis[i] = timeData[i] - 0.6 * timeData[i - 1];
        // }

        // 1. Windowing (Hamming)
        const windowed = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            // windowed[i] = preEmphasis[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
            windowed[i] = timeData[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
        }

        // 2. Real FFT
        const spectrum = this.fft(windowed); // Returns {real, imag}

        // 3. Log Magnitude
        const logMag = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const mag = Math.sqrt(spectrum.real[i] * spectrum.real[i] + spectrum.imag[i] * spectrum.imag[i]);
            logMag[i] = Math.log(mag + 1e-10); // Avoid log(0)
        }

        // 4. IFFT to get Real Cepstrum
        // Since logMag is real and symmetric (for real signal), we can treat it as real input to IFFT
        // But here we just have the log magnitude of the positive frequencies (and negative implied).
        // For a real signal, the log spectrum is even.
        const cepstrum = this.ifft(logMag, new Float32Array(n)); // Returns {real, imag}

        // 5. Liftering (Low-pass in Cepstral domain)
        // Keep low quesfrency (spectral envelope), remove high quesfrency (pitch pulses)
        const liftered = new Float32Array(n);
        const cutoff = 16; // Reduced to 16 for SMOOTHER envelope (removes pitch harmonics)

        for (let i = 0; i < n; i++) {
            if (i < cutoff || i > n - cutoff) {
                liftered[i] = cepstrum.real[i];
            } else {
                liftered[i] = 0;
            }
        }

        // 6. FFT back to Spectral Domain (Smoothed Spectrum)
        const envelope = this.fft(liftered);

        // 7. Peak Picking on Envelope Magnitude
        const formants = [];
        const numPoints = n / 2; // Nyquist
        let lastMag = 0;
        let lastSlope = 0;

        for (let i = 0; i < numPoints; i++) {
            const mag = Math.sqrt(envelope.real[i] * envelope.real[i] + envelope.imag[i] * envelope.imag[i]);

            if (mag < lastMag && lastSlope > 0) {
                const freq = (i - 1) * this.sampleRate / n;
                if (freq > 200 && freq < 5000) {
                    formants.push(freq);
                }
            }

            if (mag > lastMag) lastSlope = 1;
            else if (mag < lastMag) lastSlope = -1;

            lastMag = mag;
        }

        // Extra safety filter
        return formants.filter(f => f > 200 && f < 5000).slice(0, 3);
    }

    getFormantsMFCC(timeData) {
        const n = timeData.length;
        const numFilters = 40; // Number of Mel filters
        const numCoeffs = 13;  // Number of MFCCs to keep (liftering)

        // 1. Windowing
        const windowed = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            windowed[i] = timeData[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
        }

        // 2. Power Spectrum
        const spectrum = this.fft(windowed);
        const powerSpec = new Float32Array(n / 2 + 1);
        for (let i = 0; i < n / 2 + 1; i++) {
            const freq = i * this.sampleRate / n;
            // Apply spectral attenuation (De-emphasis) to suppress high frequency boost
            // 1 / (1 + (freq/1000)^2) - aggressive low pass
            const attenuation = 1.0 / (1.0 + Math.pow(freq / 1000, 1.5));
            powerSpec[i] = (spectrum.real[i] * spectrum.real[i] + spectrum.imag[i] * spectrum.imag[i]) / n * attenuation;
        }

        // 3. Mel Filterbank Integration
        if (!this.melFilters || this.melFilters.length !== numFilters || this.melFilters[0].length !== n / 2 + 1) {
            this.melFilters = this.createMelFilterbank(numFilters, n, this.sampleRate);
        }

        const melEnergies = new Float32Array(numFilters);
        for (let i = 0; i < numFilters; i++) {
            let sum = 0;
            for (let j = 0; j < n / 2 + 1; j++) {
                sum += powerSpec[j] * this.melFilters[i][j];
            }
            melEnergies[i] = Math.log(sum + 1e-10); // Log Mel Energies
        }

        // 4. DCT to get MFCCs
        const mfccs = this.dct(melEnergies, numCoeffs);

        // 5. IDCT to reconstruct smoothed Mel Envelope
        // We use the first 'numCoeffs' MFCCs to reconstruct the envelope
        // The result will be in the Mel-frequency domain (indices 0 to numFilters-1)
        const smoothedMelEnv = this.idct(mfccs, numFilters);

        // 6. Peak Picking on Mel Envelope
        const formants = [];

        // Helper to convert Mel-bin index to Hz
        // The Mel filters are equally spaced in Mel scale
        const minMel = this.hzToMel(0);
        const maxMel = this.hzToMel(this.sampleRate / 2);
        const melStep = (maxMel - minMel) / (numFilters + 1);

        const melBinToHz = (binIndex) => {
            const mel = minMel + (binIndex + 1) * melStep; // +1 because filters start at index 1
            return this.melToHz(mel);
        };

        // Simple peak picking
        for (let i = 1; i < numFilters - 1; i++) {
            if (smoothedMelEnv[i] > smoothedMelEnv[i - 1] && smoothedMelEnv[i] > smoothedMelEnv[i + 1]) {
                // Parabolic interpolation for better precision
                const alpha = smoothedMelEnv[i - 1];
                const beta = smoothedMelEnv[i];
                const gamma = smoothedMelEnv[i + 1];
                const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);

                const freq = melBinToHz(i + p);

                if (freq > 200 && freq < 5000) {
                    formants.push(freq);
                }
            }
        }

        return formants.slice(0, 3);
    }

    createMelFilterbank(numFilters, fftSize, sampleRate) {
        const minMel = this.hzToMel(0);
        const maxMel = this.hzToMel(sampleRate / 2);
        const melStep = (maxMel - minMel) / (numFilters + 1);

        const melPoints = new Float32Array(numFilters + 2);
        for (let i = 0; i < numFilters + 2; i++) {
            melPoints[i] = this.melToHz(minMel + i * melStep);
        }

        const binPoints = new Int32Array(numFilters + 2);
        for (let i = 0; i < numFilters + 2; i++) {
            binPoints[i] = Math.floor((numFilters + 1) * melPoints[i] / sampleRate * fftSize); // Wrong formula?
            // Correct: bin = freq * (fftSize / sampleRate) = freq * fftSize / sampleRate
            // Wait, bin index corresponds to FFT bin index.
            // Max bin is fftSize/2.
            binPoints[i] = Math.floor((fftSize + 1) * melPoints[i] / sampleRate); // Still looks weird
            // Standard: bin = floor( (fftSize+1) * freq / sampleRate )
            binPoints[i] = Math.floor(melPoints[i] / (sampleRate / 2) * (fftSize / 2));
        }

        const filters = [];
        for (let i = 1; i <= numFilters; i++) {
            const filter = new Float32Array(fftSize / 2 + 1);
            for (let j = 0; j < fftSize / 2 + 1; j++) {
                if (j < binPoints[i - 1]) {
                    filter[j] = 0;
                } else if (j >= binPoints[i - 1] && j < binPoints[i]) {
                    filter[j] = (j - binPoints[i - 1]) / (binPoints[i] - binPoints[i - 1]);
                } else if (j >= binPoints[i] && j < binPoints[i + 1]) {
                    filter[j] = (binPoints[i + 1] - j) / (binPoints[i + 1] - binPoints[i]);
                } else {
                    filter[j] = 0;
                }
            }
            filters.push(filter);
        }
        return filters;
    }

    hzToMel(hz) {
        return 2595 * Math.log10(1 + hz / 700);
    }

    melToHz(mel) {
        return 700 * (Math.pow(10, mel / 2595) - 1);
    }

    dct(input, numCoeffs) {
        const N = input.length;
        const output = new Float32Array(numCoeffs);
        for (let k = 0; k < numCoeffs; k++) {
            let sum = 0;
            for (let n = 0; n < N; n++) {
                sum += input[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N));
            }
            output[k] = sum; // Orthogonal normalization omitted for simplicity as we just need shape
        }
        return output;
    }

    idct(input, numPoints) {
        const M = input.length;
        const output = new Float32Array(numPoints);
        for (let n = 0; n < numPoints; n++) {
            let sum = input[0] / 2; // DC component
            for (let k = 1; k < M; k++) {
                sum += input[k] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * numPoints));
            }
            output[n] = sum; // Scaling omitted
        }
        return output;
    }

    // Simple Radix-2 FFT (Recursive) - Not optimized but sufficient for small buffers (e.g. 1024)
    // Input: Real array
    // Output: {real, imag}
    fft(inputReal, inputImag) {
        const n = inputReal.length;
        if (n <= 1) {
            return {
                real: inputReal,
                imag: inputImag || new Float32Array(n)
            };
        }

        const half = n / 2;
        const evenReal = new Float32Array(half);
        const evenImag = new Float32Array(half);
        const oddReal = new Float32Array(half);
        const oddImag = new Float32Array(half);

        const currentImag = inputImag || new Float32Array(n);

        for (let i = 0; i < half; i++) {
            evenReal[i] = inputReal[2 * i];
            evenImag[i] = currentImag[2 * i];
            oddReal[i] = inputReal[2 * i + 1];
            oddImag[i] = currentImag[2 * i + 1];
        }

        const even = this.fft(evenReal, evenImag);
        const odd = this.fft(oddReal, oddImag);

        const outReal = new Float32Array(n);
        const outImag = new Float32Array(n);

        for (let k = 0; k < half; k++) {
            const tReal = Math.cos(-2 * Math.PI * k / n) * odd.real[k] - Math.sin(-2 * Math.PI * k / n) * odd.imag[k];
            const tImag = Math.sin(-2 * Math.PI * k / n) * odd.real[k] + Math.cos(-2 * Math.PI * k / n) * odd.imag[k];

            outReal[k] = even.real[k] + tReal;
            outImag[k] = even.imag[k] + tImag;

            outReal[k + half] = even.real[k] - tReal;
            outImag[k + half] = even.imag[k] - tImag;
        }

        return { real: outReal, imag: outImag };
    }

    // Inverse FFT
    ifft(inputReal, inputImag) {
        const n = inputReal.length;

        // Conjugate input
        const conjImag = new Float32Array(n);
        for (let i = 0; i < n; i++) conjImag[i] = -inputImag[i];

        // Forward FFT
        const result = this.fft(inputReal, conjImag);

        // Conjugate result and scale
        const outReal = new Float32Array(n);
        const outImag = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            outReal[i] = result.real[i] / n;
            outImag[i] = -result.imag[i] / n;
        }

        return { real: outReal, imag: outImag };
    }
}
