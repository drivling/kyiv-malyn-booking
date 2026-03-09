#!/usr/bin/env node
/**
 * Генерує PDF з HTML-таблички зупинки.
 * Використання: node scripts/generate-stop-sign-pdf.js [html-path] [pdf-path]
 * За замовчуванням: frontend/public/stop-signs/stop-sign-11-prozhektor.html -> stop-sign-11-prozhektor.pdf
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const defaultHtml = path.join(projectRoot, 'frontend/public/stop-signs/stop-sign-11-prozhektor.html');
const defaultPdf = path.join(projectRoot, 'frontend/public/stop-signs/stop-sign-11-prozhektor.pdf');

const htmlPath = path.resolve(process.argv[2] || defaultHtml);
const pdfPath = path.resolve(process.argv[3] || defaultHtml.replace(/\.html$/, '.pdf'));

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    console.error('Потрібен puppeteer. Запусти: cd scripts && npm install');
    process.exit(1);
  }

  if (!fs.existsSync(htmlPath)) {
    console.error('Файл не знайдено:', htmlPath);
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const fileUrl = 'file://' + htmlPath.replace(/\\/g, '/');

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });
    console.log('PDF збережено:', pdfPath);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
