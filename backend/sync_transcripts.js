const { google } = require('googleapis');
require('dotenv').config();

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '1Q4ZUqhQSM4zmqyiafd8yXjd3CPoBHFHl9GyKfjoVn-E',
    range: 'シート1!A1:F6',
  });
  const rows = res.data.values;
  for (let i = 0; i < rows.length; i++) {
    console.log('Row', i, ':', JSON.stringify(rows[i]));
  }
})().catch(e => console.error('Error:', e.message));
