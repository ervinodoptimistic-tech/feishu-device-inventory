// config/feishu.js
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
  throw new Error(
    '❌  Missing Feishu credentials. Copy .env.example → .env and fill credentials.'
  );
}

const client = new lark.Client({
  appId:       process.env.FEISHU_APP_ID,
  appSecret:   process.env.FEISHU_APP_SECRET,
  domain:      lark.Domain.Feishu,
  loggerLevel: process.env.NODE_ENV === 'development'
    ? lark.LoggerLevel.warn
    : lark.LoggerLevel.error,
});

module.exports = client;
