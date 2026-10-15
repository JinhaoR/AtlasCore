import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { inspectPackage, verifiedRelease } from '../atlas-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { unzipSync, zipSync } = createRequire(new URL('../../extension/package.json', import.meta.url))('fflate');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const powershell = process.env.ATLAS_TEST_POWERSHELL || 'powershell.exe';
const fixtures = await mkdtemp(join(root, '.tools/deployment-tests-'));
const oldName = (await readdir(join(root, 'extension/release/0.1.14/signed'))).find(n => n.endsWith('.xpi'));
const newName = (await readdir(join(root, 'extension/release/0.1.15/signed'))).find(n => n.endsWith('.xpi'));
const oldBytes = await readFile(join(root, 'extension/release/0.1.14/signed', oldName));
const newBytes = await readFile(join(root, 'extension/release/0.1.15/signed', newName));
const oldHash = digest(oldBytes), newHash = digest(newBytes);

async function fixture({ isolatedSource = false, current = oldBytes } = {}) {
  const directory = await mkdtemp(join(fixtures, 'Firefox path with spaces-'));
  const distribution = join(directory, 'distribution');
  await mkdir(distribution);
  const target = join(distribution, 'atlas.xpi');
  const policyPath = join(distribution, 'policies.json');
  const policy = { policies: { ExtensionSettings: {
    'atlas-development@atlas.invalid': { installation_mode: 'force_installed', install_url: pathToFileURL(target).href },
    'another@extension.invalid': { installation_mode: 'blocked' },
  }, DisableTelemetry: true } };
  await writeFile(join(directory, 'firefox.exe'), 'isolated existence fixture, never executed');
  await writeFile(policyPath, JSON.stringify(policy));
  if (current) await writeFile(target, current);
  let source = root;
  if (isolatedSource) {
    source = await mkdtemp(join(fixtures, "source ' ; spaces-"));
    await cp(join(root, 'scripts'), join(source, 'scripts'), { recursive: true });
    await mkdir(join(source, 'extension/scripts'), { recursive: true });
    for (const name of ['release.mjs', 'verify-bundle.mjs']) await cp(join(root, 'extension/scripts', name), join(source, 'extension/scripts', name));
    await cp(join(root, 'extension/package.json'), join(source, 'extension/package.json'));
    await cp(join(root, 'extension/node_modules/fflate'), join(source, 'extension/node_modules/fflate'), { recursive: true });
    await cp(join(root, 'extension/release/0.1.15'), join(source, 'extension/release/0.1.15'), { recursive: true });
  }
  return { directory, distribution, target, policyPath, policy, source,
    backup: join(distribution, 'atlas-backups/atlas-0.1.14-backup.xpi') };
}

function ps(f, body, { mocked = true, version = '0.1.15' } = {}) {
  const data = Buffer.from(JSON.stringify({ ...f, node: process.execPath, version })).toString('base64');
  const code = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$f = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$module = Import-Module (Join-Path $f.source 'scripts/AtlasDeployment.psm1') -Force -PassThru
${mocked ? `& $module { function script:Test-AtlasAdministrator { $true }; function script:Test-AtlasFirefoxRunning { $false } }` : ''}
try {
${body}
} catch { Write-Output ('ERROR: ' + $_.Exception.Message); exit 1 }
`;
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}
const plan = '$plan = Get-AtlasDeploymentPlan -Version $f.version -FirefoxDirectory $f.directory -NodePath $f.node';
const install = `${plan}\nInstall-AtlasPackage $plan | ConvertTo-Json -Compress`;
const hashFile = async path => digest(await readFile(path));
async function unchanged(f) { assert.equal(await hashFile(f.target), oldHash); assert.equal(await readFile(f.policyPath, 'utf8'), JSON.stringify(f.policy)); }
function succeeds(result) { assert.equal(result.status, 0, result.output); }
function rejects(result, reason) { assert.equal(result.status, 1, result.output); assert.match(result.output, reason); }

test('existing offline verifier validates the real signed 0.1.15 without credentials', async () => {
  const result = await verifiedRelease('0.1.15');
  assert.equal(result.sha256, newHash); assert.equal(result.addonId, 'atlas-development@atlas.invalid');
  assert.equal(result.verified, true); assert.equal(result.runtimeFileCount, 14);
});
test('invalid versions fail before paths or UAC are used', async () => {
  const f = await fixture();
  for (const version of ['../0.1.15', '00.1.15', '0.1', '0.1.65536']) rejects(ps(f, plan, { version }), /VERSION_INVALID/);
  await unchanged(f);
});
test('missing release fails without creating it', async () => {
  const f = await fixture(); rejects(ps(f, plan, { version: '99.99.99' }), /RELEASE_MISSING/); await unchanged(f);
});
test('missing and ambiguous signed packages fail closed', async () => {
  for (const count of [0, 2]) {
    const f = await fixture({ isolatedSource: true });
    const signed = join(f.source, 'extension/release/0.1.15/signed');
    // Fixtures only. Rename the original out of selection; never edit repository artifacts.
    const { rename } = await import('node:fs/promises');
    await rename(join(signed, newName), join(signed, 'preserved.fixture'));
    for (let i = 0; i < count; ++i) await writeFile(join(signed, `${i}.xpi`), newBytes);
    rejects(ps(f, plan), /SIGNED_XPI_AMBIGUOUS/); await unchanged(f);
  }
});
test('uppercase extra XPI and XPI directories cannot hide ambiguity', async () => {
  for (const kind of ['uppercase', 'directory']) {
    const f = await fixture({ isolatedSource: true });
    const extra = join(f.source, 'extension/release/0.1.15/signed', kind === 'uppercase' ? 'extra.XPI' : 'extra.xpi');
    if (kind === 'uppercase') await writeFile(extra, newBytes); else await mkdir(extra);
    rejects(ps(f, plan), /SIGNED_XPI_AMBIGUOUS/); await unchanged(f);
  }
});
test('signed runtime modification, wrong embedded ID and version fail verification', async () => {
  for (const mutation of ['runtime', 'id', 'version', 'signature']) {
    const f = await fixture({ isolatedSource: true });
    const files = unzipSync(newBytes);
    if (mutation === 'runtime') files['background.js'] = Buffer.from('changed runtime');
    else if (mutation === 'signature') delete files['META-INF/mozilla.rsa'];
    else {
      const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
      if (mutation === 'id') manifest.browser_specific_settings.gecko.id = 'wrong@identity.invalid';
      else manifest.version = '0.1.16';
      files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
    }
    await writeFile(join(f.source, 'extension/release/0.1.15/signed', newName), zipSync(files));
    rejects(ps(f, plan), /PACKAGE_VERIFICATION_FAILED|ARCHIVE_CONTENT_MISMATCH|SIGNED_METADATA_MISSING/); await unchanged(f);
  }
});
test('existing wrong identity or malformed package cannot be overwritten', async () => {
  const files = unzipSync(oldBytes), manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  manifest.browser_specific_settings.gecko.id = 'other@id.invalid'; files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
  for (const current of [zipSync(files), Buffer.from('not an archive')]) {
    const f = await fixture({ current }); rejects(ps(f, plan), /PACKAGE_VERIFICATION_FAILED|PACKAGE_ID_MISMATCH/);
    assert.equal(await hashFile(f.target), digest(current));
  }
});
test('missing installation, distribution and policy fail without creating configuration', async () => {
  const f = await fixture();
  const { rename } = await import('node:fs/promises');
  await rename(join(f.directory, 'firefox.exe'), join(f.directory, 'firefox.fixture')); rejects(ps(f, plan), /FIREFOX_MISSING/);
  await rename(join(f.directory, 'firefox.fixture'), join(f.directory, 'firefox.exe'));
  await rename(f.distribution, join(f.directory, 'distribution.fixture')); rejects(ps(f, plan), /DISTRIBUTION_MISSING/);
  await rename(join(f.directory, 'distribution.fixture'), f.distribution);
  await rename(f.policyPath, `${f.policyPath}.fixture`); rejects(ps(f, plan), /POLICY_MISSING/);
  await rename(`${f.policyPath}.fixture`, f.policyPath); await unchanged(f);
});
test('incompatible policies are rejected and never edited', async () => {
  const variants = [
    '{invalid', '{}',
    JSON.stringify({ policies: { ExtensionSettings: { 'ATLAS-development@atlas.invalid': { installation_mode: 'force_installed' } } } }),
    ...['normal_installed', 'FORCE_INSTALLED'].map(mode => JSON.stringify({ policies: { ExtensionSettings: { 'atlas-development@atlas.invalid': { installation_mode: mode, install_url: 'file:///C:/wrong.xpi' } } } })),
    ...['https://example.invalid/atlas.xpi', 'file://server/share/atlas.xpi', 'file:///C:/wrong.xpi'].map(url => JSON.stringify({ policies: { ExtensionSettings: { 'atlas-development@atlas.invalid': { installation_mode: 'force_installed', install_url: url } } } })),
  ];
  for (const contents of variants) {
    const f = await fixture(); await writeFile(f.policyPath, contents); rejects(ps(f, plan), /POLICY_INVALID|POLICY_INCOMPATIBLE/);
    assert.equal(await readFile(f.policyPath, 'utf8'), contents); assert.equal(await hashFile(f.target), oldHash);
  }
});
test('Firefox running prevents deployment; it is never terminated', async () => {
  const f = await fixture(); rejects(ps(f, `& $module { function script:Test-AtlasFirefoxRunning { $true } }; ${plan}`), /FIREFOX_RUNNING/); await unchanged(f);
  assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});
test('lack of Administrator prevents any writer changes', async () => {
  const f = await fixture(); rejects(ps(f, `${plan}; & $module { function script:Test-AtlasAdministrator { $false } }; Install-AtlasPackage $plan`), /ELEVATION_REQUIRED/); await unchanged(f);
  assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});
test('UAC cancellation and elevation failure leave target untouched', async () => {
  for (const mock of [
    `function script:Start-AtlasElevatedProcess { throw [ComponentModel.Win32Exception]::new(1223) }`,
    `function script:Start-AtlasElevatedProcess { throw 'access denied' }`,
  ]) {
    const f = await fixture(); rejects(ps(f, `${plan}; & $module { ${mock} }; Invoke-AtlasElevation $plan`), /UAC_CANCELLED|ELEVATION_FAILED/); await unchanged(f);
  }
});
test('version comparison rejects downgrade and changed bytes at the same version', async () => {
  const f = await fixture({ current: newBytes }); rejects(ps(f, plan, { version: '0.1.14' }), /DOWNGRADE_REJECTED/);
  const files = unzipSync(newBytes); files['background.js'] = Buffer.from('same version different bytes');
  await writeFile(f.target, zipSync(files)); rejects(ps(f, plan), /SAME_VERSION_DIFFERENT_PACKAGE/);
});
test('already-deployed exact bytes are a no-op, including while Firefox is open', async () => {
  const f = await fixture({ current: newBytes });
  succeeds(ps(f, `& $module { function script:Test-AtlasFirefoxRunning { $true } }; ${plan}; if (-not $plan.AlreadyDeployed) { throw 'not recognized' }`));
  assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});
test('valid signed update with spaces uses verified backup and exact replacement', async () => {
  const f = await fixture(); succeeds(ps(f, install));
  assert.equal(await hashFile(f.target), newHash); assert.equal(await hashFile(f.backup), oldHash);
  assert.equal(await readFile(f.policyPath, 'utf8'), JSON.stringify(f.policy));
  succeeds(ps(f, `${plan}; if (-not $plan.AlreadyDeployed) { throw 'not idempotent' }`));
  assert.deepEqual(await readdir(join(f.distribution, 'atlas-backups')), ['atlas-0.1.14-backup.xpi']);
});
test('missing managed XPI can be deployed only with an existing compatible policy', async () => {
  const f = await fixture({ current: null }); succeeds(ps(f, install)); assert.equal(await hashFile(f.target), newHash);
  assert.ok(!(await readdir(f.distribution)).includes('atlas-backups'));
});
test('backup collision is rejected and an identical backup can be reused', async () => {
  const f = await fixture(); await mkdir(join(f.distribution, 'atlas-backups')); await writeFile(f.backup, 'conflict');
  rejects(ps(f, plan), /BACKUP_COLLISION/); await unchanged(f); assert.equal(await readFile(f.backup, 'utf8'), 'conflict');
  await writeFile(f.backup, oldBytes); succeeds(ps(f, install)); assert.equal(await hashFile(f.backup), oldHash);
});
test('copy and atomic replace failures preserve the previous package', async () => {
  for (const mock of [
    `function script:Copy-AtlasVerifiedFile { throw 'simulated access denied during copy' }`,
    `function script:Replace-AtlasFile { throw 'simulated replace failure' }`,
  ]) {
    const f = await fixture(); rejects(ps(f, `${plan}; & $module { ${mock} }; Install-AtlasPackage $plan`), /DEPLOYMENT_FAILED.*(COPY|BACKUP|REPLACE)/); await unchanged(f);
    assert.ok(!(await readdir(f.distribution)).some(n => n.startsWith('.atlas-stage-')));
  }
});
test('staged hash mismatch refuses replacement', async () => {
  const f = await fixture();
  rejects(ps(f, `${plan}; & $module { $script:originalHash = (Get-Command Get-AtlasHash).ScriptBlock; function script:Get-AtlasHash($Path) { if ([IO.Path]::GetFileName($Path).StartsWith('.atlas-stage-')) { return 'bad' }; & $script:originalHash $Path } }; Install-AtlasPackage $plan`), /STAGED_HASH_MISMATCH/); await unchanged(f);
});
test('final hash failure restores and verifies only the on-disk previous package', async () => {
  const f = await fixture();
  const result = ps(f, `${plan}; & $module { function script:Replace-AtlasFile($Source, $Destination) { [IO.File]::Replace($Source, $Destination, [Management.Automation.Language.NullString]::Value); if ([IO.Path]::GetFileName($Source).StartsWith('.atlas-stage-')) { [IO.File]::WriteAllText($Destination, 'bad replacement') } } }; Install-AtlasPackage $plan`);
  rejects(result, /FINAL_HASH_MISMATCH.*previous on-disk XPI was restored and hash-verified/); await unchanged(f); assert.equal(await hashFile(f.backup), oldHash);
});
test('failed restoration is reported without claiming rollback', async () => {
  const f = await fixture();
  rejects(ps(f, `${plan}; & $module { function script:Replace-AtlasFile($Source, $Destination) { if ([IO.Path]::GetFileName($Source).StartsWith('.atlas-restore-')) { throw 'restore failed' }; [IO.File]::Replace($Source, $Destination, [Management.Automation.Language.NullString]::Value); [IO.File]::WriteAllText($Destination, 'bad') } }; Install-AtlasPackage $plan`), /Recovery not verified: restore failed/);
  assert.equal(await hashFile(f.backup), oldHash);
});
test('changed target, policy and source since preflight stop before replacement', async () => {
  for (const field of ['target', 'policy', 'source']) {
    const f = await fixture({ isolatedSource: field === 'source' });
    const mutate = field === 'target' ? `[IO.File]::WriteAllText($plan.TargetPath, 'external change')` : field === 'policy' ? `[IO.File]::AppendAllText($plan.PolicyPath, ' ')` : `[IO.File]::AppendAllText($plan.SourcePath, 'changed')`;
    rejects(ps(f, `${plan}; ${mutate}; Install-AtlasPackage $plan`), /PREFLIGHT_CHANGED|PACKAGE_VERIFICATION_FAILED|VERIFIED_RELEASE_CHANGED|SAME_VERSION_DIFFERENT_PACKAGE|PACKAGE_ID_MISMATCH|invalid zip data/);
    if (field !== 'target') assert.equal(await hashFile(f.target), oldHash);
    assert.ok(!(await readdir(f.distribution)).includes('atlas-backups'));
  }
});
test('policy or Firefox becoming unavailable immediately before replacement fails closed', async () => {
  const f = await fixture();
  rejects(ps(f, `${plan}; & $module { $script:checks = 0; function script:Test-AtlasFirefoxRunning { $script:checks++; return $script:checks -ge 3 } }; Install-AtlasPackage $plan`), /FIREFOX_RUNNING/); await unchanged(f);
});
test('elevation plan rejects stale source, target, policy and tool hashes', async () => {
  const f = await fixture();
  for (const field of ['SourceHash', 'CurrentHash', 'PolicyHash', 'Version']) rejects(ps(f, `${plan}; $expected = ($plan | ConvertTo-Json -Depth 6 | ConvertFrom-Json); $expected.${field} = 'changed'; Assert-AtlasPlanUnchanged $plan $expected`), /PREFLIGHT_CHANGED/);
  rejects(ps(f, `${plan}; $expected = ($plan | ConvertTo-Json -Depth 6 | ConvertFrom-Json); $expected.ToolHashes[0].Sha256 = 'changed'; Assert-AtlasPlanUnchanged $plan $expected`), /DEPLOYMENT_TOOLS_CHANGED/); await unchanged(f);
});
test('encoded UAC handoff treats paths as data and changed tools are rejected before execution', async () => {
  const f = await fixture({ isolatedSource: true });
  const result = ps(f, `${plan}; & $module { function script:Start-AtlasElevatedProcess($Executable, $EncodedCommand) {
    $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($EncodedCommand))
    if ($text.Contains($script:Repository)) { throw 'raw path in code' }
    $tool = Join-Path $script:Repository 'scripts/deploy-atlas.ps1'; [IO.File]::AppendAllText($tool, ' ')
    & $Executable -NoProfile -ExecutionPolicy RemoteSigned -EncodedCommand $EncodedCommand
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE }
  } }; Invoke-AtlasElevation $plan`);
  rejects(result, /DEPLOYMENT_TOOLS_CHANGED/); await unchanged(f);
});
test('elevated success is independently checked by the parent', async () => {
  const f = await fixture();
  rejects(ps(f, `${plan}; & $module { function script:Start-AtlasElevatedProcess { return [pscustomobject]@{ ExitCode = 0 } } }; Invoke-AtlasElevation $plan`), /ELEVATED_RESULT_UNVERIFIED/); await unchanged(f);
});
test('interrupted staging and lock files do not defeat safe retry or create extra backups', async () => {
  const f = await fixture(); await mkdir(join(f.distribution, 'atlas-backups'));
  await writeFile(f.backup, oldBytes); await writeFile(join(f.distribution, '.atlas-stage-interrupted.xpi'), 'partial');
  await writeFile(join(f.distribution, 'atlas-backups/.atlas-backup-interrupted.tmp'), 'partial');
  await writeFile(join(f.distribution, '.atlas-deploy.lock'), 'stale lock file');
  succeeds(ps(f, install)); assert.equal(await hashFile(f.target), newHash); assert.equal(await hashFile(f.backup), oldHash);
  succeeds(ps(f, `${plan}; if (-not $plan.AlreadyDeployed) { throw 'not a no-op' }`));
  assert.equal((await readdir(join(f.distribution, 'atlas-backups'))).filter(n => n.endsWith('.xpi')).length, 1);
});
test('an active deployment lock blocks concurrent writers', async () => {
  const f = await fixture();
  rejects(ps(f, `${plan}; $lock = [IO.File]::Open((Join-Path $f.distribution '.atlas-deploy.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); try { Install-AtlasPackage $plan } finally { $lock.Dispose() }`), /DEPLOYMENT_FAILED.*PREPARE/); await unchanged(f);
});
test('real process interruption before and after replacement leaves a safely retryable package', async () => {
  for (const afterReplace of [false, true]) {
    const f = await fixture();
    const result = ps(f, `${plan}; & $module { function script:Replace-AtlasFile($Source, $Destination) {
      ${afterReplace ? '[IO.File]::Replace($Source, $Destination, [Management.Automation.Language.NullString]::Value)' : ''}
      [Environment]::Exit(70)
    } }; Install-AtlasPackage $plan`);
    assert.equal(result.status, 70, result.output); assert.equal(await hashFile(f.target), afterReplace ? newHash : oldHash);
    assert.equal(await hashFile(f.backup), oldHash);
    succeeds(ps(f, install)); assert.equal(await hashFile(f.target), newHash); assert.equal(await hashFile(f.backup), oldHash);
  }
});
test('UAC success reports a hash-verified deployment and leaves the policy unchanged', async () => {
  const f = await fixture();
  const result = ps(f, `${plan}; & $module { param($p) $script:testElevationPlan = $p; function script:Start-AtlasElevatedProcess { Install-AtlasPackage $script:testElevationPlan | Out-Null; return [pscustomobject]@{ ExitCode = 0 } } } $plan; Invoke-AtlasElevation $plan`);
  succeeds(result); assert.match(result.output, /deployed successfully on disk/); assert.match(result.output, /activation has not been checked/);
  assert.equal(await hashFile(f.target), newHash); assert.equal(await hashFile(f.backup), oldHash); assert.equal(await readFile(f.policyPath, 'utf8'), JSON.stringify(f.policy));
});
test('public WhatIf verifies a signed release but creates no files or UAC', async () => {
  const f = await fixture();
  const result = ps(f, `function global:Get-Process { param($Name, $Id) if ($Name -eq 'firefox') { return }; Microsoft.PowerShell.Management\\Get-Process -Id $Id }; & (Join-Path $f.source 'scripts/deploy-atlas.ps1') -Version $f.version -FirefoxDirectory $f.directory -NodePath $f.node -WhatIf`, { mocked: false });
  succeeds(result); assert.match(result.output, /Signed release:.*Verified/); assert.match(result.output, /No changes made/); assert.doesNotMatch(result.output, /Requesting Windows UAC/); await unchanged(f);
  assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});
test('ordinary inspector reports manifest identity rather than filename', async () => {
  const f = await fixture(); const misleading = join(f.directory, 'atlas-99.99.99.xpi'); await writeFile(misleading, oldBytes);
  assert.equal((await inspectPackage(misleading)).version, '0.1.14');
});
test('a forged writer plan cannot change identity, verification hash or backup location', async () => {
  const f = await fixture();
  for (const field of ['SourceHash', 'BackupDirectory', 'AlreadyDeployed']) rejects(ps(f, `${plan}; $plan.${field} = 'forged'; Install-AtlasPackage $plan`), /PREFLIGHT_CHANGED/);
  await unchanged(f); assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});
test('writer independently rejects a modified signed release after plan creation', async () => {
  const f = await fixture({ isolatedSource: true });
  rejects(ps(f, `${plan}; [IO.File]::WriteAllText($plan.SourcePath, 'invalid'); $plan.SourceHash = (Get-FileHash -LiteralPath $plan.SourcePath -Algorithm SHA256).Hash.ToLowerInvariant(); Install-AtlasPackage $plan`), /PACKAGE_VERIFICATION_FAILED|invalid zip data/);
  await unchanged(f); assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});
test('native encoded UAC bootstrap reaches the real entrypoint with held tool files', async () => {
  // Matching bytes make this probe read-only even under an Administrator host.
  const f = await fixture({ current: newBytes });
  const result = ps(f, `${plan}; & $module { function script:Start-AtlasElevatedProcess($Executable, $EncodedCommand) {
    $ErrorActionPreference = 'Continue'
    $childOutput = & $Executable -NoProfile -ExecutionPolicy RemoteSigned -EncodedCommand $EncodedCommand 2>&1
    $childCode = $LASTEXITCODE
    Write-Host ($childOutput -join "\n")
    if ($childCode -notin @(0, 43)) { throw ('unexpected bootstrap exit: ' + $childCode) }
    # End this handshake probe before the parent's replacement-result checks.
    return [pscustomobject]@{ ExitCode = 43 }
  } }; Invoke-AtlasElevation $plan`);
  rejects(result, /ELEVATED_DEPLOYMENT_FAILED/);
  assert.match(result.output, /ELEVATION_REQUIRED|already deployed/);
  assert.equal(await hashFile(f.target), newHash); assert.equal(await readFile(f.policyPath, 'utf8'), JSON.stringify(f.policy));
  assert.deepEqual((await readdir(f.distribution)).sort(), ['atlas.xpi', 'policies.json']);
});

console.log(`Isolated deployment fixtures: ${fixtures}`);
