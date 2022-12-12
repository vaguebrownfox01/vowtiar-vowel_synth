import path from 'path';
import { exportSignal } from './lib/makeVowel';
import * as fs from 'fs';

// CHECK PATHS BEFORE RUNING
import _formants from './data/c_timit-vowels_formant_estimation_vowlim100.json';

let exportFolder =
    '/home/jeevan/Desktop/Jeevan_K/Projects/Vowtiar-Quest/vowtiar-formant_estimation/vowtiar-vowel_synth/src/data/audio_exports';
const pyMakewavHelper =
    '/home/jeevan/Desktop/Jeevan_K/Projects/Vowtiar-Quest/vowtiar-formant_estimation/vowtiar-vowel_synth/src/helper/makewav2';

if (!fs.existsSync(exportFolder)) {
    fs.mkdirSync(exportFolder);
}

interface Data {
    schema: {
        fields: Array<{ name: string; type: string }>;
        pandas_version: string;
    };
    data: Array<{
        index: number;
        person_id: string;
        sex: string;
        duration_second: number;
        vowel_name: string;
        pitch_mean_praat_base: number;
        F1_mean_praat_base: number;
        F2_mean_praat_base: number;
        F3_mean_praat_base: number;
        F1_median_praat_base: number;
        F2_median_praat_base: number;
        F3_median_praat_base: number;
    }>;
}

const data: Data = _formants;
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
    ].join('_');

    let formantArray = [
        f['F1_mean_praat_base'],
        f['F2_mean_praat_base'],
        f['F3_mean_praat_base'],
    ];

    let expPath = path.join(exportFolder, fileName);

    console.log(fileName, `; ${formants.length - i - 1} remaining`);

    exportSignal(pitch, formantArray, expPath, pyMakewavHelper);

    // if (i > 5) break;
}
