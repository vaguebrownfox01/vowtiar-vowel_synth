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
		person_id: "MPPC0",
		sex: "M",
		duration_second: 0.073125,
		vowel_name: "iy",
		pitch_mean_praat_base: 142.78,
		F1_mean_praat_base: 466.98,
		F2_mean_praat_base: 1948.16,
		F3_mean_praat_base: 2673.15,
		F1_median_praat_base: 463.02,
		F2_median_praat_base: 1958.39,
		F3_median_praat_base: 2700.85
	},
	{
		index: 3,
		person_id: "MKAH0",
		sex: "M",
		duration_second: 0.061125,
		vowel_name: "iy",
		pitch_mean_praat_base: 126.96,
		F1_mean_praat_base: 480.7,
		F2_mean_praat_base: 2161.41,
		F3_mean_praat_base: 2724.09,
		F1_median_praat_base: 481.49,
		F2_median_praat_base: 2157.63,
		F3_median_praat_base: 2737.17
	},
	{
		index: 4,
		person_id: "MRML0",
		sex: "M",
		duration_second: 0.1774375,
		vowel_name: "iy",
		pitch_mean_praat_base: 86.21,
		F1_mean_praat_base: 880.29,
		F2_mean_praat_base: 2167.21,
		F3_mean_praat_base: 2948.52,
		F1_median_praat_base: 355.54,
		F2_median_praat_base: 2210.83,
		F3_median_praat_base: 2897.05
	},
	{
		index: 5,
		person_id: "MRAB0",
		sex: "M",
		duration_second: 0.1540625,
		vowel_name: "iy",
		pitch_mean_praat_base: 104.09,
		F1_mean_praat_base: 348.26,
		F2_mean_praat_base: 2253.84,
		F3_mean_praat_base: 2795.53,
		F1_median_praat_base: 348.01,
		F2_median_praat_base: 2249.24,
		F3_median_praat_base: 2805.57
	},
	{
		index: 6,
		person_id: "MKDR0",
		sex: "M",
		duration_second: 0.0600625,
		vowel_name: "iy",
		pitch_mean_praat_base: 95.58,
		F1_mean_praat_base: 658.51,
		F2_mean_praat_base: 1900.8,
		F3_mean_praat_base: 2807.69,
		F1_median_praat_base: 338.5,
		F2_median_praat_base: 2019.08,
		F3_median_praat_base: 2800.1
	},
	{
		index: 7,
		person_id: "MWAC0",
		sex: "M",
		duration_second: 0.114625,
		vowel_name: "iy",
		pitch_mean_praat_base: 142.99,
		F1_mean_praat_base: 476.95,
		F2_mean_praat_base: 2027.29,
		F3_mean_praat_base: 2759.65,
		F1_median_praat_base: 320.88,
		F2_median_praat_base: 2099.65,
		F3_median_praat_base: 2840.58
	},
	{
		index: 8,
		person_id: "MCDD0",
		sex: "M",
		duration_second: 0.0778125,
		vowel_name: "iy",
		pitch_mean_praat_base: 114.95,
		F1_mean_praat_base: 496.98,
		F2_mean_praat_base: 2027.39,
		F3_mean_praat_base: 2632.6,
		F1_median_praat_base: 334.23,
		F2_median_praat_base: 2000.15,
		F3_median_praat_base: 2584.84
	},
	{
		index: 9,
		person_id: "MJRH0",
		sex: "M",
		duration_second: 0.055,
		vowel_name: "iy",
		pitch_mean_praat_base: 139.47,
		F1_mean_praat_base: 319.85,
		F2_mean_praat_base: 2319.5,
		F3_mean_praat_base: 3200.71,
		F1_median_praat_base: 314.73,
		F2_median_praat_base: 2315.63,
		F3_median_praat_base: 3197.97
	},
	{
		index: 10,
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
		index: 11,
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
		index: 12,
		person_id: "FSBK0",
		sex: "F",
		duration_second: 0.116875,
		vowel_name: "iy",
		pitch_mean_praat_base: 251.43,
		F1_mean_praat_base: 551.54,
		F2_mean_praat_base: 2428.28,
		F3_mean_praat_base: 2950.14,
		F1_median_praat_base: 554.69,
		F2_median_praat_base: 2566.72,
		F3_median_praat_base: 2990.46
	},
	{
		index: 13,
		person_id: "FDKN0",
		sex: "F",
		duration_second: 0.1131875,
		vowel_name: "iy",
		pitch_mean_praat_base: 197.6,
		F1_mean_praat_base: 436.39,
		F2_mean_praat_base: 1834.62,
		F3_mean_praat_base: 2578.99,
		F1_median_praat_base: 434.2,
		F2_median_praat_base: 2063.58,
		F3_median_praat_base: 2515.75
	},
	{
		index: 14,
		person_id: "FRLL0",
		sex: "F",
		duration_second: 0.095,
		vowel_name: "iy",
		pitch_mean_praat_base: 271.58,
		F1_mean_praat_base: 713.24,
		F2_mean_praat_base: 2401,
		F3_mean_praat_base: 3090.99,
		F1_median_praat_base: 705.39,
		F2_median_praat_base: 2449.46,
		F3_median_praat_base: 3056.27
	},
	{
		index: 15,
		person_id: "FEDW0",
		sex: "F",
		duration_second: 0.1066875,
		vowel_name: "iy",
		pitch_mean_praat_base: 189.07,
		F1_mean_praat_base: 458.4,
		F2_mean_praat_base: 2239.28,
		F3_mean_praat_base: 2660.38,
		F1_median_praat_base: 444.5,
		F2_median_praat_base: 2413.8,
		F3_median_praat_base: 2766.59
	},
	{
		index: 16,
		person_id: "FDNC0",
		sex: "F",
		duration_second: 0.0666875,
		vowel_name: "iy",
		pitch_mean_praat_base: 214.03,
		F1_mean_praat_base: 481.45,
		F2_mean_praat_base: 2317.03,
		F3_mean_praat_base: 2994.34,
		F1_median_praat_base: 469.79,
		F2_median_praat_base: 2389.72,
		F3_median_praat_base: 3041.17
	},
	{
		index: 17,
		person_id: "FEAR0",
		sex: "F",
		duration_second: 0.08875,
		vowel_name: "iy",
		pitch_mean_praat_base: 177.07,
		F1_mean_praat_base: 395.54,
		F2_mean_praat_base: 2199.16,
		F3_mean_praat_base: 2470.42,
		F1_median_praat_base: 386.42,
		F2_median_praat_base: 2242.22,
		F3_median_praat_base: 2450.6
	},
	{
		index: 18,
		person_id: "FPMY0",
		sex: "F",
		duration_second: 0.09,
		vowel_name: "iy",
		pitch_mean_praat_base: 203.99,
		F1_mean_praat_base: 514.91,
		F2_mean_praat_base: 2294.51,
		F3_mean_praat_base: 2806.05,
		F1_median_praat_base: 519.05,
		F2_median_praat_base: 2349.57,
		F3_median_praat_base: 2783.06
	},
	{
		index: 19,
		person_id: "FLJG0",
		sex: "F",
		duration_second: 0.155,
		vowel_name: "iy",
		pitch_mean_praat_base: 169.92,
		F1_mean_praat_base: 449.88,
		F2_mean_praat_base: 2524.47,
		F3_mean_praat_base: 3035.74,
		F1_median_praat_base: 428.27,
		F2_median_praat_base: 2725.25,
		F3_median_praat_base: 3155.15
	},
	{
		index: 20,
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
		index: 21,
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
		index: 22,
		person_id: "MJJB0",
		sex: "M",
		duration_second: 0.1645,
		vowel_name: "ae",
		pitch_mean_praat_base: 110.74,
		F1_mean_praat_base: 621.72,
		F2_mean_praat_base: 1694.96,
		F3_mean_praat_base: 2385.37,
		F1_median_praat_base: 644.6,
		F2_median_praat_base: 1710.21,
		F3_median_praat_base: 2478.03
	},
	{
		index: 23,
		person_id: "MPAR0",
		sex: "M",
		duration_second: 0.20975,
		vowel_name: "ae",
		pitch_mean_praat_base: 113.88,
		F1_mean_praat_base: 695.57,
		F2_mean_praat_base: 1435.61,
		F3_mean_praat_base: 2424.44,
		F1_median_praat_base: 694.64,
		F2_median_praat_base: 1449.48,
		F3_median_praat_base: 2459.81
	},
	{
		index: 24,
		person_id: "MWAC0",
		sex: "M",
		duration_second: 0.1478125,
		vowel_name: "ae",
		pitch_mean_praat_base: 134.51,
		F1_mean_praat_base: 607.58,
		F2_mean_praat_base: 1886.37,
		F3_mean_praat_base: 3436.58,
		F1_median_praat_base: 619.52,
		F2_median_praat_base: 1885.82,
		F3_median_praat_base: 3562.52
	},
	{
		index: 25,
		person_id: "MSVS0",
		sex: "M",
		duration_second: 0.258125,
		vowel_name: "ae",
		pitch_mean_praat_base: 140.49,
		F1_mean_praat_base: 665.28,
		F2_mean_praat_base: 1602.7,
		F3_mean_praat_base: 2409.3,
		F1_median_praat_base: 682.24,
		F2_median_praat_base: 1627.47,
		F3_median_praat_base: 2455.26
	},
	{
		index: 26,
		person_id: "MRJM1",
		sex: "M",
		duration_second: 0.16,
		vowel_name: "ae",
		pitch_mean_praat_base: 132.97,
		F1_mean_praat_base: 589.65,
		F2_mean_praat_base: 1913.36,
		F3_mean_praat_base: 2696.94,
		F1_median_praat_base: 602.68,
		F2_median_praat_base: 1933.76,
		F3_median_praat_base: 2682.28
	},
	{
		index: 27,
		person_id: "MRLR0",
		sex: "M",
		duration_second: 0.1245625,
		vowel_name: "ae",
		pitch_mean_praat_base: 105.46,
		F1_mean_praat_base: 679.94,
		F2_mean_praat_base: 1413.02,
		F3_mean_praat_base: 2344.47,
		F1_median_praat_base: 689.35,
		F2_median_praat_base: 1469.45,
		F3_median_praat_base: 2351.26
	},
	{
		index: 28,
		person_id: "MMDS0",
		sex: "M",
		duration_second: 0.1398125,
		vowel_name: "ae",
		pitch_mean_praat_base: 131.64,
		F1_mean_praat_base: 617.17,
		F2_mean_praat_base: 1761.13,
		F3_mean_praat_base: 2315.13,
		F1_median_praat_base: 621.5,
		F2_median_praat_base: 1796.56,
		F3_median_praat_base: 2299.15
	},
	{
		index: 29,
		person_id: "MPAR0",
		sex: "M",
		duration_second: 0.1246875,
		vowel_name: "ae",
		pitch_mean_praat_base: 107.12,
		F1_mean_praat_base: 635.6,
		F2_mean_praat_base: 1602.36,
		F3_mean_praat_base: 2559.77,
		F1_median_praat_base: 651.13,
		F2_median_praat_base: 1600.17,
		F3_median_praat_base: 2569.16
	},
	{
		index: 30,
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
		index: 31,
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
		index: 32,
		person_id: "FEDW0",
		sex: "F",
		duration_second: 0.18,
		vowel_name: "ae",
		pitch_mean_praat_base: 168.79,
		F1_mean_praat_base: 799.52,
		F2_mean_praat_base: 1899.65,
		F3_mean_praat_base: 2599.4,
		F1_median_praat_base: 834.51,
		F2_median_praat_base: 2058.96,
		F3_median_praat_base: 2738.26
	},
	{
		index: 33,
		person_id: "FGMB0",
		sex: "F",
		duration_second: 0.155,
		vowel_name: "ae",
		pitch_mean_praat_base: 204.51,
		F1_mean_praat_base: 799.82,
		F2_mean_praat_base: 1714.49,
		F3_mean_praat_base: 2713,
		F1_median_praat_base: 820.87,
		F2_median_praat_base: 1705.46,
		F3_median_praat_base: 2711.27
	},
	{
		index: 34,
		person_id: "FADG0",
		sex: "F",
		duration_second: 0.1800625,
		vowel_name: "ae",
		pitch_mean_praat_base: 232.68,
		F1_mean_praat_base: 702.41,
		F2_mean_praat_base: 2142.11,
		F3_mean_praat_base: 3055.97,
		F1_median_praat_base: 695.49,
		F2_median_praat_base: 2202.24,
		F3_median_praat_base: 3060.74
	},
	{
		index: 35,
		person_id: "FJLG0",
		sex: "F",
		duration_second: 0.2086875,
		vowel_name: "ae",
		pitch_mean_praat_base: 225.3,
		F1_mean_praat_base: 864.42,
		F2_mean_praat_base: 2084.82,
		F3_mean_praat_base: 3088.21,
		F1_median_praat_base: 883.51,
		F2_median_praat_base: 2112.68,
		F3_median_praat_base: 3103.19
	},
	{
		index: 36,
		person_id: "FJRE0",
		sex: "F",
		duration_second: 0.1845,
		vowel_name: "ae",
		pitch_mean_praat_base: 190.76,
		F1_mean_praat_base: 665.63,
		F2_mean_praat_base: 1937.05,
		F3_mean_praat_base: 2609.87,
		F1_median_praat_base: 700.82,
		F2_median_praat_base: 1923.67,
		F3_median_praat_base: 2681.5
	},
	{
		index: 37,
		person_id: "FCDR1",
		sex: "F",
		duration_second: 0.1175,
		vowel_name: "ae",
		pitch_mean_praat_base: 197.13,
		F1_mean_praat_base: 727.5,
		F2_mean_praat_base: 1543.29,
		F3_mean_praat_base: 2146.43,
		F1_median_praat_base: 738.34,
		F2_median_praat_base: 1616.57,
		F3_median_praat_base: 2151.37
	},
	{
		index: 38,
		person_id: "FRAM1",
		sex: "F",
		duration_second: 0.2995,
		vowel_name: "ae",
		pitch_mean_praat_base: 201.98,
		F1_mean_praat_base: 939.08,
		F2_mean_praat_base: 1673.68,
		F3_mean_praat_base: 1914.55,
		F1_median_praat_base: 967.91,
		F2_median_praat_base: 1710.58,
		F3_median_praat_base: 1901.68
	},
	{
		index: 39,
		person_id: "FPAC0",
		sex: "F",
		duration_second: 0.1521875,
		vowel_name: "ae",
		pitch_mean_praat_base: 219.54,
		F1_mean_praat_base: 678.91,
		F2_mean_praat_base: 2277.89,
		F3_mean_praat_base: 3047.67,
		F1_median_praat_base: 667.47,
		F2_median_praat_base: 2338.69,
		F3_median_praat_base: 3029.26
	},
	{
		index: 40,
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
		index: 41,
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
		index: 42,
		person_id: "MRPP0",
		sex: "M",
		duration_second: 0.107375,
		vowel_name: "er",
		pitch_mean_praat_base: 92.21,
		F1_mean_praat_base: 749.85,
		F2_mean_praat_base: 1476.25,
		F3_mean_praat_base: 2741.83,
		F1_median_praat_base: 746.41,
		F2_median_praat_base: 1485.72,
		F3_median_praat_base: 2926.02
	},
	{
		index: 43,
		person_id: "MJPM1",
		sex: "M",
		duration_second: 0.146625,
		vowel_name: "er",
		pitch_mean_praat_base: 164.38,
		F1_mean_praat_base: 531.63,
		F2_mean_praat_base: 1704.12,
		F3_mean_praat_base: 2267,
		F1_median_praat_base: 536.54,
		F2_median_praat_base: 1707.31,
		F3_median_praat_base: 2190.63
	},
	{
		index: 44,
		person_id: "MBWP0",
		sex: "M",
		duration_second: 0.109625,
		vowel_name: "er",
		pitch_mean_praat_base: 111.94,
		F1_mean_praat_base: 526.46,
		F2_mean_praat_base: 1323.19,
		F3_mean_praat_base: 1915.14,
		F1_median_praat_base: 528.12,
		F2_median_praat_base: 1309.1,
		F3_median_praat_base: 1725.29
	},
	{
		index: 45,
		person_id: "MJTC0",
		sex: "M",
		duration_second: 0.1665625,
		vowel_name: "er",
		pitch_mean_praat_base: 98.22,
		F1_mean_praat_base: 466.81,
		F2_mean_praat_base: 1548.37,
		F3_mean_praat_base: 1820.24,
		F1_median_praat_base: 467.05,
		F2_median_praat_base: 1547.6,
		F3_median_praat_base: 1798.92
	},
	{
		index: 46,
		person_id: "MTRT0",
		sex: "M",
		duration_second: 0.1086875,
		vowel_name: "er",
		pitch_mean_praat_base: 101.71,
		F1_mean_praat_base: 697.49,
		F2_mean_praat_base: 1304.87,
		F3_mean_praat_base: 2250.85,
		F1_median_praat_base: 545.19,
		F2_median_praat_base: 1313.22,
		F3_median_praat_base: 1681.61
	},
	{
		index: 47,
		person_id: "MTAB0",
		sex: "M",
		duration_second: 0.1669375,
		vowel_name: "er",
		pitch_mean_praat_base: 108.51,
		F1_mean_praat_base: 1015.62,
		F2_mean_praat_base: 1496.81,
		F3_mean_praat_base: 2519.49,
		F1_median_praat_base: 1074.91,
		F2_median_praat_base: 1500.47,
		F3_median_praat_base: 2476.12
	},
	{
		index: 48,
		person_id: "MPRK0",
		sex: "M",
		duration_second: 0.085,
		vowel_name: "er",
		pitch_mean_praat_base: 138.19,
		F1_mean_praat_base: 523.94,
		F2_mean_praat_base: 1261.02,
		F3_mean_praat_base: 1651.92,
		F1_median_praat_base: 522.66,
		F2_median_praat_base: 1293.34,
		F3_median_praat_base: 1599.78
	},
	{
		index: 49,
		person_id: "MRDD0",
		sex: "M",
		duration_second: 0.0965625,
		vowel_name: "er",
		pitch_mean_praat_base: 96.16,
		F1_mean_praat_base: 603.27,
		F2_mean_praat_base: 1301.15,
		F3_mean_praat_base: 1772.63,
		F1_median_praat_base: 580.03,
		F2_median_praat_base: 1304.28,
		F3_median_praat_base: 1623.71
	},
	{
		index: 50,
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
		index: 51,
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
		index: 52,
		person_id: "FKDE0",
		sex: "F",
		duration_second: 0.125,
		vowel_name: "er",
		pitch_mean_praat_base: 214.08,
		F1_mean_praat_base: 557.65,
		F2_mean_praat_base: 1488.11,
		F3_mean_praat_base: 1968.86,
		F1_median_praat_base: 564.33,
		F2_median_praat_base: 1355.28,
		F3_median_praat_base: 1823.16
	},
	{
		index: 53,
		person_id: "FSLB1",
		sex: "F",
		duration_second: 0.09425,
		vowel_name: "er",
		pitch_mean_praat_base: 201.42,
		F1_mean_praat_base: 563.96,
		F2_mean_praat_base: 1710.59,
		F3_mean_praat_base: 2082.06,
		F1_median_praat_base: 583.12,
		F2_median_praat_base: 1616,
		F3_median_praat_base: 2037.77
	},
	{
		index: 54,
		person_id: "FJSJ0",
		sex: "F",
		duration_second: 0.1284375,
		vowel_name: "er",
		pitch_mean_praat_base: 240.23,
		F1_mean_praat_base: 535.17,
		F2_mean_praat_base: 1786.04,
		F3_mean_praat_base: 2087.89,
		F1_median_praat_base: 560.18,
		F2_median_praat_base: 1727.42,
		F3_median_praat_base: 1993.44
	},
	{
		index: 55,
		person_id: "FRNG0",
		sex: "F",
		duration_second: 0.0730625,
		vowel_name: "er",
		pitch_mean_praat_base: 248.42,
		F1_mean_praat_base: 448.97,
		F2_mean_praat_base: 2008.57,
		F3_mean_praat_base: 2387.18,
		F1_median_praat_base: 443.58,
		F2_median_praat_base: 2004.34,
		F3_median_praat_base: 2401.22
	},
	{
		index: 56,
		person_id: "FSXA0",
		sex: "F",
		duration_second: 0.0885,
		vowel_name: "er",
		pitch_mean_praat_base: 186.95,
		F1_mean_praat_base: 494.13,
		F2_mean_praat_base: 1694.35,
		F3_mean_praat_base: 2204.38,
		F1_median_praat_base: 495.05,
		F2_median_praat_base: 1623.91,
		F3_median_praat_base: 1903.22
	},
	{
		index: 57,
		person_id: "FJSK0",
		sex: "F",
		duration_second: 0.115,
		vowel_name: "er",
		pitch_mean_praat_base: 208.31,
		F1_mean_praat_base: 620.54,
		F2_mean_praat_base: 1415.13,
		F3_mean_praat_base: 1811.93,
		F1_median_praat_base: 618.09,
		F2_median_praat_base: 1361.94,
		F3_median_praat_base: 1784.18
	},
	{
		index: 58,
		person_id: "FCMH0",
		sex: "F",
		duration_second: 0.17625,
		vowel_name: "er",
		pitch_mean_praat_base: 187.7,
		F1_mean_praat_base: 539.62,
		F2_mean_praat_base: 1831.41,
		F3_mean_praat_base: 2472.6,
		F1_median_praat_base: 549.3,
		F2_median_praat_base: 1825.94,
		F3_median_praat_base: 2397.97
	},
	{
		index: 59,
		person_id: "FCMG0",
		sex: "F",
		duration_second: 0.0835,
		vowel_name: "er",
		pitch_mean_praat_base: 172.43,
		F1_mean_praat_base: 581.64,
		F2_mean_praat_base: 1539.12,
		F3_mean_praat_base: 2342.88,
		F1_median_praat_base: 571.18,
		F2_median_praat_base: 1515.04,
		F3_median_praat_base: 2135.63
	},
	{
		index: 60,
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
		index: 61,
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
		index: 62,
		person_id: "MADC0",
		sex: "M",
		duration_second: 0.1079375,
		vowel_name: "aa",
		pitch_mean_praat_base: 106.44,
		F1_mean_praat_base: 824.3,
		F2_mean_praat_base: 1261.13,
		F3_mean_praat_base: 2325.81,
		F1_median_praat_base: 825.98,
		F2_median_praat_base: 1252,
		F3_median_praat_base: 2464.04
	},
	{
		index: 63,
		person_id: "MDED0",
		sex: "M",
		duration_second: 0.07,
		vowel_name: "aa",
		pitch_mean_praat_base: 127.04,
		F1_mean_praat_base: 700.06,
		F2_mean_praat_base: 1157.79,
		F3_mean_praat_base: 2454.03,
		F1_median_praat_base: 700.64,
		F2_median_praat_base: 1161.21,
		F3_median_praat_base: 2413.32
	},
	{
		index: 64,
		person_id: "MTHC0",
		sex: "M",
		duration_second: 0.0835625,
		vowel_name: "aa",
		pitch_mean_praat_base: 129.64,
		F1_mean_praat_base: 680.34,
		F2_mean_praat_base: 917.28,
		F3_mean_praat_base: 2254.46,
		F1_median_praat_base: 675.41,
		F2_median_praat_base: 926.33,
		F3_median_praat_base: 2335.95
	},
	{
		index: 65,
		person_id: "MTAT0",
		sex: "M",
		duration_second: 0.121375,
		vowel_name: "aa",
		pitch_mean_praat_base: 119.56,
		F1_mean_praat_base: 657.45,
		F2_mean_praat_base: 1125.5,
		F3_mean_praat_base: 2039.69,
		F1_median_praat_base: 636.69,
		F2_median_praat_base: 1078.08,
		F3_median_praat_base: 1908.17
	},
	{
		index: 66,
		person_id: "MJXA0",
		sex: "M",
		duration_second: 0.1386875,
		vowel_name: "aa",
		pitch_mean_praat_base: 122.57,
		F1_mean_praat_base: 707.97,
		F2_mean_praat_base: 1131.6,
		F3_mean_praat_base: 2462.42,
		F1_median_praat_base: 728.91,
		F2_median_praat_base: 1143.05,
		F3_median_praat_base: 2477.52
	},
	{
		index: 67,
		person_id: "MNET0",
		sex: "M",
		duration_second: 0.166875,
		vowel_name: "aa",
		pitch_mean_praat_base: 102.15,
		F1_mean_praat_base: 716.65,
		F2_mean_praat_base: 1515.87,
		F3_mean_praat_base: 2642.67,
		F1_median_praat_base: 704.51,
		F2_median_praat_base: 1437.21,
		F3_median_praat_base: 2578.04
	},
	{
		index: 68,
		person_id: "MJWG0",
		sex: "M",
		duration_second: 0.116875,
		vowel_name: "aa",
		pitch_mean_praat_base: 131.66,
		F1_mean_praat_base: 597.63,
		F2_mean_praat_base: 1139.53,
		F3_mean_praat_base: 2156.83,
		F1_median_praat_base: 616.94,
		F2_median_praat_base: 997.39,
		F3_median_praat_base: 2143.08
	},
	{
		index: 69,
		person_id: "MJMM0",
		sex: "M",
		duration_second: 0.1175,
		vowel_name: "aa",
		pitch_mean_praat_base: 152.88,
		F1_mean_praat_base: 639.6,
		F2_mean_praat_base: 1215.58,
		F3_mean_praat_base: 1967.13,
		F1_median_praat_base: 639.33,
		F2_median_praat_base: 1163.95,
		F3_median_praat_base: 1994.84
	},
	{
		index: 70,
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
		index: 71,
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
		index: 72,
		person_id: "FNTB0",
		sex: "F",
		duration_second: 0.1500625,
		vowel_name: "aa",
		pitch_mean_praat_base: 181.68,
		F1_mean_praat_base: 745.56,
		F2_mean_praat_base: 1401.29,
		F3_mean_praat_base: 2761.31,
		F1_median_praat_base: 756.62,
		F2_median_praat_base: 1316.07,
		F3_median_praat_base: 2758.02
	},
	{
		index: 73,
		person_id: "FSXA0",
		sex: "F",
		duration_second: 0.1815,
		vowel_name: "aa",
		pitch_mean_praat_base: 176.03,
		F1_mean_praat_base: 684.95,
		F2_mean_praat_base: 1084.53,
		F3_mean_praat_base: 2524.88,
		F1_median_praat_base: 710.84,
		F2_median_praat_base: 1087.46,
		F3_median_praat_base: 2675.51
	},
	{
		index: 74,
		person_id: "FJMG0",
		sex: "F",
		duration_second: 0.285,
		vowel_name: "aa",
		pitch_mean_praat_base: 233.38,
		F1_mean_praat_base: 1024.03,
		F2_mean_praat_base: 1710.95,
		F3_mean_praat_base: 2996.76,
		F1_median_praat_base: 1047.21,
		F2_median_praat_base: 1721.46,
		F3_median_praat_base: 2942.28
	},
	{
		index: 75,
		person_id: "FBJL0",
		sex: "F",
		duration_second: 0.125625,
		vowel_name: "aa",
		pitch_mean_praat_base: 211.14,
		F1_mean_praat_base: 709.17,
		F2_mean_praat_base: 1348.43,
		F3_mean_praat_base: 2152.25,
		F1_median_praat_base: 749.28,
		F2_median_praat_base: 1262.95,
		F3_median_praat_base: 2153.03
	},
	{
		index: 76,
		person_id: "FDAC1",
		sex: "F",
		duration_second: 0.3775,
		vowel_name: "aa",
		pitch_mean_praat_base: 162.79,
		F1_mean_praat_base: 933.13,
		F2_mean_praat_base: 1633.93,
		F3_mean_praat_base: 2765.28,
		F1_median_praat_base: 939.42,
		F2_median_praat_base: 1650.94,
		F3_median_praat_base: 2789.27
	},
	{
		index: 77,
		person_id: "FDAS1",
		sex: "F",
		duration_second: 0.143125,
		vowel_name: "aa",
		pitch_mean_praat_base: 234.21,
		F1_mean_praat_base: 791.39,
		F2_mean_praat_base: 1652.57,
		F3_mean_praat_base: 2610.81,
		F1_median_praat_base: 817.19,
		F2_median_praat_base: 1635.9,
		F3_median_praat_base: 2608.96
	},
	{
		index: 78,
		person_id: "FSMS1",
		sex: "F",
		duration_second: 0.1085,
		vowel_name: "aa",
		pitch_mean_praat_base: 222.13,
		F1_mean_praat_base: 787.25,
		F2_mean_praat_base: 1633.36,
		F3_mean_praat_base: 2585.08,
		F1_median_praat_base: 821.99,
		F2_median_praat_base: 1570.44,
		F3_median_praat_base: 2524.05
	},
	{
		index: 79,
		person_id: "FKSR0",
		sex: "F",
		duration_second: 0.115,
		vowel_name: "aa",
		pitch_mean_praat_base: 210.74,
		F1_mean_praat_base: 791.55,
		F2_mean_praat_base: 1518.56,
		F3_mean_praat_base: 2183.58,
		F1_median_praat_base: 809.84,
		F2_median_praat_base: 1492.1,
		F3_median_praat_base: 2129.27
	},
	{
		index: 80,
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
		index: 81,
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
		index: 82,
		person_id: "MJRA0",
		sex: "M",
		duration_second: 0.094,
		vowel_name: "uw",
		pitch_mean_praat_base: 131.54,
		F1_mean_praat_base: 432.96,
		F2_mean_praat_base: 1249.07,
		F3_mean_praat_base: 2321.8,
		F1_median_praat_base: 406.74,
		F2_median_praat_base: 1115.37,
		F3_median_praat_base: 2339.85
	},
	{
		index: 83,
		person_id: "MRPP0",
		sex: "M",
		duration_second: 0.19025,
		vowel_name: "uw",
		pitch_mean_praat_base: 98.23,
		F1_mean_praat_base: 489.04,
		F2_mean_praat_base: 1469.06,
		F3_mean_praat_base: 2370.23,
		F1_median_praat_base: 486.26,
		F2_median_praat_base: 1472.35,
		F3_median_praat_base: 2226.49
	},
	{
		index: 84,
		person_id: "MPAB0",
		sex: "M",
		duration_second: 0.138375,
		vowel_name: "uw",
		pitch_mean_praat_base: 128.42,
		F1_mean_praat_base: 529.55,
		F2_mean_praat_base: 1439.53,
		F3_mean_praat_base: 2859.77,
		F1_median_praat_base: 558.76,
		F2_median_praat_base: 1436.66,
		F3_median_praat_base: 2846.17
	},
	{
		index: 85,
		person_id: "MDBP0",
		sex: "M",
		duration_second: 0.072625,
		vowel_name: "uw",
		pitch_mean_praat_base: 133.53,
		F1_mean_praat_base: 362.03,
		F2_mean_praat_base: 1252.03,
		F3_mean_praat_base: 2462.42,
		F1_median_praat_base: 349.81,
		F2_median_praat_base: 1209.19,
		F3_median_praat_base: 2444.41
	},
	{
		index: 86,
		person_id: "MDHS0",
		sex: "M",
		duration_second: 0.0809375,
		vowel_name: "uw",
		pitch_mean_praat_base: 138.52,
		F1_mean_praat_base: 498.61,
		F2_mean_praat_base: 1166.96,
		F3_mean_praat_base: 2796.55,
		F1_median_praat_base: 493.35,
		F2_median_praat_base: 1098.81,
		F3_median_praat_base: 2767.2
	},
	{
		index: 87,
		person_id: "MSDH0",
		sex: "M",
		duration_second: 0.08525,
		vowel_name: "uw",
		pitch_mean_praat_base: 116.87,
		F1_mean_praat_base: 520.78,
		F2_mean_praat_base: 1259.53,
		F3_mean_praat_base: 2635.58,
		F1_median_praat_base: 515.32,
		F2_median_praat_base: 1215.96,
		F3_median_praat_base: 2658.12
	},
	{
		index: 88,
		person_id: "MKCH0",
		sex: "M",
		duration_second: 0.0910625,
		vowel_name: "uw",
		pitch_mean_praat_base: 119.63,
		F1_mean_praat_base: 609.38,
		F2_mean_praat_base: 1196.3,
		F3_mean_praat_base: 3007.03,
		F1_median_praat_base: 557.43,
		F2_median_praat_base: 901.22,
		F3_median_praat_base: 3174.39
	},
	{
		index: 89,
		person_id: "MVJH0",
		sex: "M",
		duration_second: 0.090875,
		vowel_name: "uw",
		pitch_mean_praat_base: 124.81,
		F1_mean_praat_base: 427.16,
		F2_mean_praat_base: 1329.42,
		F3_mean_praat_base: 2344.42,
		F1_median_praat_base: 422.3,
		F2_median_praat_base: 1275.19,
		F3_median_praat_base: 2339.38
	},
	{
		index: 90,
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
		index: 91,
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
		index: 92,
		person_id: "FUTB0",
		sex: "F",
		duration_second: 0.11,
		vowel_name: "uw",
		pitch_mean_praat_base: 192.63,
		F1_mean_praat_base: 443.59,
		F2_mean_praat_base: 1650.7,
		F3_mean_praat_base: 2607.27,
		F1_median_praat_base: 443.32,
		F2_median_praat_base: 1535.42,
		F3_median_praat_base: 2586.43
	},
	{
		index: 93,
		person_id: "FMBG0",
		sex: "F",
		duration_second: 0.0600625,
		vowel_name: "uw",
		pitch_mean_praat_base: 215.32,
		F1_mean_praat_base: 480.76,
		F2_mean_praat_base: 1237.66,
		F3_mean_praat_base: 2588.39,
		F1_median_praat_base: 467.44,
		F2_median_praat_base: 1202,
		F3_median_praat_base: 2617.36
	},
	{
		index: 94,
		person_id: "FAKS0",
		sex: "F",
		duration_second: 0.10875,
		vowel_name: "uw",
		pitch_mean_praat_base: 262.9,
		F1_mean_praat_base: 550.2,
		F2_mean_praat_base: 1326.25,
		F3_mean_praat_base: 2911,
		F1_median_praat_base: 552.48,
		F2_median_praat_base: 1263.5,
		F3_median_praat_base: 2857.34
	},
	{
		index: 95,
		person_id: "FAEM0",
		sex: "F",
		duration_second: 0.0985,
		vowel_name: "uw",
		pitch_mean_praat_base: 181.32,
		F1_mean_praat_base: 483.82,
		F2_mean_praat_base: 1321.67,
		F3_mean_praat_base: 2497.02,
		F1_median_praat_base: 484.52,
		F2_median_praat_base: 1207.55,
		F3_median_praat_base: 2515.79
	},
	{
		index: 96,
		person_id: "FPMY0",
		sex: "F",
		duration_second: 0.1279375,
		vowel_name: "uw",
		pitch_mean_praat_base: 197.62,
		F1_mean_praat_base: 563.44,
		F2_mean_praat_base: 1121.39,
		F3_mean_praat_base: 2615.05,
		F1_median_praat_base: 559.4,
		F2_median_praat_base: 939.14,
		F3_median_praat_base: 2709.59
	},
	{
		index: 97,
		person_id: "FBJL0",
		sex: "F",
		duration_second: 0.079625,
		vowel_name: "uw",
		pitch_mean_praat_base: 212.47,
		F1_mean_praat_base: 509.18,
		F2_mean_praat_base: 1611.73,
		F3_mean_praat_base: 2749.14,
		F1_median_praat_base: 514.92,
		F2_median_praat_base: 1625.12,
		F3_median_praat_base: 2748.29
	},
	{
		index: 98,
		person_id: "FETB0",
		sex: "F",
		duration_second: 0.1608125,
		vowel_name: "uw",
		pitch_mean_praat_base: 221.64,
		F1_mean_praat_base: 449.83,
		F2_mean_praat_base: 1545.86,
		F3_mean_praat_base: 3059.75,
		F1_median_praat_base: 447.17,
		F2_median_praat_base: 1470.68,
		F3_median_praat_base: 3067.08
	},
	{
		index: 99,
		person_id: "FLET0",
		sex: "F",
		duration_second: 0.1199375,
		vowel_name: "uw",
		pitch_mean_praat_base: 230.86,
		F1_mean_praat_base: 602.26,
		F2_mean_praat_base: 1390.1,
		F3_mean_praat_base: 2922.8,
		F1_median_praat_base: 583.33,
		F2_median_praat_base: 1376.39,
		F3_median_praat_base: 2925.93
	},
	{
		index: 100,
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
		index: 101,
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
		index: 102,
		person_id: "MTMR0",
		sex: "M",
		duration_second: 0.085,
		vowel_name: "ih",
		pitch_mean_praat_base: 106.61,
		F1_mean_praat_base: 459.09,
		F2_mean_praat_base: 1555.94,
		F3_mean_praat_base: 2759.48,
		F1_median_praat_base: 461.33,
		F2_median_praat_base: 1553.06,
		F3_median_praat_base: 2763.56
	},
	{
		index: 103,
		person_id: "MLSH0",
		sex: "M",
		duration_second: 0.059,
		vowel_name: "ih",
		pitch_mean_praat_base: 132.98,
		F1_mean_praat_base: 423.36,
		F2_mean_praat_base: 1957.74,
		F3_mean_praat_base: 2279.44,
		F1_median_praat_base: 425.8,
		F2_median_praat_base: 1951.65,
		F3_median_praat_base: 2269.21
	},
	{
		index: 104,
		person_id: "MCDR0",
		sex: "M",
		duration_second: 0.085,
		vowel_name: "ih",
		pitch_mean_praat_base: 109.53,
		F1_mean_praat_base: 495.31,
		F2_mean_praat_base: 1588.59,
		F3_mean_praat_base: 2785.8,
		F1_median_praat_base: 497,
		F2_median_praat_base: 1558.28,
		F3_median_praat_base: 2757.22
	},
	{
		index: 105,
		person_id: "MJWS0",
		sex: "M",
		duration_second: 0.1165625,
		vowel_name: "ih",
		pitch_mean_praat_base: 136.03,
		F1_mean_praat_base: 373.84,
		F2_mean_praat_base: 2056.57,
		F3_mean_praat_base: 2597.5,
		F1_median_praat_base: 368.78,
		F2_median_praat_base: 2078.05,
		F3_median_praat_base: 2596.81
	},
	{
		index: 106,
		person_id: "MMRP0",
		sex: "M",
		duration_second: 0.07125,
		vowel_name: "ih",
		pitch_mean_praat_base: 123.91,
		F1_mean_praat_base: 698.92,
		F2_mean_praat_base: 1829.09,
		F3_mean_praat_base: 2767.12,
		F1_median_praat_base: 457.77,
		F2_median_praat_base: 1720.2,
		F3_median_praat_base: 2427.2
	},
	{
		index: 107,
		person_id: "MJDH0",
		sex: "M",
		duration_second: 0.060625,
		vowel_name: "ih",
		pitch_mean_praat_base: 152,
		F1_mean_praat_base: 493.52,
		F2_mean_praat_base: 1553.63,
		F3_mean_praat_base: 2711.93,
		F1_median_praat_base: 486.99,
		F2_median_praat_base: 1455.66,
		F3_median_praat_base: 2533.82
	},
	{
		index: 108,
		person_id: "MCSH0",
		sex: "M",
		duration_second: 0.08875,
		vowel_name: "ih",
		pitch_mean_praat_base: 147.49,
		F1_mean_praat_base: 595.27,
		F2_mean_praat_base: 1465.08,
		F3_mean_praat_base: 2679.66,
		F1_median_praat_base: 592.08,
		F2_median_praat_base: 1514.07,
		F3_median_praat_base: 2680.57
	},
	{
		index: 109,
		person_id: "MMDM2",
		sex: "M",
		duration_second: 0.05375,
		vowel_name: "ih",
		pitch_mean_praat_base: 103.78,
		F1_mean_praat_base: 431.69,
		F2_mean_praat_base: 1844.92,
		F3_mean_praat_base: 2521.56,
		F1_median_praat_base: 433.09,
		F2_median_praat_base: 1840.19,
		F3_median_praat_base: 2496.63
	},
	{
		index: 110,
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
		index: 111,
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
		index: 112,
		person_id: "FKLC1",
		sex: "F",
		duration_second: 0.03,
		vowel_name: "ih",
		pitch_mean_praat_base: 182.56,
		F1_mean_praat_base: 515.44,
		F2_mean_praat_base: 1911.28,
		F3_mean_praat_base: 2418.91,
		F1_median_praat_base: 524.4,
		F2_median_praat_base: 1894.1,
		F3_median_praat_base: 2441.49
	},
	{
		index: 113,
		person_id: "FMAF0",
		sex: "F",
		duration_second: 0.0961875,
		vowel_name: "ih",
		pitch_mean_praat_base: 187.13,
		F1_mean_praat_base: 486.98,
		F2_mean_praat_base: 2161.68,
		F3_mean_praat_base: 2929.67,
		F1_median_praat_base: 484.62,
		F2_median_praat_base: 2175.64,
		F3_median_praat_base: 2927.35
	},
	{
		index: 114,
		person_id: "FSJG0",
		sex: "F",
		duration_second: 0.1021875,
		vowel_name: "ih",
		pitch_mean_praat_base: 200.76,
		F1_mean_praat_base: 501.45,
		F2_mean_praat_base: 1982.23,
		F3_mean_praat_base: 2693.72,
		F1_median_praat_base: 503.32,
		F2_median_praat_base: 1988.08,
		F3_median_praat_base: 2736.38
	},
	{
		index: 115,
		person_id: "FJXM0",
		sex: "F",
		duration_second: 0.0638125,
		vowel_name: "ih",
		pitch_mean_praat_base: 231.25,
		F1_mean_praat_base: 533.28,
		F2_mean_praat_base: 2138.84,
		F3_mean_praat_base: 3135.49,
		F1_median_praat_base: 539.43,
		F2_median_praat_base: 2066.91,
		F3_median_praat_base: 3145.57
	},
	{
		index: 116,
		person_id: "FCYL0",
		sex: "F",
		duration_second: 0.094,
		vowel_name: "ih",
		pitch_mean_praat_base: 201.42,
		F1_mean_praat_base: 406.05,
		F2_mean_praat_base: 2379.54,
		F3_mean_praat_base: 2825.9,
		F1_median_praat_base: 389.83,
		F2_median_praat_base: 2417.6,
		F3_median_praat_base: 2817.95
	},
	{
		index: 117,
		person_id: "FPMY0",
		sex: "F",
		duration_second: 0.094,
		vowel_name: "ih",
		pitch_mean_praat_base: 197.62,
		F1_mean_praat_base: 594.92,
		F2_mean_praat_base: 1802.87,
		F3_mean_praat_base: 2831.48,
		F1_median_praat_base: 626.96,
		F2_median_praat_base: 1822.1,
		F3_median_praat_base: 2782.42
	},
	{
		index: 118,
		person_id: "FPAC0",
		sex: "F",
		duration_second: 0.0709375,
		vowel_name: "ih",
		pitch_mean_praat_base: 227.13,
		F1_mean_praat_base: 532.77,
		F2_mean_praat_base: 1746.29,
		F3_mean_praat_base: 2669.02,
		F1_median_praat_base: 537,
		F2_median_praat_base: 1811.56,
		F3_median_praat_base: 2637.77
	},
	{
		index: 119,
		person_id: "FMEM0",
		sex: "F",
		duration_second: 0.0515,
		vowel_name: "ih",
		pitch_mean_praat_base: 146.64,
		F1_mean_praat_base: 507.87,
		F2_mean_praat_base: 1875.45,
		F3_mean_praat_base: 2151.14,
		F1_median_praat_base: 511.9,
		F2_median_praat_base: 1882.81,
		F3_median_praat_base: 2162.51
	},
	{
		index: 120,
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
		index: 121,
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
		index: 122,
		person_id: "MBPM0",
		sex: "M",
		duration_second: 0.0661875,
		vowel_name: "ao",
		pitch_mean_praat_base: 103.42,
		F1_mean_praat_base: 612.02,
		F2_mean_praat_base: 1050.11,
		F3_mean_praat_base: 2467.02,
		F1_median_praat_base: 597.12,
		F2_median_praat_base: 1048.61,
		F3_median_praat_base: 2433.43
	},
	{
		index: 123,
		person_id: "MJDH0",
		sex: "M",
		duration_second: 0.096625,
		vowel_name: "ao",
		pitch_mean_praat_base: 114.65,
		F1_mean_praat_base: 694.55,
		F2_mean_praat_base: 831.98,
		F3_mean_praat_base: 2055.8,
		F1_median_praat_base: 709.66,
		F2_median_praat_base: 812.82,
		F3_median_praat_base: 2141.82
	},
	{
		index: 124,
		person_id: "MDKS0",
		sex: "M",
		duration_second: 0.1134375,
		vowel_name: "ao",
		pitch_mean_praat_base: 129.68,
		F1_mean_praat_base: 564.64,
		F2_mean_praat_base: 1732.76,
		F3_mean_praat_base: 2704.24,
		F1_median_praat_base: 569.2,
		F2_median_praat_base: 1877.35,
		F3_median_praat_base: 2851.31
	},
	{
		index: 125,
		person_id: "MJPG0",
		sex: "M",
		duration_second: 0.0918125,
		vowel_name: "ao",
		pitch_mean_praat_base: 124.14,
		F1_mean_praat_base: 667.65,
		F2_mean_praat_base: 1054.34,
		F3_mean_praat_base: 2499.8,
		F1_median_praat_base: 669.15,
		F2_median_praat_base: 1039.22,
		F3_median_praat_base: 2481.61
	},
	{
		index: 126,
		person_id: "MTJS0",
		sex: "M",
		duration_second: 0.1185,
		vowel_name: "ao",
		pitch_mean_praat_base: 137.39,
		F1_mean_praat_base: 633.09,
		F2_mean_praat_base: 938.18,
		F3_mean_praat_base: 3020.57,
		F1_median_praat_base: 652.78,
		F2_median_praat_base: 961.86,
		F3_median_praat_base: 2988.8
	},
	{
		index: 127,
		person_id: "MMDB0",
		sex: "M",
		duration_second: 0.1251875,
		vowel_name: "ao",
		pitch_mean_praat_base: 115.67,
		F1_mean_praat_base: 662.96,
		F2_mean_praat_base: 1047.68,
		F3_mean_praat_base: 2351.21,
		F1_median_praat_base: 663.16,
		F2_median_praat_base: 943.7,
		F3_median_praat_base: 2448.07
	},
	{
		index: 128,
		person_id: "MPAR0",
		sex: "M",
		duration_second: 0.1125625,
		vowel_name: "ao",
		pitch_mean_praat_base: 104.01,
		F1_mean_praat_base: 538.25,
		F2_mean_praat_base: 1011.28,
		F3_mean_praat_base: 2900.05,
		F1_median_praat_base: 516.83,
		F2_median_praat_base: 990.78,
		F3_median_praat_base: 2937.57
	},
	{
		index: 129,
		person_id: "MPPC0",
		sex: "M",
		duration_second: 0.1096875,
		vowel_name: "ao",
		pitch_mean_praat_base: 142.74,
		F1_mean_praat_base: 688.33,
		F2_mean_praat_base: 1095.86,
		F3_mean_praat_base: 2620.73,
		F1_median_praat_base: 695.4,
		F2_median_praat_base: 1104.67,
		F3_median_praat_base: 2658.94
	},
	{
		index: 130,
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
		index: 131,
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
		index: 132,
		person_id: "FAWF0",
		sex: "F",
		duration_second: 0.1128125,
		vowel_name: "ao",
		pitch_mean_praat_base: 206.1,
		F1_mean_praat_base: 782.25,
		F2_mean_praat_base: 1165.22,
		F3_mean_praat_base: 2730.33,
		F1_median_praat_base: 791.62,
		F2_median_praat_base: 1159.07,
		F3_median_praat_base: 2733.05
	},
	{
		index: 133,
		person_id: "FPAS0",
		sex: "F",
		duration_second: 0.089125,
		vowel_name: "ao",
		pitch_mean_praat_base: 212,
		F1_mean_praat_base: 658.37,
		F2_mean_praat_base: 1120.59,
		F3_mean_praat_base: 2723.29,
		F1_median_praat_base: 684.58,
		F2_median_praat_base: 1123.33,
		F3_median_praat_base: 2728.14
	},
	{
		index: 134,
		person_id: "FJSK0",
		sex: "F",
		duration_second: 0.109625,
		vowel_name: "ao",
		pitch_mean_praat_base: 200.83,
		F1_mean_praat_base: 645.43,
		F2_mean_praat_base: 1236.9,
		F3_mean_praat_base: 1967.74,
		F1_median_praat_base: 648.15,
		F2_median_praat_base: 1195.56,
		F3_median_praat_base: 1892.37
	},
	{
		index: 135,
		person_id: "FRJB0",
		sex: "F",
		duration_second: 0.1079375,
		vowel_name: "ao",
		pitch_mean_praat_base: 209.23,
		F1_mean_praat_base: 562,
		F2_mean_praat_base: 907.83,
		F3_mean_praat_base: 2767.87,
		F1_median_praat_base: 560.58,
		F2_median_praat_base: 903.3,
		F3_median_praat_base: 2812.79
	},
	{
		index: 136,
		person_id: "FHEW0",
		sex: "F",
		duration_second: 0.119875,
		vowel_name: "ao",
		pitch_mean_praat_base: 248.39,
		F1_mean_praat_base: 717.04,
		F2_mean_praat_base: 1204.41,
		F3_mean_praat_base: 2748.65,
		F1_median_praat_base: 750.81,
		F2_median_praat_base: 1144.49,
		F3_median_praat_base: 2746.36
	},
	{
		index: 137,
		person_id: "FMAH0",
		sex: "F",
		duration_second: 0.120125,
		vowel_name: "ao",
		pitch_mean_praat_base: 241.71,
		F1_mean_praat_base: 809.29,
		F2_mean_praat_base: 1149.19,
		F3_mean_praat_base: 3196.92,
		F1_median_praat_base: 811.24,
		F2_median_praat_base: 1115.32,
		F3_median_praat_base: 3253.65
	},
	{
		index: 138,
		person_id: "FMAH1",
		sex: "F",
		duration_second: 0.074125,
		vowel_name: "ao",
		pitch_mean_praat_base: 235.33,
		F1_mean_praat_base: 591.5,
		F2_mean_praat_base: 1077.01,
		F3_mean_praat_base: 2205.47,
		F1_median_praat_base: 610.18,
		F2_median_praat_base: 1068.21,
		F3_median_praat_base: 2205.67
	},
	{
		index: 139,
		person_id: "FLAS0",
		sex: "F",
		duration_second: 0.12775,
		vowel_name: "ao",
		pitch_mean_praat_base: 189.92,
		F1_mean_praat_base: 641.75,
		F2_mean_praat_base: 1327.36,
		F3_mean_praat_base: 2254.17,
		F1_median_praat_base: 663.68,
		F2_median_praat_base: 1252.17,
		F3_median_praat_base: 2253.65
	},
	{
		index: 140,
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
		index: 141,
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
		index: 142,
		person_id: "MCTH0",
		sex: "M",
		duration_second: 0.0594375,
		vowel_name: "axr",
		pitch_mean_praat_base: 117.99,
		F1_mean_praat_base: 444.11,
		F2_mean_praat_base: 1395.65,
		F3_mean_praat_base: 2112.49,
		F1_median_praat_base: 442.51,
		F2_median_praat_base: 1394.06,
		F3_median_praat_base: 1945.56
	},
	{
		index: 143,
		person_id: "MESD0",
		sex: "M",
		duration_second: 0.0758125,
		vowel_name: "axr",
		pitch_mean_praat_base: 111.76,
		F1_mean_praat_base: 583.21,
		F2_mean_praat_base: 1525.55,
		F3_mean_praat_base: 2083.78,
		F1_median_praat_base: 489.57,
		F2_median_praat_base: 1531.84,
		F3_median_praat_base: 1865.89
	},
	{
		index: 144,
		person_id: "MREM0",
		sex: "M",
		duration_second: 0.087,
		vowel_name: "axr",
		pitch_mean_praat_base: 114.42,
		F1_mean_praat_base: 481.61,
		F2_mean_praat_base: 1301.52,
		F3_mean_praat_base: 2354.4,
		F1_median_praat_base: 461.76,
		F2_median_praat_base: 1275.65,
		F3_median_praat_base: 2341.66
	},
	{
		index: 145,
		person_id: "MRMS1",
		sex: "M",
		duration_second: 0.1003125,
		vowel_name: "axr",
		pitch_mean_praat_base: 146.35,
		F1_mean_praat_base: 558.62,
		F2_mean_praat_base: 1494.26,
		F3_mean_praat_base: 1687.4,
		F1_median_praat_base: 528.28,
		F2_median_praat_base: 1497.11,
		F3_median_praat_base: 1605.2
	},
	{
		index: 146,
		person_id: "MCCS0",
		sex: "M",
		duration_second: 0.0991875,
		vowel_name: "axr",
		pitch_mean_praat_base: 103.5,
		F1_mean_praat_base: 564.72,
		F2_mean_praat_base: 1579,
		F3_mean_praat_base: 2025.05,
		F1_median_praat_base: 515.72,
		F2_median_praat_base: 1584.29,
		F3_median_praat_base: 1870.16
	},
	{
		index: 147,
		person_id: "MSES0",
		sex: "M",
		duration_second: 0.0443125,
		vowel_name: "axr",
		pitch_mean_praat_base: 149.56,
		F1_mean_praat_base: 566.79,
		F2_mean_praat_base: 1369.49,
		F3_mean_praat_base: 1967.41,
		F1_median_praat_base: 520.85,
		F2_median_praat_base: 1484.69,
		F3_median_praat_base: 1595.94
	},
	{
		index: 148,
		person_id: "MTMR0",
		sex: "M",
		duration_second: 0.0561875,
		vowel_name: "axr",
		pitch_mean_praat_base: 107.06,
		F1_mean_praat_base: 799.29,
		F2_mean_praat_base: 1502.83,
		F3_mean_praat_base: 3244.79,
		F1_median_praat_base: 831.21,
		F2_median_praat_base: 1511.55,
		F3_median_praat_base: 3239.29
	},
	{
		index: 149,
		person_id: "MGAR0",
		sex: "M",
		duration_second: 0.060125,
		vowel_name: "axr",
		pitch_mean_praat_base: 134.45,
		F1_mean_praat_base: 481.1,
		F2_mean_praat_base: 1771.43,
		F3_mean_praat_base: 2231.43,
		F1_median_praat_base: 485.42,
		F2_median_praat_base: 1758.93,
		F3_median_praat_base: 2205.06
	},
	{
		index: 150,
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
		index: 151,
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
		index: 152,
		person_id: "FBMH0",
		sex: "F",
		duration_second: 0.11,
		vowel_name: "axr",
		pitch_mean_praat_base: 179.67,
		F1_mean_praat_base: 529.04,
		F2_mean_praat_base: 1620.92,
		F3_mean_praat_base: 2220.55,
		F1_median_praat_base: 533.53,
		F2_median_praat_base: 1688.88,
		F3_median_praat_base: 2141.24
	},
	{
		index: 153,
		person_id: "FJKL0",
		sex: "F",
		duration_second: 0.0861875,
		vowel_name: "axr",
		pitch_mean_praat_base: 226.57,
		F1_mean_praat_base: 694.74,
		F2_mean_praat_base: 1771.67,
		F3_mean_praat_base: 2192.42,
		F1_median_praat_base: 674.17,
		F2_median_praat_base: 1776.16,
		F3_median_praat_base: 2019.1
	},
	{
		index: 154,
		person_id: "FPAZ0",
		sex: "F",
		duration_second: 0.061625,
		vowel_name: "axr",
		pitch_mean_praat_base: 220.39,
		F1_mean_praat_base: 486.65,
		F2_mean_praat_base: 1715.02,
		F3_mean_praat_base: 2228.38,
		F1_median_praat_base: 486.99,
		F2_median_praat_base: 1699.5,
		F3_median_praat_base: 2147.4
	},
	{
		index: 155,
		person_id: "FJCS0",
		sex: "F",
		duration_second: 0.16125,
		vowel_name: "axr",
		pitch_mean_praat_base: 185.44,
		F1_mean_praat_base: 514.97,
		F2_mean_praat_base: 1584.22,
		F3_mean_praat_base: 2084.57,
		F1_median_praat_base: 457.8,
		F2_median_praat_base: 1564.09,
		F3_median_praat_base: 1743.04
	},
	{
		index: 156,
		person_id: "FELC0",
		sex: "F",
		duration_second: 0.1019375,
		vowel_name: "axr",
		pitch_mean_praat_base: 210.49,
		F1_mean_praat_base: 656.05,
		F2_mean_praat_base: 1298.15,
		F3_mean_praat_base: 2102.86,
		F1_median_praat_base: 667.48,
		F2_median_praat_base: 1188.02,
		F3_median_praat_base: 2054.76
	},
	{
		index: 157,
		person_id: "FJSA0",
		sex: "F",
		duration_second: 0.1090625,
		vowel_name: "axr",
		pitch_mean_praat_base: 215.49,
		F1_mean_praat_base: 620.2,
		F2_mean_praat_base: 1538.25,
		F3_mean_praat_base: 2001.31,
		F1_median_praat_base: 643.49,
		F2_median_praat_base: 1567.97,
		F3_median_praat_base: 1893.87
	},
	{
		index: 158,
		person_id: "FLKM0",
		sex: "F",
		duration_second: 0.159875,
		vowel_name: "axr",
		pitch_mean_praat_base: 215.17,
		F1_mean_praat_base: 743.22,
		F2_mean_praat_base: 1657.77,
		F3_mean_praat_base: 2260.76,
		F1_median_praat_base: 746.91,
		F2_median_praat_base: 1650.22,
		F3_median_praat_base: 1996.95
	},
	{
		index: 159,
		person_id: "FJWB1",
		sex: "F",
		duration_second: 0.036875,
		vowel_name: "axr",
		pitch_mean_praat_base: 225.38,
		F1_mean_praat_base: 1032.32,
		F2_mean_praat_base: 1540.49,
		F3_mean_praat_base: 2487.56,
		F1_median_praat_base: 1107.03,
		F2_median_praat_base: 1539.15,
		F3_median_praat_base: 2448.62
	},
	{
		index: 160,
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
		index: 161,
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
		index: 162,
		person_id: "MPAB0",
		sex: "M",
		duration_second: 0.120125,
		vowel_name: "ow",
		pitch_mean_praat_base: 154.48,
		F1_mean_praat_base: 499.68,
		F2_mean_praat_base: 1271.73,
		F3_mean_praat_base: 2552.41,
		F1_median_praat_base: 438.49,
		F2_median_praat_base: 1234.7,
		F3_median_praat_base: 2510.62
	},
	{
		index: 163,
		person_id: "MDCM0",
		sex: "M",
		duration_second: 0.0633125,
		vowel_name: "ow",
		pitch_mean_praat_base: 104.11,
		F1_mean_praat_base: 825.67,
		F2_mean_praat_base: 2587.01,
		F3_mean_praat_base: 3495.75,
		F1_median_praat_base: 815.61,
		F2_median_praat_base: 2586.7,
		F3_median_praat_base: 3427.64
	},
	{
		index: 164,
		person_id: "MTAB0",
		sex: "M",
		duration_second: 0.1211875,
		vowel_name: "ow",
		pitch_mean_praat_base: 114.76,
		F1_mean_praat_base: 658.07,
		F2_mean_praat_base: 999.51,
		F3_mean_praat_base: 2462.72,
		F1_median_praat_base: 671.57,
		F2_median_praat_base: 919.62,
		F3_median_praat_base: 2418.53
	},
	{
		index: 165,
		person_id: "MRWA0",
		sex: "M",
		duration_second: 0.1273125,
		vowel_name: "ow",
		pitch_mean_praat_base: 166.08,
		F1_mean_praat_base: 494.63,
		F2_mean_praat_base: 1268.03,
		F3_mean_praat_base: 2279.49,
		F1_median_praat_base: 488.14,
		F2_median_praat_base: 1195.05,
		F3_median_praat_base: 2285.52
	},
	{
		index: 166,
		person_id: "MCDR0",
		sex: "M",
		duration_second: 0.1461875,
		vowel_name: "ow",
		pitch_mean_praat_base: 112.05,
		F1_mean_praat_base: 595.93,
		F2_mean_praat_base: 988.49,
		F3_mean_praat_base: 2652.03,
		F1_median_praat_base: 590.95,
		F2_median_praat_base: 976.03,
		F3_median_praat_base: 2630.23
	},
	{
		index: 167,
		person_id: "MRPC0",
		sex: "M",
		duration_second: 0.1828125,
		vowel_name: "ow",
		pitch_mean_praat_base: 97.11,
		F1_mean_praat_base: 768.11,
		F2_mean_praat_base: 969.63,
		F3_mean_praat_base: 2552.58,
		F1_median_praat_base: 771.04,
		F2_median_praat_base: 959.45,
		F3_median_praat_base: 2550.04
	},
	{
		index: 168,
		person_id: "MDRM0",
		sex: "M",
		duration_second: 0.1785,
		vowel_name: "ow",
		pitch_mean_praat_base: 124.4,
		F1_mean_praat_base: 540.22,
		F2_mean_praat_base: 1327.9,
		F3_mean_praat_base: 2782.66,
		F1_median_praat_base: 516.95,
		F2_median_praat_base: 1228.33,
		F3_median_praat_base: 2766.04
	},
	{
		index: 169,
		person_id: "MSMC0",
		sex: "M",
		duration_second: 0.2005,
		vowel_name: "ow",
		pitch_mean_praat_base: 129.66,
		F1_mean_praat_base: 685.38,
		F2_mean_praat_base: 1672.63,
		F3_mean_praat_base: 2902.31,
		F1_median_praat_base: 612.02,
		F2_median_praat_base: 1176.17,
		F3_median_praat_base: 2713.37
	},
	{
		index: 170,
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
		index: 171,
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
		index: 172,
		person_id: "FCFT0",
		sex: "F",
		duration_second: 0.09,
		vowel_name: "ow",
		pitch_mean_praat_base: 205.28,
		F1_mean_praat_base: 670.52,
		F2_mean_praat_base: 1644.19,
		F3_mean_praat_base: 2849.35,
		F1_median_praat_base: 680.6,
		F2_median_praat_base: 1608.51,
		F3_median_praat_base: 2832.34
	},
	{
		index: 173,
		person_id: "FLKD0",
		sex: "F",
		duration_second: 0.1555,
		vowel_name: "ow",
		pitch_mean_praat_base: 216.21,
		F1_mean_praat_base: 589.18,
		F2_mean_praat_base: 1854.32,
		F3_mean_praat_base: 2887.83,
		F1_median_praat_base: 609.03,
		F2_median_praat_base: 1841.53,
		F3_median_praat_base: 2864.2
	},
	{
		index: 174,
		person_id: "FALK0",
		sex: "F",
		duration_second: 0.07,
		vowel_name: "ow",
		pitch_mean_praat_base: 182.15,
		F1_mean_praat_base: 587.35,
		F2_mean_praat_base: 1060.29,
		F3_mean_praat_base: 3130.52,
		F1_median_praat_base: 599.22,
		F2_median_praat_base: 1082.16,
		F3_median_praat_base: 3123.47
	},
	{
		index: 175,
		person_id: "FMPG0",
		sex: "F",
		duration_second: 0.254125,
		vowel_name: "ow",
		pitch_mean_praat_base: 225.65,
		F1_mean_praat_base: 758.57,
		F2_mean_praat_base: 1297.78,
		F3_mean_praat_base: 2937.43,
		F1_median_praat_base: 797,
		F2_median_praat_base: 1314.54,
		F3_median_praat_base: 3071.51
	},
	{
		index: 176,
		person_id: "FHXS0",
		sex: "F",
		duration_second: 0.099375,
		vowel_name: "ow",
		pitch_mean_praat_base: 182.89,
		F1_mean_praat_base: 644.83,
		F2_mean_praat_base: 1366.27,
		F3_mean_praat_base: 2506.99,
		F1_median_praat_base: 677.23,
		F2_median_praat_base: 1407.22,
		F3_median_praat_base: 2560.23
	},
	{
		index: 177,
		person_id: "FSJK1",
		sex: "F",
		duration_second: 0.10375,
		vowel_name: "ow",
		pitch_mean_praat_base: 190.47,
		F1_mean_praat_base: 671.85,
		F2_mean_praat_base: 1518.31,
		F3_mean_praat_base: 2637.64,
		F1_median_praat_base: 689.62,
		F2_median_praat_base: 1522.73,
		F3_median_praat_base: 2517.96
	},
	{
		index: 178,
		person_id: "FBMJ0",
		sex: "F",
		duration_second: 0.139125,
		vowel_name: "ow",
		pitch_mean_praat_base: 156.67,
		F1_mean_praat_base: 558.16,
		F2_mean_praat_base: 1294.9,
		F3_mean_praat_base: 2745.96,
		F1_median_praat_base: 577.18,
		F2_median_praat_base: 1174.79,
		F3_median_praat_base: 2710.16
	},
	{
		index: 179,
		person_id: "FDFB0",
		sex: "F",
		duration_second: 0.0658125,
		vowel_name: "ow",
		pitch_mean_praat_base: 185.29,
		F1_mean_praat_base: 658.34,
		F2_mean_praat_base: 1302.39,
		F3_mean_praat_base: 2724.11,
		F1_median_praat_base: 662.81,
		F2_median_praat_base: 1293.09,
		F3_median_praat_base: 2751.24
	},
	{
		index: 180,
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
		index: 181,
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
		index: 182,
		person_id: "MRAI0",
		sex: "M",
		duration_second: 0.0291875,
		vowel_name: "ix",
		pitch_mean_praat_base: 107.89,
		F1_mean_praat_base: 491.94,
		F2_mean_praat_base: 1763.41,
		F3_mean_praat_base: 2338.32,
		F1_median_praat_base: 490.99,
		F2_median_praat_base: 1754.62,
		F3_median_praat_base: 2313.7
	},
	{
		index: 183,
		person_id: "MMLM0",
		sex: "M",
		duration_second: 0.0429375,
		vowel_name: "ix",
		pitch_mean_praat_base: 107.86,
		F1_mean_praat_base: 372.5,
		F2_mean_praat_base: 2048.45,
		F3_mean_praat_base: 2526.77,
		F1_median_praat_base: 387.47,
		F2_median_praat_base: 2017.93,
		F3_median_praat_base: 2400.01
	},
	{
		index: 184,
		person_id: "MKAM0",
		sex: "M",
		duration_second: 0.073125,
		vowel_name: "ix",
		pitch_mean_praat_base: 110.61,
		F1_mean_praat_base: 476.41,
		F2_mean_praat_base: 1762.72,
		F3_mean_praat_base: 2548.39,
		F1_median_praat_base: 494.49,
		F2_median_praat_base: 1773.65,
		F3_median_praat_base: 2526.77
	},
	{
		index: 185,
		person_id: "MGJC0",
		sex: "M",
		duration_second: 0.089375,
		vowel_name: "ix",
		pitch_mean_praat_base: 143.83,
		F1_mean_praat_base: 498.8,
		F2_mean_praat_base: 1495.39,
		F3_mean_praat_base: 2739.7,
		F1_median_praat_base: 501.03,
		F2_median_praat_base: 1484.57,
		F3_median_praat_base: 2721.62
	},
	{
		index: 186,
		person_id: "MVRW0",
		sex: "M",
		duration_second: 0.042625,
		vowel_name: "ix",
		pitch_mean_praat_base: 124.05,
		F1_mean_praat_base: 651.34,
		F2_mean_praat_base: 1606.98,
		F3_mean_praat_base: 2428.49,
		F1_median_praat_base: 684.54,
		F2_median_praat_base: 1638.61,
		F3_median_praat_base: 2487.85
	},
	{
		index: 187,
		person_id: "MMAB0",
		sex: "M",
		duration_second: 0.045,
		vowel_name: "ix",
		pitch_mean_praat_base: 112.81,
		F1_mean_praat_base: 438.63,
		F2_mean_praat_base: 1503.23,
		F3_mean_praat_base: 2302.66,
		F1_median_praat_base: 442.9,
		F2_median_praat_base: 1554.38,
		F3_median_praat_base: 2309.64
	},
	{
		index: 188,
		person_id: "MHRM0",
		sex: "M",
		duration_second: 0.0338125,
		vowel_name: "ix",
		pitch_mean_praat_base: 127.38,
		F1_mean_praat_base: 504.35,
		F2_mean_praat_base: 1964.18,
		F3_mean_praat_base: 2382.22,
		F1_median_praat_base: 506.41,
		F2_median_praat_base: 1998.19,
		F3_median_praat_base: 2424.26
	},
	{
		index: 189,
		person_id: "MDSS0",
		sex: "M",
		duration_second: 0.0480625,
		vowel_name: "ix",
		pitch_mean_praat_base: 132.69,
		F1_mean_praat_base: 471.43,
		F2_mean_praat_base: 1963.03,
		F3_mean_praat_base: 2319.77,
		F1_median_praat_base: 457.86,
		F2_median_praat_base: 1977.5,
		F3_median_praat_base: 2328.68
	},
	{
		index: 190,
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
		index: 191,
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
		index: 192,
		person_id: "FNKL0",
		sex: "F",
		duration_second: 0.065875,
		vowel_name: "ix",
		pitch_mean_praat_base: 199,
		F1_mean_praat_base: 498.01,
		F2_mean_praat_base: 2136.53,
		F3_mean_praat_base: 2533.38,
		F1_median_praat_base: 517.92,
		F2_median_praat_base: 2091.36,
		F3_median_praat_base: 2519.3
	},
	{
		index: 193,
		person_id: "FPAS0",
		sex: "F",
		duration_second: 0.055,
		vowel_name: "ix",
		pitch_mean_praat_base: 201.08,
		F1_mean_praat_base: 455.47,
		F2_mean_praat_base: 1908.91,
		F3_mean_praat_base: 2723.72,
		F1_median_praat_base: 451.39,
		F2_median_praat_base: 1748.09,
		F3_median_praat_base: 2669.06
	},
	{
		index: 194,
		person_id: "FPAD0",
		sex: "F",
		duration_second: 0.0260625,
		vowel_name: "ix",
		pitch_mean_praat_base: 248.9,
		F1_mean_praat_base: 622.96,
		F2_mean_praat_base: 1531.35,
		F3_mean_praat_base: 2244.52,
		F1_median_praat_base: 632.71,
		F2_median_praat_base: 1519.41,
		F3_median_praat_base: 2247.19
	},
	{
		index: 195,
		person_id: "FNTB0",
		sex: "F",
		duration_second: 0.0519375,
		vowel_name: "ix",
		pitch_mean_praat_base: 165.05,
		F1_mean_praat_base: 566.57,
		F2_mean_praat_base: 2050.26,
		F3_mean_praat_base: 2618.48,
		F1_median_praat_base: 568.52,
		F2_median_praat_base: 2047.83,
		F3_median_praat_base: 2556.38
	},
	{
		index: 196,
		person_id: "FNMR0",
		sex: "F",
		duration_second: 0.0561875,
		vowel_name: "ix",
		pitch_mean_praat_base: 163,
		F1_mean_praat_base: 686.28,
		F2_mean_praat_base: 1788,
		F3_mean_praat_base: 2226.66,
		F1_median_praat_base: 693.95,
		F2_median_praat_base: 1782.38,
		F3_median_praat_base: 2158.8
	},
	{
		index: 197,
		person_id: "FBMJ0",
		sex: "F",
		duration_second: 0.053375,
		vowel_name: "ix",
		pitch_mean_praat_base: 150.04,
		F1_mean_praat_base: 615.63,
		F2_mean_praat_base: 2036.24,
		F3_mean_praat_base: 2805.05,
		F1_median_praat_base: 617.62,
		F2_median_praat_base: 2021.5,
		F3_median_praat_base: 2807.69
	},
	{
		index: 198,
		person_id: "FMLD0",
		sex: "F",
		duration_second: 0.065,
		vowel_name: "ix",
		pitch_mean_praat_base: 209.1,
		F1_mean_praat_base: 508.32,
		F2_mean_praat_base: 1766.58,
		F3_mean_praat_base: 2438.5,
		F1_median_praat_base: 510.62,
		F2_median_praat_base: 1819.66,
		F3_median_praat_base: 2393.5
	},
	{
		index: 199,
		person_id: "FSAG0",
		sex: "F",
		duration_second: 0.019875,
		vowel_name: "ix",
		pitch_mean_praat_base: 163.94,
		F1_mean_praat_base: 546.53,
		F2_mean_praat_base: 1931.49,
		F3_mean_praat_base: 2429.34,
		F1_median_praat_base: 546.53,
		F2_median_praat_base: 1931.49,
		F3_median_praat_base: 2429.34
	},
	{
		index: 200,
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
		index: 201,
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
		index: 202,
		person_id: "MCCS0",
		sex: "M",
		duration_second: 0.0991875,
		vowel_name: "eh",
		pitch_mean_praat_base: 128.68,
		F1_mean_praat_base: 575.25,
		F2_mean_praat_base: 1856.2,
		F3_mean_praat_base: 2467.96,
		F1_median_praat_base: 593.25,
		F2_median_praat_base: 1827.31,
		F3_median_praat_base: 2467.06
	},
	{
		index: 203,
		person_id: "MSAT0",
		sex: "M",
		duration_second: 0.0718125,
		vowel_name: "eh",
		pitch_mean_praat_base: 94.88,
		F1_mean_praat_base: 563.68,
		F2_mean_praat_base: 1258.28,
		F3_mean_praat_base: 1798.32,
		F1_median_praat_base: 562.78,
		F2_median_praat_base: 1270.04,
		F3_median_praat_base: 1805.18
	},
	{
		index: 204,
		person_id: "MDCD0",
		sex: "M",
		duration_second: 0.0980625,
		vowel_name: "eh",
		pitch_mean_praat_base: 100.68,
		F1_mean_praat_base: 511.22,
		F2_mean_praat_base: 1536.49,
		F3_mean_praat_base: 2419.06,
		F1_median_praat_base: 522.99,
		F2_median_praat_base: 1506.96,
		F3_median_praat_base: 2475.64
	},
	{
		index: 205,
		person_id: "MJVW0",
		sex: "M",
		duration_second: 0.095,
		vowel_name: "eh",
		pitch_mean_praat_base: 133.97,
		F1_mean_praat_base: 576.44,
		F2_mean_praat_base: 1586.24,
		F3_mean_praat_base: 2393.3,
		F1_median_praat_base: 583.4,
		F2_median_praat_base: 1597.55,
		F3_median_praat_base: 2417.75
	},
	{
		index: 206,
		person_id: "MJEE0",
		sex: "M",
		duration_second: 0.0875,
		vowel_name: "eh",
		pitch_mean_praat_base: 102.86,
		F1_mean_praat_base: 524.61,
		F2_mean_praat_base: 1715.39,
		F3_mean_praat_base: 2614.26,
		F1_median_praat_base: 540.08,
		F2_median_praat_base: 1721.39,
		F3_median_praat_base: 2537.6
	},
	{
		index: 207,
		person_id: "MJRG0",
		sex: "M",
		duration_second: 0.125,
		vowel_name: "eh",
		pitch_mean_praat_base: 97.33,
		F1_mean_praat_base: 545.39,
		F2_mean_praat_base: 1731.48,
		F3_mean_praat_base: 2719.04,
		F1_median_praat_base: 514.68,
		F2_median_praat_base: 1752.92,
		F3_median_praat_base: 2729.85
	},
	{
		index: 208,
		person_id: "MDLM0",
		sex: "M",
		duration_second: 0.06525,
		vowel_name: "eh",
		pitch_mean_praat_base: 118.24,
		F1_mean_praat_base: 568.89,
		F2_mean_praat_base: 1798.26,
		F3_mean_praat_base: 2659.72,
		F1_median_praat_base: 568.74,
		F2_median_praat_base: 1796.36,
		F3_median_praat_base: 2656.8
	},
	{
		index: 209,
		person_id: "MMDM1",
		sex: "M",
		duration_second: 0.08325,
		vowel_name: "eh",
		pitch_mean_praat_base: 127.24,
		F1_mean_praat_base: 678.04,
		F2_mean_praat_base: 1562.29,
		F3_mean_praat_base: 2577.22,
		F1_median_praat_base: 647.06,
		F2_median_praat_base: 1626.84,
		F3_median_praat_base: 2560.02
	},
	{
		index: 210,
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
		index: 211,
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
		index: 212,
		person_id: "FJLG0",
		sex: "F",
		duration_second: 0.08,
		vowel_name: "eh",
		pitch_mean_praat_base: 225.3,
		F1_mean_praat_base: 707.54,
		F2_mean_praat_base: 1868.56,
		F3_mean_praat_base: 3218.47,
		F1_median_praat_base: 711.75,
		F2_median_praat_base: 1822.54,
		F3_median_praat_base: 3218.72
	},
	{
		index: 213,
		person_id: "FLOD0",
		sex: "F",
		duration_second: 0.0748125,
		vowel_name: "eh",
		pitch_mean_praat_base: 177.98,
		F1_mean_praat_base: 606.97,
		F2_mean_praat_base: 1638.9,
		F3_mean_praat_base: 2671.06,
		F1_median_praat_base: 615.46,
		F2_median_praat_base: 1646.42,
		F3_median_praat_base: 2694.94
	},
	{
		index: 214,
		person_id: "FJRE0",
		sex: "F",
		duration_second: 0.08875,
		vowel_name: "eh",
		pitch_mean_praat_base: 195.17,
		F1_mean_praat_base: 712.04,
		F2_mean_praat_base: 1841.38,
		F3_mean_praat_base: 3007.71,
		F1_median_praat_base: 719.14,
		F2_median_praat_base: 1845.37,
		F3_median_praat_base: 3018.56
	},
	{
		index: 215,
		person_id: "FDRD1",
		sex: "F",
		duration_second: 0.11875,
		vowel_name: "eh",
		pitch_mean_praat_base: 207.31,
		F1_mean_praat_base: 705.72,
		F2_mean_praat_base: 1732.16,
		F3_mean_praat_base: 2971.02,
		F1_median_praat_base: 739.71,
		F2_median_praat_base: 1708.56,
		F3_median_praat_base: 2982.82
	},
	{
		index: 216,
		person_id: "FDJH0",
		sex: "F",
		duration_second: 0.096625,
		vowel_name: "eh",
		pitch_mean_praat_base: 228.49,
		F1_mean_praat_base: 817.94,
		F2_mean_praat_base: 1507.86,
		F3_mean_praat_base: 2910.95,
		F1_median_praat_base: 821.43,
		F2_median_praat_base: 1532.26,
		F3_median_praat_base: 2973.38
	},
	{
		index: 217,
		person_id: "FGWR0",
		sex: "F",
		duration_second: 0.04925,
		vowel_name: "eh",
		pitch_mean_praat_base: 185.09,
		F1_mean_praat_base: 580.07,
		F2_mean_praat_base: 1876.55,
		F3_mean_praat_base: 2200.79,
		F1_median_praat_base: 581.99,
		F2_median_praat_base: 1837.13,
		F3_median_praat_base: 2221.45
	},
	{
		index: 218,
		person_id: "FCRH0",
		sex: "F",
		duration_second: 0.1566875,
		vowel_name: "eh",
		pitch_mean_praat_base: 223.66,
		F1_mean_praat_base: 630.04,
		F2_mean_praat_base: 2340.16,
		F3_mean_praat_base: 3150.34,
		F1_median_praat_base: 624.77,
		F2_median_praat_base: 2440.12,
		F3_median_praat_base: 3145.04
	},
	{
		index: 219,
		person_id: "FJRP1",
		sex: "F",
		duration_second: 0.0893125,
		vowel_name: "eh",
		pitch_mean_praat_base: 174.3,
		F1_mean_praat_base: 494.36,
		F2_mean_praat_base: 2162.63,
		F3_mean_praat_base: 2487,
		F1_median_praat_base: 504.15,
		F2_median_praat_base: 2165.98,
		F3_median_praat_base: 2402.59
	},
	{
		index: 220,
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
		index: 221,
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
		index: 222,
		person_id: "MSDB0",
		sex: "M",
		duration_second: 0.1485625,
		vowel_name: "oy",
		pitch_mean_praat_base: 105.03,
		F1_mean_praat_base: 682.05,
		F2_mean_praat_base: 1193.53,
		F3_mean_praat_base: 2660.94,
		F1_median_praat_base: 670.9,
		F2_median_praat_base: 1207.07,
		F3_median_praat_base: 2684.78
	},
	{
		index: 223,
		person_id: "MLEL0",
		sex: "M",
		duration_second: 0.155,
		vowel_name: "oy",
		pitch_mean_praat_base: 127.97,
		F1_mean_praat_base: 573.94,
		F2_mean_praat_base: 1152.76,
		F3_mean_praat_base: 2588.54,
		F1_median_praat_base: 583.78,
		F2_median_praat_base: 939.32,
		F3_median_praat_base: 2600.32
	},
	{
		index: 224,
		person_id: "MTML0",
		sex: "M",
		duration_second: 0.1239375,
		vowel_name: "oy",
		pitch_mean_praat_base: 131.83,
		F1_mean_praat_base: 649.89,
		F2_mean_praat_base: 1209.54,
		F3_mean_praat_base: 2300.23,
		F1_median_praat_base: 647.33,
		F2_median_praat_base: 1235.43,
		F3_median_praat_base: 2249.95
	},
	{
		index: 225,
		person_id: "MBEF0",
		sex: "M",
		duration_second: 0.1723125,
		vowel_name: "oy",
		pitch_mean_praat_base: 122.5,
		F1_mean_praat_base: 603.45,
		F2_mean_praat_base: 1234.36,
		F3_mean_praat_base: 2343.22,
		F1_median_praat_base: 610.67,
		F2_median_praat_base: 1171.13,
		F3_median_praat_base: 2328.58
	},
	{
		index: 226,
		person_id: "MEGJ0",
		sex: "M",
		duration_second: 0.161875,
		vowel_name: "oy",
		pitch_mean_praat_base: 106.92,
		F1_mean_praat_base: 600.4,
		F2_mean_praat_base: 970.2,
		F3_mean_praat_base: 2129.91,
		F1_median_praat_base: 610.8,
		F2_median_praat_base: 839.63,
		F3_median_praat_base: 2102.8
	},
	{
		index: 227,
		person_id: "MDPB0",
		sex: "M",
		duration_second: 0.181625,
		vowel_name: "oy",
		pitch_mean_praat_base: 115.56,
		F1_mean_praat_base: 710.33,
		F2_mean_praat_base: 1179.44,
		F3_mean_praat_base: 2949.38,
		F1_median_praat_base: 714.01,
		F2_median_praat_base: 1071.56,
		F3_median_praat_base: 3050.37
	},
	{
		index: 228,
		person_id: "MMGG0",
		sex: "M",
		duration_second: 0.143625,
		vowel_name: "oy",
		pitch_mean_praat_base: 121.22,
		F1_mean_praat_base: 508.84,
		F2_mean_praat_base: 1175.02,
		F3_mean_praat_base: 2505.27,
		F1_median_praat_base: 530.99,
		F2_median_praat_base: 1174.12,
		F3_median_praat_base: 2521.19
	},
	{
		index: 229,
		person_id: "MJDM1",
		sex: "M",
		duration_second: 0.2835625,
		vowel_name: "oy",
		pitch_mean_praat_base: 136.86,
		F1_mean_praat_base: 714.86,
		F2_mean_praat_base: 1584.83,
		F3_mean_praat_base: 2924.74,
		F1_median_praat_base: 703.1,
		F2_median_praat_base: 1627.02,
		F3_median_praat_base: 2901.28
	},
	{
		index: 230,
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
		index: 231,
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
		index: 232,
		person_id: "FTLG0",
		sex: "F",
		duration_second: 0.15925,
		vowel_name: "oy",
		pitch_mean_praat_base: 192.08,
		F1_mean_praat_base: 631.12,
		F2_mean_praat_base: 1182.81,
		F3_mean_praat_base: 2291.76,
		F1_median_praat_base: 634.11,
		F2_median_praat_base: 1154.12,
		F3_median_praat_base: 2306.96
	},
	{
		index: 233,
		person_id: "FJHK0",
		sex: "F",
		duration_second: 0.159125,
		vowel_name: "oy",
		pitch_mean_praat_base: 214.9,
		F1_mean_praat_base: 583.06,
		F2_mean_praat_base: 1575.78,
		F3_mean_praat_base: 2509.47,
		F1_median_praat_base: 610.34,
		F2_median_praat_base: 1458.42,
		F3_median_praat_base: 2410.49
	},
	{
		index: 234,
		person_id: "FNKL0",
		sex: "F",
		duration_second: 0.1931875,
		vowel_name: "oy",
		pitch_mean_praat_base: 199,
		F1_mean_praat_base: 605.82,
		F2_mean_praat_base: 1783.09,
		F3_mean_praat_base: 2404.61,
		F1_median_praat_base: 607.55,
		F2_median_praat_base: 1871.5,
		F3_median_praat_base: 2421.87
	},
	{
		index: 235,
		person_id: "FMEM0",
		sex: "F",
		duration_second: 0.1175,
		vowel_name: "oy",
		pitch_mean_praat_base: 133.15,
		F1_mean_praat_base: 552.64,
		F2_mean_praat_base: 1301.41,
		F3_mean_praat_base: 2297.6,
		F1_median_praat_base: 555.71,
		F2_median_praat_base: 1264.1,
		F3_median_praat_base: 2305.54
	},
	{
		index: 236,
		person_id: "FJXP0",
		sex: "F",
		duration_second: 0.143125,
		vowel_name: "oy",
		pitch_mean_praat_base: 194.71,
		F1_mean_praat_base: 644.27,
		F2_mean_praat_base: 1228.18,
		F3_mean_praat_base: 3005.85,
		F1_median_praat_base: 646.83,
		F2_median_praat_base: 1219.77,
		F3_median_praat_base: 2983.43
	},
	{
		index: 237,
		person_id: "FLTM0",
		sex: "F",
		duration_second: 0.175,
		vowel_name: "oy",
		pitch_mean_praat_base: 192.4,
		F1_mean_praat_base: 599.46,
		F2_mean_praat_base: 1371.22,
		F3_mean_praat_base: 2717.63,
		F1_median_praat_base: 619.2,
		F2_median_praat_base: 1128.69,
		F3_median_praat_base: 2730.35
	},
	{
		index: 238,
		person_id: "FCMR0",
		sex: "F",
		duration_second: 0.2603125,
		vowel_name: "oy",
		pitch_mean_praat_base: 162.63,
		F1_mean_praat_base: 576.78,
		F2_mean_praat_base: 1501.2,
		F3_mean_praat_base: 2573.23,
		F1_median_praat_base: 574,
		F2_median_praat_base: 1331.84,
		F3_median_praat_base: 2595.31
	},
	{
		index: 239,
		person_id: "FLAG0",
		sex: "F",
		duration_second: 0.1595,
		vowel_name: "oy",
		pitch_mean_praat_base: 203.9,
		F1_mean_praat_base: 633.99,
		F2_mean_praat_base: 1174.44,
		F3_mean_praat_base: 2660.99,
		F1_median_praat_base: 633,
		F2_median_praat_base: 1193.25,
		F3_median_praat_base: 2694.68
	},
	{
		index: 240,
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
		index: 241,
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
		index: 242,
		person_id: "MKDB0",
		sex: "M",
		duration_second: 0.1116875,
		vowel_name: "ay",
		pitch_mean_praat_base: 135.59,
		F1_mean_praat_base: 628.67,
		F2_mean_praat_base: 1490.56,
		F3_mean_praat_base: 2552.14,
		F1_median_praat_base: 666.55,
		F2_median_praat_base: 1482.18,
		F3_median_praat_base: 2555.73
	},
	{
		index: 243,
		person_id: "MRLD0",
		sex: "M",
		duration_second: 0.265,
		vowel_name: "ay",
		pitch_mean_praat_base: 113.18,
		F1_mean_praat_base: 643.88,
		F2_mean_praat_base: 1527.48,
		F3_mean_praat_base: 2843.28,
		F1_median_praat_base: 658.54,
		F2_median_praat_base: 1401.97,
		F3_median_praat_base: 2826.49
	},
	{
		index: 244,
		person_id: "MRRK0",
		sex: "M",
		duration_second: 0.1155,
		vowel_name: "ay",
		pitch_mean_praat_base: 110.38,
		F1_mean_praat_base: 630.1,
		F2_mean_praat_base: 1458.49,
		F3_mean_praat_base: 2382.32,
		F1_median_praat_base: 661.26,
		F2_median_praat_base: 1372.72,
		F3_median_praat_base: 2376.83
	},
	{
		index: 245,
		person_id: "MPWM0",
		sex: "M",
		duration_second: 0.101,
		vowel_name: "ay",
		pitch_mean_praat_base: 124.43,
		F1_mean_praat_base: 722.26,
		F2_mean_praat_base: 1306.55,
		F3_mean_praat_base: 2123.71,
		F1_median_praat_base: 738.09,
		F2_median_praat_base: 1336.3,
		F3_median_praat_base: 2126.32
	},
	{
		index: 246,
		person_id: "MTAT1",
		sex: "M",
		duration_second: 0.250125,
		vowel_name: "ay",
		pitch_mean_praat_base: 151.22,
		F1_mean_praat_base: 686.39,
		F2_mean_praat_base: 1512.84,
		F3_mean_praat_base: 2282.01,
		F1_median_praat_base: 692.99,
		F2_median_praat_base: 1515.85,
		F3_median_praat_base: 2244.03
	},
	{
		index: 247,
		person_id: "MDRD0",
		sex: "M",
		duration_second: 0.24125,
		vowel_name: "ay",
		pitch_mean_praat_base: 115.19,
		F1_mean_praat_base: 687.19,
		F2_mean_praat_base: 1383.35,
		F3_mean_praat_base: 2625.77,
		F1_median_praat_base: 712.84,
		F2_median_praat_base: 1331.87,
		F3_median_praat_base: 2592.42
	},
	{
		index: 248,
		person_id: "MJAI0",
		sex: "M",
		duration_second: 0.1198125,
		vowel_name: "ay",
		pitch_mean_praat_base: 123.42,
		F1_mean_praat_base: 737.15,
		F2_mean_praat_base: 1410.35,
		F3_mean_praat_base: 2845.66,
		F1_median_praat_base: 754.81,
		F2_median_praat_base: 1323.59,
		F3_median_praat_base: 2850.06
	},
	{
		index: 249,
		person_id: "MDBB0",
		sex: "M",
		duration_second: 0.0823125,
		vowel_name: "ay",
		pitch_mean_praat_base: 174.92,
		F1_mean_praat_base: 561.19,
		F2_mean_praat_base: 1611.49,
		F3_mean_praat_base: 2545.51,
		F1_median_praat_base: 558.28,
		F2_median_praat_base: 1644.72,
		F3_median_praat_base: 2449.53
	},
	{
		index: 250,
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
		index: 251,
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
		index: 252,
		person_id: "FEEH0",
		sex: "F",
		duration_second: 0.1238125,
		vowel_name: "ay",
		pitch_mean_praat_base: 244.53,
		F1_mean_praat_base: 692.36,
		F2_mean_praat_base: 1539,
		F3_mean_praat_base: 2236.98,
		F1_median_praat_base: 692.83,
		F2_median_praat_base: 1613.49,
		F3_median_praat_base: 2249.67
	},
	{
		index: 253,
		person_id: "FDKN0",
		sex: "F",
		duration_second: 0.0916875,
		vowel_name: "ay",
		pitch_mean_praat_base: 195.37,
		F1_mean_praat_base: 695.82,
		F2_mean_praat_base: 1479.66,
		F3_mean_praat_base: 2563.14,
		F1_median_praat_base: 737.6,
		F2_median_praat_base: 1461.9,
		F3_median_praat_base: 2592.44
	},
	{
		index: 254,
		person_id: "FSBK0",
		sex: "F",
		duration_second: 0.1528125,
		vowel_name: "ay",
		pitch_mean_praat_base: 253.86,
		F1_mean_praat_base: 868.73,
		F2_mean_praat_base: 1748.02,
		F3_mean_praat_base: 2912.54,
		F1_median_praat_base: 915.21,
		F2_median_praat_base: 1712.55,
		F3_median_praat_base: 2895.19
	},
	{
		index: 255,
		person_id: "FCDR1",
		sex: "F",
		duration_second: 0.238625,
		vowel_name: "ay",
		pitch_mean_praat_base: 187.43,
		F1_mean_praat_base: 795.58,
		F2_mean_praat_base: 1560.38,
		F3_mean_praat_base: 2237.6,
		F1_median_praat_base: 810.3,
		F2_median_praat_base: 1550.04,
		F3_median_praat_base: 2227.08
	},
	{
		index: 256,
		person_id: "FDFB0",
		sex: "F",
		duration_second: 0.1505625,
		vowel_name: "ay",
		pitch_mean_praat_base: 189.87,
		F1_mean_praat_base: 722.66,
		F2_mean_praat_base: 1665.12,
		F3_mean_praat_base: 3031,
		F1_median_praat_base: 743.4,
		F2_median_praat_base: 1673.11,
		F3_median_praat_base: 3036.51
	},
	{
		index: 257,
		person_id: "FSCN0",
		sex: "F",
		duration_second: 0.279375,
		vowel_name: "ay",
		pitch_mean_praat_base: 207.18,
		F1_mean_praat_base: 774.09,
		F2_mean_praat_base: 1664.3,
		F3_mean_praat_base: 2268.34,
		F1_median_praat_base: 765.94,
		F2_median_praat_base: 1575.63,
		F3_median_praat_base: 2074.44
	},
	{
		index: 258,
		person_id: "FASW0",
		sex: "F",
		duration_second: 0.280875,
		vowel_name: "ay",
		pitch_mean_praat_base: 154.89,
		F1_mean_praat_base: 744.91,
		F2_mean_praat_base: 1506.58,
		F3_mean_praat_base: 2831.33,
		F1_median_praat_base: 763.14,
		F2_median_praat_base: 1345.06,
		F3_median_praat_base: 2821.17
	},
	{
		index: 259,
		person_id: "FKSR0",
		sex: "F",
		duration_second: 0.1,
		vowel_name: "ay",
		pitch_mean_praat_base: 236.58,
		F1_mean_praat_base: 680.59,
		F2_mean_praat_base: 2082.1,
		F3_mean_praat_base: 2878.54,
		F1_median_praat_base: 676.94,
		F2_median_praat_base: 2176.85,
		F3_median_praat_base: 2904.9
	},
	{
		index: 260,
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
		index: 261,
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
		index: 262,
		person_id: "MDWK0",
		sex: "M",
		duration_second: 0.05275,
		vowel_name: "ax",
		pitch_mean_praat_base: 99.5,
		F1_mean_praat_base: 566.05,
		F2_mean_praat_base: 1391.89,
		F3_mean_praat_base: 2819,
		F1_median_praat_base: 571.24,
		F2_median_praat_base: 1357.15,
		F3_median_praat_base: 2632.54
	},
	{
		index: 263,
		person_id: "MRMH0",
		sex: "M",
		duration_second: 0.04775,
		vowel_name: "ax",
		pitch_mean_praat_base: 125.11,
		F1_mean_praat_base: 564.65,
		F2_mean_praat_base: 1328.62,
		F3_mean_praat_base: 2544.91,
		F1_median_praat_base: 569.96,
		F2_median_praat_base: 1388.1,
		F3_median_praat_base: 2515.46
	},
	{
		index: 264,
		person_id: "MSDH0",
		sex: "M",
		duration_second: 0.044375,
		vowel_name: "ax",
		pitch_mean_praat_base: 116.87,
		F1_mean_praat_base: 549.04,
		F2_mean_praat_base: 1032.28,
		F3_mean_praat_base: 2826.04,
		F1_median_praat_base: 550.83,
		F2_median_praat_base: 1026.36,
		F3_median_praat_base: 2831.41
	},
	{
		index: 265,
		person_id: "MSTF0",
		sex: "M",
		duration_second: 0.04,
		vowel_name: "ax",
		pitch_mean_praat_base: 136.13,
		F1_mean_praat_base: 577.85,
		F2_mean_praat_base: 1219.93,
		F3_mean_praat_base: 2614.16,
		F1_median_praat_base: 576.47,
		F2_median_praat_base: 1212.95,
		F3_median_praat_base: 2592.93
	},
	{
		index: 266,
		person_id: "MJDC0",
		sex: "M",
		duration_second: 0.0495625,
		vowel_name: "ax",
		pitch_mean_praat_base: 135.27,
		F1_mean_praat_base: 432.09,
		F2_mean_praat_base: 1525.67,
		F3_mean_praat_base: 2499.51,
		F1_median_praat_base: 432.56,
		F2_median_praat_base: 1454.01,
		F3_median_praat_base: 2502.17
	},
	{
		index: 267,
		person_id: "MJTC0",
		sex: "M",
		duration_second: 0.0325,
		vowel_name: "ax",
		pitch_mean_praat_base: 94.77,
		F1_mean_praat_base: 553.44,
		F2_mean_praat_base: 1186.99,
		F3_mean_praat_base: 2667.4,
		F1_median_praat_base: 556.83,
		F2_median_praat_base: 1164.67,
		F3_median_praat_base: 2636.35
	},
	{
		index: 268,
		person_id: "MAHH0",
		sex: "M",
		duration_second: 0.07125,
		vowel_name: "ax",
		pitch_mean_praat_base: 135.28,
		F1_mean_praat_base: 492.84,
		F2_mean_praat_base: 1630.82,
		F3_mean_praat_base: 2749.21,
		F1_median_praat_base: 472.68,
		F2_median_praat_base: 1571.95,
		F3_median_praat_base: 2847.75
	},
	{
		index: 269,
		person_id: "MWAD0",
		sex: "M",
		duration_second: 0.026125,
		vowel_name: "ax",
		pitch_mean_praat_base: 118.58,
		F1_mean_praat_base: 487.01,
		F2_mean_praat_base: 1657.14,
		F3_mean_praat_base: 2740.31,
		F1_median_praat_base: 485.57,
		F2_median_praat_base: 1632.35,
		F3_median_praat_base: 2344.56
	},
	{
		index: 270,
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
		index: 271,
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
		index: 272,
		person_id: "FMMH0",
		sex: "F",
		duration_second: 0.026125,
		vowel_name: "ax",
		pitch_mean_praat_base: 204.66,
		F1_mean_praat_base: 545.94,
		F2_mean_praat_base: 1722.86,
		F3_mean_praat_base: 3034.86,
		F1_median_praat_base: 545.94,
		F2_median_praat_base: 1722.86,
		F3_median_praat_base: 3034.86
	},
	{
		index: 273,
		person_id: "FJRE0",
		sex: "F",
		duration_second: 0.055,
		vowel_name: "ax",
		pitch_mean_praat_base: 190.31,
		F1_mean_praat_base: 621.61,
		F2_mean_praat_base: 1476.05,
		F3_mean_praat_base: 2862.61,
		F1_median_praat_base: 624.52,
		F2_median_praat_base: 1442.01,
		F3_median_praat_base: 2834.61
	},
	{
		index: 274,
		person_id: "FGWR0",
		sex: "F",
		duration_second: 0.05075,
		vowel_name: "ax",
		pitch_mean_praat_base: 204.83,
		F1_mean_praat_base: 589.72,
		F2_mean_praat_base: 1658.74,
		F3_mean_praat_base: 2820.43,
		F1_median_praat_base: 590.72,
		F2_median_praat_base: 1655.73,
		F3_median_praat_base: 2826.09
	},
	{
		index: 275,
		person_id: "FASW0",
		sex: "F",
		duration_second: 0.02,
		vowel_name: "ax",
		pitch_mean_praat_base: 171.67,
		F1_mean_praat_base: 613.48,
		F2_mean_praat_base: 1802.14,
		F3_mean_praat_base: 3169.45,
		F1_median_praat_base: 613.48,
		F2_median_praat_base: 1802.14,
		F3_median_praat_base: 3169.45
	},
	{
		index: 276,
		person_id: "FJSJ0",
		sex: "F",
		duration_second: 0.0393125,
		vowel_name: "ax",
		pitch_mean_praat_base: 160.92,
		F1_mean_praat_base: 494.36,
		F2_mean_praat_base: 1603.54,
		F3_mean_praat_base: 2602.34,
		F1_median_praat_base: 499.59,
		F2_median_praat_base: 1612.67,
		F3_median_praat_base: 2595.91
	},
	{
		index: 277,
		person_id: "FALK0",
		sex: "F",
		duration_second: 0.0835625,
		vowel_name: "ax",
		pitch_mean_praat_base: 207.78,
		F1_mean_praat_base: 623.71,
		F2_mean_praat_base: 1614.87,
		F3_mean_praat_base: 2932.62,
		F1_median_praat_base: 653.05,
		F2_median_praat_base: 1655.6,
		F3_median_praat_base: 2933.9
	},
	{
		index: 278,
		person_id: "FJHK0",
		sex: "F",
		duration_second: 0.0525,
		vowel_name: "ax",
		pitch_mean_praat_base: 206.11,
		F1_mean_praat_base: 535.86,
		F2_mean_praat_base: 1468.24,
		F3_mean_praat_base: 3172.98,
		F1_median_praat_base: 544.86,
		F2_median_praat_base: 1472.07,
		F3_median_praat_base: 3171.59
	},
	{
		index: 279,
		person_id: "FCDR1",
		sex: "F",
		duration_second: 0.02575,
		vowel_name: "ax",
		pitch_mean_praat_base: 175.47,
		F1_mean_praat_base: 638.38,
		F2_mean_praat_base: 1522.21,
		F3_mean_praat_base: 2469.19,
		F1_median_praat_base: 638.38,
		F2_median_praat_base: 1522.21,
		F3_median_praat_base: 2469.19
	},
	{
		index: 280,
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
		index: 281,
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
		index: 282,
		person_id: "MVJH0",
		sex: "M",
		duration_second: 0.0275,
		vowel_name: "ux",
		pitch_mean_praat_base: 132.62,
		F1_mean_praat_base: 464.1,
		F2_mean_praat_base: 1482.18,
		F3_mean_praat_base: 2324.64,
		F1_median_praat_base: 464.1,
		F2_median_praat_base: 1482.18,
		F3_median_praat_base: 2324.64
	},
	{
		index: 283,
		person_id: "MWAC0",
		sex: "M",
		duration_second: 0.15125,
		vowel_name: "ux",
		pitch_mean_praat_base: 142.99,
		F1_mean_praat_base: 446.13,
		F2_mean_praat_base: 1762.88,
		F3_mean_praat_base: 2474.33,
		F1_median_praat_base: 465.06,
		F2_median_praat_base: 1773.79,
		F3_median_praat_base: 2314.83
	},
	{
		index: 284,
		person_id: "MDPK0",
		sex: "M",
		duration_second: 0.09,
		vowel_name: "ux",
		pitch_mean_praat_base: 109.16,
		F1_mean_praat_base: 408.67,
		F2_mean_praat_base: 1817.99,
		F3_mean_praat_base: 2433.71,
		F1_median_praat_base: 404.48,
		F2_median_praat_base: 1816.52,
		F3_median_praat_base: 2420.35
	},
	{
		index: 285,
		person_id: "MWAR0",
		sex: "M",
		duration_second: 0.090625,
		vowel_name: "ux",
		pitch_mean_praat_base: 142.74,
		F1_mean_praat_base: 1417.45,
		F2_mean_praat_base: 2282.15,
		F3_mean_praat_base: 3127.46,
		F1_median_praat_base: 1905.33,
		F2_median_praat_base: 2199.56,
		F3_median_praat_base: 3402.99
	},
	{
		index: 286,
		person_id: "MJJM0",
		sex: "M",
		duration_second: 0.09,
		vowel_name: "ux",
		pitch_mean_praat_base: 113.57,
		F1_mean_praat_base: 845.19,
		F2_mean_praat_base: 2060.88,
		F3_mean_praat_base: 2886.89,
		F1_median_praat_base: 300.86,
		F2_median_praat_base: 1890.72,
		F3_median_praat_base: 2697.28
	},
	{
		index: 287,
		person_id: "MRMG0",
		sex: "M",
		duration_second: 0.0489375,
		vowel_name: "ux",
		pitch_mean_praat_base: 119.8,
		F1_mean_praat_base: 394.48,
		F2_mean_praat_base: 1827.38,
		F3_mean_praat_base: 2628.84,
		F1_median_praat_base: 397.16,
		F2_median_praat_base: 1829.53,
		F3_median_praat_base: 2613
	},
	{
		index: 288,
		person_id: "MGXP0",
		sex: "M",
		duration_second: 0.07575,
		vowel_name: "ux",
		pitch_mean_praat_base: 124.9,
		F1_mean_praat_base: 343.58,
		F2_mean_praat_base: 1604.24,
		F3_mean_praat_base: 2316.24,
		F1_median_praat_base: 357.69,
		F2_median_praat_base: 1601.64,
		F3_median_praat_base: 2293.76
	},
	{
		index: 289,
		person_id: "MJRA0",
		sex: "M",
		duration_second: 0.0780625,
		vowel_name: "ux",
		pitch_mean_praat_base: 116.66,
		F1_mean_praat_base: 540.72,
		F2_mean_praat_base: 1757.5,
		F3_mean_praat_base: 2455.97,
		F1_median_praat_base: 374.81,
		F2_median_praat_base: 1599.88,
		F3_median_praat_base: 2195.62
	},
	{
		index: 290,
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
		index: 291,
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
		index: 292,
		person_id: "FDMS0",
		sex: "F",
		duration_second: 0.093375,
		vowel_name: "ux",
		pitch_mean_praat_base: 196.2,
		F1_mean_praat_base: 439.97,
		F2_mean_praat_base: 1828.44,
		F3_mean_praat_base: 2559,
		F1_median_praat_base: 439.42,
		F2_median_praat_base: 1790.33,
		F3_median_praat_base: 2660.97
	},
	{
		index: 293,
		person_id: "FSKC0",
		sex: "F",
		duration_second: 0.2399375,
		vowel_name: "ux",
		pitch_mean_praat_base: 179.82,
		F1_mean_praat_base: 467.05,
		F2_mean_praat_base: 1646.1,
		F3_mean_praat_base: 2718.53,
		F1_median_praat_base: 456.58,
		F2_median_praat_base: 1690.39,
		F3_median_praat_base: 2710.63
	},
	{
		index: 294,
		person_id: "FUTB0",
		sex: "F",
		duration_second: 0.1210625,
		vowel_name: "ux",
		pitch_mean_praat_base: 179.98,
		F1_mean_praat_base: 456.49,
		F2_mean_praat_base: 1565.33,
		F3_mean_praat_base: 2912.97,
		F1_median_praat_base: 444.08,
		F2_median_praat_base: 1610.11,
		F3_median_praat_base: 2901.49
	},
	{
		index: 295,
		person_id: "FASW0",
		sex: "F",
		duration_second: 0.31775,
		vowel_name: "ux",
		pitch_mean_praat_base: 162.68,
		F1_mean_praat_base: 360.23,
		F2_mean_praat_base: 2395.66,
		F3_mean_praat_base: 2962.99,
		F1_median_praat_base: 344.99,
		F2_median_praat_base: 2361.78,
		F3_median_praat_base: 2908.45
	},
	{
		index: 296,
		person_id: "FEME0",
		sex: "F",
		duration_second: 0.0616875,
		vowel_name: "ux",
		pitch_mean_praat_base: 147.9,
		F1_mean_praat_base: 363.31,
		F2_mean_praat_base: 2224.7,
		F3_mean_praat_base: 2705.72,
		F1_median_praat_base: 348.98,
		F2_median_praat_base: 2226.54,
		F3_median_praat_base: 2634.85
	},
	{
		index: 297,
		person_id: "FECD0",
		sex: "F",
		duration_second: 0.222,
		vowel_name: "ux",
		pitch_mean_praat_base: 202.33,
		F1_mean_praat_base: 595.51,
		F2_mean_praat_base: 2086.36,
		F3_mean_praat_base: 2965.29,
		F1_median_praat_base: 569.19,
		F2_median_praat_base: 2154.13,
		F3_median_praat_base: 2993.1
	},
	{
		index: 298,
		person_id: "FCAU0",
		sex: "F",
		duration_second: 0.133125,
		vowel_name: "ux",
		pitch_mean_praat_base: 224.57,
		F1_mean_praat_base: 426.16,
		F2_mean_praat_base: 1732.43,
		F3_mean_praat_base: 2464.16,
		F1_median_praat_base: 425.34,
		F2_median_praat_base: 1803.32,
		F3_median_praat_base: 2459.51
	},
	{
		index: 299,
		person_id: "FBCG1",
		sex: "F",
		duration_second: 0.0966875,
		vowel_name: "ux",
		pitch_mean_praat_base: 218.35,
		F1_mean_praat_base: 553.23,
		F2_mean_praat_base: 1777.01,
		F3_mean_praat_base: 2866.35,
		F1_median_praat_base: 547.11,
		F2_median_praat_base: 1733.93,
		F3_median_praat_base: 2855.62
	},
	{
		index: 300,
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
		index: 301,
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
		index: 302,
		person_id: "MDPS0",
		sex: "M",
		duration_second: 0.14075,
		vowel_name: "aw",
		pitch_mean_praat_base: 98.38,
		F1_mean_praat_base: 678.39,
		F2_mean_praat_base: 1150.25,
		F3_mean_praat_base: 2270.69,
		F1_median_praat_base: 655.57,
		F2_median_praat_base: 1141.07,
		F3_median_praat_base: 2265.85
	},
	{
		index: 303,
		person_id: "MKAM0",
		sex: "M",
		duration_second: 0.1045,
		vowel_name: "aw",
		pitch_mean_praat_base: 110.61,
		F1_mean_praat_base: 715.53,
		F2_mean_praat_base: 1232.23,
		F3_mean_praat_base: 2247.44,
		F1_median_praat_base: 734.81,
		F2_median_praat_base: 1204.31,
		F3_median_praat_base: 2237.16
	},
	{
		index: 304,
		person_id: "MRAM0",
		sex: "M",
		duration_second: 0.3160625,
		vowel_name: "aw",
		pitch_mean_praat_base: 124.64,
		F1_mean_praat_base: 669.76,
		F2_mean_praat_base: 1406.51,
		F3_mean_praat_base: 2418.16,
		F1_median_praat_base: 671.42,
		F2_median_praat_base: 1477.18,
		F3_median_praat_base: 2440.96
	},
	{
		index: 305,
		person_id: "MILB0",
		sex: "M",
		duration_second: 0.13575,
		vowel_name: "aw",
		pitch_mean_praat_base: 175.34,
		F1_mean_praat_base: 729.15,
		F2_mean_praat_base: 1159.02,
		F3_mean_praat_base: 2305.67,
		F1_median_praat_base: 734.23,
		F2_median_praat_base: 1186.62,
		F3_median_praat_base: 2291.76
	},
	{
		index: 306,
		person_id: "MJXL0",
		sex: "M",
		duration_second: 0.164375,
		vowel_name: "aw",
		pitch_mean_praat_base: 120.87,
		F1_mean_praat_base: 765.45,
		F2_mean_praat_base: 1474.82,
		F3_mean_praat_base: 2585.21,
		F1_median_praat_base: 786.79,
		F2_median_praat_base: 1488.87,
		F3_median_praat_base: 2571.93
	},
	{
		index: 307,
		person_id: "MTLC0",
		sex: "M",
		duration_second: 0.1566875,
		vowel_name: "aw",
		pitch_mean_praat_base: 92.14,
		F1_mean_praat_base: 706.18,
		F2_mean_praat_base: 1372.67,
		F3_mean_praat_base: 2561.64,
		F1_median_praat_base: 709.33,
		F2_median_praat_base: 1373,
		F3_median_praat_base: 2563.11
	},
	{
		index: 308,
		person_id: "MMRP0",
		sex: "M",
		duration_second: 0.139375,
		vowel_name: "aw",
		pitch_mean_praat_base: 135.09,
		F1_mean_praat_base: 718.01,
		F2_mean_praat_base: 1491.07,
		F3_mean_praat_base: 2506.25,
		F1_median_praat_base: 742.55,
		F2_median_praat_base: 1508.67,
		F3_median_praat_base: 2526.21
	},
	{
		index: 309,
		person_id: "MAHH0",
		sex: "M",
		duration_second: 0.288375,
		vowel_name: "aw",
		pitch_mean_praat_base: 126.6,
		F1_mean_praat_base: 713.66,
		F2_mean_praat_base: 1112.14,
		F3_mean_praat_base: 2230.75,
		F1_median_praat_base: 741.14,
		F2_median_praat_base: 1158.36,
		F3_median_praat_base: 2212.9
	},
	{
		index: 310,
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
		index: 311,
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
		index: 312,
		person_id: "FEAR0",
		sex: "F",
		duration_second: 0.1,
		vowel_name: "aw",
		pitch_mean_praat_base: 200.71,
		F1_mean_praat_base: 847.19,
		F2_mean_praat_base: 1491.08,
		F3_mean_praat_base: 2839.49,
		F1_median_praat_base: 879.31,
		F2_median_praat_base: 1446.17,
		F3_median_praat_base: 2861.96
	},
	{
		index: 313,
		person_id: "FDKN0",
		sex: "F",
		duration_second: 0.1226875,
		vowel_name: "aw",
		pitch_mean_praat_base: 215.71,
		F1_mean_praat_base: 760.36,
		F2_mean_praat_base: 1232.92,
		F3_mean_praat_base: 2462.52,
		F1_median_praat_base: 767.9,
		F2_median_praat_base: 1242.29,
		F3_median_praat_base: 2716.65
	},
	{
		index: 314,
		person_id: "FETB0",
		sex: "F",
		duration_second: 0.1119375,
		vowel_name: "aw",
		pitch_mean_praat_base: 221.33,
		F1_mean_praat_base: 665.71,
		F2_mean_praat_base: 1255.47,
		F3_mean_praat_base: 3090.52,
		F1_median_praat_base: 669.11,
		F2_median_praat_base: 1236.74,
		F3_median_praat_base: 3092.67
	},
	{
		index: 315,
		person_id: "FLAG0",
		sex: "F",
		duration_second: 0.2398125,
		vowel_name: "aw",
		pitch_mean_praat_base: 200.45,
		F1_mean_praat_base: 813.68,
		F2_mean_praat_base: 1591.15,
		F3_mean_praat_base: 2733.58,
		F1_median_praat_base: 845.71,
		F2_median_praat_base: 1570.38,
		F3_median_praat_base: 2718.64
	},
	{
		index: 316,
		person_id: "FMAH1",
		sex: "F",
		duration_second: 0.12675,
		vowel_name: "aw",
		pitch_mean_praat_base: 227.97,
		F1_mean_praat_base: 800.69,
		F2_mean_praat_base: 1632.11,
		F3_mean_praat_base: 2951.87,
		F1_median_praat_base: 817.37,
		F2_median_praat_base: 1601.97,
		F3_median_praat_base: 2932.5
	},
	{
		index: 317,
		person_id: "FCRH0",
		sex: "F",
		duration_second: 0.225,
		vowel_name: "aw",
		pitch_mean_praat_base: 215.43,
		F1_mean_praat_base: 823.33,
		F2_mean_praat_base: 1241.26,
		F3_mean_praat_base: 2775.95,
		F1_median_praat_base: 865.88,
		F2_median_praat_base: 1233.41,
		F3_median_praat_base: 2747.7
	},
	{
		index: 318,
		person_id: "FMMH0",
		sex: "F",
		duration_second: 0.114125,
		vowel_name: "aw",
		pitch_mean_praat_base: 196.95,
		F1_mean_praat_base: 795.39,
		F2_mean_praat_base: 1318.16,
		F3_mean_praat_base: 2892.07,
		F1_median_praat_base: 838.62,
		F2_median_praat_base: 1423.87,
		F3_median_praat_base: 2888.97
	},
	{
		index: 319,
		person_id: "FJLM0",
		sex: "F",
		duration_second: 0.169375,
		vowel_name: "aw",
		pitch_mean_praat_base: 211.54,
		F1_mean_praat_base: 813.58,
		F2_mean_praat_base: 1808.49,
		F3_mean_praat_base: 3048.6,
		F1_median_praat_base: 858.66,
		F2_median_praat_base: 1808.9,
		F3_median_praat_base: 3089.74
	},
	{
		index: 320,
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
		index: 321,
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
		index: 322,
		person_id: "MDLB0",
		sex: "M",
		duration_second: 0.049,
		vowel_name: "ah",
		pitch_mean_praat_base: 118.24,
		F1_mean_praat_base: 612.56,
		F2_mean_praat_base: 1027.08,
		F3_mean_praat_base: 2635.93,
		F1_median_praat_base: 618.59,
		F2_median_praat_base: 1028.52,
		F3_median_praat_base: 2653.12
	},
	{
		index: 323,
		person_id: "MRWA0",
		sex: "M",
		duration_second: 0.1114375,
		vowel_name: "ah",
		pitch_mean_praat_base: 130.85,
		F1_mean_praat_base: 569.22,
		F2_mean_praat_base: 1578.86,
		F3_mean_praat_base: 2441.25,
		F1_median_praat_base: 570.04,
		F2_median_praat_base: 1589.22,
		F3_median_praat_base: 2431.72
	},
	{
		index: 324,
		person_id: "MSAT0",
		sex: "M",
		duration_second: 0.0425,
		vowel_name: "ah",
		pitch_mean_praat_base: 97.28,
		F1_mean_praat_base: 625.52,
		F2_mean_praat_base: 981.31,
		F3_mean_praat_base: 2565.21,
		F1_median_praat_base: 627.15,
		F2_median_praat_base: 982.15,
		F3_median_praat_base: 2560.24
	},
	{
		index: 325,
		person_id: "MRMG0",
		sex: "M",
		duration_second: 0.0530625,
		vowel_name: "ah",
		pitch_mean_praat_base: 121.51,
		F1_mean_praat_base: 586.19,
		F2_mean_praat_base: 1527.62,
		F3_mean_praat_base: 2542.96,
		F1_median_praat_base: 603.58,
		F2_median_praat_base: 1509.74,
		F3_median_praat_base: 2529.87
	},
	{
		index: 326,
		person_id: "MTRC0",
		sex: "M",
		duration_second: 0.045625,
		vowel_name: "ah",
		pitch_mean_praat_base: 117.9,
		F1_mean_praat_base: 615.21,
		F2_mean_praat_base: 1590.29,
		F3_mean_praat_base: 2690.05,
		F1_median_praat_base: 617.76,
		F2_median_praat_base: 1584.45,
		F3_median_praat_base: 2682.07
	},
	{
		index: 327,
		person_id: "MTMR0",
		sex: "M",
		duration_second: 0.084125,
		vowel_name: "ah",
		pitch_mean_praat_base: 106.61,
		F1_mean_praat_base: 518.05,
		F2_mean_praat_base: 1507.92,
		F3_mean_praat_base: 2739.26,
		F1_median_praat_base: 523.46,
		F2_median_praat_base: 1505.62,
		F3_median_praat_base: 2683.28
	},
	{
		index: 328,
		person_id: "MJTH0",
		sex: "M",
		duration_second: 0.06325,
		vowel_name: "ah",
		pitch_mean_praat_base: 103.58,
		F1_mean_praat_base: 600.9,
		F2_mean_praat_base: 1505.44,
		F3_mean_praat_base: 2747.31,
		F1_median_praat_base: 604.35,
		F2_median_praat_base: 1491.57,
		F3_median_praat_base: 2745.72
	},
	{
		index: 329,
		person_id: "MTKD0",
		sex: "M",
		duration_second: 0.13475,
		vowel_name: "ah",
		pitch_mean_praat_base: 124.11,
		F1_mean_praat_base: 675.52,
		F2_mean_praat_base: 1331.53,
		F3_mean_praat_base: 2203.12,
		F1_median_praat_base: 687.71,
		F2_median_praat_base: 1300.78,
		F3_median_praat_base: 2188.99
	},
	{
		index: 330,
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
		index: 331,
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
		index: 332,
		person_id: "FBLV0",
		sex: "F",
		duration_second: 0.05675,
		vowel_name: "ah",
		pitch_mean_praat_base: 180.61,
		F1_mean_praat_base: 544.75,
		F2_mean_praat_base: 1612.38,
		F3_mean_praat_base: 2339.87,
		F1_median_praat_base: 544.75,
		F2_median_praat_base: 1638.17,
		F3_median_praat_base: 2352.01
	},
	{
		index: 333,
		person_id: "FDAS1",
		sex: "F",
		duration_second: 0.0975,
		vowel_name: "ah",
		pitch_mean_praat_base: 234.21,
		F1_mean_praat_base: 691.3,
		F2_mean_praat_base: 1685.18,
		F3_mean_praat_base: 2724.06,
		F1_median_praat_base: 717.25,
		F2_median_praat_base: 1668.92,
		F3_median_praat_base: 2721.09
	},
	{
		index: 334,
		person_id: "FGMB0",
		sex: "F",
		duration_second: 0.115,
		vowel_name: "ah",
		pitch_mean_praat_base: 204.08,
		F1_mean_praat_base: 687.67,
		F2_mean_praat_base: 1240.56,
		F3_mean_praat_base: 2711.6,
		F1_median_praat_base: 708.15,
		F2_median_praat_base: 1234.71,
		F3_median_praat_base: 2758.98
	},
	{
		index: 335,
		person_id: "FHEW0",
		sex: "F",
		duration_second: 0.0966875,
		vowel_name: "ah",
		pitch_mean_praat_base: 249.33,
		F1_mean_praat_base: 702.3,
		F2_mean_praat_base: 1538.1,
		F3_mean_praat_base: 2870.54,
		F1_median_praat_base: 744.57,
		F2_median_praat_base: 1620.49,
		F3_median_praat_base: 3148.22
	},
	{
		index: 336,
		person_id: "FBJL0",
		sex: "F",
		duration_second: 0.060625,
		vowel_name: "ah",
		pitch_mean_praat_base: 212.47,
		F1_mean_praat_base: 633.19,
		F2_mean_praat_base: 1571.79,
		F3_mean_praat_base: 2825.33,
		F1_median_praat_base: 637.56,
		F2_median_praat_base: 1588.5,
		F3_median_praat_base: 2863.97
	},
	{
		index: 337,
		person_id: "FLJA0",
		sex: "F",
		duration_second: 0.073625,
		vowel_name: "ah",
		pitch_mean_praat_base: 222.29,
		F1_mean_praat_base: 712.59,
		F2_mean_praat_base: 1243.56,
		F3_mean_praat_base: 2847.13,
		F1_median_praat_base: 711.39,
		F2_median_praat_base: 1187.99,
		F3_median_praat_base: 2843.02
	},
	{
		index: 338,
		person_id: "FPKT0",
		sex: "F",
		duration_second: 0.0443125,
		vowel_name: "ah",
		pitch_mean_praat_base: 227.95,
		F1_mean_praat_base: 727.71,
		F2_mean_praat_base: 1376.24,
		F3_mean_praat_base: 2625.96,
		F1_median_praat_base: 733.45,
		F2_median_praat_base: 1357.14,
		F3_median_praat_base: 2643.71
	},
	{
		index: 339,
		person_id: "FJMG0",
		sex: "F",
		duration_second: 0.08875,
		vowel_name: "ah",
		pitch_mean_praat_base: 251.41,
		F1_mean_praat_base: 766.78,
		F2_mean_praat_base: 1751.2,
		F3_mean_praat_base: 2722.56,
		F1_median_praat_base: 777.37,
		F2_median_praat_base: 1761.93,
		F3_median_praat_base: 2736.29
	},
	{
		index: 340,
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
		index: 341,
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
		index: 342,
		person_id: "MJDE0",
		sex: "M",
		duration_second: 0.115,
		vowel_name: "ey",
		pitch_mean_praat_base: 128.19,
		F1_mean_praat_base: 438.05,
		F2_mean_praat_base: 1904.36,
		F3_mean_praat_base: 2681.49,
		F1_median_praat_base: 466.74,
		F2_median_praat_base: 1897.38,
		F3_median_praat_base: 2675.9
	},
	{
		index: 343,
		person_id: "MWDK0",
		sex: "M",
		duration_second: 0.1668125,
		vowel_name: "ey",
		pitch_mean_praat_base: 152.49,
		F1_mean_praat_base: 485.36,
		F2_mean_praat_base: 1715.23,
		F3_mean_praat_base: 2590.7,
		F1_median_praat_base: 491.05,
		F2_median_praat_base: 1730.31,
		F3_median_praat_base: 2519.58
	},
	{
		index: 344,
		person_id: "MADC0",
		sex: "M",
		duration_second: 0.117625,
		vowel_name: "ey",
		pitch_mean_praat_base: 111.07,
		F1_mean_praat_base: 480.85,
		F2_mean_praat_base: 2015.8,
		F3_mean_praat_base: 2277.9,
		F1_median_praat_base: 487.77,
		F2_median_praat_base: 2031.48,
		F3_median_praat_base: 2299.7
	},
	{
		index: 345,
		person_id: "MPFU0",
		sex: "M",
		duration_second: 0.095,
		vowel_name: "ey",
		pitch_mean_praat_base: 122.59,
		F1_mean_praat_base: 536.88,
		F2_mean_praat_base: 2000.58,
		F3_mean_praat_base: 2632.89,
		F1_median_praat_base: 577.05,
		F2_median_praat_base: 1980.29,
		F3_median_praat_base: 2638.79
	},
	{
		index: 346,
		person_id: "MCLM0",
		sex: "M",
		duration_second: 0.14725,
		vowel_name: "ey",
		pitch_mean_praat_base: 134.08,
		F1_mean_praat_base: 539.06,
		F2_mean_praat_base: 1466.39,
		F3_mean_praat_base: 2577.07,
		F1_median_praat_base: 569.64,
		F2_median_praat_base: 1399.07,
		F3_median_praat_base: 2573.58
	},
	{
		index: 347,
		person_id: "MGLB0",
		sex: "M",
		duration_second: 0.181875,
		vowel_name: "ey",
		pitch_mean_praat_base: 106,
		F1_mean_praat_base: 480.71,
		F2_mean_praat_base: 1896.01,
		F3_mean_praat_base: 2702.94,
		F1_median_praat_base: 487.56,
		F2_median_praat_base: 1934.51,
		F3_median_praat_base: 2701.14
	},
	{
		index: 348,
		person_id: "MKLS0",
		sex: "M",
		duration_second: 0.087,
		vowel_name: "ey",
		pitch_mean_praat_base: 121.53,
		F1_mean_praat_base: 451.93,
		F2_mean_praat_base: 2167.88,
		F3_mean_praat_base: 2673.68,
		F1_median_praat_base: 449.62,
		F2_median_praat_base: 2159.45,
		F3_median_praat_base: 2732.22
	},
	{
		index: 349,
		person_id: "MSES0",
		sex: "M",
		duration_second: 0.08625,
		vowel_name: "ey",
		pitch_mean_praat_base: 136.18,
		F1_mean_praat_base: 476.73,
		F2_mean_praat_base: 1889.52,
		F3_mean_praat_base: 2559.34,
		F1_median_praat_base: 468.92,
		F2_median_praat_base: 1895.39,
		F3_median_praat_base: 2554.26
	},
	{
		index: 350,
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
		index: 351,
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
		index: 352,
		person_id: "FRJB0",
		sex: "F",
		duration_second: 0.125375,
		vowel_name: "ey",
		pitch_mean_praat_base: 187.99,
		F1_mean_praat_base: 540.55,
		F2_mean_praat_base: 2281.07,
		F3_mean_praat_base: 2935.02,
		F1_median_praat_base: 534.34,
		F2_median_praat_base: 2401.32,
		F3_median_praat_base: 3038.02
	},
	{
		index: 353,
		person_id: "FCAL1",
		sex: "F",
		duration_second: 0.125625,
		vowel_name: "ey",
		pitch_mean_praat_base: 220.68,
		F1_mean_praat_base: 582.12,
		F2_mean_praat_base: 2068.52,
		F3_mean_praat_base: 2762.14,
		F1_median_praat_base: 598.26,
		F2_median_praat_base: 2053.63,
		F3_median_praat_base: 2755.16
	},
	{
		index: 354,
		person_id: "FSEM0",
		sex: "F",
		duration_second: 0.12,
		vowel_name: "ey",
		pitch_mean_praat_base: 239.05,
		F1_mean_praat_base: 639.87,
		F2_mean_praat_base: 2174.24,
		F3_mean_praat_base: 3150.15,
		F1_median_praat_base: 632.47,
		F2_median_praat_base: 2177.44,
		F3_median_praat_base: 3222.99
	},
	{
		index: 355,
		person_id: "FLTM0",
		sex: "F",
		duration_second: 0.15425,
		vowel_name: "ey",
		pitch_mean_praat_base: 186.34,
		F1_mean_praat_base: 611.76,
		F2_mean_praat_base: 2181.77,
		F3_mean_praat_base: 2946.35,
		F1_median_praat_base: 616.7,
		F2_median_praat_base: 2150.62,
		F3_median_praat_base: 3032.46
	},
	{
		index: 356,
		person_id: "FKMS0",
		sex: "F",
		duration_second: 0.1644375,
		vowel_name: "ey",
		pitch_mean_praat_base: 175.57,
		F1_mean_praat_base: 558.05,
		F2_mean_praat_base: 1891.56,
		F3_mean_praat_base: 2651.65,
		F1_median_praat_base: 569.61,
		F2_median_praat_base: 1940.55,
		F3_median_praat_base: 2598.46
	},
	{
		index: 357,
		person_id: "FJLM0",
		sex: "F",
		duration_second: 0.1531875,
		vowel_name: "ey",
		pitch_mean_praat_base: 220.88,
		F1_mean_praat_base: 733.77,
		F2_mean_praat_base: 2033.56,
		F3_mean_praat_base: 3193.81,
		F1_median_praat_base: 797.04,
		F2_median_praat_base: 1975.41,
		F3_median_praat_base: 3191.01
	},
	{
		index: 358,
		person_id: "FMKF0",
		sex: "F",
		duration_second: 0.138375,
		vowel_name: "ey",
		pitch_mean_praat_base: 194.2,
		F1_mean_praat_base: 634.72,
		F2_mean_praat_base: 2639.54,
		F3_mean_praat_base: 3111.92,
		F1_median_praat_base: 642.54,
		F2_median_praat_base: 2649.51,
		F3_median_praat_base: 3106.5
	},
	{
		index: 359,
		person_id: "FVKB0",
		sex: "F",
		duration_second: 0.23725,
		vowel_name: "ey",
		pitch_mean_praat_base: 221.94,
		F1_mean_praat_base: 560.27,
		F2_mean_praat_base: 2192.96,
		F3_mean_praat_base: 2837.93,
		F1_median_praat_base: 571.97,
		F2_median_praat_base: 2244.81,
		F3_median_praat_base: 2855.1
	},
	{
		index: 360,
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
		index: 361,
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
		index: 362,
		person_id: "MDLC1",
		sex: "M",
		duration_second: 0.0589375,
		vowel_name: "uh",
		pitch_mean_praat_base: 130.32,
		F1_mean_praat_base: 503.87,
		F2_mean_praat_base: 1423.29,
		F3_mean_praat_base: 2499.36,
		F1_median_praat_base: 508.26,
		F2_median_praat_base: 1480.48,
		F3_median_praat_base: 2522.88
	},
	{
		index: 363,
		person_id: "MRML0",
		sex: "M",
		duration_second: 0.0719375,
		vowel_name: "uh",
		pitch_mean_praat_base: 94.99,
		F1_mean_praat_base: 772.22,
		F2_mean_praat_base: 1508.79,
		F3_mean_praat_base: 2385.5,
		F1_median_praat_base: 755.69,
		F2_median_praat_base: 1502.12,
		F3_median_praat_base: 2425.85
	},
	{
		index: 364,
		person_id: "MWSB0",
		sex: "M",
		duration_second: 0.0335625,
		vowel_name: "uh",
		pitch_mean_praat_base: 137.32,
		F1_mean_praat_base: 602.37,
		F2_mean_praat_base: 1331.81,
		F3_mean_praat_base: 2883.37,
		F1_median_praat_base: 604.46,
		F2_median_praat_base: 1346.46,
		F3_median_praat_base: 2883.73
	},
	{
		index: 365,
		person_id: "MRMB0",
		sex: "M",
		duration_second: 0.1624375,
		vowel_name: "uh",
		pitch_mean_praat_base: 110.14,
		F1_mean_praat_base: 741.82,
		F2_mean_praat_base: 2046.21,
		F3_mean_praat_base: 3197.86,
		F1_median_praat_base: 875.2,
		F2_median_praat_base: 2500.61,
		F3_median_praat_base: 3385.68
	},
	{
		index: 366,
		person_id: "MJSW0",
		sex: "M",
		duration_second: 0.071375,
		vowel_name: "uh",
		pitch_mean_praat_base: 132.84,
		F1_mean_praat_base: 568.55,
		F2_mean_praat_base: 885.42,
		F3_mean_praat_base: 2996.25,
		F1_median_praat_base: 578.59,
		F2_median_praat_base: 875.06,
		F3_median_praat_base: 2965.4
	},
	{
		index: 367,
		person_id: "MBOM0",
		sex: "M",
		duration_second: 0.06025,
		vowel_name: "uh",
		pitch_mean_praat_base: 102.29,
		F1_mean_praat_base: 459.75,
		F2_mean_praat_base: 1720.62,
		F3_mean_praat_base: 2672.64,
		F1_median_praat_base: 462.02,
		F2_median_praat_base: 1717.82,
		F3_median_praat_base: 2658.77
	},
	{
		index: 368,
		person_id: "MTRT0",
		sex: "M",
		duration_second: 0.08,
		vowel_name: "uh",
		pitch_mean_praat_base: 98.01,
		F1_mean_praat_base: 766.83,
		F2_mean_praat_base: 1911.87,
		F3_mean_praat_base: 2922.44,
		F1_median_praat_base: 817.85,
		F2_median_praat_base: 2141.05,
		F3_median_praat_base: 3131.09
	},
	{
		index: 369,
		person_id: "MJMM0",
		sex: "M",
		duration_second: 0.0425,
		vowel_name: "uh",
		pitch_mean_praat_base: 130.14,
		F1_mean_praat_base: 467.51,
		F2_mean_praat_base: 1523.11,
		F3_mean_praat_base: 2489.33,
		F1_median_praat_base: 470.7,
		F2_median_praat_base: 1557.97,
		F3_median_praat_base: 2494.09
	},
	{
		index: 370,
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
		index: 371,
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
		index: 372,
		person_id: "FASW0",
		sex: "F",
		duration_second: 0.066875,
		vowel_name: "uh",
		pitch_mean_praat_base: 150.87,
		F1_mean_praat_base: 542.27,
		F2_mean_praat_base: 1609.21,
		F3_mean_praat_base: 3269.65,
		F1_median_praat_base: 548.98,
		F2_median_praat_base: 1627.49,
		F3_median_praat_base: 3325.24
	},
	{
		index: 373,
		person_id: "FELC0",
		sex: "F",
		duration_second: 0.1264375,
		vowel_name: "uh",
		pitch_mean_praat_base: 215.29,
		F1_mean_praat_base: 612.85,
		F2_mean_praat_base: 1277.39,
		F3_mean_praat_base: 2598.38,
		F1_median_praat_base: 580,
		F2_median_praat_base: 1260.6,
		F3_median_praat_base: 2568.43
	},
	{
		index: 374,
		person_id: "FPAZ0",
		sex: "F",
		duration_second: 0.145625,
		vowel_name: "uh",
		pitch_mean_praat_base: 216.02,
		F1_mean_praat_base: 579.14,
		F2_mean_praat_base: 1667.83,
		F3_mean_praat_base: 2836.14,
		F1_median_praat_base: 602.76,
		F2_median_praat_base: 1685.86,
		F3_median_praat_base: 2843.52
	},
	{
		index: 375,
		person_id: "FKFB0",
		sex: "F",
		duration_second: 0.05875,
		vowel_name: "uh",
		pitch_mean_praat_base: 219.09,
		F1_mean_praat_base: 572.03,
		F2_mean_praat_base: 1932.55,
		F3_mean_praat_base: 2836.58,
		F1_median_praat_base: 579.84,
		F2_median_praat_base: 1928.35,
		F3_median_praat_base: 2791.81
	},
	{
		index: 376,
		person_id: "FDKN0",
		sex: "F",
		duration_second: 0.1101875,
		vowel_name: "uh",
		pitch_mean_praat_base: 204.7,
		F1_mean_praat_base: 564.34,
		F2_mean_praat_base: 1189.96,
		F3_mean_praat_base: 2807.87,
		F1_median_praat_base: 565.19,
		F2_median_praat_base: 1139.58,
		F3_median_praat_base: 2898.39
	},
	{
		index: 377,
		person_id: "FCAJ0",
		sex: "F",
		duration_second: 0.103375,
		vowel_name: "uh",
		pitch_mean_praat_base: 170.32,
		F1_mean_praat_base: 589.29,
		F2_mean_praat_base: 1156.16,
		F3_mean_praat_base: 2917.03,
		F1_median_praat_base: 589.18,
		F2_median_praat_base: 1146.91,
		F3_median_praat_base: 2917.32
	},
	{
		index: 378,
		person_id: "FCLT0",
		sex: "F",
		duration_second: 0.0725,
		vowel_name: "uh",
		pitch_mean_praat_base: 204.64,
		F1_mean_praat_base: 549.46,
		F2_mean_praat_base: 1442.51,
		F3_mean_praat_base: 2752.02,
		F1_median_praat_base: 562.09,
		F2_median_praat_base: 1474.66,
		F3_median_praat_base: 2754.13
	},
	{
		index: 379,
		person_id: "FPAS0",
		sex: "F",
		duration_second: 0.0613125,
		vowel_name: "uh",
		pitch_mean_praat_base: 203.75,
		F1_mean_praat_base: 645.13,
		F2_mean_praat_base: 1210.33,
		F3_mean_praat_base: 2358.63,
		F1_median_praat_base: 626.75,
		F2_median_praat_base: 1161.32,
		F3_median_praat_base: 2252.76
	},
	{
		index: 380,
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
		index: 381,
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
		index: 382,
		person_id: "MROA0",
		sex: "M",
		duration_second: 0.0215625,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 106.91,
		F1_mean_praat_base: 950.3,
		F2_mean_praat_base: 1802.1,
		F3_mean_praat_base: 3089.09,
		F1_median_praat_base: 950.3,
		F2_median_praat_base: 1802.1,
		F3_median_praat_base: 3089.09
	},
	{
		index: 383,
		person_id: "MSRR0",
		sex: "M",
		duration_second: 0.017625,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 138.74,
		F1_mean_praat_base: 1658.91,
		F2_mean_praat_base: 1929.44,
		F3_mean_praat_base: 3767.62,
		F1_median_praat_base: 1658.91,
		F2_median_praat_base: 1929.44,
		F3_median_praat_base: 3767.62
	},
	{
		index: 384,
		person_id: "MWSB0",
		sex: "M",
		duration_second: 0.0344375,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 120.24,
		F1_mean_praat_base: 1750.04,
		F2_mean_praat_base: 2699.65,
		F3_mean_praat_base: 3881.97,
		F1_median_praat_base: 1786.64,
		F2_median_praat_base: 2684.46,
		F3_median_praat_base: 3876.62
	},
	{
		index: 385,
		person_id: "MCPM0",
		sex: "M",
		duration_second: 0.032375,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 150,
		F1_mean_praat_base: 725.76,
		F2_mean_praat_base: 1833.21,
		F3_mean_praat_base: 2910.22,
		F1_median_praat_base: 727.4,
		F2_median_praat_base: 1819.46,
		F3_median_praat_base: 2840.9
	},
	{
		index: 386,
		person_id: "MSVS0",
		sex: "M",
		duration_second: 0.0225,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 140.49,
		F1_mean_praat_base: 469.42,
		F2_mean_praat_base: 1650.54,
		F3_mean_praat_base: 2581.74,
		F1_median_praat_base: 469.42,
		F2_median_praat_base: 1650.54,
		F3_median_praat_base: 2581.74
	},
	{
		index: 387,
		person_id: "MMAB0",
		sex: "M",
		duration_second: 0.0256875,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 105.11,
		F1_mean_praat_base: 1106.01,
		F2_mean_praat_base: 2064.3,
		F3_mean_praat_base: 3294.43,
		F1_median_praat_base: 1106.01,
		F2_median_praat_base: 2064.3,
		F3_median_praat_base: 3294.43
	},
	{
		index: 388,
		person_id: "MLNS0",
		sex: "M",
		duration_second: 0.0275,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 146.08,
		F1_mean_praat_base: 498.65,
		F2_mean_praat_base: 1289.69,
		F3_mean_praat_base: 2798.49,
		F1_median_praat_base: 494.74,
		F2_median_praat_base: 1291.06,
		F3_median_praat_base: 2780.54
	},
	{
		index: 389,
		person_id: "MSRR0",
		sex: "M",
		duration_second: 0.048875,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 131.81,
		F1_mean_praat_base: 507.34,
		F2_mean_praat_base: 1937,
		F3_mean_praat_base: 2714.58,
		F1_median_praat_base: 459.03,
		F2_median_praat_base: 1957.89,
		F3_median_praat_base: 2810.74
	},
	{
		index: 390,
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
		index: 391,
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
	},
	{
		index: 392,
		person_id: "FJWB1",
		sex: "F",
		duration_second: 0.0170625,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 225.38,
		F1_mean_praat_base: 259.39,
		F2_mean_praat_base: 1939.01,
		F3_mean_praat_base: 2854.58,
		F1_median_praat_base: 259.39,
		F2_median_praat_base: 1939.01,
		F3_median_praat_base: 2854.58
	},
	{
		index: 393,
		person_id: "FJRB0",
		sex: "F",
		duration_second: 0.0259375,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 231.32,
		F1_mean_praat_base: 430.31,
		F2_mean_praat_base: 1709.78,
		F3_mean_praat_base: 3056.34,
		F1_median_praat_base: 430.31,
		F2_median_praat_base: 1709.78,
		F3_median_praat_base: 3056.34
	},
	{
		index: 394,
		person_id: "FDRW0",
		sex: "F",
		duration_second: 0.0370625,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 196.41,
		F1_mean_praat_base: 889.68,
		F2_mean_praat_base: 1755.31,
		F3_mean_praat_base: 3042.52,
		F1_median_praat_base: 976.23,
		F2_median_praat_base: 1785.39,
		F3_median_praat_base: 3053.46
	},
	{
		index: 395,
		person_id: "FCJF0",
		sex: "F",
		duration_second: 0.0404375,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 206.6,
		F1_mean_praat_base: 1095.7,
		F2_mean_praat_base: 1784.74,
		F3_mean_praat_base: 3048.24,
		F1_median_praat_base: 1018.81,
		F2_median_praat_base: 1767.53,
		F3_median_praat_base: 2987.76
	},
	{
		index: 396,
		person_id: "FVMH0",
		sex: "F",
		duration_second: 0.04625,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 215.07,
		F1_mean_praat_base: 758.37,
		F2_mean_praat_base: 2162.47,
		F3_mean_praat_base: 3188.13,
		F1_median_praat_base: 541.8,
		F2_median_praat_base: 2153.17,
		F3_median_praat_base: 3176.38
	},
	{
		index: 397,
		person_id: "FSMA0",
		sex: "F",
		duration_second: 0.03,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 207.91,
		F1_mean_praat_base: 395.79,
		F2_mean_praat_base: 1155.12,
		F3_mean_praat_base: 2881.54,
		F1_median_praat_base: 386.55,
		F2_median_praat_base: 1252.54,
		F3_median_praat_base: 2838.76
	},
	{
		index: 398,
		person_id: "FCAJ0",
		sex: "F",
		duration_second: 0.0168125,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 190.54,
		F1_mean_praat_base: 511.05,
		F2_mean_praat_base: 1749.78,
		F3_mean_praat_base: 2994.59,
		F1_median_praat_base: 511.05,
		F2_median_praat_base: 1749.78,
		F3_median_praat_base: 2994.59
	},
	{
		index: 399,
		person_id: "FDXW0",
		sex: "F",
		duration_second: 0.0254375,
		vowel_name: "ax-h",
		pitch_mean_praat_base: 190.45,
		F1_mean_praat_base: 757.47,
		F2_mean_praat_base: 2034.97,
		F3_mean_praat_base: 2824.72,
		F1_median_praat_base: 765.15,
		F2_median_praat_base: 2047.5,
		F3_median_praat_base: 2787
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
