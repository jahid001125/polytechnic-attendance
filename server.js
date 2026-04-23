const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Data files
const USERS_FILE = './data/users.json';
const ATTENDANCE_FILE = './data/attendance.json';

// Initialize data files
function initData() {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      { id: '1', name: 'Admin', email: 'admin@poly.edu', password: 'admin123', role: 'admin', department: 'All' },
      { id: '2', name: 'Mr. Rahman', email: 'rahman@poly.edu', password: 'teacher123', role: 'teacher', department: 'CST' },
      { id: '3', name: 'Ms. Fatema', email: 'fatema@poly.edu', password: 'teacher123', role: 'teacher', department: 'EET' },
      { id: '4', name: 'Rahim Mia', email: 'rahim@poly.edu', password: 'student123', role: 'student', department: 'CST', studentId: 'CST-001', semester: '4th' },
      { id: '5', name: 'Karim Uddin', email: 'karim@poly.edu', password: 'student123', role: 'student', department: 'CST', studentId: 'CST-002', semester: '4th' },
      { id: '6', name: 'Sadia Islam', email: 'sadia@poly.edu', password: 'student123', role: 'student', department: 'EET', studentId: 'EET-001', semester: '2nd' }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
  }
  if (!fs.existsSync(ATTENDANCE_FILE)) {
    fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify([], null, 2));
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Active QR sessions (in memory)
let activeSessions = {};

// ── AUTH ──────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.email === email && u.password === password);
  if (user) {
    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } else {
    res.json({ success: false, message: 'Invalid email or password' });
  }
});

// ── TEACHER: Generate QR ──────────────────────────────
app.post('/api/generate-qr', async (req, res) => {
  const { teacherId, subject, department } = req.body;
  const sessionId = uuidv4();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  activeSessions[sessionId] = {
    sessionId, teacherId, subject, department,
    createdAt: Date.now(), expiresAt, attendees: []
  };

  const qrData = JSON.stringify({ sessionId, subject, department });
  const qrImage = await QRCode.toDataURL(qrData);

  res.json({ success: true, sessionId, qrImage, expiresAt, subject, department });
});

// ── TEACHER: Get live session ─────────────────────────
app.get('/api/session/:sessionId', (req, res) => {
  const session = activeSessions[req.params.sessionId];
  if (!session) return res.json({ success: false, message: 'Session not found or expired' });
  res.json({ success: true, session });
});

// ── STUDENT: Mark attendance ──────────────────────────
app.post('/api/attend', (req, res) => {
  const { sessionId, studentId, studentName, department } = req.body;
  const session = activeSessions[sessionId];

  if (!session) return res.json({ success: false, message: 'QR code expired or invalid!' });
  if (Date.now() > session.expiresAt) {
    delete activeSessions[sessionId];
    return res.json({ success: false, message: 'QR code has expired!' });
  }
  if (session.attendees.find(a => a.studentId === studentId)) {
    return res.json({ success: false, message: 'Already marked attendance!' });
  }

  const record = {
    studentId, studentName, department,
    time: new Date().toLocaleTimeString('en-BD')
  };
  session.attendees.push(record);

  const attendance = readJSON(ATTENDANCE_FILE);
  attendance.push({
    sessionId, subject: session.subject,
    department: session.department,
    teacherId: session.teacherId,
    date: new Date().toLocaleDateString('en-BD'),
    ...record
  });
  writeJSON(ATTENDANCE_FILE, attendance);

  res.json({ success: true, message: 'Attendance marked successfully!' });
});

// ── STUDENT: Get own attendance ───────────────────────
app.get('/api/my-attendance/:studentId', (req, res) => {
  const attendance = readJSON(ATTENDANCE_FILE);
  const records = attendance.filter(a => a.studentId === req.params.studentId);
  res.json({ success: true, records });
});

// ── ADMIN: Get all users ──────────────────────────────
app.get('/api/users', (req, res) => {
  const users = readJSON(USERS_FILE).map(({ password: _, ...u }) => u);
  res.json({ success: true, users });
});

app.post('/api/users', (req, res) => {
  const users = readJSON(USERS_FILE);
  const newUser = { id: uuidv4(), ...req.body };
  users.push(newUser);
  writeJSON(USERS_FILE, users);
  res.json({ success: true, user: newUser });
});

app.delete('/api/users/:id', (req, res) => {
  let users = readJSON(USERS_FILE);
  users = users.filter(u => u.id !== req.params.id);
  writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

// ── ADMIN: All attendance ─────────────────────────────
app.get('/api/attendance', (req, res) => {
  const attendance = readJSON(ATTENDANCE_FILE);
  res.json({ success: true, attendance });
});

// ── Serve pages ───────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student.html')));

initData();
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
