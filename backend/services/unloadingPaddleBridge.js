const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function extractLastJsonLine(output = '') {
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) {
      continue;
    }

    try {
      return JSON.parse(line);
    } catch (err) {
      // تجاهل أي سطر ليس JSON صالحًا
    }
  }

  return null;
}

function runPythonOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'ocr', 'unloading_paddle_reader.py');
    const debugDir = path.join(__dirname, '..', 'debug', 'paddle-crops');
    const projectRoot = path.join(__dirname, '..');
    const pythonCmd =
      process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');

    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const py = spawn(pythonCmd, [scriptPath, imagePath, debugDir], {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:
          process.env.PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK || 'True',
      },
    });

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    py.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    py.on('error', (err) => {
      reject(new Error(`تعذر تشغيل Python: ${err.message}`));
    });

    py.on('close', (code) => {
      const parsed = extractLastJsonLine(stdout);

      if (code !== 0) {
        return reject(
          new Error(
            `Python OCR failed with code ${code}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`
          )
        );
      }

      if (!parsed) {
        return reject(
          new Error(`تعذر قراءة JSON من Python.\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`)
        );
      }

      resolve(parsed);
    });
  });
}

module.exports = {
  runPythonOcr,
};
