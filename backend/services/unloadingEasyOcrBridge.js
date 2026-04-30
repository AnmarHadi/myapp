const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const { spawn } = require('child_process')

let sharp = null
try {
  sharp = require('sharp')
} catch (_) {}

const OCR_TIMEOUT_MS = Number(process.env.UNLOADING_OCR_TIMEOUT_MS || 300000)
const WORKER_ENABLED = process.env.UNLOADING_OCR_DISABLE_WORKER !== '1'

let workerProcess = null
let workerStdoutBuffer = ''
let workerRequestSeq = 0
const workerPending = new Map()
let workerScriptPath = ''
let workerScriptMtimeMs = 0

function resolvePreprocessOptions(options = {}) {
  return {
    maxWidth: Number(options.maxWidth || process.env.UNLOADING_OCR_MAX_WIDTH || 1800),
    jpegQuality: Number(options.jpegQuality || process.env.UNLOADING_OCR_JPEG_QUALITY || 82),
    grayscale: options.grayscale !== false,
    normalize: Boolean(options.normalize),
    sharpen: Boolean(options.sharpen),
    profileName: options.profileName || 'default',
  }
}

async function preprocessImageForOcr(imagePath, options = {}) {
  if (!sharp) {
    return {
      preparedImagePath: imagePath,
      preprocessing: { skipped: true, reason: 'sharp_unavailable' },
    }
  }

  const resolved = resolvePreprocessOptions(options)

  const tmpFile = path.join(
    os.tmpdir(),
    `unloading-ocr-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  )

  const metadata = await sharp(imagePath).metadata()
  const shouldResize = (metadata.width || 0) > resolved.maxWidth

  let pipeline = sharp(imagePath)
    .rotate()

  if (resolved.grayscale) {
    pipeline = pipeline.grayscale()
  }

  if (shouldResize) {
    pipeline = pipeline.resize({
      width: resolved.maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
  }

  if (resolved.normalize) {
    pipeline = pipeline.normalize()
  }

  if (resolved.sharpen) {
    pipeline = pipeline.sharpen()
  }

  await pipeline
    .jpeg({ quality: resolved.jpegQuality, mozjpeg: true })
    .toFile(tmpFile)

  return {
    preparedImagePath: tmpFile,
    preprocessing: {
      originalWidth: metadata.width || null,
      originalHeight: metadata.height || null,
      resized: shouldResize,
      targetWidth: shouldResize ? resolved.maxWidth : (metadata.width || null),
      format: metadata.format || null,
      jpegQuality: resolved.jpegQuality,
      grayscale: resolved.grayscale,
      normalize: resolved.normalize,
      sharpen: resolved.sharpen,
      profileName: resolved.profileName,
    },
  }
}

function resolvePythonCommand() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH
  return process.platform === 'win32' ? 'python' : 'python3'
}

function resolveReaderScript(projectRoot) {
  if (process.env.UNLOADING_OCR_SCRIPT_PATH) {
    return path.isAbsolute(process.env.UNLOADING_OCR_SCRIPT_PATH)
      ? process.env.UNLOADING_OCR_SCRIPT_PATH
      : path.join(projectRoot, process.env.UNLOADING_OCR_SCRIPT_PATH)
  }

  const candidates = [
    path.join(projectRoot, 'ocr', 'unloading_easyocr_reader.py'),
    path.join(projectRoot, 'python', 'unloading_easyocr_reader.py'),
    path.join(projectRoot, 'services', 'python', 'unloading_easyocr_reader.py'),
  ]

  return candidates[0]
}

async function assertRequiredFiles(scriptPath, projectRoot, templateName) {
  const required = [
    { label: 'OCR script', filePath: scriptPath },
    {
      label: 'OCR template',
      filePath: path.join(projectRoot, 'templates', `${templateName}.json`),
    },
  ]

  for (const item of required) {
    try {
      await fs.access(item.filePath)
    } catch {
      throw new Error(`${item.label} not found: ${item.filePath}`)
    }
  }
}

function parseLastJsonLine(stdout = '') {
  const lines = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  const lastJsonLine = [...lines].reverse().find(
    (line) => line.startsWith('{') && line.endsWith('}')
  )

  if (!lastJsonLine) {
    throw new Error('No JSON object found in stdout')
  }

  return JSON.parse(lastJsonLine)
}

function stopWorker() {
  if (workerProcess) {
    workerProcess.kill()
    workerProcess = null
  }
  workerScriptPath = ''
  workerScriptMtimeMs = 0
}

function rejectPendingWorkerRequests(message) {
  for (const [, pending] of workerPending) {
    clearTimeout(pending.timeout)
    pending.reject(new Error(message))
  }
  workerPending.clear()
}

function handleWorkerStdoutChunk(chunk) {
  workerStdoutBuffer += chunk.toString()
  const lines = workerStdoutBuffer.split(/\r?\n/)
  workerStdoutBuffer = lines.pop() || ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    let payload
    try {
      payload = JSON.parse(line)
    } catch {
      continue
    }

    const pending = workerPending.get(payload.id)
    if (!pending) continue

    workerPending.delete(payload.id)
    clearTimeout(pending.timeout)

    if (payload.ok) {
      pending.resolve(payload.result)
    } else {
      pending.reject(new Error(payload?.error?.message || 'Persistent OCR worker failed'))
    }
  }
}

async function ensureWorker(scriptPath, projectRoot) {
  let scriptStat = null
  try {
    scriptStat = await fs.stat(scriptPath)
  } catch (_) {}

  const nextMtimeMs = scriptStat?.mtimeMs || 0
  const scriptChanged =
    workerProcess &&
    !workerProcess.killed &&
    (workerScriptPath !== scriptPath || workerScriptMtimeMs !== nextMtimeMs)

  if (scriptChanged) {
    stopWorker()
  }

  if (workerProcess && !workerProcess.killed) {
    return workerProcess
  }

  const pythonCmd = resolvePythonCommand()
  workerStdoutBuffer = ''

  workerProcess = spawn(
    pythonCmd,
    [scriptPath, '--worker'],
    {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    }
  )
  workerScriptPath = scriptPath
  workerScriptMtimeMs = nextMtimeMs

  workerProcess.stdout.on('data', handleWorkerStdoutChunk)

  workerProcess.stderr.on('data', (data) => {
    const text = data.toString()
    if (text.trim()) {
      console.error('[unloading-ocr-worker]', text.trim())
    }
  })

  workerProcess.on('error', (error) => {
    rejectPendingWorkerRequests(`Persistent OCR worker error: ${error.message}`)
    workerProcess = null
  })

  workerProcess.on('close', (code) => {
    rejectPendingWorkerRequests(`Persistent OCR worker exited with code ${code}`)
    workerProcess = null
  })

  return workerProcess
}

function runPythonOcrWorker(scriptPath, imagePath, templateName, projectRoot) {
  return new Promise(async (resolve, reject) => {
    const worker = await ensureWorker(scriptPath, projectRoot)
    const id = `ocr-${Date.now()}-${++workerRequestSeq}`
    const timeout = setTimeout(() => {
      workerPending.delete(id)
      reject(new Error(`Persistent EasyOCR timed out after ${OCR_TIMEOUT_MS}ms`))
    }, OCR_TIMEOUT_MS)

    workerPending.set(id, { resolve, reject, timeout })

    const payload = JSON.stringify({ id, imagePath, templateName })
    worker.stdin.write(`${payload}\n`, (error) => {
      if (!error) return
      clearTimeout(timeout)
      workerPending.delete(id)
      reject(new Error(`Failed to send OCR request to persistent worker: ${error.message}`))
    })
  })
}

function runPythonOcr(scriptPath, imagePath, templateName, projectRoot) {
  return new Promise((resolve, reject) => {
    const pythonCmd = resolvePythonCommand()

    let stdout = ''
    let stderr = ''
    let finished = false

    console.log('OCR pythonCmd =', pythonCmd)
    console.log('OCR scriptPath =', scriptPath)
    console.log('OCR imagePath =', imagePath)
    console.log('OCR templateName =', templateName)

    const py = spawn(
      pythonCmd,
      [scriptPath, imagePath, templateName],
      {
        cwd: projectRoot,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      }
    )

    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      py.kill('SIGKILL')
      reject(new Error(`EasyOCR timed out after ${OCR_TIMEOUT_MS}ms`))
    }, OCR_TIMEOUT_MS)

    py.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    py.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    py.on('error', (error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      reject(new Error(`Failed to start Python OCR process: ${error.message}`))
    })

    py.on('close', (code) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)

      if (code !== 0) {
        return reject(
          new Error(
            [
              `EasyOCR process exited with code ${code}`,
              `STDERR:\n${stderr || '(empty)'}`,
              `STDOUT:\n${stdout || '(empty)'}`,
            ].join('\n')
          )
        )
      }

      console.log('OCR exit code =', code)

      try {
        const parsed = parseLastJsonLine(stdout)
        resolve(parsed)
      } catch (error) {
        reject(
          new Error(
            [
              'Failed to parse EasyOCR JSON response.',
              `STDERR:\n${stderr || '(empty)'}`,
              `STDOUT:\n${stdout || '(empty)'}`,
              `Parse error: ${error.message}`,
            ].join('\n')
          )
        )
      }
    })
  })
}

async function runEasyOcr(imagePath, templateName = 'unloading-template', options = {}) {
  if (!imagePath || typeof imagePath !== 'string') {
    throw new Error('runEasyOcr requires a valid image file path')
  }

  const projectRoot = path.resolve(__dirname, '..')
  const scriptPath = resolveReaderScript(projectRoot)

  let preparedImagePath = imagePath
  let preprocessing = null
  let shouldDeletePreparedFile = false

  try {
    await assertRequiredFiles(scriptPath, projectRoot, templateName)

    const prepared = await preprocessImageForOcr(imagePath, options)
    preparedImagePath = prepared.preparedImagePath
    preprocessing = prepared.preprocessing
    shouldDeletePreparedFile = preparedImagePath !== imagePath

    const startedAt = Date.now()
    let result
    try {
      result = WORKER_ENABLED
        ? await runPythonOcrWorker(scriptPath, preparedImagePath, templateName, projectRoot)
        : await runPythonOcr(scriptPath, preparedImagePath, templateName, projectRoot)
    } catch (error) {
      if (!WORKER_ENABLED) throw error
      console.warn('Persistent OCR worker failed, falling back to one-shot process:', error.message)
      stopWorker()
      result = await runPythonOcr(scriptPath, preparedImagePath, templateName, projectRoot)
    }
    const durationMs = Date.now() - startedAt

    return {
      ...result,
      meta: {
        ...(result?.meta || {}),
        durationMs,
        pythonCommand: resolvePythonCommand(),
        scriptPath,
        preprocessing,
      },
    }
  } finally {
    if (shouldDeletePreparedFile && preparedImagePath) {
      await fs.unlink(preparedImagePath).catch(() => {})
    }
  }
}

module.exports = {
  runEasyOcr,
}
