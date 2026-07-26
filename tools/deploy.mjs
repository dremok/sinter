/**
 * Deploy what is COMMITTED, not what happens to be on disk.
 *
 * `railway up` uploads the working directory. That is fine when one person is
 * typing and actively dangerous when several agents are editing the tree at
 * once: the deploy ships whatever existed at the instant the upload ran,
 * including half-finished work nobody reviewed and files that are not in any
 * commit. Caught it by comparing the deployed bundle hash against a local
 * build made ninety seconds earlier and finding they differed.
 *
 * This project has already shipped one incident of exactly that shape: debug
 * geometry in primary colours reached production because an unrelated `git add
 * -A` swept up an agent's work in progress. Uploading the working tree is the
 * same mistake with no commit step to notice it.
 *
 * So: export HEAD to a scratch directory and deploy from there. What is
 * deployed is then always something with a commit hash, which means it can be
 * reproduced, bisected and rolled back.
 *
 *   node tools/deploy.mjs            deploy HEAD
 *   node tools/deploy.mjs --dry      export and build only, do not upload
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DRY = process.argv.includes('--dry')
const SERVICE = 'sinter'

const run = (cmd, args, cwd = ROOT, opts = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', ...opts }).trim()

const head = run('git', ['rev-parse', '--short', 'HEAD'])
const subject = run('git', ['log', '-1', '--format=%s'])
const dirty = run('git', ['status', '--porcelain'])

console.log(`deploying ${head}  "${subject}"`)
if (dirty) {
  // Not an error. With several agents working this is the normal state, and the
  // whole point of the tool is that their work in progress does NOT ship.
  const n = dirty.split('\n').length
  console.log(`  ${n} uncommitted file(s) in the working tree, none of which will be deployed`)
}

const stage = mkdtempSync(join(tmpdir(), 'sinter-deploy-'))
try {
  // `git archive` writes exactly the committed tree: no node_modules, no
  // .shots, no scratch files, nothing gitignored, nothing uncommitted.
  const tar = join(stage, 'head.tar')
  run('git', ['archive', '--format=tar', '-o', tar, 'HEAD'])
  run('tar', ['-xf', tar, '-C', stage])
  rmSync(tar)

  console.log('  installing...')
  run('npm', ['ci', '--no-audit', '--no-fund'], stage)

  // Build here rather than trusting the remote builder, so a broken build is a
  // local failure with readable output instead of a red deploy.
  console.log('  building...')
  run('npm', ['run', 'build'], stage)
  console.log('  build ok')

  if (DRY) {
    console.log(`  dry run, staged at ${stage}`)
    process.exit(0)
  }

  // Railway remembers which project a DIRECTORY belongs to, and the staging
  // directory is new every time, so it has to be told. Read the association
  // from the repo rather than hardcoding ids, so this keeps working if the
  // project is ever recreated.
  const link = JSON.parse(run('cat', [join(homedir(), '.railway', 'config.json')]))
  const repo = link.projects?.[ROOT]
  if (!repo) throw new Error(`railway has no link for ${ROOT}. Run \`railway link\` there first.`)
  run('railway', ['link', '-p', repo.project, '-e', repo.environmentName ?? 'production', '-s', SERVICE], stage)

  console.log('  uploading...')
  const out = run('railway', ['up', '--detach', '--service', SERVICE], stage, {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  console.log(out)
  console.log(`\ndeployed ${head}. Now go and LOOK at it:  npm run verify:deploy`)
} finally {
  if (!DRY) rmSync(stage, { recursive: true, force: true })
}
