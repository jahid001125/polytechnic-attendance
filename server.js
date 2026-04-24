const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ── MongoDB Connection ────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://jahidulislam8511_db_user:SEeImHXD1LYhuU7i@cluster0.0tagxqv.mongodb.net/polytechnic?appName=Cluster0';

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('✅ MongoDB Connected!'))
  .catch(err => console.error('❌ MongoDB Error:', err.message));

// ── Schemas ───────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ['admin', 'teacher', 'student'] },
  department: String,
  studentId: String,
  semester: String,
  approved: { type: Boolean, default: false }
});

const attendanceSchema = new mongoose.Schema({
  sessionId: String,
  subject: String,
  department: String,
  teacherId: String,
  studentId: String,
  studentName: String,
  date: String,
  time: String
});

const pendingSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'student' },
  department: String,
  studentId: String,
  semester: String,
  requestedAt: String
});

const User = mongoose.model('User', userSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const Pending = mongoose.model('Pending', pendingSchema);

// ── Seed default users ────────────────────────────────
async function seedUsers() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      await User.insertMany([
        { name: 'Admin', email: 'admin@poly.edu', password: 'admin123', role: 'admin', department: 'All', approved: true },
        { name: 'Mr. Rahman', email: 'rahman@poly.edu', password: 'teacher123', role: 'teacher', department: 'CST', approved: true },
        { name: 'Ms. Fatema', email: 'fatema@poly.edu', password: 'teacher123', role: 'teacher', department: 'EET', approved: true },
        { name: 'Rahim Mia', email: 'rahim@poly.edu', password: 'student123', role: 'student', department: 'CST', studentId: 'CST-001', semester: '4th', approved: true },
        { name: 'Karim Uddin', email: 'karim@poly.edu', password: 'student123', role: 'student', department: 'CST', studentId: 'CST-002', semester: '4th', approved: true },
        { name: 'Sadia Islam', email: 'sadia@poly.edu', password: 'student123', role: 'student', department: 'EET', studentId: 'EET-001', semester: '2nd', approved: true }
      ]);
      console.log('✅ Default users created!');
    }
  } catch(e) {
    console.error('Seed error:', e.message);
  }
}

let activeSessions = {};

// ── AUTH: Login ───────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) return res.json({ success: false, message: 'Invalid email or password!' });
    if (!user.approved) return res.json({ success: false, message: '⏳ Your account is pending approval!' });
    const { password: _, ...safeUser } = user.toObject();
    res.json({ success: true, user: safeUser });
  } catch(e) {
    res.json({ success: false, message: 'Server error!' });
  }
});

// ── AUTH: Student Signup ──────────────────────────────
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password, department, studentId, semester } = req.body;
    const existUser = await User.findOne({ email });
    const existPending = await Pending.findOne({ email });
    if (existUser || existPending) return res.json({ success: false, message: 'Email already registered!' });
    await Pending.create({ name, email, password, department, studentId, semester, requestedAt: new Date().toLocaleDateString('en-BD') });
    res.json({ success: true, message: '✅ Signup request sent! Wait for admin approval.' });
  } catch(e) {
    res.json({ success: false, message: 'Server error!' });
  }
});

// ── ADMIN: Pending requests ───────────────────────────
app.get('/api/pending', async (req, res) => {
  const pending = await Pending.find();
  res.json({ success: true, pending });
});

app.post('/api/approve/:id', async (req, res) => {
  try {
    const pending = await Pending.findById(req.params.id);
    if (!pending) return res.json({ success: false, message: 'Not found' });
    const obj = pending.toObject();
    delete obj._id;
    await User.create({ ...obj, approved: true });
    await Pending.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User approved!' });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

app.delete('/api/pending/:id', async (req, res) => {
  await Pending.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── TEACHER: Generate QR ──────────────────────────────
app.post('/api/generate-qr', async (req, res) => {
  const { teacherId, subject, department, teacherLat, teacherLng } = req.body;
  const sessionId = uuidv4();
  activeSessions[sessionId] = {
    sessionId, teacherId, subject, department,
    teacherLat, teacherLng,
    createdAt: Date.now(),
    sessionExpiresAt: Date.now() + 60 * 60 * 1000,
    attendees: [],
    currentToken: uuidv4(),
    tokenExpiresAt: Date.now() + 5 * 60 * 1000
  };
  const qrData = JSON.stringify({ sessionId, token: activeSessions[sessionId].currentToken });
  const qrImage = await QRCode.toDataURL(qrData);
  res.json({ success: true, sessionId, qrImage, subject, department });
});

app.post('/api/refresh-qr/:sessionId', async (req, res) => {
  const session = activeSessions[req.params.sessionId];
  if (!session) return res.json({ success: false });
  session.currentToken = uuidv4();
  session.tokenExpiresAt = Date.now() + 5 * 60 * 1000;
  const qrData = JSON.stringify({ sessionId: session.sessionId, token: session.currentToken });
  const qrImage = await QRCode.toDataURL(qrData);
  res.json({ success: true, qrImage });
});

app.get('/api/session/:sessionId', (req, res) => {
  const session = activeSessions[req.params.sessionId];
  if (!session) return res.json({ success: false });
  res.json({ success: true, session });
});

// ── STUDENT: Mark attendance ──────────────────────────
app.post('/api/attend', async (req, res) => {
  try {
    const { sessionId, token, studentId, studentName, department, studentLat, studentLng } = req.body;
    const session = activeSessions[sessionId];
    if (!session) return res.json({ success: false, message: '❌ QR code invalid!' });
    if (Date.now() > session.sessionExpiresAt) {
      delete activeSessions[sessionId];
      return res.json({ success: false, message: '❌ Class session ended!' });
    }
    if (token !== session.currentToken || Date.now() > session.tokenExpiresAt) {
      return res.json({ success: false, message: '❌ QR expired! Ask teacher to show current QR.' });
    }
    if (session.teacherLat && session.teacherLng && studentLat && studentLng) {
      const distance = getDistance(session.teacherLat, session.teacherLng, studentLat, studentLng);
      if (distance > 50) return res.json({ success: false, message: `❌ You are ${Math.round(distance)}m away!` });
    }
    if (session.attendees.find(a => a.studentId === studentId)) {
      return res.json({ success: false, message: '⚠️ Already marked!' });
    }
    const record = { studentId, studentName, department, time: new Date().toLocaleTimeString('en-BD') };
    session.attendees.push(record);
    await Attendance.create({ sessionId, subject: session.subject, department: session.department, teacherId: session.teacherId, date: new Date().toLocaleDateString('en-BD'), ...record });
    res.json({ success: true, message: '✅ Attendance marked successfully!' });
  } catch(e) {
    res.json({ success: false, message: 'Server error!' });
  }
});

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

app.get('/api/my-attendance/:studentId', async (req, res) => {
  const records = await Attendance.find({ studentId: req.params.studentId });
  res.json({ success: true, records });
});

app.get('/api/users', async (req, res) => {
  const users = await User.find({}, { password: 0 });
  res.json({ success: true, users });
});

app.post('/api/users', async (req, res) => {
  try {
    const exist = await User.findOne({ email: req.body.email });
    if (exist) return res.json({ success: false, message: 'Email already exists!' });
    const user = await User.create({ ...req.body, approved: true });
    res.json({ success: true, user });
  } catch(e) {
    res.json({ success: false, message: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.get('/api/attendance', async (req, res) => {
  const attendance = await Attendance.find();
  res.json({ success: true, attendance });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));

app.listen(PORT, async () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  setTimeout(seedUsers, 5000);
});
