#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:AtlasId = 'atlas-development@atlas.invalid'
$script:Repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:Bridge = Join-Path $PSScriptRoot 'atlas-release.mjs'

function Assert-AtlasLocalPath([string]$Path) {
    $absolute = [IO.Path]::GetFullPath($Path)
    if ($absolute.StartsWith('\\') -or $absolute.Substring(2).Contains(':')) { throw 'LOCAL_PATH_REQUIRED: network paths and alternate streams are not supported.' }
    $cursor = $absolute
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $entry = Get-Item -LiteralPath $cursor -Force
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "REPARSE_POINT_REJECTED: $cursor" }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $absolute
}

function Get-AtlasHash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-AtlasNode([string]$NodePath) {
    if (-not $NodePath) {
        $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
        if (-not $command) { throw 'NODE_REQUIRED: install Node 24+ and the existing extension dependencies, or pass -NodePath.' }
        $NodePath = $command.Source
    }
    $path = Assert-AtlasLocalPath $NodePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'NODE_REQUIRED: executable not found.' }
    return $path
}

function Invoke-AtlasPackageCheck([string]$NodePath, [string]$Operation, [string]$Argument) {
    # Call operator with separate arguments, never Invoke-Expression or command text.
    $nodeOptions = $env:NODE_OPTIONS; $nodeLookup = $env:NODE_PATH
    try {
        $env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
        $output = & $NodePath $script:Bridge $Operation $Argument
        if ($LASTEXITCODE -ne 0) { throw 'PACKAGE_VERIFICATION_FAILED: see the offline verifier error above.' }
    } finally { $env:NODE_OPTIONS = $nodeOptions; $env:NODE_PATH = $nodeLookup }
    try { $result = ($output -join "`n") | ConvertFrom-Json } catch { throw 'PACKAGE_VERIFICATION_UNCERTAIN: invalid verifier response.' }
    if (-not $result -or $result.addonId -cne $script:AtlasId -or $result.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'PACKAGE_VERIFICATION_UNCERTAIN: missing identity or hash.' }
    if ($Operation -ceq 'verify' -and ($result.verified -ne $true -or $result.version -cne $Argument)) { throw 'PACKAGE_VERIFICATION_UNCERTAIN: no verified release.' }
    return $result
}

function Test-AtlasVersion([string]$Version) {
    return $Version -cmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -and
        @($Version.Split('.') | Where-Object { [double]$_ -gt 65535 }).Count -eq 0
}

function Test-AtlasFirefoxRunning {
    return @(Get-Process -Name firefox -ErrorAction SilentlyContinue).Count -gt 0
}

function Test-AtlasAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } finally { $identity.Dispose() }
}

function Assert-AtlasPolicy([string]$PolicyPath, [string]$TargetPath) {
    if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) { throw 'POLICY_MISSING: no existing distribution/policies.json; policy will not be created.' }
    Assert-AtlasLocalPath $PolicyPath | Out-Null
    try { $policy = [IO.File]::ReadAllText($PolicyPath) | ConvertFrom-Json } catch { throw 'POLICY_INVALID: policies.json is not valid JSON.' }
    try {
        $entries = @($policy.policies.ExtensionSettings.PSObject.Properties | Where-Object { $_.Name -ceq $script:AtlasId })
        if ($entries.Count -ne 1) { throw 'missing Atlas ID' }
        $atlas = $entries[0].Value
        if ($atlas.installation_mode -cne 'force_installed') { throw 'wrong installation mode' }
        $uri = [Uri]$atlas.install_url
        if (-not $uri.IsAbsoluteUri -or -not $uri.IsFile -or $uri.IsUnc -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw 'not an unambiguous local file URL' }
        $localPath = Assert-AtlasLocalPath $uri.LocalPath
        if (-not [string]::Equals($localPath, $TargetPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'install_url targets a different file' }
    } catch { throw "POLICY_INCOMPATIBLE: Atlas must be force_installed from the selected distribution/atlas.xpi ($($_.Exception.Message)). Policy was not changed." }
    return Get-AtlasHash $PolicyPath
}

function Get-AtlasToolHashes([string]$NodePath) {
    $paths = @((Join-Path $PSScriptRoot 'deploy-atlas.ps1'), (Join-Path $PSScriptRoot 'AtlasDeployment.psm1'), $script:Bridge,
        (Join-Path $script:Repository 'extension/scripts/release.mjs'), (Join-Path $script:Repository 'extension/scripts/verify-bundle.mjs'),
        (Join-Path $script:Repository 'extension/node_modules/fflate/lib/node.cjs'),
        (Join-Path $script:Repository 'extension/node_modules/fflate/esm/index.mjs'),
        (Join-Path $script:Repository 'extension/node_modules/fflate/package.json'), $NodePath)
    return @($paths | ForEach-Object { $path = Assert-AtlasLocalPath $_; [pscustomobject]@{ Path = $path; Sha256 = Get-AtlasHash $path } })
}

function Get-AtlasDeploymentPlan {
    param([string]$Version, [string]$FirefoxDirectory, [string]$NodePath)
    if (-not (Test-AtlasVersion $Version)) { throw 'VERSION_INVALID: use three numeric components, each 0..65535, without leading zeros.' }
    $firefox = Assert-AtlasLocalPath $FirefoxDirectory
    if (-not (Test-Path -LiteralPath (Join-Path $firefox 'firefox.exe') -PathType Leaf)) { throw 'FIREFOX_MISSING: select an existing installation with -FirefoxDirectory.' }
    Assert-AtlasLocalPath (Join-Path $firefox 'firefox.exe') | Out-Null
    $distribution = Join-Path $firefox 'distribution'
    if (-not (Test-Path -LiteralPath $distribution -PathType Container)) { throw 'DISTRIBUTION_MISSING: an existing managed installation is required.' }
    Assert-AtlasLocalPath $distribution | Out-Null
    $target = Assert-AtlasLocalPath (Join-Path $distribution 'atlas.xpi')
    $policyPath = Join-Path $distribution 'policies.json'
    $policyHash = Assert-AtlasPolicy $policyPath $target
    $release = Join-Path $script:Repository "extension/release/$Version"
    if (-not (Test-Path -LiteralPath $release -PathType Container)) { throw 'RELEASE_MISSING: build and sign separately; deployment never creates a release.' }
    Assert-AtlasLocalPath $release | Out-Null
    $signedDirectory = Join-Path $release 'signed'
    if (-not (Test-Path -LiteralPath $signedDirectory -PathType Container)) { throw 'SIGNED_XPI_MISSING' }
    Assert-AtlasLocalPath $signedDirectory | Out-Null
    $packages = @(Get-ChildItem -LiteralPath $signedDirectory -Force | Where-Object { $_.Name -match '\.xpi$' })
    if ($packages.Count -ne 1 -or $packages[0].PSIsContainer -or -not $packages[0].Name.EndsWith('.xpi', [StringComparison]::Ordinal)) { throw 'SIGNED_XPI_AMBIGUOUS: exactly one lowercase .xpi is required.' }
    $selected = Assert-AtlasLocalPath $packages[0].FullName
    $node = Get-AtlasNode $NodePath
    $tools = Get-AtlasToolHashes $node
    $verified = Invoke-AtlasPackageCheck $node 'verify' $Version
    if (-not [string]::Equals($verified.path, $selected, [StringComparison]::OrdinalIgnoreCase) -or (Get-AtlasHash $selected) -cne $verified.sha256) { throw 'VERIFIED_RELEASE_CHANGED' }
    $currentVersion = $null
    $currentHash = $null
    if (Test-Path -LiteralPath $target) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'TARGET_INVALID: atlas.xpi is not a file.' }
        $current = Invoke-AtlasPackageCheck $node 'inspect' $target
        $currentVersion = $current.version
        $currentHash = $current.sha256
        if ([version]$Version -lt [version]$currentVersion) { throw "DOWNGRADE_REJECTED: deployed $currentVersion is newer than $Version." }
        if ($Version -ceq $currentVersion -and $currentHash -cne $verified.sha256) { throw 'SAME_VERSION_DIFFERENT_PACKAGE: prepare a new signed version instead.' }
    }
    $already = $currentHash -ceq $verified.sha256
    # An exact no-op is safe while Firefox is open; any replacement requires closure.
    if (-not $already -and (Test-AtlasFirefoxRunning)) { throw 'FIREFOX_RUNNING: close Firefox completely, then rerun. No processes were stopped.' }
    $backupDirectory = Assert-AtlasLocalPath (Join-Path $distribution 'atlas-backups')
    $backup = $null
    if ($currentVersion) {
        $backup = Assert-AtlasLocalPath (Join-Path $backupDirectory "atlas-$currentVersion-backup.xpi")
        if (-not $already -and (Test-Path -LiteralPath $backup) -and (Get-AtlasHash $backup) -cne $currentHash) { throw "BACKUP_COLLISION: preserve or move the conflicting backup yourself: $backup" }
    }
    return [pscustomobject][ordered]@{
        Version = $Version; FirefoxDirectory = $firefox; NodePath = $node; SourcePath = $selected; SourceHash = $verified.sha256
        TargetPath = $target; PolicyPath = $policyPath; PolicyHash = $policyHash; CurrentVersion = $currentVersion; CurrentHash = $currentHash
        BackupDirectory = $backupDirectory; BackupPath = $backup; AlreadyDeployed = $already; ToolHashes = $tools
    }
}

function Assert-AtlasPlanUnchanged($Actual, $Expected) {
    foreach ($field in @('Version', 'FirefoxDirectory', 'NodePath', 'SourcePath', 'SourceHash', 'TargetPath', 'PolicyPath', 'PolicyHash', 'CurrentVersion', 'CurrentHash', 'BackupDirectory', 'BackupPath', 'AlreadyDeployed')) {
        if ($Actual.$field -cne $Expected.$field) { throw "PREFLIGHT_CHANGED: $field changed since verification; rerun from your normal terminal." }
    }
    if (($Actual.ToolHashes | ConvertTo-Json -Compress) -cne ($Expected.ToolHashes | ConvertTo-Json -Compress)) { throw 'DEPLOYMENT_TOOLS_CHANGED: rerun preflight.' }
}

function Show-AtlasDeploymentPlan($Plan) {
    Write-Host "`nAtlas Windows Deployment`n"
    Write-Host "Requested version: $($Plan.Version)"
    $current = if ($Plan.CurrentVersion) { $Plan.CurrentVersion } else { '(no managed package on disk)' }
    Write-Host "Current package:   $current"
    Write-Host 'Firefox policy:    Verified (read-only)'
    Write-Host 'Signed release:    Verified against frozen artifacts'
    Write-Host "Source SHA-256:    $($Plan.SourceHash)"
    Write-Host "Target:            $($Plan.TargetPath)"
    Write-Host 'Back up your live Atlas configuration first: docs/firefox-backup.md.'
    Write-Host 'Firefox will verify the cryptographic signature when it loads the XPI.'
}

function Copy-AtlasVerifiedFile([string]$Source, [string]$Destination, [string]$ExpectedHash) {
    $inputFile = $null; $outputFile = $null
    try {
        $inputFile = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $outputFile = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $inputFile.CopyTo($outputFile)
        $outputFile.Flush($true)
    } finally {
        if ($outputFile) { $outputFile.Dispose() }
        if ($inputFile) { $inputFile.Dispose() }
    }
    if ((Get-AtlasHash $Destination) -cne $ExpectedHash) { throw "STAGED_HASH_MISMATCH: $Destination" }
}

function Move-AtlasFile([string]$Source, [string]$Destination) { [IO.File]::Move($Source, $Destination) }
function Replace-AtlasFile([string]$Source, [string]$Destination) {
    # PS 5.1 converts $null to an empty string for this .NET string parameter.
    # NullString preserves a real null; our verified backup already exists.
    [IO.File]::Replace($Source, $Destination, [Management.Automation.Language.NullString]::Value)
}

function Assert-AtlasWriteInputs($Plan) {
    foreach ($entry in $Plan.ToolHashes) {
        Assert-AtlasLocalPath $entry.Path | Out-Null
        if ((Get-AtlasHash $entry.Path) -cne $entry.Sha256) { throw 'DEPLOYMENT_TOOLS_CHANGED' }
    }
    foreach ($path in @($Plan.SourcePath, $Plan.TargetPath, $Plan.PolicyPath, $Plan.BackupDirectory)) { Assert-AtlasLocalPath $path | Out-Null }
    if ((Get-AtlasHash $Plan.SourcePath) -cne $Plan.SourceHash -or (Assert-AtlasPolicy $Plan.PolicyPath $Plan.TargetPath) -cne $Plan.PolicyHash) { throw 'PREFLIGHT_CHANGED: source or policy changed.' }
    $targetHash = if (Test-Path -LiteralPath $Plan.TargetPath -PathType Leaf) { Get-AtlasHash $Plan.TargetPath } else { $null }
    if ($targetHash -cne $Plan.CurrentHash) { throw 'PREFLIGHT_CHANGED: deployed package changed.' }
    if (Test-AtlasFirefoxRunning) { throw 'FIREFOX_RUNNING: close Firefox completely and rerun.' }
}

function Install-AtlasPackage($Plan) {
    if (-not (Test-AtlasAdministrator)) { throw 'ELEVATION_REQUIRED: no deployment writes were attempted.' }
    # The writer also enforces full verification; importing this module and
    # constructing a plan never provides a way around signed-release validation.
    $verifiedPlan = Get-AtlasDeploymentPlan -Version $Plan.Version -FirefoxDirectory $Plan.FirefoxDirectory -NodePath $Plan.NodePath
    Assert-AtlasPlanUnchanged $verifiedPlan $Plan
    if ($Plan.AlreadyDeployed) { return [pscustomobject]@{ BackupPath = $null; AlreadyDeployed = $true } }
    $lock = $null; $policyLock = $null; $sourceLock = $null
    $stage = $null; $backupStage = $null; $restoreStage = $null; $replaced = $false
    $stageName = 'PREPARE'
    try {
        Assert-AtlasWriteInputs $Plan
        $lockPath = Assert-AtlasLocalPath (Join-Path $Plan.FirefoxDirectory 'distribution/.atlas-deploy.lock')
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        # Hold these files read-only throughout the write transaction.
        $policyLock = [IO.File]::Open($Plan.PolicyPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $sourceLock = [IO.File]::Open($Plan.SourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        Assert-AtlasWriteInputs $Plan
        $stageName = 'BACKUP'
        if ($Plan.BackupPath) {
            [IO.Directory]::CreateDirectory($Plan.BackupDirectory) | Out-Null
            Assert-AtlasLocalPath $Plan.BackupPath | Out-Null
            if (Test-Path -LiteralPath $Plan.BackupPath) {
                if ((Get-AtlasHash $Plan.BackupPath) -cne $Plan.CurrentHash) { throw 'BACKUP_COLLISION: existing backup was not overwritten.' }
            } else {
                $backupStage = Join-Path $Plan.BackupDirectory ('.atlas-backup-' + [Guid]::NewGuid().ToString('N') + '.tmp')
                Copy-AtlasVerifiedFile $Plan.TargetPath $backupStage $Plan.CurrentHash
                Move-AtlasFile $backupStage $Plan.BackupPath
            }
        }
        $stageName = 'COPY'
        $stage = Join-Path (Split-Path -Parent $Plan.TargetPath) ('.atlas-stage-' + [Guid]::NewGuid().ToString('N') + '.xpi')
        Copy-AtlasVerifiedFile $Plan.SourcePath $stage $Plan.SourceHash
        Assert-AtlasWriteInputs $Plan
        $stageName = 'REPLACE'
        if ($Plan.CurrentHash) { Replace-AtlasFile $stage $Plan.TargetPath } else { Move-AtlasFile $stage $Plan.TargetPath }
        $replaced = $true
        $stageName = 'FINAL_VERIFY'
        if ((Get-AtlasHash $Plan.TargetPath) -cne $Plan.SourceHash) { throw 'FINAL_HASH_MISMATCH' }
        if ((Get-AtlasHash $Plan.PolicyPath) -cne $Plan.PolicyHash) { throw 'POLICY_CHANGED' }
        return [pscustomobject]@{ BackupPath = $Plan.BackupPath; AlreadyDeployed = $false }
    } catch {
        $cause = $_.Exception.Message
        $status = 'The target could not be inspected; inspect the managed file and backup before retrying.'
        try {
            $observed = if (Test-Path -LiteralPath $Plan.TargetPath -PathType Leaf) { Get-AtlasHash $Plan.TargetPath } else { $null }
            if ($observed -ceq $Plan.CurrentHash) { $status = 'The previous on-disk package is unchanged.' }
            elseif ($observed -ceq $Plan.SourceHash) { $status = 'The verified new package is on disk; Firefox activation remains unverified.' }
            elseif ($replaced -and $Plan.BackupPath -and -not (Test-AtlasFirefoxRunning)) {
                Assert-AtlasLocalPath $Plan.TargetPath | Out-Null
                Assert-AtlasLocalPath $Plan.BackupPath | Out-Null
                $restoreStage = Join-Path (Split-Path -Parent $Plan.TargetPath) ('.atlas-restore-' + [Guid]::NewGuid().ToString('N') + '.xpi')
                Copy-AtlasVerifiedFile $Plan.BackupPath $restoreStage $Plan.CurrentHash
                if ((Get-AtlasHash $Plan.TargetPath) -cne $observed) { throw 'Target changed during recovery; it was not overwritten.' }
                Replace-AtlasFile $restoreStage $Plan.TargetPath
                if ((Get-AtlasHash $Plan.TargetPath) -cne $Plan.CurrentHash) { throw 'Restored bytes did not match the previous package.' }
                $status = 'The previous on-disk XPI was restored and hash-verified. Firefox activation/storage rollback is unverified.'
            } else { $status = 'The target is not a verified old/new package; no unsafe restoration was attempted.' }
        } catch { $status = "Recovery not verified: $($_.Exception.Message) Backup: $($Plan.BackupPath)" }
        $failure = New-Object InvalidOperationException("DEPLOYMENT_FAILED [$stageName]: $cause $status")
        $failure.Data['AtlasDeploymentStage'] = $stageName
        throw $failure
    } finally {
        foreach ($stream in @($sourceLock, $policyLock, $lock)) { if ($stream) { $stream.Dispose() } }
        # Only this invocation's unique files, never wildcard or recursive cleanup.
        foreach ($path in @($stage, $backupStage, $restoreStage)) {
            if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
                try { Assert-AtlasLocalPath $path | Out-Null; [IO.File]::Delete($path) } catch { Write-Warning "Temporary file retained: $path" }
            }
        }
    }
}

function Start-AtlasElevatedProcess([string]$Executable, [string]$EncodedCommand, [string]$ExecutionPolicy) {
    # Preserve the caller's effective script policy for this child only. Never
    # change a saved execution policy or select Bypass as an elevation shortcut.
    return Start-Process -FilePath $Executable -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', $ExecutionPolicy, '-EncodedCommand', $EncodedCommand) -WindowStyle Hidden -Wait -PassThru
}

function Invoke-AtlasElevation($Plan) {
    $planJson = $Plan | ConvertTo-Json -Compress -Depth 6
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($planJson))
    # Payload is base64, so no user-controlled path can become executable syntax.
    $bootstrap = @'
$ErrorActionPreference = 'Stop'
$toolLocks = @()
try {
    $payload = '__PAYLOAD__'
    $plan = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    foreach ($tool in $plan.ToolHashes) {
        $toolLocks += [IO.File]::Open($tool.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        if ((Get-FileHash -LiteralPath $tool.Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $tool.Sha256) { exit 41 }
    }
    $parameters = @{ Version = $plan.Version; FirefoxDirectory = $plan.FirefoxDirectory; NodePath = $plan.NodePath; ElevationPlan = $payload }
    & $plan.ToolHashes[0].Path @parameters
    exit 0
} catch { exit 43 } finally { foreach ($toolLock in $toolLocks) { $toolLock.Dispose() } }
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap.Replace('__PAYLOAD__', $payload)))
    $executable = (Get-Process -Id $PID).Path
    Write-Host 'Requesting Windows UAC for this deployment. The helper will repeat verification before writing.'
    try { $process = Start-AtlasElevatedProcess $executable $encoded ([string](Get-ExecutionPolicy)) } catch {
        $error = $_.Exception
        while ($error.InnerException) { $error = $error.InnerException }
        if ($error -is [ComponentModel.Win32Exception] -and $error.NativeErrorCode -eq 1223) { throw 'UAC_CANCELLED: deployment was not started.' }
        throw 'ELEVATION_FAILED: no automatic permission changes attempted. Open PowerShell as Administrator and rerun the same command.'
    }
    if ($process.ExitCode -ne 0) {
        $state = 'The on-disk state could not be verified.'
        try {
            $hash = Get-AtlasHash $Plan.TargetPath
            if ($hash -ceq $Plan.CurrentHash) { $state = 'The previous on-disk package is present.' }
            elseif ($hash -ceq $Plan.SourceHash) { $state = 'The verified new package is on disk; activation is unverified.' }
        } catch { }
        if ($process.ExitCode -eq 41) { throw 'DEPLOYMENT_TOOLS_CHANGED: UAC helper refused to execute changed tools.' }
        $stages = @{ 44 = 'PREPARE'; 45 = 'BACKUP'; 46 = 'COPY'; 47 = 'REPLACE'; 48 = 'FINAL_VERIFY' }
        $stage = if ($stages.ContainsKey([int]$process.ExitCode)) { $stages[[int]$process.ExitCode] } else { 'PREFLIGHT/VERIFICATION' }
        throw "ELEVATED_DEPLOYMENT_FAILED [$stage]: $state Backup: $($Plan.BackupPath) Rerun in Administrator PowerShell for detailed diagnostics; no browser activation is claimed."
    }
    if ((Get-AtlasHash $Plan.TargetPath) -cne $Plan.SourceHash -or (Assert-AtlasPolicy $Plan.PolicyPath $Plan.TargetPath) -cne $Plan.PolicyHash) { throw 'ELEVATED_RESULT_UNVERIFIED: managed file or policy differs.' }
    if ($Plan.BackupPath -and (Get-AtlasHash $Plan.BackupPath) -cne $Plan.CurrentHash) { throw 'BACKUP_RESULT_UNVERIFIED' }
    Show-AtlasDeploymentResult $Plan ([pscustomobject]@{ BackupPath = $Plan.BackupPath; AlreadyDeployed = $false })
}

function Show-AtlasActivationReminder([string]$Version) {
    Write-Host "`nFirefox activation has not been checked. Restart Firefox and verify:"
    Write-Host "- about:addons shows Atlas $Version"
    Write-Host '- about:policies shows no errors'
    Write-Host '- Atlas settings, destinations, pins and drafts are intact'
    Write-Host 'Keep the same extension ID and profile; do not uninstall Atlas to update.'
}

function Show-AtlasDeploymentResult($Plan, $Result) {
    Write-Host "`nAtlas $($Plan.Version) deployed successfully on disk."
    if ($Result.BackupPath) { Write-Host "Previous XPI preserved: $($Result.BackupPath)" }
    Write-Host 'Deployed SHA-256 matches the verified signed release. Firefox policy unchanged.'
    Show-AtlasActivationReminder $Plan.Version
}

Export-ModuleMember -Function Get-AtlasDeploymentPlan, Assert-AtlasPlanUnchanged, Test-AtlasAdministrator, Show-AtlasDeploymentPlan, Install-AtlasPackage, Invoke-AtlasElevation, Show-AtlasDeploymentResult, Show-AtlasActivationReminder
