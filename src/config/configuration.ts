export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'calling_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY || '',
    sipConnectionId: process.env.TELNYX_SIP_CONNECTION_ID || '',
    phoneNumber: process.env.TELNYX_PHONE_NUMBER || '',
    webhookSecret: process.env.TELNYX_WEBHOOK_SECRET || '',
    webhookUrl: process.env.TELNYX_WEBHOOK_URL || '',
  },
});
