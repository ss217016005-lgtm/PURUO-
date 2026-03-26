const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.PORT;
const DATA_DIR = isRailway ? '/app/data' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const defaultDB = {
    users: [], categories: ["תמונות והסרטות", "עזרה הדדית", "למעשה", "הפורום שלנו", "חדשות בציבור"],
    posts: [], reports: [], pms: []
};

const readDB = () => {
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDB, null, 2)); return defaultDB; }
    let db = JSON.parse(fs.readFileSync(DATA_FILE));
    let needsSave = false;

    if (!db.reports) { db.reports = []; needsSave = true; }
    if (!db.pms) { db.pms = []; needsSave = true; }
    if (db.users) {
        db.users.forEach(user => {
            if (!user.role) { user.role = user.isAdmin ? 'admin' : 'user'; needsSave = true; }
            if (!user.joinDate) { user.joinDate = "משתמש ותיק"; needsSave = true; }
            if (!user.notifications) { user.notifications = []; needsSave = true; }
        });
    }
    if (needsSave) fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
};
const writeDB = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

const upload = multer({ dest: UPLOADS_DIR });
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// === משתמשים ===
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "שם המשתמש כבר קיים." });
    db.users.push({ username, password, isApproved: false, role: db.users.length === 0 ? 'admin' : 'user', joinDate: new Date().toLocaleDateString('he-IL'), lastSeen: Date.now(), notifications: [] });
    writeDB(db); res.json({ message: "נרשמת בהצלחה. המתן לאישור מנהל." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && user.role !== 'admin') return res.status(403).json({ error: "ממתין לאישור מנהל." });
    user.lastSeen = Date.now(); writeDB(db);
    res.json({ message: "התחברת!", username: user.username, role: user.role });
});

app.get('/api/users/info', (req, res) => {
    const db = readDB(); const info = {};
    db.users.forEach(u => { info[u.username] = { role: u.role || 'user', joinDate: u.joinDate || 'לא ידוע' }; });
    res.json(info);
});

app.post('/api/ping', (req, res) => {
    const { username } = req.body; const db = readDB();
    if (username) { const user = db.users.find(u => u.username === username); if (user) user.lastSeen = Date.now(); writeDB(db); }
    res.json({ 
        onlineUsers: db.users.filter(u => u.lastSeen > Date.now() - 3 * 60 * 1000).map(u => u.username),
        registeredUsers: db.users.filter(u => u.isApproved || u.role === 'admin').map(u => u.username)
    });
});

// === התראות והודעות פרטיות ===
app.get('/api/notifications/:username', (req, res) => {
    const user = readDB().users.find(u => u.username === req.params.username);
    res.json(user ? user.notifications : []);
});
app.post('/api/notifications/read', (req, res) => {
    const db = readDB(); const user = db.users.find(u => u.username === req.body.username);
    if (user) { user.notifications.forEach(n => n.read = true); writeDB(db); }
    res.json({ success: true });
});

app.get('/api/pms/:username', (req, res) => {
    const pms = readDB().pms.filter(p => p.to === req.params.username || p.from === req.params.username);
    res.json(pms);
});
app.post('/api/pms', (req, res) => {
    const { from, to, content } = req.body; const db = readDB();
    const toUser = db.users.find(u => u.username === to);
    if (!toUser) return res.status(404).json({ error: "משתמש לא נמצא." });
    
    db.pms.push({ id: Date.now(), from, to, content, date: new Date().toLocaleString('he-IL') });
    toUser.notifications.push({ id: Date.now(), text: `✉️ הודעה פרטית חדשה מאת ${from}`, read: false, date: new Date().toLocaleString('he-IL') });
    writeDB(db); res.json({ success: true });
});

// === פוסטים ותגובות ===
app.get('/api/categories', (req, res) => res.json(readDB().categories));
app.get('/api/posts', (req, res) => res.json(readDB().posts));

app.post('/api/posts', upload.single('attachedFile'), (req, res) => {
    const { author, title, content, category } = req.body; const db = readDB();
    const newPost = { id: Date.now(), author, title, category, content, date: new Date().toLocaleString('he-IL'), fileUrl: req.file ? `/uploads/${req.file.filename}` : null, likes: [], replies: [] };
    db.posts.push(newPost); writeDB(db); res.status(201).json(newPost);
});

app.post('/api/posts/:id/reply', upload.single('attachedFile'), (req, res) => {
    const { author, content } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: "אשכול לא נמצא." });
    
    const newReply = { id: Date.now(), author, content, date: new Date().toLocaleString('he-IL'), fileUrl: req.file ? `/uploads/${req.file.filename}` : null, likes: [] };
    post.replies.push(newReply);

    // התראה ליוצר האשכול
    const postAuthor = db.users.find(u => u.username === post.author);
    if (postAuthor && postAuthor.username !== author) {
        postAuthor.notifications.push({ id: Date.now(), text: `💬 ${author} הגיב לאשכול שלך "${post.title}"`, read: false, date: new Date().toLocaleString('he-IL') });
    }
    writeDB(db); res.status(201).json(newReply);
});

app.post('/api/like', (req, res) => {
    const { username, postId, replyId } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === postId);
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    if (target.author === username) return res.status(400).json({ error: "אי אפשר לעשות לייק לעצמך! 😊" });
    const likeIndex = target.likes.indexOf(username);
    if (likeIndex > -1) target.likes.splice(likeIndex, 1); else target.likes.push(username);
    writeDB(db); res.json({ success: true });
});

app.post('/api/report', (req, res) => {
    const { reporter, postId, replyId, reason } = req.body; const db = readDB();
    db.reports.push({ id: Date.now(), reporter, postId, replyId, reason, date: new Date().toLocaleString('he-IL') });
    writeDB(db); res.json({ success: true });
});

app.put('/api/posts/edit', (req, res) => {
    const { username, postId, replyId, newContent } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    target.content = newContent + `\n\n[נערך על ידי צוות הפיקוח]`;
    writeDB(db); res.json({ success: true });
});

// === קריאות אדמין (קריאה ומחיקה של דיווחים) ===
app.get('/api/admin/reports', (req, res) => res.json(readDB().reports));
app.delete('/api/admin/reports/:id', (req, res) => {
    const db = readDB(); db.reports = db.reports.filter(r => r.id !== parseInt(req.params.id));
    writeDB(db); res.json({ success: true });
});

app.get('/api/admin/pending-users', (req, res) => res.json(readDB().users.filter(u => !u.isApproved && u.role !== 'admin').map(u => u.username)));
app.post('/api/admin/approve', (req, res) => {
    const db = readDB(); const user = db.users.find(u => u.username === req.body.username);
    if (user) { user.isApproved = true; writeDB(db); res.json({ success: true }); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
