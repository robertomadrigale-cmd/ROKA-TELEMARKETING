import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  page.on('request', req => {
    if (req.url().includes('/api/did')) console.log('REQ:', req.method(), req.url());
  });
  page.on('response', async res => {
    if (res.url().includes('/api/did')) console.log('RES:', res.status(), res.url(), await res.text().catch(()=>''));
  });

  await page.goto('http://localhost:5173');
  
  // Wait for the UI to load
  await page.waitForSelector('.rail-link');
  
  // Go to Sesion
  const links = await page.$$('.rail-link');
  await links[1].click(); // Second link is "Sesion"
  
  // Click D-ID Realtime button
  await page.waitForSelector('.avatar-choice');
  const choices = await page.$$('.avatar-choice');
  
  // Find the D-ID choice by text
  for (const choice of choices) {
    const text = await page.evaluate(el => el.textContent, choice);
    if (text.includes('D-ID')) {
      await choice.click();
      break;
    }
  }
  
  // Click Conectar D-ID
  await new Promise(r => setTimeout(r, 1000));
  const connectBtn = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Conectar D-ID'));
  });
  
  if (connectBtn) {
    console.log('Clicking Conectar D-ID...');
    await connectBtn.click();
  } else {
    console.log('Button Conectar D-ID not found');
  }
  
  // Wait a bit to see what happens
  await new Promise(r => setTimeout(r, 5000));
  
  // Check video state
  const videoState = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return 'No video element';
    return {
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      srcObject: !!video.srcObject
    };
  });
  
  console.log('Video state:', videoState);
  
  await browser.close();
})();
