require('dotenv').config();
const express = require('express');
const app = express();
const { Pool } = require('pg');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// USSD Route
app.post('/ussd', async (req, res) => {
  try {
    let { sessionId, phoneNumber, text = '' } = req.body;
    let inputs = text.split('*').filter(i => i !== '');
    let lang = inputs[0] || '';
    let response = '';

    // Back navigation
    if (inputs.length > 1 && inputs[inputs.length - 1] === '0') {
      inputs.pop();
      inputs.pop();
      text = inputs.join('*');
    }

    lang = inputs[0] || '';

    // Insert or ignore user
    if (lang === '1' || lang === '2') {
      await pool.query(
        `INSERT INTO users (phone_number, language)
         VALUES ($1, $2)
         ON CONFLICT (phone_number) DO NOTHING`,
        [phoneNumber, lang === '1' ? 'EN' : 'RW']
      );
    }

    // Get user id
    const userRes = await pool.query(`SELECT id FROM users WHERE phone_number = $1`, [phoneNumber]);
    const userId = userRes.rows.length ? userRes.rows[0].id : null;

    // Get latest BMI session
    const latestSessionRes = await pool.query(
      `SELECT weight, height, bmi, status FROM bmi_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const latestSession = latestSessionRes.rows[0];

    if (text === '') {
      response = `CON Welcome to Health BMI App\n1. English\n2. Kinyarwanda`;
    } else if (inputs.length === 1 && latestSession) {
      response = lang === '1'
        ? `CON We found your last BMI data:\nWeight: ${latestSession.weight} kg\nHeight: ${latestSession.height} cm\nBMI: ${latestSession.bmi.toFixed(1)} (${latestSession.status})\n\n1. Update with new data\n2. Use existing data`
        : `CON Twabonye amakuru ya BMI yawe:\nIbiro: ${latestSession.weight} kg\nUburebure: ${latestSession.height} cm\nBMI: ${latestSession.bmi.toFixed(1)} (${latestSession.status})\n\n1. Hindura amakuru\n2. Koresha aya`;
    } else if (inputs.length === 2 && inputs[1] === '2' && latestSession) {
      response = lang === '1'
        ? `CON Your BMI is ${latestSession.bmi.toFixed(1)} (${latestSession.status})\nWould you like health tips?\n1. Yes\n2. No\n0. Go Back`
        : `CON BMI yawe ni ${latestSession.bmi.toFixed(1)} (${latestSession.status})\nWaba ushaka inama z'ubuzima?\n1. Yego\n2. Oya\n0. Subira inyuma`;
    } else if (inputs.length === 2 && inputs[1] === '1') {
      response = lang === '1'
        ? `CON Enter your weight in KG:`
        : `CON Injiza ibiro byawe mu KG:`;
    } else if (inputs.length === 3) {
      response = lang === '1'
        ? `CON Enter your height in CM:\n(0 to go back)`
        : `CON Injiza uburebure bwawe mu CM:\n(0 usubire inyuma)`;
    } else if (inputs.length === 4) {
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);

      if (isNaN(weight) || isNaN(height)) {
        response = lang === '1'
          ? 'END Invalid weight or height.'
          : 'END Ibiro cyangwa uburebure si byemewe.';
      } else {
        const bmi = weight / ((height / 100) ** 2);
        let status = bmi < 18.5 ? (lang === '1' ? 'Underweight' : 'Ufite ibiro biri hasi') :
                     bmi < 25 ? (lang === '1' ? 'Normal' : 'Bisanzwe') :
                     bmi < 30 ? (lang === '1' ? 'Overweight' : 'Ufite ibiro byinshi') :
                     (lang === '1' ? 'Obese' : 'Ufite ibiro byinshi cyane');

        await pool.query(
          `INSERT INTO bmi_sessions (user_id, session_id, phone_number, weight, height, bmi, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, sessionId, phoneNumber, weight, height, bmi, status]
        );

        response = lang === '1'
          ? `CON Your BMI is ${bmi.toFixed(1)} (${status})\nWould you like health tips?\n1. Yes\n2. No\n0. Go Back`
          : `CON BMI yawe ni ${bmi.toFixed(1)} (${status})\nWaba ushaka inama z'ubuzima?\n1. Yego\n2. Oya\n0. Subira inyuma`;
      }
    } else if (inputs.length === 5) {
      const wantTips = inputs[4];
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);
      const bmi = weight / ((height / 100) ** 2);

      let tip = bmi < 18.5 ? (lang === '1'
        ? 'Eat more calories and protein. Consult a doctor.'
        : 'Fata ibiryo byinshi birimo poroteyine. Ganira na muganga.')
        : bmi < 25 ? (lang === '1'
          ? 'You are healthy. Maintain balanced meals.'
          : 'Uri muzima. Kurikiza indyo yuzuye.')
        : bmi < 30 ? (lang === '1'
          ? 'Exercise regularly and avoid junk food.'
          : 'Jya ukora imyitozo kandi wirinde ibiryo bibi.')
        : (lang === '1'
          ? 'See a doctor and follow a strict diet.'
          : 'Ganira na muganga kandi ukurikize indyo ikomeye.');

      response = wantTips === '1'
        ? `END ${tip}`
        : wantTips === '2'
          ? (lang === '1' ? 'END Thank you for using our service.' : 'END Murakoze gukoresha serivisi yacu.')
          : (lang === '1' ? 'END Invalid option.' : 'END Igisubizo si cyo.');
    } else {
      response = lang === '1'
        ? 'END Invalid input. Please restart.'
        : 'END Ikosa ryabaye. Ongera utangire.';
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
  } catch (error) {
    console.error('🚨 Error:', error.message, error.stack);
    res.status(500).send('END Internal server error.');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`USSD app running on port ${PORT}`);
});
