require('dotenv').config();
const express = require('express');
const app = express();
const { Pool } = require('pg');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.post('/ussd', async (req, res) => {
  try {
    let { sessionId, phoneNumber, text = '' } = req.body;
    let inputs = text.split('*').filter(i => i !== '');
    let lang = inputs[0] || '';
    let response = '';

    // Back navigation: if last input is '0', remove last two inputs to go back
    if (inputs.length > 1 && inputs[inputs.length - 1] === '0') {
      inputs.pop(); // remove '0'
      inputs.pop(); // remove previous input
      text = inputs.join('*');
    }

    lang = inputs[0] || '';

    // Ensure user exists & save language preference
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

    // Fetch latest BMI session for this user
    const latestSessionRes = await pool.query(
      `SELECT weight, height, bmi, status 
       FROM bmi_sessions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId]
    );
    const latestSession = latestSessionRes.rows[0];

    inputs = text ? text.split('*') : [];

    if (text === '') {
      // Level 1: Language selection
      response = `CON Welcome to Health BMI App
1. English
2. Kinyarwanda`;
    } 
    else if (inputs.length === 1) {
      // After choosing language, check if existing session
      if (latestSession) {
        response = lang === '1'
          ? `CON We found your last BMI data:
Weight: ${latestSession.weight} kg
Height: ${latestSession.height} cm
BMI: ${latestSession.bmi.toFixed(1)} (${latestSession.status})

1. Update with new data
2. Use existing data`
          : `CON Twabonye amakuru ya BMI yawe ya nyuma:
Ibiro: ${latestSession.weight} kg
Uburebure: ${latestSession.height} cm
BMI: ${latestSession.bmi.toFixed(1)} (${latestSession.status})

1. Hindura amakuru mashya
2. Koresha aya makuru`;
      } else {
        // No previous session, ask for weight
        response = lang === '1'
          ? `CON Enter your weight in KG:`
          : `CON Injiza ibiro byawe mu KG:`;
      }
    }
    else if (inputs.length === 2 && inputs[1] === '2' && latestSession) {
      // User wants to use existing data, show BMI & ask for tips
      response = lang === '1'
        ? `CON Your BMI is ${latestSession.bmi.toFixed(1)} (${latestSession.status})
Would you like health tips?
1. Yes
2. No
0. Go Back`
        : `CON BMI yawe ni ${latestSession.bmi.toFixed(1)} (${latestSession.status})
Waba ushaka inama z'ubuzima?
1. Yego
2. Oya
0. Subira inyuma`;
    }
    else if (inputs.length === 2 && inputs[1] === '1') {
      // User chose to update with new data -> ask for weight
      response = lang === '1'
        ? `CON Enter your weight in KG:`
        : `CON Injiza ibiro byawe mu KG:`;
    }
    else if (inputs.length === 2) {
      // Invalid choice
      response = lang === '1'
        ? 'END Invalid option.'
        : 'END Igisubizo si cyo.';
    }
    else if (inputs.length === 3) {
      // Asked for height
      response = lang === '1'
        ? `CON Enter your height in CM:
(Enter 0 to go back)`
        : `CON Injiza uburebure bwawe mu CM:
(Andika 0 usubire inyuma)`;
    }
    else if (inputs.length === 4) {
      // Calculate BMI and save session
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);

      if (isNaN(weight) || isNaN(height)) {
        response = lang === '1'
          ? 'END Invalid weight or height. Please enter valid numbers.'
          : 'END Ibiro cyangwa uburebure si imibare yemewe. Ongera ugerageze.';
      } else {
        const bmi = weight / ((height / 100) ** 2);
        let status = '';
        if (bmi < 18.5) status = lang === '1' ? 'Underweight' : 'Ufite ibiro biri hasi';
        else if (bmi < 25) status = lang === '1' ? 'Normal' : 'Bisanzwe';
        else if (bmi < 30) status = lang === '1' ? 'Overweight' : 'Ufite ibiro byinshi';
        else status = lang === '1' ? 'Obese' : 'Ufite ibiro bikabije';

        await pool.query(
          `INSERT INTO bmi_sessions (user_id, session_id, phone_number, weight, height, bmi, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, sessionId, phoneNumber, weight, height, bmi, status]
        );

        response = lang === '1'
          ? `CON Your BMI is ${bmi.toFixed(1)} (${status})
Would you like health tips?
1. Yes
2. No
0. Go Back`
          : `CON BMI yawe ni ${bmi.toFixed(1)} (${status})
Waba ushaka inama z'ubuzima?
1. Yego
2. Oya
0. Subira inyuma`;
      }
    }
    else if (inputs.length === 5) {
      // Provide health tips or exit
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);
      const wantTips = inputs[4];
      const bmi = weight / ((height / 100) ** 2);

      let tip = '';
      if (bmi < 18.5) {
        tip = lang === '1'
          ? 'Eat more calories and protein. Consult a doctor.'
          : 'Fata ibiryo byinshi birimo poroteyine. Ganira na muganga.';
      } else if (bmi < 25) {
        tip = lang === '1'
          ? 'You are healthy. Maintain balanced meals.'
          : 'Uri muzima. Kurikiza indyo yuzuye.';
      } else if (bmi < 30) {
        tip = lang === '1'
          ? 'Exercise regularly and avoid junk food.'
          : 'Jya ukora imyitozo kandi wirinde ibiryo bibi.';
      } else {
        tip = lang === '1'
          ? 'See a doctor and follow a strict diet.'
          : 'Ganira na muganga kandi ukurikize indyo ikomeye.';
      }

      response = wantTips === '1'
        ? `END ${tip}`
        : wantTips === '2'
          ? lang === '1'
            ? 'END Thank you for using our service.'
            : 'END Murakoze gukoresha serivisi yacu.'
          : lang === '1'
            ? 'END Invalid option.'
            : 'END Igisubizo si cyo.';
    } else {
      response = lang === '1'
        ? 'END Invalid input. Please restart.'
        : 'END Ikosa ryabaye. Ongera utangire.';
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
  } catch (error) {
    console.error('🚨 Error:', error);
    res.status(500).send('END Internal server error.');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`USSD app running on port ${PORT}`);
});
