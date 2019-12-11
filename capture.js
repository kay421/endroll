'use strict';

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

const ffmpegArgs = fps => [
    '-y',
    '-f',
    'image2pipe',
    '-r',
    `${+fps}`,
    '-i',
    '-',
    '-c:v',
    // 'libvpx',
    'libx264',
    '-auto-alt-ref',
    '0',
    '-pix_fmt',
    'yuva420p',
    '-metadata:s:v:0',
    'alpha_mode="1"'
]

const write = (stream, buffer) =>
  new Promise((resolve, reject) => {
    stream.write(buffer, error => {
      if (error) reject(error);
      else resolve();
    });
});


(async() => {
    let options = {
        pipeOutput: true,
        output: 'output.mp4'
    }

    var ffmpegPath = options.ffmpeg || 'ffmpeg';
    var fps = options.fps || 30;
    var outFile = options.output;

    const args = ffmpegArgs(fps);
    args.push(outFile || '-');

    const ffmpeg = spawn(ffmpegPath, args);
    if (options.pipeOutput) {
        ffmpeg.stdout.pipe(process.stdout);
        ffmpeg.stderr.pipe(process.stderr);
    }

    const closed = new Promise((resolve, reject) => {
        ffmpeg.on('error', reject);
        ffmpeg.on('close', resolve);
    });

    const viewportHeight = parseInt(process.argv[3])
    const viewportWidth = parseInt(process.argv[4])
    const browser = await puppeteer.launch({
        headless: true,
        devtools: true,
        defaultViewport: {
            width: viewportWidth,
            height: viewportHeight,
            deviceScaleFactor: parseFloat(process.argv[5]),
        },
    });
    const page = await browser.newPage();

    await page.goto(
        process.argv[2]
        , { waitUntil: 'networkidle0' }
    );
    await page.waitFor(() => !document.querySelector(".loading"));

    await page.addScriptTag({ path: './node_modules/gsap/dist/ScrollToPlugin.min.js' });
    await page.addScriptTag({ path: './node_modules/gsap/dist/gsap.min.js' });

    const $item = await page.$('.content__item-title');
    const bounding_box = await $item.boundingBox();
    const selector = ".content__item";
    await page.waitForSelector(selector);
    const items = await page.evaluate(selector => {
        let positions = []
        const elements = Array.from(document.querySelectorAll(selector));
        for (const ele of elements) {
            const {x, y, width, height} = ele.getBoundingClientRect();
            positions.push({x, y, width, height})
        }
        return positions;
    }, selector);

    await page.evaluate(async (items, threshold) => {
        gsap.registerPlugin(ScrollToPlugin);
        var tl = gsap.timeline();
        tl.pause();
        for (const item of items) {
            tl.add(gsap.to(window, {duration: 3.5, scrollTo: item.y - threshold, ease: "expo.inOut"}));
        }
        window.timeline = tl
        // console.log(Math.ceil(window.timeline.duration() / 1 * 5));
        return Promise.resolve()
    }, items, bounding_box.height);

    const frames = await page.evaluate(async _fps =>
      Math.ceil(window.timeline.duration() / 1 * _fps)
    , fps)
    let frame = 0

    const nextFrame = async () => {

        await page.evaluate(async progress => {
          window.timeline.progress(progress)
          await new Promise(r => setTimeout(r, 16))
        }, frame / frames)

        let screenshot = await page.screenshot({
            fullPage: false,
            // type: "jpeg",
        });
        await write(ffmpeg.stdin, screenshot)
        frame++

        console.log(`frame ${frame} / ${frames}`)
        if (frame > frames) {
          console.log('done!')
          ffmpeg.stdin.end()
          await closed
          await browser.close()
          return
        }
        nextFrame()
    }
    nextFrame()
})();