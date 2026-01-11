const { chromium } = require('playwright');
const path = require('path');

async function run() {
    console.log('Starting Playwright capture...');
    const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 2560, height: 1440 },
        deviceScaleFactor: 2
    });

    const page = await context.newPage();

    const targets = [
        { name: 'chat_screenshot.png', url: 'http://web:3000/demo/submit' },
        { name: 'dashboard_screenshot.png', url: 'http://web:3000/demo' },
        { name: 'workflows_screenshot.png', url: 'http://web:3000/demo/workflows' }
    ];

    for (const target of targets) {
        console.log(`Navigating to ${target.url}...`);
        try {
            await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 });

            // Hide header and other distractions
            await page.evaluate(() => {
                // Hide the top navigation bar entirely
                document.querySelector('header')?.remove();

                // Hide scrollbars for a cleaner look
                document.body.style.overflow = 'hidden';
            });

            // Wait a bit for any animations to settle
            await page.waitForTimeout(1000);

            const outputPath = path.join('/project/apps/web/public/images', target.name);
            console.log(`Capturing to ${outputPath}...`);
            await page.screenshot({
                path: outputPath,
                type: 'png'
            });
            console.log(`Success: ${target.name}`);
        } catch (err) {
            console.error(`Failed to capture ${target.name}:`, err.message);
        }
    }

    await browser.close();
    console.log('Capture process finished.');
}

run();
