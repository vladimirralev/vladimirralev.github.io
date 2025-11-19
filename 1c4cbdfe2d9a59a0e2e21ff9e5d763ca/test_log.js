const sampleRate = 44100;
const fftSize = 2048;
const binCount = fftSize / 2;
const maxFreq = sampleRate / 2;

function freqToY(freq) {
    const minBin = 1;
    const maxBin = binCount - 1;

    const binIndex = freq / (maxFreq / binCount);

    if (binIndex < minBin) return 0;

    const normalizedY = Math.log(binIndex / minBin) / Math.log(maxBin / minBin);
    return normalizedY;
}

console.log('Bin Count:', binCount);
console.log('Max Freq:', maxFreq);
console.log('Bin Width:', maxFreq / binCount);

const freqs = [50, 100, 200, 440, 1000, 2000, 5000, 10000, 20000];

freqs.forEach(f => {
    const y = freqToY(f);
    console.log(`Freq: ${f} Hz -> NormY: ${y.toFixed(3)} (${(y * 100).toFixed(1)}%)`);
});
