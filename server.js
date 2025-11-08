const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const vader = require('vader-sentiment');

const app = express();
const PORT = 5000;
const saltRounds = 10;

app.use(express.json());
app.use(cors());

// Connect to SQLite Database
const db = new sqlite3.Database('./feedback.db', (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Ensure tables exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    role TEXT CHECK(role IN ('guest', 'user', 'admin')),
    feedback_type TEXT,
    feedback_text TEXT,
    sentiment_label TEXT,
    sentiment_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// Register user
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err)
      return res.status(500).json({ error: 'Server error' });
    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], function (err) {
      if (err)
        return res.status(400).json({ error: 'User already exists or DB error' });
      db.get(`SELECT id FROM users WHERE username = ?`, [username], (e, row) => {
        if (e) return res.status(500).json({ error: 'Failed to fetch user ID after register.' });
        res.json({ success: true, userId: row.id });
      });
    });
  });
});

// Login user
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  db.get(`SELECT id, password FROM users WHERE username = ?`, [username], (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Invalid username or password' });
    bcrypt.compare(password, row.password, (err, valid) => {
      if (err || !valid) return res.status(400).json({ error: 'Invalid username or password' });
      res.json({ success: true, userId: row.id });
    });
  });
});

// Save feedback
app.post('/api/feedback', (req, res) => {
  const { user_id, username, role, feedback_type, feedback_text } = req.body;
  if (!feedback_text || !role || (!username && !user_id))
    return res.status(400).json({ error: 'Missing feedback fields' });

  // Sentiment analysis
  const sentiment = vader.SentimentIntensityAnalyzer.polarity_scores(feedback_text);
  let sentiment_label = 'neutral';
  if (sentiment.compound > 0.3) sentiment_label = 'positive';
  else if (sentiment.compound < -0.3) sentiment_label = 'negative';
  const sentiment_score = sentiment.compound;

  db.run(
    `INSERT INTO feedback (user_id, username, role, feedback_type, feedback_text, sentiment_label, sentiment_score) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user_id || null, username || '', role, feedback_type || '', feedback_text, sentiment_label, sentiment_score],
    function (err) {
      if (err) {
        console.error('Failed to save feedback:', err.message);
        return res.status(500).json({ error: 'Failed to save feedback' });
      }
      res.json({ success: true });
    }
  );
});

// Fetch all feedback (Admin)
app.get('/api/all-feedback', (req, res) => {
  db.all('SELECT * FROM feedback ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      console.error('Error fetching feedbacks:', err.message);
      return res.status(500).json({ error: 'DB error fetching feedbacks' });
    }
    res.json(rows);
  });
});

// Fetch user feedback (by id)
app.get('/api/feedback/user/:userId', (req, res) => {
  const userId = req.params.userId;
  db.all('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, rows) => {
    if (err) {
      console.error('Error fetching user feedback:', err.message);
      return res.status(500).json({ error: 'DB error fetching user feedback' });
    }
    res.json(rows);
  });
});

// Sentiment summary (pie chart)
app.get('/api/sentiment-summary', (req, res) => {
  db.all(`SELECT sentiment_label, COUNT(*) as count FROM feedback GROUP BY sentiment_label`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching sentiment summary:', err.message);
      return res.status(500).json({ error: 'DB error fetching sentiment summary' });
    }
    res.json(rows);
  });
});

// Feedback count by type (bar chart)
app.get('/api/feedback-count-by-type', (req, res) => {
  db.all(`SELECT feedback_type, COUNT(*) as count FROM feedback GROUP BY feedback_type`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching feedback count by type:', err.message);
      return res.status(500).json({ error: 'DB error fetching feedback count by type' });
    }
    res.json(rows);
  });
});

// Average sentiment score over time (line chart)
app.get('/api/avg-sentiment-over-time', (req, res) => {
  db.all(
    `SELECT DATE(created_at) AS date, AVG(sentiment_score) AS avg_score 
     FROM feedback 
     GROUP BY DATE(created_at) 
     ORDER BY DATE(created_at)`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching avg sentiment over time:', err.message);
        return res.status(500).json({ error: 'DB error fetching avg sentiment over time' });
      }
      res.json(rows);
    }
  );
});

// Robust DELETE feedback endpoint
app.delete('/api/delete-feedback/:id', (req, res) => {
  const feedbackId = req.params.id;
  if (!feedbackId || isNaN(feedbackId)) {
    return res.status(400).json({ success: false, message: 'Invalid feedback ID.' });
  }
  db.run('DELETE FROM feedback WHERE id = ?', [feedbackId], function (err) {
    if (err) {
      console.error('Failed to delete feedback:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to delete feedback.' });
    }
    if (this.changes > 0) {
      res.json({ success: true, message: 'Feedback deleted successfully.' });
    } else {
      res.status(404).json({ success: false, message: 'Feedback not found.' });
    }
  });
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
