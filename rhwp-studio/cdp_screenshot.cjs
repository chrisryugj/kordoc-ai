const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.connect({ browserURL: "http://172.21.192.1:19222" });
  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes("7700"));
  if (!page) {
    console.log("Available pages:");
    pages.forEach(p => console.log(p.url()));
    return;
  }
  console.log("Found page:", page.url());
  const scrollContainer = await page.$("#scroll-container");
  if (scrollContainer) {
    await page.evaluate(el => { el.scrollBy(0, 800); }, scrollContainer);
    await new Promise(r => setTimeout(r, 500));
  }
  await page.screenshot({ path: "/tmp/cdp_current.png", fullPage: false });
  console.log("Screenshot saved");
  await browser.disconnect();
})().catch(e => console.error(e));
