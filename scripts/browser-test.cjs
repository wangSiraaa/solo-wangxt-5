const { chromium } = require('/tmp/node_modules/playwright-core')

;(async () => {
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome-linux-arm64/chrome',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--font-render-hinting=none'
    ],
    headless: true
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console.error: ' + m.text())
  })

  await page.goto('http://localhost:4317/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  assert(await page.isVisible('text=导入源 PDF'), '初始页显示导入区', errors)

  // 载入 11 页样册（需要补白，验证面更广）
  await page.click('text=载入 11 页样册')
  await page.waitForSelector('.sheet-card', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const sheets = await page.locator('.sheet-card').count()
  assert(sheets === 3, `11页默认(非封面单独) → 3 张纸，实际 ${sheets}`, errors)

  // 补白标签存在
  const blankTags = await page.locator('.sheet-card').allTextContents()
  assert(blankTags.join('').includes('含 1 处补白'), '预览明确展示补白位置', errors)
  assert(blankTags.join('').includes('成书页 12'), '补白成书页号正确 (#12)', errors)

  // 原页 11 个缩略图
  const chips = await page.locator('.page-chip').count()
  assert(chips === 11, `11 个原页缩略图，实际 ${chips}`, errors)

  // 排除一页 → 自动补白
  await page.locator('.page-chip').nth(4).click() // 排除第5页
  await page.waitForTimeout(800)
  const afterExclude = (await page.locator('.sheet-card').allTextContents()).join('')
  assert(afterExclude.includes('已排除') || (await page.locator('.page-chip.excluded').count()) === 1, '排除标记显示', errors)

  // 撤销恢复
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(500)
  const excludedCount = await page.locator('.page-chip.excluded').count()
  assert(excludedCount === 0, `Ctrl+Z 撤销排除，剩余排除数 ${excludedCount}`, errors)

  // 切换长边翻转 → 背面出现 180° 标记
  await page.click('text=长边翻转')
  await page.waitForTimeout(1200)
  const rotMarks = await page.locator('.sheet-card').allTextContents()
  assert(rotMarks.join('').includes('⟲'), '长边翻转背面显示 180° 旋转标记', errors)
  assert(rotMarks.join('').includes('长边翻转后整面旋转 180°'), '长边翻转背面方向说明', errors)

  // 切回短边，开启封面单独计纸
  await page.click('text=短边翻转')
  const coverSwitch = page.locator('input[type=checkbox]').first()
  await page.check('.switch input[type=checkbox]')
  await page.waitForTimeout(1000)
  const cover = await page.locator('.sheet-card.cover').count()
  assert(cover >= 1, '封面单独计纸 → 封面纸卡片', errors)

  // 改变纸张规格 → 重新检查提示
  await page.selectOption('select', 'a4')
  await page.waitForTimeout(800)
  const notice = await page.locator('.sidebar').allTextContents()
  assert(notice.join('').includes('重新检查'), '纸张变更后触发出血/裁切复查提示', errors)

  // 导出前检查对话框
  await page.click('text=导出前检查并下载')
  await page.waitForSelector('.modal', { timeout: 10000 })
  const modalText = await page.locator('.modal').allTextContents()
  assert(modalText.join('').includes('逐纸页序与旋转'), '检查对话框含逐纸页序表', errors)

  // 触发实际导出（监听下载）
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
    page.click('text=确认导出')
  ])
  assert(download !== null, '导出 PDF 触发浏览器下载', errors)
  if (download) {
    const path = '/tmp/exported-browser.pdf'
    await download.saveAs(path)
    const fs = require('fs')
    const size = fs.statSync(path).size
    assert(size > 10000, `导出文件非空（${size} 字节）`, errors)
  }

  // IndexedDB 草稿：刷新后出现恢复条
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const restoreVisible = await page.isVisible('text=恢复上次工作').catch(() => false)
  assert(restoreVisible, 'IndexedDB 草稿：刷新后可恢复上次工程', errors)

  if (errors.filter((e) => e.startsWith('❌')).length) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  console.log(errors.length ? '浏览器控制台消息:\n' + errors.join('\n') : '浏览器控制台无错误')
  console.log('\n🎉 浏览器端冒烟全部通过')
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

function assert(cond, msg, errors) {
  if (cond) console.log('✅', msg)
  else {
    console.log('❌', msg)
    errors.push('❌ ' + msg)
  }
}
