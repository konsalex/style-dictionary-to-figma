import * as esbuild from 'esbuild'

await esbuild.build({
    entryPoints: ['src/code.ts'],
    bundle: true,
    outfile: 'public/code.js',
})