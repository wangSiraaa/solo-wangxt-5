const { chromium } = require('/tmp/node_modules/playwright-core')
const fs = require('fs')

;(async () => {
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome-linux-arm64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--disable-gpu'],
    headless: true
  })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  await page.goto('http://localhost:4317/', { waitUntil: 'networkidle' })

  await page.click('text=载入 11 页样册')
  await page.waitForSelector('.sheet-card')
  await page.waitForTimeout(1800)
  // 短边翻转第一张纸
  await page.locator('.sheet-card').first().screenshot({ path: '/tmp/shot-11-short-sheet1.png' })

  // 长边翻转
  await page.click('text=长边翻转')
  await page.waitForTimeout(1800)
  await page.locator('.sheet-card').first().screenshot({ path: '/tmp/shot-11-long-sheet1.png' })

  // 封面单独计纸 + 8 页样册：重新导入 8 页
  await page.click('text=短边翻转')
  await page.check('.switch input[type=checkbox]')
  await page.waitForTimeout(1500)
  await page.locator('.sheet-card.cover').first().screenshot({ path: '/tmp/shot-cover-sheet.png' })

  // 8 页样册整体
  await page.evaluate(() => location.reload())
  await page.waitForTimeout(1200)
  // 草稿恢复条出现，直接忽略并重新载入 8 页
  await page.click('text=载入 8 页样册').catch(() => {})
  await page.waitForTimeout(500)
  const again = await page.$('text=载入 8 页样册')
  if (again) { await again.click(); await page.waitForTimeout(2000) }
  await page.waitForSelector('.sheet-card', { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/shot-8-full.png', fullPage: false })

  console.log(fs.readdirSync('/tmp').filter((f) => f.endsWith('.png')).join('\n'))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
