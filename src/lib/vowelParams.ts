import * as KlattSyn from 'klatt-syn';

export interface AppParms {
    mParms: KlattSyn.MainParms;
    fParmsA: KlattSyn.FrameParms[];
    fadingDuration: number;
    windowFunctionId: string;
    reference?: string;
}

const defaultMainParms: KlattSyn.MainParms = {
    sampleRate: 44100,
    glottalSourceType: KlattSyn.GlottalSourceType.natural,
};

const defaultFrameParms: KlattSyn.FrameParms = {
    duration: 3,
    f0: 247, // 220,
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

    // Cascade branch:
    cascadeEnabled: true,
    cascadeVoicingDb: 0,
    cascadeAspirationDb: -25,
    cascadeAspirationMod: 0.5,
    nasalAntiformantFreq: NaN,
    nasalAntiformantBw: NaN,

    // Parallel branch:
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

const defaultAppParms: AppParms = {
    mParms: defaultMainParms,
    fParmsA: [defaultFrameParms],
    fadingDuration: 0.05,
    windowFunctionId: 'hann',
};

function decodeGlottalSourceType(s: string): KlattSyn.GlottalSourceType {
    const i = KlattSyn.glottalSourceTypeEnumNames.indexOf(s);
    if (i < 0) {
        throw new Error(`Unknown glottal source type "${s}".`);
    }
    return i;
}

export function getMyAudioParms(
    sampleRate: number,
    duration: number,
    pitch: number,
    formants: Array<number>,
    formantsBw: Array<number>,
    formantsDb: Array<number>
): AppParms {
    const appParms = defaultAppParms;

    // Main parameters:
    const mParms = defaultMainParms;
    appParms.mParms = mParms;
    mParms.sampleRate = sampleRate;
    mParms.glottalSourceType = decodeGlottalSourceType('natural');

    // Frame parameters:
    const fParms = defaultFrameParms;
    appParms.fParmsA = [fParms]; // temporary solution for a single frame
    fParms.duration = duration;
    fParms.f0 = pitch;
    fParms.oralFormantFreq = formants;
    fParms.oralFormantBw = formantsBw;
    fParms.oralFormantDb = formantsDb;

    return appParms;
}
