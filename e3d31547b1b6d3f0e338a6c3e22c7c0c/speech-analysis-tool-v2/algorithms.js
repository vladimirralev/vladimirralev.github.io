// Speech Analysis Algorithms

/**
 * Estimates the first two formants (F1 and F2) from frequency data.
 * @param {Uint8Array} freqData - Frequency data from the analyser node.
 * @param {number} sampleRate - Sample rate of the audio context.
 * @returns {Object} - Estimated formant frequencies {f1, f2}.
 */
export function estimateFormants(freqData, sampleRate, algorithm = 'default') {
    if (algorithm === 'lpcc') {
        return estimateFormantsLPCC(freqData, sampleRate);
    } else if (algorithm === 'burg') {
        return estimateFormantsBurg(freqData, sampleRate);
    } else if (algorithm === 'autocorr') {
        return estimateFormantsAutocorr(freqData, sampleRate);
    } else if (algorithm === 'density') {
        const maxFreq = 3500; // Focus on 0-3500 Hz for speech formants
        const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * freqData.length);
        let f1 = 0, f2 = 0;
        let max1 = 0, max2 = 0;
        let f1Bin = -1, f2Bin = -1;
        let f2WidthLower = 0, f2WidthUpper = 0;
        
        // Search for peaks in the frequency data for f1
        for (let i = 0; i < maxBin; i++) {
            const freq = (i / freqData.length) * (sampleRate / 2);
            const value = freqData[i];
            
            // First formant typically between 300-1000 Hz
            if (freq > 300 && freq < 1000 && value > max1) {
                max1 = value;
                f1Bin = i;
                f1 = freq;
            }
        }
        
        let f1WidthLower = f1;
        let f1WidthUpper = f1;
        let valleyThreshold = 0.41;
        if (f1Bin !== -1) {
            // Look downwards for valley to determine lower bound of width
            let lowerBin = f1Bin;
            for (let i = f1Bin - 1; i >= 0; i--) {
                const freq = (i / freqData.length) * (sampleRate / 2);
                if (freqData[i] < max1 * valleyThreshold || freq < 300) { // Threshold for valley or below plausible f1 range
                    lowerBin = i;
                    break;
                }
            }
            f1WidthLower = Math.max(300, (lowerBin / freqData.length) * (sampleRate / 2));
            
            // Look upwards for valley to determine upper bound of width
            let upperBin = f1Bin;
            for (let i = f1Bin + 1; i < maxBin; i++) {
                const freq = (i / freqData.length) * (sampleRate / 2);
                if (freqData[i] < max1 * valleyThreshold || freq > 1000) { // Threshold for valley or above plausible f1 range
                    upperBin = i;
                    break;
                }
            }
            f1WidthUpper = Math.min(1000, (upperBin / freqData.length) * (sampleRate / 2));
            
            // Limit width to 400 Hz
            let width = f1WidthUpper - f1WidthLower;
            if (width > 400) {
                // Find the 200 Hz window with maximum power
                let maxPower = 0;
                let bestLowerBin = lowerBin;
                let bestUpperBin = upperBin;
                const targetWidthBins = Math.floor(200 / (sampleRate / 2) * freqData.length);
                
                for (let startBin = lowerBin; startBin <= upperBin - targetWidthBins; startBin++) {
                    let power = 0;
                    const endBin = startBin + targetWidthBins;
                    for (let j = startBin; j <= endBin && j < freqData.length; j++) {
                        power += freqData[j];
                    }
                    if (power > maxPower) {
                        maxPower = power;
                        bestLowerBin = startBin;
                        bestUpperBin = endBin;
                    }
                }
                
                f1WidthLower = Math.max(300, (bestLowerBin / freqData.length) * (sampleRate / 2));
                f1WidthUpper = Math.min(1000, (bestUpperBin / freqData.length) * (sampleRate / 2));
                width = f1WidthUpper - f1WidthLower;
            }
            const widthBins = Math.floor(width / (sampleRate / 2) * freqData.length);
            
            // Calculate total power at f1 over the width
            let f1Power = 0;
            for (let j = lowerBin; j <= upperBin && j < freqData.length; j++) {
                f1Power += freqData[j];
            }
            const f1PowerThreshold = (2 / 3) * f1Power;
            
            // Now find f2 by looking for the minimal frequency where total power in a bin of size width is at least 2/3 of f1 power
            let foundF2 = false;
            const f1Plus120Hz = f1 + 120;
            const f1Plus120HzBin = Math.floor((f1Plus120Hz / (sampleRate / 2)) * freqData.length);
            const startBinF2 = Math.max(upperBin, f1Plus120HzBin);
            for (let startBin = startBinF2; startBin < maxBin - widthBins; startBin++) {
                let power = 0;
                const endBin = startBin + widthBins;
                for (let j = startBin; j < endBin && j < maxBin; j++) {
                    power += freqData[j];
                }
                if (power >= f1PowerThreshold) {
                    f2Bin = Math.floor((startBin + endBin) / 2);
                    f2 = (f2Bin / freqData.length) * (sampleRate / 2);
                    foundF2 = true;
                    break;
                }
            }
            
            // If no f2 is found with power >= 2/3 of f1 power, default to finding max power in f2 range
            if (!foundF2) {
                let maxPower = 0;
                for (let startBin = startBinF2; startBin < maxBin - widthBins; startBin++) {
                    let power = 0;
                    const endBin = startBin + widthBins;
                    for (let j = startBin; j < endBin && j < maxBin; j++) {
                        power += freqData[j];
                    }
                    if (power > maxPower) {
                        maxPower = power;
                        f2Bin = Math.floor((startBin + endBin) / 2);
                        f2 = (f2Bin / freqData.length) * (sampleRate / 2);
                    }
                }
            }

            // Calculate F2 width bounds
            f2WidthLower = f2;
            f2WidthUpper = f2;
            let maxF2Power = freqData[f2Bin] || 0;
            if (f2Bin !== -1) {
                // Look downwards for valley to determine lower bound of width
                let lowerBinF2 = f2Bin;
                for (let i = f2Bin - 1; i >= startBinF2; i--) {
                    const freq = (i / freqData.length) * (sampleRate / 2);
                    if (freqData[i] < maxF2Power * valleyThreshold || freq < f1 + 120) {
                        lowerBinF2 = i;
                        break;
                    }
                }
                f2WidthLower = Math.max(f1 + 120, (lowerBinF2 / freqData.length) * (sampleRate / 2));
                
                // Look upwards for valley to determine upper bound of width
                let upperBinF2 = f2Bin;
                for (let i = f2Bin + 1; i < maxBin; i++) {
                    const freq = (i / freqData.length) * (sampleRate / 2);
                    if (freqData[i] < maxF2Power * valleyThreshold || freq > 2700) {
                        upperBinF2 = i;
                        break;i
                    }
                }
                f2WidthUpper = Math.min(2700, (upperBinF2 / freqData.length) * (sampleRate / 2));
                
                // Limit width to 400 Hz
                let f2Width = f2WidthUpper - f2WidthLower;
                if (f2Width > 400) {
                    // Find the 400 Hz window with maximum power
                    let maxPower = 0;
                    let bestLowerBin = lowerBinF2;
                    let bestUpperBin = upperBinF2;
                    const targetWidthBins = Math.floor(200 / (sampleRate / 2) * freqData.length);
                    
                    for (let startBin = lowerBinF2; startBin <= upperBinF2 - targetWidthBins; startBin++) {
                        let power = 0;
                        const endBin = startBin + targetWidthBins;
                        for (let j = startBin; j <= endBin && j < freqData.length; j++) {
                            power += freqData[j];
                        }
                        if (power > maxPower) {
                            maxPower = power;
                            bestLowerBin = startBin;
                            bestUpperBin = endBin;
                        }
                    }
                    
                    f2WidthLower = Math.max(f1 + 120, (bestLowerBin / freqData.length) * (sampleRate / 2));
                    f2WidthUpper = Math.min(2700, (bestUpperBin / freqData.length) * (sampleRate / 2));
                }
            }
        }
        
        let MIN_POWER = 1;
        // Basic validation: F2 should be higher than F1, and there should be significant energy
        if (f1 > 0 && f2 > f1 && max1 >= MIN_POWER) {
            return { f1, f2, f1WidthLower, f1WidthUpper, f2WidthLower, f2WidthUpper };
        }
        return { f1: 0, f2: 0, f1WidthLower: 0, f1WidthUpper: 0, f2WidthLower: 0, f2WidthUpper: 0 };
    } else {
        const maxFreq = 3500; // Focus on 0-3500 Hz for speech formants
        const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * freqData.length);
        let f1 = 0, f2 = 0;
        let max1 = 0, max2 = 0;
        let f1Bin = -1, f2Bin = -1;
        
        // Search for peaks in the frequency data
        for (let i = 0; i < maxBin; i++) {
            const freq = (i / freqData.length) * (sampleRate / 2);
            const value = freqData[i];
            
            // First formant typically between 300-1000 Hz
            if (freq > 300 && freq < 1000 && value > max1) {
                max1 = value;
                f1Bin = i;
                f1 = freq;
            }
            // Second formant typically between 800-2500 Hz
            if (freq > 633 && freq < 2550 && value > max2 && i > f1Bin + 15) {
                max2 = value;
                f2Bin = i;
                f2 = freq;
            }
        }
        let MIN_POWER = 1;
        // Basic validation: F2 should be higher than F1, and there should be significant energy
        if (f1 > 0 && f2 > f1 && max1 >= MIN_POWER && max2 >= MIN_POWER) {
            return { f1, f2 };
        }
        return { f1: 0, f2: 0 };
    }
}

/**
 * Estimates formants using an Autocorrelation-based method with enhanced preprocessing for high precision.
 * @param {Uint8Array} freqData - Frequency data from the analyser node.
 * @param {number} sampleRate - Sample rate of the audio context.
 * @returns {Object} - Estimated formant frequencies {f1, f2}.
 */
function estimateFormantsAutocorr(freqData, sampleRate) {
    const maxFreq = 3500; // Focus on 0-3500 Hz for speech formants
    const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * freqData.length);
    let f1 = 0, f2 = 0;
    
    // Step 1: Convert frequency data to a power spectrum and apply pre-emphasis
    const powerSpectrum = new Float32Array(freqData.length);
    let maxAmp = 0;
    for (let i = 0; i < freqData.length; i++) {
        powerSpectrum[i] = freqData[i] / 255.0; // Normalize to 0-1 range
        if (powerSpectrum[i] > maxAmp) maxAmp = powerSpectrum[i];
    }
    // Normalize the spectrum to enhance sensitivity for low volume audio
    if (maxAmp > 0) {
        for (let i = 0; i < powerSpectrum.length; i++) {
            powerSpectrum[i] = powerSpectrum[i] / maxAmp; // Scale to max amplitude
        }
    }
    // Apply pre-emphasis to boost higher frequencies for better formant detection
    const preEmphasized = new Float32Array(powerSpectrum.length);
    preEmphasized[0] = powerSpectrum[0];
    for (let i = 1; i < powerSpectrum.length; i++) {
        preEmphasized[i] = powerSpectrum[i] - 0.95 * powerSpectrum[i - 1];
    }
    
    // Step 2: Compute autocorrelation of the pre-emphasized spectrum
    const order = 16; // High order for detailed spectral analysis
    const autocorr = new Float32Array(order + 1);
    for (let lag = 0; lag <= order; lag++) {
        let sum = 0;
        for (let i = 0; i < preEmphasized.length - lag; i++) {
            sum += preEmphasized[i] * preEmphasized[i + lag];
        }
        autocorr[lag] = sum;
    }
    
    // Step 3: Compute LP coefficients using Levinson-Durbin recursion for autocorrelation method
    const lpCoeffs = levinsonDurbin(autocorr, order);
    
    // Step 4: Compute the spectral envelope from LP coefficients
    const envelope = new Float32Array(maxBin);
    for (let i = 0; i < maxBin; i++) {
        let sum = 0;
        for (let j = 1; j <= order; j++) {
            sum += lpCoeffs[j] * (i >= j ? preEmphasized[i - j] : 0);
        }
        envelope[i] = preEmphasized[i] - sum;
    }
    
    // Step 5: Smooth the envelope to enhance formant peaks
    const smoothedEnvelope = smoothSpectrum(envelope, 5);
    
    // Step 6: Peak picking for formants with adaptive ranges
    let max1 = 0, max2 = 0;
    let f1Bin = -1, f2Bin = -1;
    for (let i = 0; i < maxBin; i++) {
        const freq = (i / freqData.length) * (sampleRate / 2);
        const value = smoothedEnvelope[i];
        
        // First formant typically between 200-1000 Hz (broadened range for robustness)
        if (freq > 200 && freq < 1000 && value > max1) {
            max1 = value;
            f1Bin = i;
            f1 = freq;
        }
        // Second formant typically between 700-2500 Hz (broadened range)
        if (freq > 700 && freq < 2500 && value > max2 && (f1Bin === -1 || i > f1Bin + 8)) {
            max2 = value;
            f2Bin = i;
            f2 = freq;
        }
    }
    
    // Step 7: Always provide an estimate with continuity constraint
    // Maintain a history for smoothing (static variable to persist across calls)
    if (!estimateFormantsAutocorr.formantHistory) {
        estimateFormantsAutocorr.formantHistory = [];
    }
    const history = estimateFormantsAutocorr.formantHistory;
    
    if (f1 > 0 && f2 > f1 + 150) {
        // Valid detection, update history
        history.push({ f1, f2 });
        if (history.length > 5) history.shift(); // Keep last 5 values for smoothing
        return { f1, f2 };
    } else if (f1 > 0) {
        // If F2 is not detected or too close to F1, estimate F2 based on history or typical spacing
        if (history.length > 0) {
            const lastF2 = history[history.length - 1].f2;
            f2 = Math.min(Math.max(f1 + 400, lastF2 - 100), lastF2 + 100, 2200); // Constrain based on history
        } else {
            f2 = Math.min(f1 + 600, 2200); // Fallback to a typical F2 value
        }
        history.push({ f1, f2 });
        if (history.length > 5) history.shift();
        return { f1, f2 };
    } else {
        // If no clear peaks are found, use historical data or default estimate
        if (history.length > 0) {
            const last = history[history.length - 1];
            f1 = last.f1;
            f2 = last.f2;
        } else {
            f1 = 400; // Fallback to typical mid-range value
            f2 = 1200;
        }
        history.push({ f1, f2 });
        if (history.length > 5) history.shift();
        return { f1, f2 };
    }
}

/**
 * Estimates formants using the Burg method for Linear Prediction, which offers high accuracy.
 * @param {Uint8Array} freqData - Frequency data from the analyser node.
 * @param {number} sampleRate - Sample rate of the audio context.
 * @returns {Object} - Estimated formant frequencies {f1, f2}.
 */
function estimateFormantsBurg(freqData, sampleRate) {
    const maxFreq = 3500; // Focus on 0-3500 Hz for speech formants
    const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * freqData.length);
    let f1 = 0, f2 = 0;
    
    // Step 1: Convert frequency data to a power spectrum and normalize for low volume
    const powerSpectrum = new Float32Array(freqData.length);
    let maxAmp = 0;
    for (let i = 0; i < freqData.length; i++) {
        powerSpectrum[i] = freqData[i] / 255.0; // Normalize to 0-1 range
        if (powerSpectrum[i] > maxAmp) maxAmp = powerSpectrum[i];
    }
    // Normalize the spectrum to enhance sensitivity for low volume audio
    if (maxAmp > 0) {
        for (let i = 0; i < powerSpectrum.length; i++) {
            powerSpectrum[i] = powerSpectrum[i] / maxAmp; // Scale to max amplitude
        }
    }
    
    // Step 2: Compute Burg method coefficients for Linear Prediction
    const order = 20; // Increased model order for better spectral resolution
    const burgCoeffs = burgMethod(powerSpectrum, order);
    
    // Step 3: Compute the spectral envelope using the Burg coefficients
    const envelope = new Float32Array(maxBin);
    for (let i = 0; i < maxBin; i++) {
        let sum = 0;
        for (let j = 1; j <= order; j++) {
            sum += burgCoeffs[j] * (i >= j ? powerSpectrum[i - j] : 0);
        }
        envelope[i] = powerSpectrum[i] - sum;
    }
    
    // Step 4: Smooth the envelope to reduce noise and enhance peaks
    const smoothedEnvelope = smoothSpectrum(envelope, 5); // Increased smoothing window for better peak clarity
    
    // Step 5: Peak picking for formants with refined ranges
    let max1 = 0, max2 = 0;
    let f1Bin = -1, f2Bin = -1;
    for (let i = 0; i < maxBin; i++) {
        const freq = (i / freqData.length) * (sampleRate / 2);
        const value = smoothedEnvelope[i];
        
        // First formant typically between 250-900 Hz (refined range)
        if (freq > 250 && freq < 900 && value > max1) {
            max1 = value;
            f1Bin = i;
            f1 = freq;
        }
        // Second formant typically between 750-2300 Hz (refined range)
        if (freq > 750 && freq < 2560 && value > max2 && (f1Bin === -1 || i > f1Bin + 10)) {
            max2 = value;
            f2Bin = i;
            f2 = freq;
        }
    }
    
    // Step 6: Always provide an estimate, even if peaks are weak, with continuity constraint
    // Maintain a simple history for smoothing (static variable to persist across calls)
    if (!estimateFormantsBurg.formantHistory) {
        estimateFormantsBurg.formantHistory = [];
    }
    const history = estimateFormantsBurg.formantHistory;
    
    if (f1 > 0 && f2 > f1 + 200) {
        // Valid detection, update history
        history.push({ f1, f2 });
        if (history.length > 5) history.shift(); // Keep last 5 values for smoothing
        return { f1, f2 };
    } else if (f1 > 0) {
        // If F2 is not detected or too close to F1, estimate F2 based on typical spacing or history
        if (history.length > 0) {
            const lastF2 = history[history.length - 1].f2;
            f2 = Math.min(Math.max(f1 + 400, lastF2 - 100), lastF2 + 100, 2000); // Constrain based on history
        } else {
            f2 = Math.min(f1 + 600, 2000); // Fallback to a typical F2 value
        }
        history.push({ f1, f2 });
        if (history.length > 5) history.shift();
        return { f1, f2 };
    } else {
        // If no clear peaks are found, use historical data or default estimate
        if (history.length > 0) {
            const last = history[history.length - 1];
            f1 = last.f1;
            f2 = last.f2;
        } else {
            f1 = 400; // Fallback to typical mid-range value
            f2 = 1200;
        }
        history.push({ f1, f2 });
        if (history.length > 5) history.shift();
        return { f1, f2 };
    }
}

/**
 * Computes Linear Prediction coefficients using the Burg method for high accuracy.
 * @param {Float32Array} data - Input signal or power spectrum.
 * @param {number} order - Order of the LP model.
 * @returns {Float32Array} - LP coefficients.
 */
function burgMethod(data, order) {
    const N = data.length;
    const coeffs = new Float32Array(order + 1);
    const forwardPred = new Float32Array(N);
    const backwardPred = new Float32Array(N);
    let errorPower = 0;
    
    // Initialize forward and backward prediction errors
    for (let i = 0; i < N; i++) {
        forwardPred[i] = data[i];
        backwardPred[i] = data[i];
        errorPower += data[i] * data[i];
    }
    errorPower /= N;
    
    coeffs[0] = 1.0;
    
    for (let k = 1; k <= order; k++) {
        let numerator = 0;
        let denominator = 0;
        for (let i = k; i < N; i++) {
            numerator += forwardPred[i] * backwardPred[i - k];
            denominator += forwardPred[i] * forwardPred[i] + backwardPred[i - k] * backwardPred[i - k];
        }
        const reflectionCoeff = denominator > 0 ? -2 * numerator / denominator : 0;
        coeffs[k] = reflectionCoeff;
        
        // Update the forward and backward prediction errors
        for (let i = k; i < N; i++) {
            const tempForward = forwardPred[i];
            forwardPred[i] += reflectionCoeff * backwardPred[i - k];
            backwardPred[i - k] += reflectionCoeff * tempForward;
        }
        
        // Update error power
        errorPower *= (1 - reflectionCoeff * reflectionCoeff);
    }
    
    return coeffs;
}

/**
 * Smooths the spectrum to reduce noise and enhance peaks.
 * @param {Float32Array|Uint8Array} spectrum - Input spectrum data.
 * @param {number} windowSize - Size of the smoothing window.
 * @returns {Float32Array} - Smoothed spectrum.
 */
function smoothSpectrum(spectrum, windowSize) {
    const smoothed = new Float32Array(spectrum.length);
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < spectrum.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = i - halfWindow; j <= i + halfWindow; j++) {
            if (j >= 0 && j < spectrum.length) {
                sum += spectrum[j];
                count++;
            }
        }
        smoothed[i] = sum / count;
    }
    
    return smoothed;
}

/**
 * Estimates formants using Linear Prediction Cepstral Coefficients (LPCC) method.
 * @param {Uint8Array} freqData - Frequency data from the analyser node.
 * @param {number} sampleRate - Sample rate of the audio context.
 * @returns {Object} - Estimated formant frequencies {f1, f2}.
 */
function estimateFormantsLPCC(freqData, sampleRate) {
    const maxFreq = 3500; // Focus on 0-3500 Hz for speech formants
    const maxBin = Math.floor((maxFreq / (sampleRate / 2)) * freqData.length);
    let f1 = 0, f2 = 0;
    
    // Step 1: Convert frequency data to a power spectrum
    const powerSpectrum = new Float32Array(freqData.length);
    for (let i = 0; i < freqData.length; i++) {
        powerSpectrum[i] = freqData[i] / 255.0; // Normalize to 0-1 range
    }
    
    // Step 2: Compute autocorrelation (simplified for frequency domain data)
    const order = 12; // LP order, typically 2-3 times the number of formants expected
    const autocorr = new Float32Array(order + 1);
    for (let lag = 0; lag <= order; lag++) {
        let sum = 0;
        for (let i = 0; i < powerSpectrum.length - lag; i++) {
            sum += powerSpectrum[i] * powerSpectrum[i + lag];
        }
        autocorr[lag] = sum;
    }
    
    // Step 3: Compute LP coefficients using Levinson-Durbin recursion
    const lpCoeffs = levinsonDurbin(autocorr, order);
    
    // Step 4: Convert LP coefficients to cepstral coefficients (simplified)
    // In a real implementation, this would involve more complex transformations
    // For this example, we'll simulate finding formants by analyzing the spectral envelope
    
    // Step 5: Find peaks in the spectral envelope derived from LP coefficients
    const envelope = new Float32Array(maxBin);
    for (let i = 0; i < maxBin; i++) {
        let sum = 0;
        for (let j = 1; j <= order; j++) {
            sum += lpCoeffs[j] * (i >= j ? powerSpectrum[i - j] : 0);
        }
        envelope[i] = powerSpectrum[i] - sum;
    }
    
    // Step 6: Peak picking for formants
    let max1 = 0, max2 = 0;
    let f1Bin = -1, f2Bin = -1;
    for (let i = 0; i < maxBin; i++) {
        const freq = (i / freqData.length) * (sampleRate / 2);
        const value = envelope[i];
        
        // First formant typically between 300-1000 Hz
        if (freq > 300 && freq < 1000 && value > max1) {
            max1 = value;
            f1Bin = i;
            f1 = freq;
        }
        // Second formant typically between 800-2500 Hz
        if (freq > 800 && freq < 2500 && value > max2 && i > f1Bin + 10) {
            max2 = value;
            f2Bin = i;
            f2 = freq;
        }
    }
    
    let MIN_POWER = 0.01; // Adjusted for normalized power spectrum
    // Validation: F2 should be higher than F1, and there should be significant energy
    if (f1 > 0 && f2 > f1 && max1 >= MIN_POWER && max2 >= MIN_POWER) {
        return { f1, f2 };
    }
    return { f1: 0, f2: 0 };
}

/**
 * Computes Linear Prediction coefficients using Levinson-Durbin recursion.
 * @param {Float32Array} autocorr - Autocorrelation coefficients.
 * @param {number} order - Order of the LP model.
 * @returns {Float32Array} - LP coefficients.
 */
function levinsonDurbin(autocorr, order) {
    const coeffs = new Float32Array(order + 1);
    const error = new Float32Array(order + 1);
    coeffs[0] = 1.0;
    error[0] = autocorr[0];
    
    for (let i = 1; i <= order; i++) {
        let sum = 0;
        for (let j = 1; j < i; j++) {
            sum += coeffs[j] * autocorr[i - j];
        }
        let reflection = - (autocorr[i] + sum) / error[i - 1];
        coeffs[i] = reflection;
        for (let j = 1; j < i; j++) {
            coeffs[j] = coeffs[j] + reflection * coeffs[i - j];
        }
        error[i] = (1 - reflection * reflection) * error[i - 1];
    }
    
    return coeffs;
}

/**
 * Detects the closest vowel based on F1 and F2 formant frequencies.
 * @param {number} f1 - First formant frequency in Hz.
 * @param {number} f2 - Second formant frequency in Hz.
 * @returns {string} - Detected vowel symbol or empty string if no match.
 */
export function detectVowel(f1, f2) {
    // Vowel formant data (approximate values for a typical male speaker)
    const vowels = [
        // Front Unrounded Vowels
        { ipa: 'i', description: 'Close front unrounded', f1: 270, f2: 2290 },
        { ipa: 'y', description: 'Close front rounded', f1: 270, f2: 2100 },
        { ipa: 'ɪ', description: 'Near-close near-front unrounded', f1: 400, f2: 1990 },
        { ipa: 'ʏ', description: 'Near-close near-front rounded', f1: 400, f2: 1850 },
        { ipa: 'e', description: 'Close-mid front unrounded', f1: 460, f2: 2200 },
        { ipa: 'ø', description: 'Close-mid front rounded', f1: 460, f2: 1900 },
        { ipa: 'ɛ', description: 'Open-mid front unrounded', f1: 660, f2: 1850 },
        { ipa: 'œ', description: 'Open-mid front rounded', f1: 660, f2: 1710 },
        { ipa: 'æ', description: 'Near-open front unrounded', f1: 800, f2: 1720 },
        { ipa: 'a', description: 'Open front unrounded', f1: 980, f2: 1550 },
        { ipa: 'ɶ', description: 'Open front rounded', f1: 820, f2: 1530 },

        // Central Vowels
        { ipa: 'ɨ', description: 'Close central unrounded', f1: 320, f2: 1650 },
        { ipa: 'ʉ', description: 'Close central rounded', f1: 320, f2: 1500 },
        { ipa: 'ɘ', description: 'Close-mid central unrounded', f1: 490, f2: 1600 },
        { ipa: 'ɵ', description: 'Close-mid central rounded', f1: 490, f2: 1450 },
        { ipa: 'ə', description: 'Mid central unrounded (schwa)', f1: 550, f2: 1500 },
        { ipa: 'ɜ', description: 'Open-mid central unrounded', f1: 690, f2: 1660 },
        { ipa: 'ɞ', description: 'Open-mid central rounded', f1: 690, f2: 1520 },
        { ipa: 'ɐ', description: 'Near-open central unrounded', f1: 760, f2: 1480 },

        // Back Unrounded Vowels
        { ipa: 'ɯ', description: 'Close back unrounded', f1: 300, f2: 1350 },
        { ipa: 'ɤ', description: 'Close-mid back unrounded', f1: 440, f2: 1220 },
        { ipa: 'ʌ', description: 'Open-mid back unrounded', f1: 720, f2: 1240 },

        // Back Rounded Vowels
        { ipa: 'u', description: 'Close back rounded', f1: 300, f2: 870 },
        { ipa: 'ʊ', description: 'Near-close near-back rounded', f1: 430, f2: 1020 },
        { ipa: 'o', description: 'Close-mid back rounded', f1: 460, f2: 800 },
        { ipa: 'ɔ', description: 'Open-mid back rounded', f1: 640, f2: 920 },
        { ipa: 'ɑ', description: 'Open back unrounded', f1: 850, f2: 1220 },
        { ipa: 'ɒ', description: 'Open back rounded', f1: 780, f2: 1000 },

        // Rhotacized Vowels
        { ipa: 'ɚ', description: 'Rhotacized schwa', f1: 480, f2: 1350 },
        { ipa: 'ɝ', description: 'Rhotacized open-mid central', f1: 500, f2: 1450 },

        // Nasalized Vowels (Estimates)
        { ipa: 'ĩ', description: 'Nasalized close front unrounded', f1: 300, f2: 2250 },
        { ipa: 'ɛ̃', description: 'Nasalized open-mid front unrounded', f1: 680, f2: 1800 },
        { ipa: 'ã', description: 'Nasalized open front unrounded', f1: 1000, f2: 1500 },
        { ipa: 'ɔ̃', description: 'Nasalized open-mid back rounded', f1: 660, f2: 880 },

        // Pharyngealized Vowels (Estimates)
        { ipa: 'iˤ', description: 'Pharyngealized close front unrounded', f1: 350, f2: 2100 },
        { ipa: 'aˤ', description: 'Pharyngealized open front unrounded', f1: 1050, f2: 1400 },
        { ipa: 'uˤ', description: 'Pharyngealized close back rounded', f1: 380, f2: 800 }
    ];
    
    let closestVowel = '';
    let minDistance = Infinity;
    
    vowels.forEach(vowel => {
        // Calculate Euclidean distance in formant space
        const distance = Math.sqrt(Math.pow(f1 - vowel.f1, 2) + Math.pow(f2 - vowel.f2, 2));
        if (distance < minDistance) {
            minDistance = distance;
            closestVowel = vowel.ipa;
        }
    });
    
    // Only return a vowel if it's reasonably close (within a threshold)
    return minDistance < 400 ? closestVowel : '';
}
