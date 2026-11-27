import { defineConfig, devices } from '@playwright/test';

const chromium=process.env.SHABBAT_CHROME?{channel:undefined,launchOptions:{executablePath:process.env.SHABBAT_CHROME}}:{};
export default defineConfig({
  testDir:'./test',
  testMatch:'*.spec.mjs',
  timeout:45000,
  expect:{timeout:12000},
  reporter:process.env.CI?[['list'],['html',{open:'never'}]]:'list',
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
  projects:[
    {name:'desktop-chromium',use:{...devices['Desktop Chrome'],...chromium}},
    {name:'iphone-chromium',use:{...devices['Pixel 7'],viewport:{width:390,height:844},...chromium}},
    {name:'iphone-webkit',use:{...devices['iPhone 13']}},
  ],
  webServer:{command:'node test/server.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:false},
});
