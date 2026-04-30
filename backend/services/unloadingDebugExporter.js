const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEBUG_ROOT = path.join(__dirname, '..', 'debug', 'unloading-crops');

const FIELD_CELLS = {
  documentType: { x: 0.305, y: 0.108, w: 0.06, h: 0.052 },
  documentNumber: { x: 0.22, y: 0.128, w: 0.24, h: 0.085 },

  loadingWarehouseName: { x: 0.56, y: 0.092, w: 0.34, h: 0.035 },
  issueDate: { x: 0.56, y: 0.124, w: 0.34, h: 0.035 },
  receiverEntity: { x: 0.56, y: 0.156, w: 0.34, h: 0.058 },
  vehicleField: { x: 0.56, y: 0.212, w: 0.34, h: 0.04 },

  quantityLiters: { x: 0.46, y: 0.292, w: 0.11, h: 0.034 },

  driverName: { x: 0.205, y: 0.724, w: 0.23, h: 0.032 },
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

async function cropRelative(buffer, zone, expand = {}) {
  const meta = await sharp(buffer).metadata();

  let left = Math.floor(meta.width * zone.x);
  let top = Math.floor(meta.height * zone.y);
  let width = Math.floor(meta.width * zone.w);
  let height = Math.floor(meta.height * zone.h);

  if (expand.x) {
    const dx = Math.floor(meta.width * expand.x);
    left = Math.max(0, left - dx);
    width = Math.min(meta.width - left, width + dx * 2);
  }

  if (expand.y) {
    const dy = Math.floor(meta.height * expand.y);
    top = Math.max(0, top - dy);
    height = Math.min(meta.height - top, height + dy * 2);
  }

  return sharp(buffer).extract({ left, top, width, height });
}

async function buildFieldVariant(buffer, fieldName, variant = 'base') {
  const zone = FIELD_CELLS[fieldName];

  let img = await cropRelative(buffer, zone, {
    x: ['receiverEntity', 'loadingWarehouseName', 'driverName', 'vehicleField'].includes(fieldName) ? 0.005 : 0,
    y: 0.004,
  });

  img = img.rotate().grayscale().normalize().sharpen();

  if (variant === 'threshold165') img = img.threshold(165);
  if (variant === 'threshold185') img = img.threshold(185);

  const widths = {
    documentType: 800,
    documentNumber: 1700,
    loadingWarehouseName: 1900,
    issueDate: 1200,
    receiverEntity: 2000,
    vehicleField: 1600,
    quantityLiters: 1000,
    driverName: 1700,
  };

  return img.resize({ width: widths[fieldName] || 1400 }).png().toBuffer();
}

async function exportUnloadingDebugCrops(buffer, label = '') {
  ensureDir(DEBUG_ROOT);

  const folderName = `${stamp()}${label ? `-${label}` : ''}`;
  const outDir = path.join(DEBUG_ROOT, folderName);
  ensureDir(outDir);

  await sharp(buffer).rotate().png().toFile(path.join(outDir, '00-original.png'));

  const fields = Object.keys(FIELD_CELLS);

  for (const field of fields) {
    const variants = ['base', 'threshold165', 'threshold185'];

    for (const variant of variants) {
      const out = await buildFieldVariant(buffer, field, variant);
      const fileName = `${field}__${variant}.png`;
      fs.writeFileSync(path.join(outDir, fileName), out);
    }
  }

  return {
    folder: folderName,
    outputDir: outDir,
    relativeDir: path.join('debug', 'unloading-crops', folderName).replace(/\\/g, '/'),
  };
}

module.exports = {
  exportUnloadingDebugCrops,
};