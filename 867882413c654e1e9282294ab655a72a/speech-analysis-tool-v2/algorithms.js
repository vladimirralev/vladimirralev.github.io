// Speech Analysis Algorithms

/**
 * Estimates the first two formants (F1 and F2) from frequency data.
 * @param {Uint8Array} freqData - Frequency data from the analyser node.
 * @param {number} sampleRate - Sample rate of the audio context.
 * @returns {Object} - Estimated formant frequencies {f1, f2}.
 */
export function estimateFormants(freqData, sampleRate) {
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
        if (freq > 604 && freq < 2500 && value > max2 && i > f1Bin + 10) {
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
