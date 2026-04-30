const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const { extractStructuredFields } = require('./unloadingFieldReader');

const RAW_OCR_TIMEOUT_MS = Number(process.env.UNLOADING_FAST_OCR_TIMEOUT_MS || 120000);

function resolvePythonCommand() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function parseLastJsonLine(stdout = '') {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lastJsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!lastJsonLine) {
    throw new Error('No JSON object found in stdout');
  }

  return JSON.parse(lastJsonLine);
}

function runRawPythonOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const projectRoot = path.resolve(__dirname, '..');
    const scriptPath = path.join(projectRoot, 'python', 'ocr_worker.py');
    const pythonCmd = resolvePythonCommand();

    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let finished = false;

    const py = spawn(pythonCmd, [scriptPath, imagePath], {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      py.kill('SIGKILL');
      reject(new Error(`Raw OCR timed out after ${RAW_OCR_TIMEOUT_MS}ms`));
    }, RAW_OCR_TIMEOUT_MS);

    py.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    py.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    py.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to start Raw OCR process: ${error.message}`));
    });

    py.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (code !== 0) {
        return reject(
          new Error(
            [
              `Raw OCR process exited with code ${code}`,
              `STDERR:\n${stderr || '(empty)'}`,
              `STDOUT:\n${stdout || '(empty)'}`,
            ].join('\n')
          )
        );
      }

      try {
        const parsed = parseLastJsonLine(stdout);
        resolve({
          ...parsed,
          meta: {
            ...(parsed?.meta || {}),
            durationMs: Date.now() - startedAt,
            pythonCommand: pythonCmd,
            scriptPath,
            rawPath: true,
          },
        });
      } catch (error) {
        reject(
          new Error(
            [
              'Failed to parse Raw OCR JSON response.',
              `STDERR:\n${stderr || '(empty)'}`,
              `STDOUT:\n${stdout || '(empty)'}`,
              `Parse error: ${error.message}`,
            ].join('\n')
          )
        );
      }
    });
  });
}

async function runFastOcr(imagePath, templateName = 'unloading-template') {
  if (!imagePath || typeof imagePath !== 'string') {
    throw new Error('runFastOcr requires a valid image file path');
  }

  const startedAt = Date.now();
  const [structured, raw] = await Promise.all([
    fs.readFile(imagePath).then((buffer) => extractStructuredFields(buffer, templateName)),
    runRawPythonOcr(imagePath).catch((error) => ({
      success: false,
      message: error.message,
      meta: { rawPath: false },
    })),
  ]);

  const merged = {
    ...(structured || {}),
    ...(raw || {}),
    success: true,
    documentNumber: structured?.documentNumber || raw?.documentNumber || '',
    documentType: structured?.documentType || raw?.documentType || '',
    loadingWarehouseName: structured?.loadingWarehouseName || raw?.loadingWarehouseName || '',
    issueDate: structured?.issueDate || raw?.issueDate || '',
    receiverEntity: structured?.receiverEntity || raw?.receiverEntity || '',
    vehicleNumberRaw: structured?.vehicleNumberRaw || raw?.vehicleNumberRaw || '',
    vehicleNumber: structured?.vehicleNumber || raw?.vehicleNumber || '',
    vehicleGovernorate: structured?.vehicleGovernorate || raw?.vehicleGovernorate || '',
    driverName: raw?.driverName || structured?.driverName || '',
    suppliedQuantityLiters: Math.max(
      Number(structured?.suppliedQuantityLiters || 0),
      Number(raw?.suppliedQuantityLiters || 0)
    ),
    rawText: raw?.rawText || structured?.rawText || '',
    debug: {
      structured: structured?.debug || {},
      raw: raw?.debug || {},
    },
    meta: {
      ...(structured?.meta || {}),
      ...(raw?.meta || {}),
      durationMs: Date.now() - startedAt,
      fastPath: true,
      structuredDurationMs: structured?.meta?.durationMs || 0,
      rawDurationMs: raw?.meta?.durationMs || 0,
    },
  };

  return merged;
}

module.exports = {
  runFastOcr,
};
