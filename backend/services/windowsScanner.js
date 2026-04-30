const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scanViaWiaWithRetry(outputPath, attempts = 3, delayMs = 2000) {
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runPowerShellScan(outputPath)
    } catch (error) {
      lastError = error
      const message = String(error?.message || error)
      const retryable = /busy|online|denied|access is denied|unspecified error/i.test(message)
      if (!retryable || attempt === attempts) {
        throw error
      }
      await sleep(delayMs * attempt)
    }
  }

  throw lastError || new Error('WIA_SCAN_FAILED')
}

function runPowerShellScan(outputPath) {
  return new Promise((resolve, reject) => {
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$savePath = '${escapePowerShellSingleQuoted(outputPath)}'`,
      '$manager = New-Object -ComObject WIA.DeviceManager',
      '$scanner = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 }) | Select-Object -First 1',
      'if ($null -eq $scanner) { throw "NO_WIA_SCANNER_FOUND" }',
      '$device = $null',
      'try { $device = $scanner.Create() } catch { $device = $scanner.Connect() }',
      'if ($null -eq $device) { throw "SCAN_DEVICE_CONNECT_FAILED" }',
      'function Find-TransferItem($item) {',
      '  if ($null -eq $item) { return $null }',
      '  try {',
      '    if ($item.PSObject.Methods.Name -contains "Transfer") { return $item }',
      '  } catch {}',
      '  try {',
      '    foreach ($child in @($item.Children)) {',
      '      $found = Find-TransferItem $child',
      '      if ($null -ne $found) { return $found }',
      '    }',
      '  } catch {}',
      '  return $null',
      '}',
      '$scanItem = Find-TransferItem $device',
      'if ($null -eq $scanItem) { throw "SCAN_TRANSFER_ITEM_NOT_FOUND" }',
      '$transferOk = $false',
      'try {',
      '  $null = $scanItem.Transfer($savePath, $false)',
      '  $transferOk = $true',
      '} catch {}',
      'if (-not $transferOk) { throw "SCAN_TRANSFER_FAILED" }',
      'if (-not (Test-Path $savePath)) { throw "SCAN_SAVE_FAILED" }',
      'Write-Output $savePath',
    ].join('\n');

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('SCAN_TIMEOUT'));
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const out = stdout.trim();
      const err = stderr.trim();

      if (code !== 0) {
        const message = err || out || `Scanner process exited with code ${code}`;
        reject(new Error(message));
        return;
      }

      resolve(out || outputPath);
    });
  });
}

function runPowerShellJson(script, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('POWERSHELL_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const out = stdout.trim();
      const err = stderr.trim();

      if (code !== 0) {
        const message = err || out || `PowerShell exited with code ${code}`;
        reject(new Error(message));
        return;
      }

      resolve(out);
    });
  });
}

function resolveNaps2ConsolePath() {
  const candidates = [
    process.env.NAPS2_CONSOLE_PATH,
    'C:\\Users\\hp\\Desktop\\NAPS2\\NAPS2.Console.exe',
    'C:\\Program Files\\NAPS2\\NAPS2.Console.exe',
    'C:\\Program Files (x86)\\NAPS2\\NAPS2.Console.exe',
    'C:\\scan-flask-test\\dist\\NAPS2.Console.exe',
    'C:\\Users\\hp\\Desktop\\NAPS2\\NAPS2.Console\\NAPS2.Console.exe',
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return ''
}

function resolveNaps2ProfileName() {
  const candidates = [
    process.env.NAPS2_PROFILE_NAME,
    'C:\\Users\\hp\\Desktop\\NAPS2\\profiles.xml',
    path.join(process.env.APPDATA || '', 'NAPS2', 'profiles.xml'),
  ]

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue

    try {
      const xml = fs.readFileSync(candidate, 'utf8')
      const defaultProfileMatch = xml.match(/<ScanProfile>[\s\S]*?<IsDefault>true<\/IsDefault>[\s\S]*?<DisplayName>([^<]+)<\/DisplayName>[\s\S]*?<\/ScanProfile>/i)
      if (defaultProfileMatch?.[1]) {
        return defaultProfileMatch[1].trim()
      }

      const firstProfileMatch = xml.match(/<ScanProfile>[\s\S]*?<DisplayName>([^<]+)<\/DisplayName>/i)
      if (firstProfileMatch?.[1]) {
        return firstProfileMatch[1].trim()
      }
    } catch {}
  }

  return 'CANON DR-M160 USB #3'
}

function runCommand(exePath, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('SCANNER_TIMEOUT'))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      const out = stdout.trim()
      const err = stderr.trim()

      if (code !== 0) {
        const detail = [err, out].filter(Boolean).join(' | ')
        reject(new Error(detail || `Scanner process exited with code ${code}`))
        return
      }

      resolve({ stdout: out, stderr: err, code })
    })
  })
}

function parseScannerList(output = '', driver = 'twain') {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name, index) => ({
      deviceId: `${driver}:${index}:${name}`,
      name,
      displayName: name,
      deviceName: name,
      deviceDescription: name,
      description: '',
      manufacturer: '',
      uiClsid: '',
      type: 1,
      isScanner: true,
      driver,
    }))
}

function pickPreferredScanner(devices = []) {
  if (!Array.isArray(devices) || devices.length === 0) return null

  const byCanonDr = devices.find((device) => /DR-M160/i.test(device.displayName || device.name || ''))
  if (byCanonDr) return byCanonDr

  const byCanon = devices.find((device) => /Canon/i.test(device.displayName || device.name || ''))
  if (byCanon) return byCanon

  return devices[0]
}

async function listTwainDevicesViaNaps2() {
  const exePath = resolveNaps2ConsolePath()
  if (!exePath) return null

  const { stdout } = await runCommand(exePath, ['--driver', 'twain', '--listdevices'], 30000)
  const devices = parseScannerList(stdout, 'twain')

  return {
    source: 'naps2',
    driver: 'twain',
    consolePath: exePath,
    success: true,
    devices,
    scannerCount: devices.length,
  }
}

async function listWiaDevices() {
  const twainResult = await listTwainDevicesViaNaps2().catch(() => null)
  if (twainResult && Array.isArray(twainResult.devices) && twainResult.devices.length > 0) {
    return twainResult
  }

  const script = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  $manager = New-Object -ComObject WIA.DeviceManager',
    '  $devices = @()',
    '  $index = 0',
    '  foreach ($deviceInfo in @($manager.DeviceInfos)) {',
    '    $index += 1',
    '    $deviceId = ""',
    '    $deviceName = ""',
    '    $deviceDescription = ""',
    '    $description = ""',
    '    $manufacturer = ""',
    '    $uiClsid = ""',
    '    try { $deviceId = [string]$deviceInfo.DeviceID } catch {}',
    '    try { $deviceName = [string]$deviceInfo.Name } catch {}',
    '    try { $deviceDescription = [string]$deviceInfo.GetPropById(4) } catch {}',
    '    try { $manufacturer = [string]$deviceInfo.GetPropById(3) } catch {}',
    '    try { $uiClsid = [string]$deviceInfo.UIClsid } catch {}',
    '    $type = 0',
    '    try { $type = [int]$deviceInfo.Type } catch {}',
    '    try {',
    '      $device = $deviceInfo.Connect()',
    '      try { $displayName = [string]$device.Properties.Item("Name").Value } catch {}',
    '      try { $description = [string]$device.Properties.Item("Description").Value } catch {}',
    '      try { $manufacturer = [string]$device.Properties.Item("Manufacturer").Value } catch {}',
    '      if (-not $displayName) { try { $displayName = [string]$device.GetPropById(7) } catch {} }',
    '      if (-not $description) { try { $description = [string]$device.GetPropById(4) } catch {} }',
    '      if (-not $manufacturer) { try { $manufacturer = [string]$device.GetPropById(3) } catch {} }',
    '    } catch {}',
    '    $displayName = $deviceName',
    '    if (-not $displayName) { $displayName = $deviceDescription }',
    '    if (-not $displayName) { $displayName = $description }',
    '    if (-not $displayName) { $displayName = $manufacturer }',
    '    if (-not $displayName) { $displayName = "WIA Scanner #$index" }',
    '    $devices += [pscustomobject]@{',
    '      deviceId = $deviceId',
      '      name = $displayName',
      '      displayName = $displayName',
    '      deviceName = $deviceName',
    '      deviceDescription = $deviceDescription',
    '      description = $description',
    '      manufacturer = $manufacturer',
    '      uiClsid = $uiClsid',
    '      type = $type',
    '      isScanner = [bool]($type -eq 1)',
    '    }',
    '  }',
    '  [pscustomobject]@{',
    '    success = $true',
    '    devices = $devices',
    '    scannerCount = @($devices | Where-Object { $_.isScanner }).Count',
    '  } | ConvertTo-Json -Depth 4 -Compress',
    '} catch {',
    '  [pscustomobject]@{',
    '    success = $false',
    '    error = [string]$_.Exception.Message',
    '    devices = @()',
    '    scannerCount = 0',
    '  } | ConvertTo-Json -Depth 4 -Compress',
    '}',
  ].join('\n');

  const raw = await runPowerShellJson(script, 30000);
  if (!raw) {
    return {
      success: false,
      devices: [],
      scannerCount: 0,
      error: 'EMPTY_WIA_RESPONSE',
    };
  }

  const parsed = JSON.parse(raw);
  return {
    success: Boolean(parsed?.success),
    devices: Array.isArray(parsed?.devices) ? parsed.devices : [],
    scannerCount: Number(parsed?.scannerCount || 0),
    error: parsed?.error || '',
  };
}

async function scanDocumentImage(options = {}) {
  const outputDir = path.join(__dirname, '..', 'uploads', 'scans');
  fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `scan-${Date.now()}.jpg`;
  const outputPath = path.join(outputDir, fileName);
  const mode = String(options?.mode || 'fast').toLowerCase();
  const isAccurateMode = mode === 'accurate' || mode === 'quality' || mode === 'document';

  const twainResult = await listTwainDevicesViaNaps2().catch(() => null)
  const naps2ConsolePath = resolveNaps2ConsolePath()
  const profileName = resolveNaps2ProfileName()

  if (naps2ConsolePath && profileName) {
    const args = [
      '--profile', profileName,
      '--output', outputPath,
      '--force',
      '--verbose',
    ]

    try {
      const result = await runCommand(naps2ConsolePath, args, 180000)

      if (!fs.existsSync(outputPath)) {
        const scanText = `${result.stdout || ''} ${result.stderr || ''}`
        if (/no pages in feeder|لا توجد صفحات في المغذي|no scanned pages to export/i.test(scanText)) {
          throw new Error('NO_PAGES_IN_FEEDER')
        }
        throw new Error(`SCAN_SAVE_FAILED: ${scanText.trim() || 'output file not found'}`)
      }

      return {
        fileName,
        filePath: outputPath,
        publicUrl: `/uploads/scans/${fileName}`,
        source: 'naps2-profile',
        driver: 'wia',
        profileName,
        mode: isAccurateMode ? 'accurate' : 'fast',
      }
    } catch (error) {
      const text = String(error?.message || error)
      if (/no pages in feeder|لا توجد صفحات في المغذي|no scanned pages to export/i.test(text)) {
        throw new Error('NO_PAGES_IN_FEEDER')
      }
    }
  }

  if (twainResult && Array.isArray(twainResult.devices) && twainResult.devices.length > 0) {
    const selected = pickPreferredScanner(twainResult.devices)
    if (!selected) throw new Error('NO_TWAIN_SCANNER_FOUND')

    const dpi = isAccurateMode ? '300' : '200'
    // Some Canon TWAIN drivers report "invalid stride" in gray mode, so use color.
    const bitdepth = 'color'

    const args = [
      '--driver', 'twain',
      '--device', selected.displayName || selected.name,
      '--source', 'feeder',
      '--number', '1',
      '--dpi', dpi,
      '--bitdepth', bitdepth,
      '--verbose',
      '--output', outputPath,
      '--force',
      '--noprofile',
    ]

    try {
      await runCommand(twainResult.consolePath, args, 180000)
    } catch (error) {
      const twainError = String(error?.message || error)

      try {
        await sleep(3000)
        const savedPath = await scanViaWiaWithRetry(outputPath)
        return {
          fileName,
          filePath: savedPath,
          publicUrl: `/uploads/scans/${fileName}`,
          source: 'wia',
          driver: 'wia',
          fallbackFrom: 'twain',
          twainError,
        }
      } catch (wiaError) {
        const wiaDetail = String(wiaError?.message || wiaError)
        throw new Error(`NAPS2_SCAN_FAILED: ${twainError} | WIA_FALLBACK_FAILED: ${wiaDetail}`)
      }
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('SCAN_SAVE_FAILED')
    }

    return {
      fileName,
      filePath: outputPath,
      publicUrl: `/uploads/scans/${fileName}`,
      source: 'twain',
      driver: 'twain',
      deviceName: selected.displayName || selected.name,
      mode: isAccurateMode ? 'accurate' : 'fast',
      dpi: Number(dpi),
    }
  }

  const savedPath = await scanViaWiaWithRetry(outputPath);

  return {
    fileName,
    filePath: savedPath,
    publicUrl: `/uploads/scans/${fileName}`,
    source: 'wia',
    driver: 'wia',
  };
}

module.exports = {
  listWiaDevices,
  listTwainDevicesViaNaps2,
  scanDocumentImage,
};
