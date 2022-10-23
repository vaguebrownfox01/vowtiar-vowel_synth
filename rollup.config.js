import resolve from 'rollup-plugin-node-resolve';
import json from '@rollup/plugin-json';

export default {
    input: '_tempbuild/index.js',
    // browser: false,
    output: {
        file: 'synthvow.js',
        // format: "iife",
        // preferBuiltins: false,
    },
    plugins: [
        resolve({
            browser: false,
            preferBuiltins: true,
        }),
        json(),
    ],
};

// // "test": "tsc && node --experimental-json-modules tempBuild/index.js"
