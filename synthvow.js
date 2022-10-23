import path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

class LpFilter1 {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.y1 = 0;
        this.passthrough = true;
        this.muted = false;
    }
    set(f, g, extraGain = 1) {
        if (f <= 0 || f >= this.sampleRate / 2 || g <= 0 || g >= 1 || !isFinite(f) || !isFinite(g) || !isFinite(extraGain)) {
            throw new Error("Invalid filter parameters.");
        }
        const w = 2 * Math.PI * f / this.sampleRate;
        const q = (1 - g ** 2 * Math.cos(w)) / (1 - g ** 2);
        this.b = q - Math.sqrt(q ** 2 - 1);
        this.a = (1 - this.b) * extraGain;
        this.passthrough = false;
        this.muted = false;
    }
    setPassthrough() {
        this.passthrough = true;
        this.muted = false;
        this.y1 = 0;
    }
    setMute() {
        this.passthrough = false;
        this.muted = true;
        this.y1 = 0;
    }
    getTransferFunctionCoefficients() {
        if (this.passthrough) {
            return [[1], [1]];
        }
        if (this.muted) {
            return [[0], [1]];
        }
        return [[this.a], [1, -this.b]];
    }
    step(x) {
        if (this.passthrough) {
            return x;
        }
        if (this.muted) {
            return 0;
        }
        const y = this.a * x + this.b * this.y1;
        this.y1 = y;
        return y;
    }
}
class Resonator {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.y1 = 0;
        this.y2 = 0;
        this.passthrough = true;
        this.muted = false;
    }
    set(f, bw, dcGain = 1) {
        if (f < 0 || f >= this.sampleRate / 2 || bw <= 0 || dcGain <= 0 || !isFinite(f) || !isFinite(bw) || !isFinite(dcGain)) {
            throw new Error("Invalid resonator parameters.");
        }
        this.r = Math.exp(-Math.PI * bw / this.sampleRate);
        const w = 2 * Math.PI * f / this.sampleRate;
        this.c = -(this.r ** 2);
        this.b = 2 * this.r * Math.cos(w);
        this.a = (1 - this.b - this.c) * dcGain;
        this.passthrough = false;
        this.muted = false;
    }
    setPassthrough() {
        this.passthrough = true;
        this.muted = false;
        this.y1 = 0;
        this.y2 = 0;
    }
    setMute() {
        this.passthrough = false;
        this.muted = true;
        this.y1 = 0;
        this.y2 = 0;
    }
    adjustImpulseGain(newA) {
        this.a = newA;
    }
    adjustPeakGain(peakGain) {
        if (peakGain <= 0 || !isFinite(peakGain)) {
            throw new Error("Invalid resonator peak gain.");
        }
        this.a = peakGain * (1 - this.r);
    }
    getTransferFunctionCoefficients() {
        if (this.passthrough) {
            return [[1], [1]];
        }
        if (this.muted) {
            return [[0], [1]];
        }
        return [[this.a], [1, -this.b, -this.c]];
    }
    step(x) {
        if (this.passthrough) {
            return x;
        }
        if (this.muted) {
            return 0;
        }
        const y = this.a * x + this.b * this.y1 + this.c * this.y2;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}
class AntiResonator {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.x1 = 0;
        this.x2 = 0;
        this.passthrough = true;
        this.muted = false;
    }
    set(f, bw) {
        if (f <= 0 || f >= this.sampleRate / 2 || bw <= 0 || !isFinite(f) || !isFinite(bw)) {
            throw new Error("Invalid anti-resonator parameters.");
        }
        const r = Math.exp(-Math.PI * bw / this.sampleRate);
        const w = 2 * Math.PI * f / this.sampleRate;
        const c0 = -(r * r);
        const b0 = 2 * r * Math.cos(w);
        const a0 = 1 - b0 - c0;
        if (a0 == 0) {
            this.a = 0;
            this.b = 0;
            this.c = 0;
            return;
        }
        this.a = 1 / a0;
        this.b = -b0 / a0;
        this.c = -c0 / a0;
        this.passthrough = false;
        this.muted = false;
    }
    setPassthrough() {
        this.passthrough = true;
        this.muted = false;
        this.x1 = 0;
        this.x2 = 0;
    }
    setMute() {
        this.passthrough = false;
        this.muted = true;
        this.x1 = 0;
        this.x2 = 0;
    }
    getTransferFunctionCoefficients() {
        if (this.passthrough) {
            return [[1], [1]];
        }
        if (this.muted) {
            return [[0], [1]];
        }
        return [[this.a, this.b, this.c], [1]];
    }
    step(x) {
        if (this.passthrough) {
            return x;
        }
        if (this.muted) {
            return 0;
        }
        const y = this.a * x + this.b * this.x1 + this.c * this.x2;
        this.x2 = this.x1;
        this.x1 = x;
        return y;
    }
}
class DifferencingFilter {
    constructor() {
        this.x1 = 0;
    }
    getTransferFunctionCoefficients() {
        return [[1, -1], [1]];
    }
    step(x) {
        const y = x - this.x1;
        this.x1 = x;
        return y;
    }
}
function getWhiteNoise() {
    return Math.random() * 2 - 1;
}
class LpNoiseSource {
    constructor(sampleRate) {
        const oldB = 0.75;
        const oldSampleRate = 10000;
        const f = 1000;
        const g = (1 - oldB) / Math.sqrt(1 - 2 * oldB * Math.cos(2 * Math.PI * f / oldSampleRate) + oldB ** 2);
        const extraGain = 2.5 * (sampleRate / 10000) ** 0.33;
        this.lpFilter = new LpFilter1(sampleRate);
        this.lpFilter.set(f, g, extraGain);
    }
    getNext() {
        const x = getWhiteNoise();
        return this.lpFilter.step(x);
    }
}
class ImpulsiveGlottalSource {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.resonator = undefined;
    }
    startPeriod(openPhaseLength) {
        if (!openPhaseLength) {
            this.resonator = undefined;
            return;
        }
        if (!this.resonator) {
            this.resonator = new Resonator(this.sampleRate);
        }
        const bw = this.sampleRate / openPhaseLength;
        this.resonator.set(0, bw);
        this.resonator.adjustImpulseGain(1);
        this.positionInPeriod = 0;
    }
    getNext() {
        if (!this.resonator) {
            return 0;
        }
        const pulse = (this.positionInPeriod == 1) ? 1 : (this.positionInPeriod == 2) ? -1 : 0;
        this.positionInPeriod++;
        return this.resonator.step(pulse);
    }
}
class NaturalGlottalSource {
    constructor() {
        this.startPeriod(0);
    }
    startPeriod(openPhaseLength) {
        this.openPhaseLength = openPhaseLength;
        this.x = 0;
        const amplification = 5;
        this.b = -amplification / openPhaseLength ** 2;
        this.a = -this.b * openPhaseLength / 3;
        this.positionInPeriod = 0;
    }
    getNext() {
        if (this.positionInPeriod++ >= this.openPhaseLength) {
            this.x = 0;
            return 0;
        }
        this.a += this.b;
        this.x += this.a;
        return this.x;
    }
}
function performFrequencyModulation(f0, flutterLevel, time) {
    if (flutterLevel <= 0) {
        return f0;
    }
    const w = 2 * Math.PI * time;
    const a = Math.sin(12.7 * w) + Math.sin(7.1 * w) + Math.sin(4.7 * w);
    return f0 * (1 + a * flutterLevel / 50);
}
function dbToLin(db) {
    if (db <= -99 || isNaN(db)) {
        return 0;
    }
    else {
        return Math.pow(10, db / 20);
    }
}
const glottalSourceTypeEnumNames = ["impulsive", "natural", "noise"];
const maxOralFormants = 6;
class Generator {
    constructor(mParms) {
        this.mParms = mParms;
        this.fState = {};
        this.absPosition = 0;
        this.tiltFilter = new LpFilter1(mParms.sampleRate);
        this.flutterTimeOffset = Math.random() * 1000;
        this.outputLpFilter = new Resonator(mParms.sampleRate);
        this.outputLpFilter.set(0, mParms.sampleRate / 2);
        this.initGlottalSource();
        this.aspirationSourceCasc = new LpNoiseSource(mParms.sampleRate);
        this.aspirationSourcePar = new LpNoiseSource(mParms.sampleRate);
        this.fricationSourcePar = new LpNoiseSource(mParms.sampleRate);
        this.nasalFormantCasc = new Resonator(mParms.sampleRate);
        this.nasalAntiformantCasc = new AntiResonator(mParms.sampleRate);
        this.oralFormantCasc = Array(maxOralFormants);
        for (let i = 0; i < maxOralFormants; i++) {
            this.oralFormantCasc[i] = new Resonator(mParms.sampleRate);
        }
        this.nasalFormantPar = new Resonator(mParms.sampleRate);
        this.oralFormantPar = Array(maxOralFormants);
        for (let i = 0; i < maxOralFormants; i++) {
            this.oralFormantPar[i] = new Resonator(mParms.sampleRate);
        }
        this.differencingFilterPar = new DifferencingFilter();
    }
    generateFrame(fParms, outBuf) {
        if (fParms == this.fParms) {
            throw new Error("FrameParms structure must not be re-used.");
        }
        this.newFParms = fParms;
        for (let outPos = 0; outPos < outBuf.length; outPos++) {
            if (!this.pState || this.pState.positionInPeriod >= this.pState.periodLength) {
                this.startNewPeriod();
            }
            outBuf[outPos] = this.computeNextOutputSignalSample();
            this.pState.positionInPeriod++;
            this.absPosition++;
        }
        if (isNaN(fParms.gainDb)) {
            adjustSignalGain(outBuf, fParms.agcRmsLevel);
        }
    }
    computeNextOutputSignalSample() {
        const fParms = this.fParms;
        const fState = this.fState;
        const pState = this.pState;
        let voice = this.glottalSource();
        voice = this.tiltFilter.step(voice);
        if (pState.positionInPeriod < pState.openPhaseLength) {
            voice += getWhiteNoise() * fState.breathinessLin;
        }
        const cascadeOut = fParms.cascadeEnabled ? this.computeCascadeBranch(voice) : 0;
        const parallelOut = fParms.parallelEnabled ? this.computeParallelBranch(voice) : 0;
        let out = cascadeOut + parallelOut;
        out = this.outputLpFilter.step(out);
        out *= fState.gainLin;
        return out;
    }
    computeCascadeBranch(voice) {
        const fParms = this.fParms;
        const fState = this.fState;
        const pState = this.pState;
        const cascadeVoice = voice * fState.cascadeVoicingLin;
        const currentAspirationMod = (pState.positionInPeriod >= pState.periodLength / 2) ? fParms.cascadeAspirationMod : 0;
        const aspiration = this.aspirationSourceCasc.getNext() * fState.cascadeAspirationLin * (1 - currentAspirationMod);
        let v = cascadeVoice + aspiration;
        v = this.nasalAntiformantCasc.step(v);
        v = this.nasalFormantCasc.step(v);
        for (let i = 0; i < maxOralFormants; i++) {
            v = this.oralFormantCasc[i].step(v);
        }
        return v;
    }
    computeParallelBranch(voice) {
        const fParms = this.fParms;
        const fState = this.fState;
        const pState = this.pState;
        const parallelVoice = voice * fState.parallelVoicingLin;
        const currentAspirationMod = (pState.positionInPeriod >= pState.periodLength / 2) ? fParms.parallelAspirationMod : 0;
        const aspiration = this.aspirationSourcePar.getNext() * fState.parallelAspirationLin * (1 - currentAspirationMod);
        const source = parallelVoice + aspiration;
        const sourceDifference = this.differencingFilterPar.step(source);
        const currentFricationMod = (pState.positionInPeriod >= pState.periodLength / 2) ? fParms.fricationMod : 0;
        const fricationNoise = this.fricationSourcePar.getNext() * fState.fricationLin * (1 - currentFricationMod);
        const source2 = sourceDifference + fricationNoise;
        let v = 0;
        v += this.nasalFormantPar.step(source);
        v += this.oralFormantPar[0].step(source);
        for (let i = 1; i < maxOralFormants; i++) {
            const alternatingSign = (i % 2 == 0) ? 1 : -1;
            v += alternatingSign * this.oralFormantPar[i].step(source2);
        }
        v += fState.parallelBypassLin * source2;
        return v;
    }
    startNewPeriod() {
        if (this.newFParms) {
            this.fParms = this.newFParms;
            this.newFParms = undefined;
            this.startUsingNewFrameParameters();
        }
        if (!this.pState) {
            this.pState = {};
        }
        const pState = this.pState;
        const mParms = this.mParms;
        const fParms = this.fParms;
        const flutterTime = this.absPosition / mParms.sampleRate + this.flutterTimeOffset;
        pState.f0 = performFrequencyModulation(fParms.f0, fParms.flutterLevel, flutterTime);
        pState.periodLength = (pState.f0 > 0) ? Math.round(mParms.sampleRate / pState.f0) : 1;
        pState.openPhaseLength = (pState.periodLength > 1) ? Math.round(pState.periodLength * fParms.openPhaseRatio) : 0;
        pState.positionInPeriod = 0;
        this.startGlottalSourcePeriod();
    }
    startUsingNewFrameParameters() {
        const mParms = this.mParms;
        const fParms = this.fParms;
        const fState = this.fState;
        fState.breathinessLin = dbToLin(fParms.breathinessDb);
        fState.gainLin = dbToLin(fParms.gainDb || 0);
        setTiltFilter(this.tiltFilter, fParms.tiltDb);
        fState.cascadeVoicingLin = dbToLin(fParms.cascadeVoicingDb);
        fState.cascadeAspirationLin = dbToLin(fParms.cascadeAspirationDb);
        setNasalFormantCasc(this.nasalFormantCasc, fParms);
        setNasalAntiformantCasc(this.nasalAntiformantCasc, fParms);
        for (let i = 0; i < maxOralFormants; i++) {
            setOralFormantCasc(this.oralFormantCasc[i], fParms, i);
        }
        fState.parallelVoicingLin = dbToLin(fParms.parallelVoicingDb);
        fState.parallelAspirationLin = dbToLin(fParms.parallelAspirationDb);
        fState.fricationLin = dbToLin(fParms.fricationDb);
        fState.parallelBypassLin = dbToLin(fParms.parallelBypassDb);
        setNasalFormantPar(this.nasalFormantPar, fParms);
        for (let i = 0; i < maxOralFormants; i++) {
            setOralFormantPar(this.oralFormantPar[i], mParms, fParms, i);
        }
    }
    initGlottalSource() {
        switch (this.mParms.glottalSourceType) {
            case 0: {
                this.impulsiveGSource = new ImpulsiveGlottalSource(this.mParms.sampleRate);
                this.glottalSource = () => this.impulsiveGSource.getNext();
                break;
            }
            case 1: {
                this.naturalGSource = new NaturalGlottalSource();
                this.glottalSource = () => this.naturalGSource.getNext();
                break;
            }
            case 2: {
                this.glottalSource = getWhiteNoise;
                break;
            }
            default: {
                throw new Error("Undefined glottal source type.");
            }
        }
    }
    startGlottalSourcePeriod() {
        switch (this.mParms.glottalSourceType) {
            case 0: {
                this.impulsiveGSource.startPeriod(this.pState.openPhaseLength);
                break;
            }
            case 1: {
                this.naturalGSource.startPeriod(this.pState.openPhaseLength);
                break;
            }
        }
    }
}
function setTiltFilter(tiltFilter, tiltDb) {
    if (!tiltDb) {
        tiltFilter.setPassthrough();
    }
    else {
        tiltFilter.set(3000, dbToLin(-tiltDb));
    }
}
function setNasalFormantCasc(nasalFormantCasc, fParms) {
    if (fParms.nasalFormantFreq && fParms.nasalFormantBw) {
        nasalFormantCasc.set(fParms.nasalFormantFreq, fParms.nasalFormantBw);
    }
    else {
        nasalFormantCasc.setPassthrough();
    }
}
function setNasalAntiformantCasc(nasalAntiformantCasc, fParms) {
    if (fParms.nasalAntiformantFreq && fParms.nasalAntiformantBw) {
        nasalAntiformantCasc.set(fParms.nasalAntiformantFreq, fParms.nasalAntiformantBw);
    }
    else {
        nasalAntiformantCasc.setPassthrough();
    }
}
function setOralFormantCasc(oralFormantCasc, fParms, i) {
    const f = (i < fParms.oralFormantFreq.length) ? fParms.oralFormantFreq[i] : NaN;
    const bw = (i < fParms.oralFormantBw.length) ? fParms.oralFormantBw[i] : NaN;
    if (f && bw) {
        oralFormantCasc.set(f, bw);
    }
    else {
        oralFormantCasc.setPassthrough();
    }
}
function setNasalFormantPar(nasalFormantPar, fParms) {
    if (fParms.nasalFormantFreq && fParms.nasalFormantBw && dbToLin(fParms.nasalFormantDb)) {
        nasalFormantPar.set(fParms.nasalFormantFreq, fParms.nasalFormantBw);
        nasalFormantPar.adjustPeakGain(dbToLin(fParms.nasalFormantDb));
    }
    else {
        nasalFormantPar.setMute();
    }
}
function setOralFormantPar(oralFormantPar, mParms, fParms, i) {
    const formant = i + 1;
    const f = (i < fParms.oralFormantFreq.length) ? fParms.oralFormantFreq[i] : NaN;
    const bw = (i < fParms.oralFormantBw.length) ? fParms.oralFormantBw[i] : NaN;
    const db = (i < fParms.oralFormantDb.length) ? fParms.oralFormantDb[i] : NaN;
    const peakGain = dbToLin(db);
    if (f && bw && peakGain) {
        oralFormantPar.set(f, bw);
        const w = 2 * Math.PI * f / mParms.sampleRate;
        const diffGain = Math.sqrt(2 - 2 * Math.cos(w));
        const filterGain = (formant >= 2) ? peakGain / diffGain : peakGain;
        oralFormantPar.adjustPeakGain(filterGain);
    }
    else {
        oralFormantPar.setMute();
    }
}
function adjustSignalGain(buf, targetRms) {
    const n = buf.length;
    if (!n) {
        return;
    }
    const rms = computeRms(buf);
    if (!rms) {
        return;
    }
    const r = targetRms / rms;
    for (let i = 0; i < n; i++) {
        buf[i] *= r;
    }
}
function computeRms(buf) {
    const n = buf.length;
    let acc = 0;
    for (let i = 0; i < n; i++) {
        acc += buf[i] ** 2;
    }
    return Math.sqrt(acc / n);
}
function generateSound(mParms, fParmsA) {
    const generator = new Generator(mParms);
    let outBufLen = 0;
    for (const fParms of fParmsA) {
        outBufLen += Math.round(fParms.duration * mParms.sampleRate);
    }
    const outBuf = new Float64Array(outBufLen);
    let outBufPos = 0;
    for (const fParms of fParmsA) {
        const frameLen = Math.round(fParms.duration * mParms.sampleRate);
        const frameBuf = outBuf.subarray(outBufPos, outBufPos + frameLen);
        generator.generateFrame(fParms, frameBuf);
        outBufPos += frameLen;
    }
    return outBuf;
}

function hannWindow(x) {
    if (x < 0 || x >= 1) {
        return 0;
    }
    const w = 2 * Math.PI * x;
    return 0.5 - 0.5 * Math.cos(w);
}

function fadeAudioSignalInPlace(samples, fadeMargin, windowFunction) {
    const d = Math.min(samples.length, 2 * fadeMargin);
    for (let i = 0; i < d / 2; i++) {
        const w = windowFunction(i / d);
        samples[i] *= w;
        samples[samples.length - 1 - i] *= w;
    }
}

const defaultMainParms = {
    sampleRate: 44100,
    glottalSourceType: 1,
};
const defaultFrameParms = {
    duration: 3,
    f0: 247,
    flutterLevel: 0.25,
    openPhaseRatio: 0.7,
    breathinessDb: -25,
    tiltDb: 0,
    gainDb: NaN,
    agcRmsLevel: 0.18,
    nasalFormantFreq: NaN,
    nasalFormantBw: NaN,
    oralFormantFreq: [520, 1006, 2831, 3168, 4135, 5020],
    oralFormantBw: [76, 102, 72, 102, 816, 596],
    cascadeEnabled: true,
    cascadeVoicingDb: 0,
    cascadeAspirationDb: -25,
    cascadeAspirationMod: 0.5,
    nasalAntiformantFreq: NaN,
    nasalAntiformantBw: NaN,
    parallelEnabled: false,
    parallelVoicingDb: 0,
    parallelAspirationDb: -25,
    parallelAspirationMod: 0.5,
    fricationDb: -30,
    fricationMod: 0.5,
    parallelBypassDb: -99,
    nasalFormantDb: NaN,
    oralFormantDb: [0, -8, -15, -19, -30, -35],
};
const defaultAppParms = {
    mParms: defaultMainParms,
    fParmsA: [defaultFrameParms],
    fadingDuration: 0.05,
    windowFunctionId: 'hann',
};
function decodeGlottalSourceType(s) {
    const i = glottalSourceTypeEnumNames.indexOf(s);
    if (i < 0) {
        throw new Error(`Unknown glottal source type "${s}".`);
    }
    return i;
}
function getMyAudioParms(sampleRate, duration, pitch, formants, formantsBw, formantsDb) {
    const appParms = defaultAppParms;
    const mParms = defaultMainParms;
    appParms.mParms = mParms;
    mParms.sampleRate = sampleRate;
    mParms.glottalSourceType = decodeGlottalSourceType('natural');
    const fParms = defaultFrameParms;
    appParms.fParmsA = [fParms];
    fParms.duration = duration;
    fParms.f0 = pitch;
    fParms.oralFormantFreq = formants;
    fParms.oralFormantBw = formantsBw;
    fParms.oralFormantDb = formantsDb;
    return appParms;
}

function synthesizeSignal(appParms) {
    let signal;
    let rate;
    signal = generateSound(appParms.mParms, appParms.fParmsA);
    rate = appParms.mParms.sampleRate;
    fadeAudioSignalInPlace(signal, appParms.fadingDuration * rate, hannWindow);
    return signal;
}
function exportSignal(pitch, formants, dstfile, pyMakewavHelper) {
    if (fs.existsSync(`${dstfile}.wav`))
        return;
    let rate = 16000;
    let duration = 1.7;
    let signal;
    const params = getMyAudioParms(rate, duration, pitch, formants, [76, 102, 72], [0, -8, -15]);
    signal = synthesizeSignal(params);
    if (!signal) {
        console.log('signal synthesis failed: ', dstfile);
        return;
    }
    fs.writeFileSync(dstfile, signal.toString(), 'utf-8');
    cp.execSync(`${pyMakewavHelper} ${dstfile}`);
}

var schema = {
	fields: [
		{
			name: "index",
			type: "integer"
		},
		{
			name: "person_id",
			type: "string"
		},
		{
			name: "sex",
			type: "string"
		},
		{
			name: "duration_second",
			type: "number"
		},
		{
			name: "vowel_name",
			type: "string"
		},
		{
			name: "pitch_mean_praat_base",
			type: "number"
		},
		{
			name: "F1_mean_praat_base",
			type: "number"
		},
		{
			name: "F2_mean_praat_base",
			type: "number"
		},
		{
			name: "F3_mean_praat_base",
			type: "number"
		},
		{
			name: "F1_median_praat_base",
			type: "number"
		},
		{
			name: "F2_median_praat_base",
			type: "number"
		},
		{
			name: "F3_median_praat_base",
			type: "number"
		}
	],
	pandas_version: "0.20.0"
};
var data$1 = [
	{
		index: 0,
		person_id: "MTRT0",
		sex: "M",
		duration_second: 0.105,
		vowel_name: "iy",
		pitch_mean_praat_base: 97.4,
		F1_mean_praat_base: 456.21,
		F2_mean_praat_base: 1906.7,
		F3_mean_praat_base: 2309.29,
		F1_median_praat_base: 454.47,
		F2_median_praat_base: 1921.02,
		F3_median_praat_base: 2346.71
	},
	{
		index: 1,
		person_id: "MMGG0",
		sex: "M",
		duration_second: 0.0938125,
		vowel_name: "iy",
		pitch_mean_praat_base: 122.09,
		F1_mean_praat_base: 561.03,
		F2_mean_praat_base: 2072.62,
		F3_mean_praat_base: 2771.38,
		F1_median_praat_base: 314.55,
		F2_median_praat_base: 2110.85,
		F3_median_praat_base: 2724.62
	},
	{
		index: 2,
		person_id: "FRAM1",
		sex: "F",
		duration_second: 0.069875,
		vowel_name: "iy",
		pitch_mean_praat_base: 203.89,
		F1_mean_praat_base: 477.89,
		F2_mean_praat_base: 2144.54,
		F3_mean_praat_base: 2429.88,
		F1_median_praat_base: 472.1,
		F2_median_praat_base: 2222.18,
		F3_median_praat_base: 2299.66
	},
	{
		index: 3,
		person_id: "FDMY0",
		sex: "F",
		duration_second: 0.0881875,
		vowel_name: "iy",
		pitch_mean_praat_base: 201.71,
		F1_mean_praat_base: 455.39,
		F2_mean_praat_base: 2633.34,
		F3_mean_praat_base: 2889.85,
		F1_median_praat_base: 470.68,
		F2_median_praat_base: 2638.78,
		F3_median_praat_base: 2851.65
	},
	{
		index: 4,
		person_id: "MKLS1",
		sex: "M",
		duration_second: 0.1828125,
		vowel_name: "ae",
		pitch_mean_praat_base: 119.38,
		F1_mean_praat_base: 551.35,
		F2_mean_praat_base: 1599.19,
		F3_mean_praat_base: 2245.83,
		F1_median_praat_base: 577.93,
		F2_median_praat_base: 1540.95,
		F3_median_praat_base: 2315.69
	},
	{
		index: 5,
		person_id: "MSDS0",
		sex: "M",
		duration_second: 0.135,
		vowel_name: "ae",
		pitch_mean_praat_base: 170.98,
		F1_mean_praat_base: 837.86,
		F2_mean_praat_base: 1532.73,
		F3_mean_praat_base: 2821.4,
		F1_median_praat_base: 839.1,
		F2_median_praat_base: 1604.88,
		F3_median_praat_base: 2814.59
	},
	{
		index: 6,
		person_id: "FAEM0",
		sex: "F",
		duration_second: 0.1194375,
		vowel_name: "ae",
		pitch_mean_praat_base: 181.32,
		F1_mean_praat_base: 618.95,
		F2_mean_praat_base: 1801.71,
		F3_mean_praat_base: 2718.79,
		F1_median_praat_base: 658.05,
		F2_median_praat_base: 1840.24,
		F3_median_praat_base: 2755.34
	},
	{
		index: 7,
		person_id: "FGCS0",
		sex: "F",
		duration_second: 0.1149375,
		vowel_name: "ae",
		pitch_mean_praat_base: 225.11,
		F1_mean_praat_base: 766.46,
		F2_mean_praat_base: 2123.91,
		F3_mean_praat_base: 2809.58,
		F1_median_praat_base: 764.96,
		F2_median_praat_base: 2120.79,
		F3_median_praat_base: 3069.67
	},
	{
		index: 8,
		person_id: "MJFC0",
		sex: "M",
		duration_second: 0.114375,
		vowel_name: "er",
		pitch_mean_praat_base: 119.93,
		F1_mean_praat_base: 505.76,
		F2_mean_praat_base: 1337.13,
		F3_mean_praat_base: 1594.85,
		F1_median_praat_base: 515.99,
		F2_median_praat_base: 1301.32,
		F3_median_praat_base: 1597.15
	},
	{
		index: 9,
		person_id: "MILB0",
		sex: "M",
		duration_second: 0.0935625,
		vowel_name: "er",
		pitch_mean_praat_base: 141.19,
		F1_mean_praat_base: 427.57,
		F2_mean_praat_base: 1567.8,
		F3_mean_praat_base: 1988.34,
		F1_median_praat_base: 431.64,
		F2_median_praat_base: 1518,
		F3_median_praat_base: 1925.77
	},
	{
		index: 10,
		person_id: "FKLC0",
		sex: "F",
		duration_second: 0.179875,
		vowel_name: "er",
		pitch_mean_praat_base: 172.28,
		F1_mean_praat_base: 627.03,
		F2_mean_praat_base: 1297.08,
		F3_mean_praat_base: 1759.95,
		F1_median_praat_base: 615,
		F2_median_praat_base: 1277,
		F3_median_praat_base: 1713.32
	},
	{
		index: 11,
		person_id: "FCDR1",
		sex: "F",
		duration_second: 0.11225,
		vowel_name: "er",
		pitch_mean_praat_base: 184.17,
		F1_mean_praat_base: 682.61,
		F2_mean_praat_base: 1396.42,
		F3_mean_praat_base: 1924.79,
		F1_median_praat_base: 682.07,
		F2_median_praat_base: 1401.85,
		F3_median_praat_base: 1905.53
	},
	{
		index: 12,
		person_id: "MRPP0",
		sex: "M",
		duration_second: 0.2156875,
		vowel_name: "aa",
		pitch_mean_praat_base: 91.67,
		F1_mean_praat_base: 751.1,
		F2_mean_praat_base: 1452.37,
		F3_mean_praat_base: 2541.52,
		F1_median_praat_base: 784.82,
		F2_median_praat_base: 1426.06,
		F3_median_praat_base: 2523.28
	},
	{
		index: 13,
		person_id: "MTPP0",
		sex: "M",
		duration_second: 0.0976875,
		vowel_name: "aa",
		pitch_mean_praat_base: 98.2,
		F1_mean_praat_base: 650.12,
		F2_mean_praat_base: 1255.72,
		F3_mean_praat_base: 2082.58,
		F1_median_praat_base: 657.48,
		F2_median_praat_base: 1219.22,
		F3_median_praat_base: 2101.84
	},
	{
		index: 14,
		person_id: "FJLR0",
		sex: "F",
		duration_second: 0.0786875,
		vowel_name: "aa",
		pitch_mean_praat_base: 225.59,
		F1_mean_praat_base: 757.11,
		F2_mean_praat_base: 1510.24,
		F3_mean_praat_base: 2310.49,
		F1_median_praat_base: 770.83,
		F2_median_praat_base: 1509.78,
		F3_median_praat_base: 2342.15
	},
	{
		index: 15,
		person_id: "FGDP0",
		sex: "F",
		duration_second: 0.206125,
		vowel_name: "aa",
		pitch_mean_praat_base: 211.65,
		F1_mean_praat_base: 787.75,
		F2_mean_praat_base: 1475.62,
		F3_mean_praat_base: 3191.68,
		F1_median_praat_base: 825.1,
		F2_median_praat_base: 1353.75,
		F3_median_praat_base: 3149.12
	},
	{
		index: 16,
		person_id: "MMWS0",
		sex: "M",
		duration_second: 0.115,
		vowel_name: "uw",
		pitch_mean_praat_base: 130.06,
		F1_mean_praat_base: 543.1,
		F2_mean_praat_base: 1404.67,
		F3_mean_praat_base: 2646.3,
		F1_median_praat_base: 461.19,
		F2_median_praat_base: 1223.25,
		F3_median_praat_base: 2532.67
	},
	{
		index: 17,
		person_id: "MHMR0",
		sex: "M",
		duration_second: 0.1723125,
		vowel_name: "uw",
		pitch_mean_praat_base: 170.4,
		F1_mean_praat_base: 733.16,
		F2_mean_praat_base: 1308.7,
		F3_mean_praat_base: 2659.56,
		F1_median_praat_base: 627.18,
		F2_median_praat_base: 1089.82,
		F3_median_praat_base: 2530.85
	},
	{
		index: 18,
		person_id: "FSLB1",
		sex: "F",
		duration_second: 0.1208125,
		vowel_name: "uw",
		pitch_mean_praat_base: 208.18,
		F1_mean_praat_base: 564.91,
		F2_mean_praat_base: 1439.86,
		F3_mean_praat_base: 2951.6,
		F1_median_praat_base: 553.93,
		F2_median_praat_base: 1348.94,
		F3_median_praat_base: 2968.43
	},
	{
		index: 19,
		person_id: "FEXM0",
		sex: "F",
		duration_second: 0.0783125,
		vowel_name: "uw",
		pitch_mean_praat_base: 201.96,
		F1_mean_praat_base: 429.79,
		F2_mean_praat_base: 1656.31,
		F3_mean_praat_base: 2593.58,
		F1_median_praat_base: 429.7,
		F2_median_praat_base: 1643.26,
		F3_median_praat_base: 2586.91
	},
	{
		index: 20,
		person_id: "MDSS1",
		sex: "M",
		duration_second: 0.0905,
		vowel_name: "ih",
		pitch_mean_praat_base: 130.03,
		F1_mean_praat_base: 504.95,
		F2_mean_praat_base: 1539.35,
		F3_mean_praat_base: 2134.07,
		F1_median_praat_base: 497.88,
		F2_median_praat_base: 1598.46,
		F3_median_praat_base: 2097.93
	},
	{
		index: 21,
		person_id: "MRLR0",
		sex: "M",
		duration_second: 0.033625,
		vowel_name: "ih",
		pitch_mean_praat_base: 115.07,
		F1_mean_praat_base: 536.2,
		F2_mean_praat_base: 1912.12,
		F3_mean_praat_base: 2615.86,
		F1_median_praat_base: 547.7,
		F2_median_praat_base: 1919.53,
		F3_median_praat_base: 2603.67
	},
	{
		index: 22,
		person_id: "FJXP0",
		sex: "F",
		duration_second: 0.064625,
		vowel_name: "ih",
		pitch_mean_praat_base: 202.45,
		F1_mean_praat_base: 533.08,
		F2_mean_praat_base: 2091.99,
		F3_mean_praat_base: 3008.07,
		F1_median_praat_base: 515.13,
		F2_median_praat_base: 2107.74,
		F3_median_praat_base: 2983.76
	},
	{
		index: 23,
		person_id: "FETB0",
		sex: "F",
		duration_second: 0.0439375,
		vowel_name: "ih",
		pitch_mean_praat_base: 233.18,
		F1_mean_praat_base: 472.22,
		F2_mean_praat_base: 2003.96,
		F3_mean_praat_base: 3004.72,
		F1_median_praat_base: 472.47,
		F2_median_praat_base: 2019.27,
		F3_median_praat_base: 2934.31
	},
	{
		index: 24,
		person_id: "MSFV0",
		sex: "M",
		duration_second: 0.125,
		vowel_name: "ao",
		pitch_mean_praat_base: 102.51,
		F1_mean_praat_base: 730.18,
		F2_mean_praat_base: 1063.63,
		F3_mean_praat_base: 2913.55,
		F1_median_praat_base: 732.86,
		F2_median_praat_base: 1035.57,
		F3_median_praat_base: 2960.19
	},
	{
		index: 25,
		person_id: "MFXS0",
		sex: "M",
		duration_second: 0.1525625,
		vowel_name: "ao",
		pitch_mean_praat_base: 103.36,
		F1_mean_praat_base: 591.77,
		F2_mean_praat_base: 1374.49,
		F3_mean_praat_base: 2952.57,
		F1_median_praat_base: 571.07,
		F2_median_praat_base: 871.69,
		F3_median_praat_base: 2881.19
	},
	{
		index: 26,
		person_id: "FDRW0",
		sex: "F",
		duration_second: 0.23,
		vowel_name: "ao",
		pitch_mean_praat_base: 196.41,
		F1_mean_praat_base: 771.27,
		F2_mean_praat_base: 1519.62,
		F3_mean_praat_base: 3251.22,
		F1_median_praat_base: 815.89,
		F2_median_praat_base: 1471.12,
		F3_median_praat_base: 3231.99
	},
	{
		index: 27,
		person_id: "FSMS1",
		sex: "F",
		duration_second: 0.08875,
		vowel_name: "ao",
		pitch_mean_praat_base: 214.84,
		F1_mean_praat_base: 681.6,
		F2_mean_praat_base: 1217.44,
		F3_mean_praat_base: 2881.5,
		F1_median_praat_base: 686.72,
		F2_median_praat_base: 1153.98,
		F3_median_praat_base: 2904.1
	},
	{
		index: 28,
		person_id: "MWRE0",
		sex: "M",
		duration_second: 0.07,
		vowel_name: "axr",
		pitch_mean_praat_base: 112.27,
		F1_mean_praat_base: 782.8,
		F2_mean_praat_base: 1254.88,
		F3_mean_praat_base: 3170.87,
		F1_median_praat_base: 844.41,
		F2_median_praat_base: 1298.45,
		F3_median_praat_base: 3507.86
	},
	{
		index: 29,
		person_id: "MPDF0",
		sex: "M",
		duration_second: 0.074,
		vowel_name: "axr",
		pitch_mean_praat_base: 189.19,
		F1_mean_praat_base: 740.27,
		F2_mean_praat_base: 1781.42,
		F3_mean_praat_base: 2486.46,
		F1_median_praat_base: 477.35,
		F2_median_praat_base: 1628.9,
		F3_median_praat_base: 2565.96
	},
	{
		index: 30,
		person_id: "FLAC0",
		sex: "F",
		duration_second: 0.0521875,
		vowel_name: "axr",
		pitch_mean_praat_base: 219.05,
		F1_mean_praat_base: 533.49,
		F2_mean_praat_base: 1307.71,
		F3_mean_praat_base: 2336,
		F1_median_praat_base: 553.42,
		F2_median_praat_base: 1316.67,
		F3_median_praat_base: 2479.43
	},
	{
		index: 31,
		person_id: "FHEW0",
		sex: "F",
		duration_second: 0.105375,
		vowel_name: "axr",
		pitch_mean_praat_base: 230.8,
		F1_mean_praat_base: 731.25,
		F2_mean_praat_base: 1655.28,
		F3_mean_praat_base: 2330.91,
		F1_median_praat_base: 750.38,
		F2_median_praat_base: 1566.65,
		F3_median_praat_base: 2085.81
	},
	{
		index: 32,
		person_id: "MHMG0",
		sex: "M",
		duration_second: 0.1511875,
		vowel_name: "ow",
		pitch_mean_praat_base: 137.86,
		F1_mean_praat_base: 545.25,
		F2_mean_praat_base: 1187.87,
		F3_mean_praat_base: 2360.67,
		F1_median_praat_base: 533.51,
		F2_median_praat_base: 1173.53,
		F3_median_praat_base: 2336.16
	},
	{
		index: 33,
		person_id: "MBTH0",
		sex: "M",
		duration_second: 0.111875,
		vowel_name: "ow",
		pitch_mean_praat_base: 136.74,
		F1_mean_praat_base: 539.19,
		F2_mean_praat_base: 1389.87,
		F3_mean_praat_base: 2400.66,
		F1_median_praat_base: 552.81,
		F2_median_praat_base: 1346.42,
		F3_median_praat_base: 2414.13
	},
	{
		index: 34,
		person_id: "FLMK0",
		sex: "F",
		duration_second: 0.15,
		vowel_name: "ow",
		pitch_mean_praat_base: 222.57,
		F1_mean_praat_base: 661.51,
		F2_mean_praat_base: 1884.55,
		F3_mean_praat_base: 2885.13,
		F1_median_praat_base: 670.3,
		F2_median_praat_base: 1852.22,
		F3_median_praat_base: 2943.57
	},
	{
		index: 35,
		person_id: "FKDE0",
		sex: "F",
		duration_second: 0.1226875,
		vowel_name: "ow",
		pitch_mean_praat_base: 227.81,
		F1_mean_praat_base: 642.78,
		F2_mean_praat_base: 1632.95,
		F3_mean_praat_base: 2894.03,
		F1_median_praat_base: 664.11,
		F2_median_praat_base: 1562.92,
		F3_median_praat_base: 2982.85
	},
	{
		index: 36,
		person_id: "MWGR0",
		sex: "M",
		duration_second: 0.04675,
		vowel_name: "ix",
		pitch_mean_praat_base: 98.96,
		F1_mean_praat_base: 539.75,
		F2_mean_praat_base: 1403.9,
		F3_mean_praat_base: 2798.67,
		F1_median_praat_base: 527.31,
		F2_median_praat_base: 1440.98,
		F3_median_praat_base: 2827.77
	},
	{
		index: 37,
		person_id: "MDKS0",
		sex: "M",
		duration_second: 0.0310625,
		vowel_name: "ix",
		pitch_mean_praat_base: 125.82,
		F1_mean_praat_base: 549.96,
		F2_mean_praat_base: 1639.24,
		F3_mean_praat_base: 2394.43,
		F1_median_praat_base: 556.99,
		F2_median_praat_base: 1639.44,
		F3_median_praat_base: 2392.97
	},
	{
		index: 38,
		person_id: "FJKL0",
		sex: "F",
		duration_second: 0.0204375,
		vowel_name: "ix",
		pitch_mean_praat_base: 227.92,
		F1_mean_praat_base: 606.15,
		F2_mean_praat_base: 2049.13,
		F3_mean_praat_base: 2913.07,
		F1_median_praat_base: 606.15,
		F2_median_praat_base: 2049.13,
		F3_median_praat_base: 2913.07
	},
	{
		index: 39,
		person_id: "FDRD1",
		sex: "F",
		duration_second: 0.038125,
		vowel_name: "ix",
		pitch_mean_praat_base: 211.84,
		F1_mean_praat_base: 463.84,
		F2_mean_praat_base: 2161.11,
		F3_mean_praat_base: 2768.33,
		F1_median_praat_base: 467.95,
		F2_median_praat_base: 2131.95,
		F3_median_praat_base: 2769.14
	},
	{
		index: 40,
		person_id: "MDDC0",
		sex: "M",
		duration_second: 0.0758125,
		vowel_name: "eh",
		pitch_mean_praat_base: 152.36,
		F1_mean_praat_base: 636.38,
		F2_mean_praat_base: 1574.91,
		F3_mean_praat_base: 2169.48,
		F1_median_praat_base: 620.92,
		F2_median_praat_base: 1612.83,
		F3_median_praat_base: 2233.8
	},
	{
		index: 41,
		person_id: "MBJK0",
		sex: "M",
		duration_second: 0.0666875,
		vowel_name: "eh",
		pitch_mean_praat_base: 109.39,
		F1_mean_praat_base: 639.3,
		F2_mean_praat_base: 1364.9,
		F3_mean_praat_base: 2009.28,
		F1_median_praat_base: 636.02,
		F2_median_praat_base: 1375.73,
		F3_median_praat_base: 2089.46
	},
	{
		index: 42,
		person_id: "FMAH0",
		sex: "F",
		duration_second: 0.066625,
		vowel_name: "eh",
		pitch_mean_praat_base: 232.01,
		F1_mean_praat_base: 616.97,
		F2_mean_praat_base: 1765.17,
		F3_mean_praat_base: 2778.43,
		F1_median_praat_base: 629.01,
		F2_median_praat_base: 2090.72,
		F3_median_praat_base: 2775.41
	},
	{
		index: 43,
		person_id: "FDKN0",
		sex: "F",
		duration_second: 0.137375,
		vowel_name: "eh",
		pitch_mean_praat_base: 197.88,
		F1_mean_praat_base: 746.28,
		F2_mean_praat_base: 1621.78,
		F3_mean_praat_base: 2656.92,
		F1_median_praat_base: 746.5,
		F2_median_praat_base: 1624.58,
		F3_median_praat_base: 2737.1
	},
	{
		index: 44,
		person_id: "MRGG0",
		sex: "M",
		duration_second: 0.2165625,
		vowel_name: "oy",
		pitch_mean_praat_base: 121.18,
		F1_mean_praat_base: 489.54,
		F2_mean_praat_base: 1164.93,
		F3_mean_praat_base: 2538.41,
		F1_median_praat_base: 502.83,
		F2_median_praat_base: 1054.11,
		F3_median_praat_base: 2543.91
	},
	{
		index: 45,
		person_id: "MRSP0",
		sex: "M",
		duration_second: 0.13625,
		vowel_name: "oy",
		pitch_mean_praat_base: 128.75,
		F1_mean_praat_base: 536.65,
		F2_mean_praat_base: 1311.08,
		F3_mean_praat_base: 2237.73,
		F1_median_praat_base: 565.5,
		F2_median_praat_base: 1282.45,
		F3_median_praat_base: 2210.12
	},
	{
		index: 46,
		person_id: "FCKE0",
		sex: "F",
		duration_second: 0.13375,
		vowel_name: "oy",
		pitch_mean_praat_base: 201.73,
		F1_mean_praat_base: 607.32,
		F2_mean_praat_base: 1218.56,
		F3_mean_praat_base: 2147.31,
		F1_median_praat_base: 606.97,
		F2_median_praat_base: 1225.25,
		F3_median_praat_base: 2061.41
	},
	{
		index: 47,
		person_id: "FLOD0",
		sex: "F",
		duration_second: 0.180125,
		vowel_name: "oy",
		pitch_mean_praat_base: 197.19,
		F1_mean_praat_base: 796.3,
		F2_mean_praat_base: 1350.73,
		F3_mean_praat_base: 2872.45,
		F1_median_praat_base: 817.22,
		F2_median_praat_base: 1427.42,
		F3_median_praat_base: 2881.28
	},
	{
		index: 48,
		person_id: "MTPR0",
		sex: "M",
		duration_second: 0.1378125,
		vowel_name: "ay",
		pitch_mean_praat_base: 108.23,
		F1_mean_praat_base: 724.13,
		F2_mean_praat_base: 1487.5,
		F3_mean_praat_base: 2646.76,
		F1_median_praat_base: 725.65,
		F2_median_praat_base: 1461.63,
		F3_median_praat_base: 2668.52
	},
	{
		index: 49,
		person_id: "MRCG0",
		sex: "M",
		duration_second: 0.100875,
		vowel_name: "ay",
		pitch_mean_praat_base: 147.27,
		F1_mean_praat_base: 615.34,
		F2_mean_praat_base: 1517.74,
		F3_mean_praat_base: 2643.4,
		F1_median_praat_base: 654,
		F2_median_praat_base: 1437.64,
		F3_median_praat_base: 2617.53
	},
	{
		index: 50,
		person_id: "FLMA0",
		sex: "F",
		duration_second: 0.158375,
		vowel_name: "ay",
		pitch_mean_praat_base: 225.07,
		F1_mean_praat_base: 703.67,
		F2_mean_praat_base: 1645.93,
		F3_mean_praat_base: 3119.17,
		F1_median_praat_base: 733.8,
		F2_median_praat_base: 1690.25,
		F3_median_praat_base: 3050.25
	},
	{
		index: 51,
		person_id: "FCEG0",
		sex: "F",
		duration_second: 0.1,
		vowel_name: "ay",
		pitch_mean_praat_base: 233.68,
		F1_mean_praat_base: 650.31,
		F2_mean_praat_base: 1969.1,
		F3_mean_praat_base: 2899.25,
		F1_median_praat_base: 668.81,
		F2_median_praat_base: 2027.78,
		F3_median_praat_base: 2903.53
	},
	{
		index: 52,
		person_id: "MRCZ0",
		sex: "M",
		duration_second: 0.0234375,
		vowel_name: "ax",
		pitch_mean_praat_base: 132.45,
		F1_mean_praat_base: 444.38,
		F2_mean_praat_base: 1450.85,
		F3_mean_praat_base: 2743.56,
		F1_median_praat_base: 444.38,
		F2_median_praat_base: 1450.85,
		F3_median_praat_base: 2743.56
	},
	{
		index: 53,
		person_id: "MDAW1",
		sex: "M",
		duration_second: 0.0845625,
		vowel_name: "ax",
		pitch_mean_praat_base: 197.61,
		F1_mean_praat_base: 459.16,
		F2_mean_praat_base: 1415.24,
		F3_mean_praat_base: 2483.68,
		F1_median_praat_base: 460.36,
		F2_median_praat_base: 1484.43,
		F3_median_praat_base: 2479.9
	},
	{
		index: 54,
		person_id: "FTLH0",
		sex: "F",
		duration_second: 0.0335625,
		vowel_name: "ax",
		pitch_mean_praat_base: 176.59,
		F1_mean_praat_base: 603.4,
		F2_mean_praat_base: 1255,
		F3_mean_praat_base: 2992.05,
		F1_median_praat_base: 603.88,
		F2_median_praat_base: 1257.08,
		F3_median_praat_base: 2995.42
	},
	{
		index: 55,
		person_id: "FJWB0",
		sex: "F",
		duration_second: 0.0339375,
		vowel_name: "ax",
		pitch_mean_praat_base: 145.61,
		F1_mean_praat_base: 685.25,
		F2_mean_praat_base: 1672.65,
		F3_mean_praat_base: 2759.53,
		F1_median_praat_base: 687.1,
		F2_median_praat_base: 1690.05,
		F3_median_praat_base: 2773.57
	},
	{
		index: 56,
		person_id: "MRAM0",
		sex: "M",
		duration_second: 0.0881875,
		vowel_name: "ux",
		pitch_mean_praat_base: 122.96,
		F1_mean_praat_base: 571.08,
		F2_mean_praat_base: 1617.69,
		F3_mean_praat_base: 2574.03,
		F1_median_praat_base: 519.1,
		F2_median_praat_base: 1588.1,
		F3_median_praat_base: 2474.08
	},
	{
		index: 57,
		person_id: "MWAR0",
		sex: "M",
		duration_second: 0.073625,
		vowel_name: "ux",
		pitch_mean_praat_base: 147.84,
		F1_mean_praat_base: 410.99,
		F2_mean_praat_base: 1629.61,
		F3_mean_praat_base: 2345.64,
		F1_median_praat_base: 451.25,
		F2_median_praat_base: 1622.67,
		F3_median_praat_base: 2337.1
	},
	{
		index: 58,
		person_id: "FLMK0",
		sex: "F",
		duration_second: 0.0403125,
		vowel_name: "ux",
		pitch_mean_praat_base: 230.94,
		F1_mean_praat_base: 485.24,
		F2_mean_praat_base: 2171.17,
		F3_mean_praat_base: 2654.13,
		F1_median_praat_base: 490.73,
		F2_median_praat_base: 2160.31,
		F3_median_praat_base: 2770.46
	},
	{
		index: 59,
		person_id: "FTBW0",
		sex: "F",
		duration_second: 0.199375,
		vowel_name: "ux",
		pitch_mean_praat_base: 189.76,
		F1_mean_praat_base: 445.26,
		F2_mean_praat_base: 1872.42,
		F3_mean_praat_base: 2577.99,
		F1_median_praat_base: 442.35,
		F2_median_praat_base: 1874.91,
		F3_median_praat_base: 2558.36
	},
	{
		index: 60,
		person_id: "MBDG0",
		sex: "M",
		duration_second: 0.139,
		vowel_name: "aw",
		pitch_mean_praat_base: 134.05,
		F1_mean_praat_base: 677.07,
		F2_mean_praat_base: 1127.77,
		F3_mean_praat_base: 2559.4,
		F1_median_praat_base: 733.83,
		F2_median_praat_base: 970.5,
		F3_median_praat_base: 2354.07
	},
	{
		index: 61,
		person_id: "MRGM0",
		sex: "M",
		duration_second: 0.17,
		vowel_name: "aw",
		pitch_mean_praat_base: 137.03,
		F1_mean_praat_base: 816.91,
		F2_mean_praat_base: 1259.49,
		F3_mean_praat_base: 2485.26,
		F1_median_praat_base: 835.56,
		F2_median_praat_base: 1313.24,
		F3_median_praat_base: 2383.68
	},
	{
		index: 62,
		person_id: "FCEG0",
		sex: "F",
		duration_second: 0.139,
		vowel_name: "aw",
		pitch_mean_praat_base: 232.57,
		F1_mean_praat_base: 815.94,
		F2_mean_praat_base: 1718.63,
		F3_mean_praat_base: 2956.03,
		F1_median_praat_base: 855.65,
		F2_median_praat_base: 1735.77,
		F3_median_praat_base: 2949.42
	},
	{
		index: 63,
		person_id: "FKLH0",
		sex: "F",
		duration_second: 0.13775,
		vowel_name: "aw",
		pitch_mean_praat_base: 237.96,
		F1_mean_praat_base: 926.72,
		F2_mean_praat_base: 1618.79,
		F3_mean_praat_base: 2740.82,
		F1_median_praat_base: 930.38,
		F2_median_praat_base: 1501.57,
		F3_median_praat_base: 2734.48
	},
	{
		index: 64,
		person_id: "MNJM0",
		sex: "M",
		duration_second: 0.1096875,
		vowel_name: "ah",
		pitch_mean_praat_base: 118.83,
		F1_mean_praat_base: 649.9,
		F2_mean_praat_base: 1362.59,
		F3_mean_praat_base: 2259.12,
		F1_median_praat_base: 656.97,
		F2_median_praat_base: 1364.26,
		F3_median_praat_base: 2253.93
	},
	{
		index: 65,
		person_id: "MEGJ0",
		sex: "M",
		duration_second: 0.048125,
		vowel_name: "ah",
		pitch_mean_praat_base: 106.27,
		F1_mean_praat_base: 659.78,
		F2_mean_praat_base: 1169.68,
		F3_mean_praat_base: 2643.19,
		F1_median_praat_base: 657.16,
		F2_median_praat_base: 1160.11,
		F3_median_praat_base: 2629.35
	},
	{
		index: 66,
		person_id: "FNKL0",
		sex: "F",
		duration_second: 0.0925,
		vowel_name: "ah",
		pitch_mean_praat_base: 211.72,
		F1_mean_praat_base: 646.14,
		F2_mean_praat_base: 1501.76,
		F3_mean_praat_base: 2724.83,
		F1_median_praat_base: 647.84,
		F2_median_praat_base: 1562.39,
		F3_median_praat_base: 2780.21
	},
	{
		index: 67,
		person_id: "FPAB1",
		sex: "F",
		duration_second: 0.10375,
		vowel_name: "ah",
		pitch_mean_praat_base: 241.59,
		F1_mean_praat_base: 757.12,
		F2_mean_praat_base: 1593.81,
		F3_mean_praat_base: 2899.71,
		F1_median_praat_base: 772.61,
		F2_median_praat_base: 1578.36,
		F3_median_praat_base: 2941.66
	},
	{
		index: 68,
		person_id: "MDAW1",
		sex: "M",
		duration_second: 0.14,
		vowel_name: "ey",
		pitch_mean_praat_base: 197.61,
		F1_mean_praat_base: 433.48,
		F2_mean_praat_base: 1759.75,
		F3_mean_praat_base: 2398.67,
		F1_median_praat_base: 432.07,
		F2_median_praat_base: 1788.53,
		F3_median_praat_base: 2397.88
	},
	{
		index: 69,
		person_id: "MEWM0",
		sex: "M",
		duration_second: 0.1776875,
		vowel_name: "ey",
		pitch_mean_praat_base: 116.92,
		F1_mean_praat_base: 533.46,
		F2_mean_praat_base: 1637.88,
		F3_mean_praat_base: 2645.12,
		F1_median_praat_base: 537.34,
		F2_median_praat_base: 1719.67,
		F3_median_praat_base: 2574.44
	},
	{
		index: 70,
		person_id: "FKDE0",
		sex: "F",
		duration_second: 0.16,
		vowel_name: "ey",
		pitch_mean_praat_base: 240.38,
		F1_mean_praat_base: 659.55,
		F2_mean_praat_base: 2424.43,
		F3_mean_praat_base: 3149.06,
		F1_median_praat_base: 680.49,
		F2_median_praat_base: 2500.52,
		F3_median_praat_base: 3196.8
	},
	{
		index: 71,
		person_id: "FPAS0",
		sex: "F",
		duration_second: 0.1169375,
		vowel_name: "ey",
		pitch_mean_praat_base: 212,
		F1_mean_praat_base: 604.44,
		F2_mean_praat_base: 2238.04,
		F3_mean_praat_base: 2709.81,
		F1_median_praat_base: 615.68,
		F2_median_praat_base: 2354.59,
		F3_median_praat_base: 2687.88
	},
	{
		index: 72,
		person_id: "MTWH0",
		sex: "M",
		duration_second: 0.0700625,
		vowel_name: "uh",
		pitch_mean_praat_base: 120.08,
		F1_mean_praat_base: 884.34,
		F2_mean_praat_base: 1422.76,
		F3_mean_praat_base: 2422.65,
		F1_median_praat_base: 994.75,
		F2_median_praat_base: 1671.47,
		F3_median_praat_base: 2946.35
	},
	{
		index: 73,
		person_id: "MTPG0",
		sex: "M",
		duration_second: 0.083125,
		vowel_name: "uh",
		pitch_mean_praat_base: 114.56,
		F1_mean_praat_base: 693.84,
		F2_mean_praat_base: 1692.64,
		F3_mean_praat_base: 2364.3,
		F1_median_praat_base: 490.96,
		F2_median_praat_base: 1551.6,
		F3_median_praat_base: 2277.28
	},
	{
		index: 74,
		person_id: "FREW0",
		sex: "F",
		duration_second: 0.065875,
		vowel_name: "uh",
		pitch_mean_praat_base: 207.6,
		F1_mean_praat_base: 519.13,
		F2_mean_praat_base: 962.53,
		F3_mean_praat_base: 3017.06,
		F1_median_praat_base: 530.97,
		F2_median_praat_base: 961.25,
		F3_median_praat_base: 3004.49
	},
	{
		index: 75,
		person_id: "FECD0",
		sex: "F",
		duration_second: 0.065,
		vowel_name: "uh",
		pitch_mean_praat_base: 202.33,
		F1_mean_praat_base: 538.71,
		F2_mean_praat_base: 1340.44,
		F3_mean_praat_base: 3263.19,
		F1_median_praat_base: 558.87,
		F2_median_praat_base: 1337.64,
		F3_median_praat_base: 3271.06
	},
	{
		index: 76,
		person_id: "MWVW0",
		sex: "M",
		duration_second: 0.03325,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 129.07,
		F1_mean_praat_base: 1229.49,
		F2_mean_praat_base: 1983.71,
		F3_mean_praat_base: 2709.7,
		F1_median_praat_base: 1278.98,
		F2_median_praat_base: 1772.28,
		F3_median_praat_base: 2690.29
	},
	{
		index: 77,
		person_id: "MJDA0",
		sex: "M",
		duration_second: 0.0235625,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 146.48,
		F1_mean_praat_base: 736.37,
		F2_mean_praat_base: 1402.85,
		F3_mean_praat_base: 2308.02,
		F1_median_praat_base: 736.37,
		F2_median_praat_base: 1402.85,
		F3_median_praat_base: 2308.02
	},
	{
		index: 78,
		person_id: "FBCH0",
		sex: "F",
		duration_second: 0.0425,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 206.85,
		F1_mean_praat_base: 1022.93,
		F2_mean_praat_base: 2420.79,
		F3_mean_praat_base: 3496.52,
		F1_median_praat_base: 456.65,
		F2_median_praat_base: 2185.32,
		F3_median_praat_base: 3361.32
	},
	{
		index: 79,
		person_id: "FMCM0",
		sex: "F",
		duration_second: 0.020875,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 206.88,
		F1_mean_praat_base: 550.19,
		F2_mean_praat_base: 1920.29,
		F3_mean_praat_base: 2750.35,
		F1_median_praat_base: 550.19,
		F2_median_praat_base: 1920.29,
		F3_median_praat_base: 2750.35
	}
];
var _formants = {
	schema: schema,
	data: data$1
};

let exportFolder = '/home/jeevan/Jeevan_K/Projects/Asquire/Vowtiar-Quest/vowtiar-vowel_synth/src/data/audio_exports';
const pyMakewavHelper = '/home/jeevan/Jeevan_K/Projects/Asquire/Reverb-Quest/Formants/scripts/main/vowelsynth/src/helper/makewav';
if (!fs.existsSync(exportFolder)) {
    fs.mkdirSync(exportFolder);
}
const data = _formants;
const formants = data.data;
for (let i = 0; i < formants.length; i++) {
    let f = formants[i];
    const pitch = Math.round(f['pitch_mean_praat_base']);
    const fileName = [
        f['vowel_name'],
        f['index'],
        f['person_id'],
        f['sex'],
        `${pitch}`,
    ].join('-');
    let formantArray = [
        f['F1_mean_praat_base'],
        f['F2_mean_praat_base'],
        f['F3_mean_praat_base'],
    ];
    let expPath = path.join(exportFolder, fileName);
    console.log(fileName, `; ${formants.length - i - 1} remaining`);
    exportSignal(pitch, formantArray, expPath, pyMakewavHelper);
}
