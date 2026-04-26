#!/usr/bin/env node
/**
 * Otimiza assets do app:
 * - icon.png        1024x1024 — logo full bleed (já é como tá)
 * - adaptive-icon   1024x1024 — logo dentro do safe-area circular do Android
 *                              (centro 66%; resto preto pra fundo absorver máscara)
 * - splash.png      2048x2048 — logo centrada com padding generoso, fundo preto
 *
 * Compressão: PNG palettize + adaptive filter (sharp). Sem perda visual.
 */

const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const ASSETS = path.resolve(__dirname, '..', 'assets')
const SOURCE = path.join(ASSETS, '_backup_pre_logo_2026_04_26', 'icon.png')
const BG = { r: 17, g: 17, b: 17, alpha: 1 } // #111111 — bate com app.json backgroundColor

function bytes(filePath) {
  return fs.statSync(filePath).size
}

function fmtKB(n) {
  return (n / 1024).toFixed(1) + ' KB'
}

async function fitOnBlackCanvas(srcBuffer, canvasSize, contentSize) {
  // Resize a logo pra contentSize mantendo aspect ratio com fundo transparente,
  // depois compose num canvas preto canvasSize x canvasSize centrado.
  const resized = await sharp(srcBuffer)
    .resize(contentSize, contentSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      quality: 95,
      effort: 10,
    })
    .toBuffer()
}

async function compressAsIs(srcBuffer) {
  // Re-encode via sharp pra rodar palettização + adaptive filter no PNG original.
  return sharp(srcBuffer)
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      quality: 95,
      effort: 10,
    })
    .toBuffer()
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Source não encontrada:', SOURCE)
    process.exit(1)
  }
  const srcBuffer = fs.readFileSync(SOURCE)
  const srcMeta = await sharp(srcBuffer).metadata()
  console.log(`source: ${srcMeta.width}x${srcMeta.height} ${fmtKB(srcBuffer.length)}`)

  // ─── 1) icon.png (full bleed, mesma composição) ─────────────────────
  // O ícone iOS / launcher genérico usa o canvas inteiro, então mantemos
  // a logo até as bordas. Só re-encode pra ganhar compressão.
  const iconOut = await compressAsIs(srcBuffer)
  const iconPath = path.join(ASSETS, 'icon.png')
  fs.writeFileSync(iconPath, iconOut)
  console.log(`icon.png:          ${fmtKB(srcBuffer.length)} → ${fmtKB(iconOut.length)}`)

  // ─── 2) adaptive-icon.png (Android safe area) ───────────────────────
  // Android máscara: launcher pode ser circle/squircle/round-square. A logo
  // só fica visível dentro do círculo central (~66% do canvas = ~676px).
  // Pra garantir que NUNCA corta, colocamos a logo em 600x600 (~58.5%) com
  // 212px de padding em volta. Fundo preto absorve o resto da máscara.
  const adaptiveOut = await fitOnBlackCanvas(srcBuffer, 1024, 600)
  const adaptivePath = path.join(ASSETS, 'adaptive-icon.png')
  fs.writeFileSync(adaptivePath, adaptiveOut)
  console.log(`adaptive-icon.png: ${fmtKB(srcBuffer.length)} → ${fmtKB(adaptiveOut.length)} (logo a 600px)`)

  // ─── 3) splash.png (2048x2048, logo discreta) ───────────────────────
  // Splash do Expo usa resizeMode "contain" — vai escalar pra caber sem
  // distorcer. Tamanho maior dá mais nitidez em tablets. Logo a 800px de
  // 2048 = ~39% do canvas — discreta, profissional.
  const splashOut = await fitOnBlackCanvas(srcBuffer, 2048, 800)
  const splashPath = path.join(ASSETS, 'splash.png')
  fs.writeFileSync(splashPath, splashOut)
  console.log(`splash.png:        ${fmtKB(srcBuffer.length)} → ${fmtKB(splashOut.length)} (2048x2048, logo a 800px)`)

  const totalBefore = srcBuffer.length * 3
  const totalAfter = iconOut.length + adaptiveOut.length + splashOut.length
  console.log('')
  console.log(`total: ${fmtKB(totalBefore)} → ${fmtKB(totalAfter)} (${(100 - totalAfter / totalBefore * 100).toFixed(1)}% menor)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
