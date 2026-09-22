const fs = require('node:fs');
const path = require('node:path');

const envFile = path.resolve(__dirname, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

module.exports = {
  apps: [
    {
      name: 'sunseat-calc',
      cwd: './python',
      script: './.venv/Scripts/pythonw.exe',
      args: '-m uvicorn api.main:app --host 127.0.0.1 --port 8100',
      interpreter: 'none',
      windowsHide: true,
      env: { PYTHONPATH: '.', SUNSEAT_TIMEZONE: 'Asia/Seoul' },
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 5,
      out_file: './logs/calc-out.log',
      error_file: './logs/calc-error.log',
      merge_logs: true,
    },
    {
      name: 'sunseat-api',
      cwd: './server',
      script: 'src/server.mjs',
      interpreter: 'node',
      env: {
        PORT: 3000,
        SUNSEAT_CALC_URL: 'http://127.0.0.1:8100',
        TAGO_SCHEDULE_URL: 'https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo',
        TAGO_SERVICE_KEY: process.env.TAGO_SERVICE_KEY || '',
        SUNSEAT_STATION_CODES_JSON: '{"seoul":"NAT010000","gwangmyeong":"NATH10219","osong":"NAT050044","daejeon":"NAT011668","dongdaegu":"NAT013271","busan":"NAT014445"}',
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 5,
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      merge_logs: true,
    },
  ],
};
