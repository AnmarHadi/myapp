const path = require('path')
const os = require('os')
const fs = require('fs/promises')
let sharp = null

try {
  sharp = require('sharp')
} catch (_) {}

class ImagePreprocessor {
  async run({ imageBuffer }) {
    const tmpFile = path.join(
      os.tmpdir(),
      `doc-agent-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
    )

    if (!sharp) {
      await fs.writeFile(tmpFile, imageBuffer)
      return {
        preparedImagePath: tmpFile,
        meta: { preprocessed: false }
      }
    }

    await sharp(imageBuffer)
      .rotate()
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(tmpFile)

    return {
      preparedImagePath: tmpFile,
      meta: { preprocessed: true }
    }
  }
}

module.exports = ImagePreprocessor