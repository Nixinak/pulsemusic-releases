// electron-builder afterSign hook: VMP-sign the packaged app with castLabs EVS.
// One-time setup: npm run evs:setup  (creates a free castLabs EVS account / signs in)
const { execSync } = require('node:child_process')

exports.default = async function evsSign(context) {
  const dir = context.appOutDir
  const python = process.platform === 'win32' ? 'py -3' : 'python3'
  console.log(`\n[evs] VMP-signing ${dir}`)
  try {
    execSync(`${python} -m castlabs_evs.vmp sign-pkg "${dir}"`, { stdio: 'inherit' })
    console.log('[evs] signed\n')
  } catch {
    console.warn(
      '\n[evs] WARNING: VMP signing failed. The installer will be built, but Spotify playback\n' +
        '      will not work in it. Run "npm run evs:setup" once, then build again.\n'
    )
  }
}
