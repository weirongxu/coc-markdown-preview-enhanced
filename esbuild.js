/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
// @ts-check

const isWatch = process.argv.length > 2 && process.argv[2] === '--watch'

async function start() {
  const ctx = await require('esbuild').context({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV === 'development',
    mainFields: ['module', 'main'],
    external: ['coc.nvim', '@shd101wyy/mume'],
    platform: 'node',
    target: 'node14.14',
    outfile: 'lib/index.js',
    plugins: [
      {
        name: 'my-watch-plugin',
        setup(build) {
          build.onEnd(() => {
            console.log('built', new Date().toLocaleString())
          })
        },
      },
    ],
  })

  if (isWatch) {
    await ctx.watch()
    console.log('watching...')
  } else {
    await ctx.rebuild()
    await ctx.dispose()
  }
}

start().catch((e) => {
  console.error(e)
})
