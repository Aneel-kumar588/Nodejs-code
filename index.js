const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json'));

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();

    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const blockedTypes = ['image', 'stylesheet', 'font', 'media', 'other'];
        if (blockedTypes.includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    // Set a custom User-Agent string
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36');

    try {
        console.log("Navigating to the appointment page...");
        await page.goto('https://service2.diplo.de/rktermin/extern/appointment_showMonth.do?locationCode=kara&realmId=967&categoryId=2801', { waitUntil: 'networkidle2' });
        await saveScreenshot(page, 'process1.png');

        // Step 1: Solve CAPTCHA and Proceed
        console.log("Solving CAPTCHA...");
        const captchaSuccess = await solveCaptcha(page);
        if (!captchaSuccess) throw new Error("Failed to solve CAPTCHA.");
        console.log("CAPTCHA solved. Submitting form...");
        await page.click('input[type="submit"]');
        await saveScreenshot(page, 'process2.png');

        // Wait for the next page to load
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Step 2: Check for "Appointments are available"
        console.log("Checking for available appointments...");
        const availableAppointments = await page.evaluate(() => {
            const link = [...document.querySelectorAll('a')].find(el => el.innerText.includes('Appointments are available'));
            return link ? link.href : null;
        });

        if (availableAppointments) {
            console.log("Available appointments found. Navigating...");
            await page.goto(availableAppointments, { waitUntil: 'networkidle2' });
            await saveScreenshot(page, 'appointments_available.png');
        } else {
            console.log("No appointments available.");
            await saveScreenshot(page, 'no_appointments_available.png');
            return;
        }

        // Step 3: Fill out the appointment booking form
        console.log("Filling out the appointment booking form...");
        await page.type('#appointment_newAppointmentForm_lastname', config.lastname);
        await page.type('#appointment_newAppointmentForm_firstname', config.firstname);
        await page.type('#appointment_newAppointmentForm_email', config.email);
        await page.type('#appointment_newAppointmentForm_emailrepeat', config.email);
        await page.type('#appointment_newAppointmentForm_fields_0__content', config.passportNumber);
        await page.type('#appointment_newAppointmentForm_fields_1__content', config.province);
        await page.type('#appointment_newAppointmentForm_fields_2__content', config.country);
        await saveScreenshot(page, 'process3.png');

        // Step 4: Solve CAPTCHA again and submit
        console.log("Solving CAPTCHA again before submission...");
        const finalCaptchaSuccess = await solveCaptcha(page);
        if (!finalCaptchaSuccess) throw new Error("Failed to solve final CAPTCHA.");
        await page.click('input[type="submit"]');
        await saveScreenshot(page, 'process4.png');

        console.log("Form submitted successfully!");
    } catch (error) {
        console.error("Error during the process:", error);

        // Save HTML and screenshot for debugging
        const html = await page.content();
        fs.writeFileSync('error_page.html', html);
        await saveScreenshot(page, 'error_page.png');
    } finally {
        await browser.close();
    }
})();

async function solveCaptcha(page) {
    const API_KEY = '0d591d2f67b71c4b82fd6495517ebba1'; // Replace with your Anti-Captcha API key
    let solvedCaptcha = '';

    try {
        console.log("Waiting for CAPTCHA element...");
        const captchaElement = await page.waitForSelector('img[src*="captcha"]', { visible: true, timeout: 60000 });
        console.log("CAPTCHA element found!");

        // Save CAPTCHA image
        const captchaImagePath = 'captcha.png';
        await captchaElement.screenshot({ path: captchaImagePath });
        console.log("CAPTCHA screenshot saved at:", captchaImagePath);

        // Convert image to base64
        const captchaImage = fs.readFileSync(captchaImagePath, { encoding: 'base64' });

        // Create CAPTCHA task
        const createTaskResponse = await axios.post('https://api.anti-captcha.com/createTask', {
            clientKey: API_KEY,
            task: {
                type: "ImageToTextTask",
                body: captchaImage
            }
        });

        if (createTaskResponse.data.errorId !== 0) {
            throw new Error("Error creating CAPTCHA task: " + createTaskResponse.data.errorDescription);
        }

        const taskId = createTaskResponse.data.taskId;
        console.log("CAPTCHA task created, taskId:", taskId);

        // Poll for the solution
        let taskResult = null;
        while (!taskResult || taskResult.status !== 'ready') {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const taskResultResponse = await axios.post('https://api.anti-captcha.com/getTaskResult', {
                clientKey: API_KEY,
                taskId: taskId
            });
            taskResult = taskResultResponse.data;
        }

        solvedCaptcha = taskResult.solution.text;
        console.log("Solved CAPTCHA:", solvedCaptcha);

        // Enter CAPTCHA solution
        const captchaInputField = await page.waitForSelector('input[type="text"]', { visible: true });
        await captchaInputField.type(solvedCaptcha);
        return true;
    } catch (error) {
        console.error("Error solving CAPTCHA:", error);
        return false;
    }
}

async function saveScreenshot(page, filename) {
    await page.screenshot({ path: filename });
    console.log(`Screenshot saved as ${filename}`);
}
