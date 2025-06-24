const express = require('express');
const pool = require('./db');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/ussd', (req, res) => {
  res.send(`CON Welcome to Health BMI App`);
});

app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text = '' } = req.body;
  const inputs = text.split('*');
  const lang = inputs[0];
  let response = '';

  console.log(`Session: ${sessionId}, Phone: ${phoneNumber}, Text: ${text}, Inputs:`, inputs);

  try {
    if (lang === '1' || lang === '2') {
      await pool.query(
        `INSERT INTO users (phone_number, language)
         VALUES ($1, $2)
         ON CONFLICT (phone_number) DO NOTHING`,
        [phoneNumber, lang === '1' ? 'EN' : 'RW']
      );
    }

    const userResult = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phoneNumber]);
    const userId = userResult.rows.length ? userResult.rows[0].id : null;

    if (text === '') {
      response = `CON Welcome to Health BMI App
1. English
2. Kinyarwanda`;
    } else if (inputs.length === 1) {
      response = lang === '1'
        ? `CON Enter your weight in KG:`
        : `CON Injiza ibiro byawe mu KG:`;
    } else if (inputs.length === 2) {
      response = lang === '1'
        ? `CON Enter your height in CM:`
        : `CON Injiza uburebure bwawe mu CM:`;
    } else if (inputs.length === 3) {
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

        if (userId) {
          await pool.query(
            `INSERT INTO bmi_sessions (user_id, session_id, weight, height, bmi, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, sessionId, weight, height, bmi, status]
          );
        }

        response = lang === '1'
          ? `CON Your BMI is ${bmi.toFixed(1)} (${status})
Would you like health tips?
1. Yes
2. No`
          : `CON BMI yawe ni ${bmi.toFixed(1)} (${status})
Waba ushaka inama z'ubuzima?
1. Yego
2. Oya`;
      }
    } else if (inputs.length === 4) {
      const weight = parseFloat(inputs[1]);
      const height = parseFloat(inputs[2]);
      const wantTips = inputs[3];
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

      if (wantTips === '1') {
        response = `END ${tip}`;
      } else if (wantTips === '2') {
        response = lang === '1'
          ? 'END Thank you for using our service.'
          : 'END Murakoze gukoresha serivisi yacu.';
      } else {
        response = lang === '1'
          ? 'END Invalid option.'
          : 'END Igisubizo si cyo.';
      }
    } else {
      response = lang === '1'
        ? 'END Invalid input. Please restart.'
        : 'END Ikosa ryabaye. Ongera utangire.';
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('END Internal server error.');
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ USSD BMI app running at http://localhost:${PORT}/ussd`);
});
