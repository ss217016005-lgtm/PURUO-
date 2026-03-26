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

// מסד הנתונים עם הקטגוריות החדשות והמבנה המשודרג
const defaultDB = {
    users: [], // { username, password, isApproved, isAdmin, lastSeen }
    categories: ["תמונות והסרטות", "עזרה הדדית", "למעשה", "הפורום שלנו"],
    posts: [] // { id, category, title, author, content, date, fileUrl, likes: [], replies: [] }
};

const readDB = () => {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDB, null, 2));
        return defaultDB;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE));
};

const writeDB = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// === משתמשים והתחברות ===
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "שם המשתמש כבר קיים." });
    
    db.users.push({ 
        username, password, 
        isApproved: false, 
        isAdmin: db.users.length === 0,
        lastSeen: Date.now()
    });
    writeDB(db);
    res.json({ message: "נרשמת בהצלחה." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);

    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && !user.isAdmin) return res.status(403).json({ error: "ממתין לאישור מנהל." });

    user.lastSeen = Date.now();
    writeDB(db);
    res.json({ message: "התחברת בהצלחה!", username: user.username, isAdmin: user.isAdmin });
});

// === מערכת מחוברים (Ping) ===
app.post('/api/ping', (req, res) => {
    const { username } = req.body;
    const db = readDB();
    
    if (username) {
        const user = db.users.find(u => u.username === username);
        if (user) user.lastSeen = Date.now();
        writeDB(db);
    }
    
    const threeMinsAgo = Date.now() - 3 * 60 * 1000;
    const onlineUsers = db.users.filter(u => u.lastSeen > threeMinsAgo).map(u => u.username);
    const registeredUsers = db.users.filter(u => u.isApproved || u.isAdmin).map(u => u.username);
    
    res.json({ onlineUsers, registeredUsers });
});

// === פוסטים (אשכולות), תגובות ולייקים ===
app.get('/api/categories', (req, res) => res.json(readDB().categories));
app.get('/api/posts', (req, res) => res.json(readDB().posts));

// פתיחת אשכול חדש
app.post('/api/posts', upload.single('attachedFile'), (req, res) => {
    const { author, title, content, category } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === author);
    if (!user || (!user.isApproved && !user.isAdmin)) return res.status(403).json({ error: "אין הרשאה." });

    const newPost = {
        id: Date.now(), author, title, category, content,
        date: new Date().toLocaleString('he-IL'),
        fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
        likes: [], replies: []
    };
    db.posts.push(newPost);
    writeDB(db);
    res.status(201).json(newPost);
});

// תגובה לאשכול
app.post('/api/posts/:id/reply', upload.single('attachedFile'), (req, res) => {
    const { author, content } = req.body;
    const db = readDB();
    const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: "אשכול לא נמצא." });

    const newReply = {
        id: Date.now(), author, content,
        date: new Date().toLocaleString('he-IL'),
        fileUrl: req.file ? `/uploads/${req.file.filename}` : null,
        likes: []
    };
    post.replies.push(newReply);
    writeDB(db);
    res.status(201).json(newReply);
});

// לייק לאשכול או לתגובה
app.post('/api/like', (req, res) => {
    const { username, postId, replyId } = req.body;
    const db = readDB();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "לא נמצא" });

    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    if (!target) return res.status(404).json({ error: "לא נמצא" });

    const likeIndex = target.likes.indexOf(username);
    if (likeIndex > -1) target.likes.splice(likeIndex, 1); // ביטול לייק
    else target.likes.push(username); // הוספת לייק

    writeDB(db);
    res.json({ success: true, likes: target.likes });
});

// === ניהול ===
app.get('/api/admin/pending-users', (req, res) => {
    const db = readDB();
    res.json(db.users.filter(u => !u.isApproved && !u.isAdmin).map(u => u.username));
});
app.post('/api/admin/approve', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.username === req.body.username);
    if (user) { user.isApproved = true; writeDB(db); res.json({ success: true }); } 
    else res.status(404).json({ error: "לא נמצא." });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
