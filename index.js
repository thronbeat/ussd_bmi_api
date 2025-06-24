const express = require('express');
const pool = require('./db');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// GET request: basic connectivity test
app.get('/ussd', (req, res) => {
  res.send(`CON Welcome to Health BMI App`);
});

// POST request: USSD interaction logic
app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text = '' } = req.body;
  let inputs = text.split('*');
  const lang = inputs[0];
  let response = '';

  console.log(`Session: ${sessionId}, Phone: ${phoneNumber}, Text: ${text}, Inputs:`, inputs);

  try {
    // Insert user on language selection
    if (lang === '1' || lang === '2') {
      await pool.query(
        `INSERT INTO users (phone_number, language)
         VALUES ($1, $2)
         ON CONFLICT (phone_number) DO NOTHING`,
        [phoneNumber, lang === '1' ? 'EN' : 'RW']
      );
    }

    // Get user id
    const userResult = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phoneNumber]);
    const userId = userResult.rows.length ? userResult.rows[0].id : null;

    // Handle back navigation (input '0')
    if (inputs.includes('0')) {
      const index = inputs.lastIndexOf('0');
      inputs = inputs.slice(0, index);
    }

    // Menu navigation logic
    if (inputs.length === 0 || inputs[0] === '') {
      response = `CON Welcome to Health BMI App
1. English
2. Kinyarwanda`;
    } else if (inputs.length === 1) {
      response = inputs[0] === '1'
        ? `CON Enter your weight in KG:
0. Back`
        : `CON Injiza ibiro byawe mu KG:
0. Subira inyuma`;
    } else if (inputs.length === 2) {
      response = inputs[0] === '1'
        ? `CON Enter your height in CM:
0. Back`
        : `CON Injiza uburebure bwawe mu CM:
0. Subira inyuma`;
    } else if (inputs.length === 3) {
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);

      if (isNaN(weight) || isNaN(height)) {
        response = inputs[0] === '1'
          ? 'END Invalid weight or height. Please enter valid numbers.'
          : 'END Ibiro cyangwa uburebure si imibare yemewe. Ongera ugerageze.';
      } else {
        const bmi = weight / ((height / 100) ** 2);
        let status = '';
        if (bmi < 18.5) status = inputs[0] === '1' ? 'Underweight' : 'Ufite ibiro biri hasi';
        else if (bmi < 25) status = inputs[0] === '1' ? 'Normal' : 'Bisanzwe';
        else if (bmi < 30) status = inputs[0] === '1' ? 'Overweight' : 'Ufite ibiro byinshi';
        else status = inputs[0] === '1' ? 'Obese' : 'Ufite ibiro bikabije';

        // Save session with phone number
        if (userId) {
          await pool.query(
            `INSERT INTO bmi_sessions (user_id, phone_number, session_id, weight, height, bmi, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, phoneNumber, sessionId, weight, height, bmi, status]
          );
        }

        response = inputs[0] === '1'
          ? `CON Your BMI is ${bmi.toFixed(1)} (${status})
Would you like health tips?
1. Yes
2. No
0. Back`
          : `CON BMI yawe ni ${bmi.toFixed(1)} (${status})
Waba ushaka inama z'ubuzima?
1. Yego
2. Oya
0. Subira inyuma`;
      }
    } else if (inputs.length === 4) {
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);
      const wantTips = inputs[3];
      const bmi = weight / ((height / 100) ** 2);

      let tip = '';
      if (bmi < 18.5) {
        tip = inputs[0] === '1'
          ? 'Eat more calories and protein. Consult a doctor.'
          : 'Fata ibiryo byinshi birimo poroteyine. Ganira na muganga.';
      } else if (bmi < 25) {
        tip = inputs[0] === '1'
          ? 'You are healthy. Maintain balanced meals.'
          : 'Uri muzima. Kurikiza indyo yuzuye.';
      } else if (bmi < 30) {
        tip = inputs[0] === '1'
          ? 'Exercise regularly and avoid junk food.'
          : 'Jya ukora imyitozo kandi wirinde ibiryo bibi.';
      } else {
        tip = inputs[0] === '1'
          ? 'See a doctor and follow a strict diet.'
          : 'Ganira na muganga kandi ukurikize indyo ikomeye.';
      }

      if (wantTips === '1') {
        response = `END ${tip}`;
      } else if (wantTips === '2') {
        response = inputs[0] === '1'
          ? 'END Thank you for using our service.'
          : 'END Murakoze gukoresha serivisi yacu.';
      } else {
        response = inputs[0] === '1'
          ? 'END Invalid option.'
          : 'END Igisubizo si cyo.';
      }
    } else {
      response = inputs[0] === '1'
        ? 'END Invalid input. Please restart.'
        : 'END Ikosa ryabaye. Ongera utangire.';
    }

    // Send response
    res.set('Content-Type', 'text/plain');
    res.send(response);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('END Internal server error.');
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ USSD BMI app running at http://localhost:${PORT}/ussd`);
});
