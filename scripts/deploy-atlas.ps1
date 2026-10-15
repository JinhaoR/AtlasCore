#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$FirefoxDirectory = (Join-Path $env:ProgramFiles 'Mozilla Firefox'),
    [string]$NodePath,
    # Internal UAC handoff. This never disables verification or privilege checks.
    [Parameter(DontShow = $true)][string]$ElevationPlan
)

$ErrorActionPreference = 'Stop'
try {
    Import-Module (Join-Path $PSScriptRoot 'AtlasDeployment.psm1') -Force
    $atlasExpectedPlan = $null
    if ($ElevationPlan) {
        $atlasExpectedPlan = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ElevationPlan)) | ConvertFrom-Json
    }
    $atlasPlan = Get-AtlasDeploymentPlan -Version $Version -FirefoxDirectory $FirefoxDirectory -NodePath $NodePath
    if ($atlasExpectedPlan) {
        if (-not (Test-AtlasAdministrator)) { throw 'ELEVATION_REQUIRED: the UAC helper is not Administrator.' }
        Assert-AtlasPlanUnchanged $atlasPlan $atlasExpectedPlan
    }
    Show-AtlasDeploymentPlan $atlasPlan
    if ($atlasPlan.AlreadyDeployed) {
        Write-Host "Atlas $Version is already deployed; no files changed and no new backup."
        Show-AtlasActivationReminder $Version
    } elseif ($PSCmdlet.ShouldProcess($atlasPlan.TargetPath, "Back up the old XPI and atomically deploy verified Atlas $Version")) {
        if (Test-AtlasAdministrator) {
            $atlasResult = Install-AtlasPackage $atlasPlan
            Show-AtlasDeploymentResult $atlasPlan $atlasResult
        } else {
            Invoke-AtlasElevation $atlasPlan
        }
    } else {
        Write-Host "No changes made. Backup: $($atlasPlan.BackupPath)"
        Write-Host 'Would stage, verify, atomically replace, and verify the final XPI. No UAC requested.'
    }
} catch {
    Write-Error -ErrorAction Continue "Atlas deployment failed: $($_.Exception.Message)"
    if ($ElevationPlan) {
        $atlasStageCodes = @{ PREPARE = 44; BACKUP = 45; COPY = 46; REPLACE = 47; FINAL_VERIFY = 48 }
        $atlasFailedStage = $_.Exception.Data['AtlasDeploymentStage']
        if ($atlasFailedStage -and $atlasStageCodes.ContainsKey($atlasFailedStage)) { exit $atlasStageCodes[$atlasFailedStage] }
        exit 43
    }
    exit 1
}
