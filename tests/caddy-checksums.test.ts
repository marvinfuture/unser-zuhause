import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test(
  "Windows verifies Caddy SHA-256 and SHA-512 manifests and rejects malformed or ambiguous sums",
  { skip: process.platform !== "win32" },
  () => {
    const script = fileURLToPath(new URL("../scripts/Setup-Https.ps1", import.meta.url));
    // Führt nur die Prüfsummenfunktion aus. Der Test installiert keine Software und verändert keine Netzwerkeinstellungen.
    const command = `
    $ErrorActionPreference='Stop'
    $tree=[Management.Automation.Language.Parser]::ParseFile($env:Z_TEST_SETUP,[ref]$null,[ref]$null)
    $definition=$tree.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-ZuhauseCaddyChecksum'},$true)
    . ([scriptblock]::Create($definition.Extent.Text))
    $path=[IO.Path]::GetTempFileName()
    try {
      [IO.File]::WriteAllBytes($path,[byte[]](1,4,8,16))
      $name='caddy_1_windows_amd64.zip'
      $sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
      $sha512=(Get-FileHash -Algorithm SHA512 -LiteralPath $path).Hash.ToLowerInvariant()
      Assert-ZuhauseCaddyChecksum $path $name ("$sha256  $name")
      Assert-ZuhauseCaddyChecksum $path $name ("$sha512 *$name")
      $invalid=@("$(('0'*32))  $name","$(('0'*64))  $name","$(('z'*128))  $name","$sha256  another-$name",("$sha256  $name" + '.sig'),("$sha256  $name" + [Environment]::NewLine + "$sha512  $name"),("$sha256  $name" + [Environment]::NewLine + "unknown  $name"))
      foreach($value in $invalid) {
        $rejected=$false
        try { Assert-ZuhauseCaddyChecksum $path $name $value } catch { $rejected=$true }
        if(-not $rejected){throw 'Invalid manifest accepted'}
      }
    } finally { Remove-Item -LiteralPath $path -Force }
  `;
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      {
        env: { ...process.env, Z_TEST_SETUP: script },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, result.stderr);
  },
);
