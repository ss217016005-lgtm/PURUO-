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
    posts: [], reports: [], messages: [] 
};

// שדרוג מסד הנתונים השקט
const readDB = () => {
    if (!fs.existsSync(DATA_FILE)) { fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDB, null, 2)); return defaultDB; }
    let db = JSON.parse(fs.readFileSync(DATA_FILE));
    let needsSave = false;

    if (!db.reports) { db.reports = []; needsSave = true; }
    if (!db.messages) { db.messages = []; needsSave = true; }
    if (db.categories && !db.categories.includes("חדשות בציבור")) { db.categories.push("חדשות בציבור"); needsSave = true; }
    
    if (db.users) {
        db.users.forEach(user => {
            if (!user.role) { user.role = user.isAdmin ? 'admin' : 'user'; needsSave = true; }
            if (!user.joinDate || user.joinDate === "משתמש ותיק") { user.joinDate = new Date().toLocaleDateString('he-IL'); needsSave = true; }
            if (!user.notifications) { user.notifications = []; needsSave = true; }
            if (user.totalLikes === undefined) { user.totalLikes = 0; needsSave = true; }
            if (user.veteranProgress === undefined) { user.veteranProgress = 0; needsSave = true; }
            if (user.lastActive === undefined) { user.lastActive = user.lastSeen || Date.now(); needsSave = true; }
        });
    }
    if (db.posts) {
        db.posts.forEach(post => { 
            if (!post.followers) { post.followers = [post.author]; needsSave = true; } 
            if (post.isLocked === undefined) { post.isLocked = false; needsSave = true; }
        });
    }

    if (needsSave) fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
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

// === עזרים (כמו זיהוי תיוגים) ===
function isVeteran(user) { return (user.role === 'admin' || user.role === 'mod' || user.veteranProgress >= 10); }

function notifyMentions(content, author, postTitle, threadId, db) {
    const mentions = [...new Set((content.match(/@([א-תa-zA-Z0-9_]+)/g) || []).map(m => m.substring(1)))];
    mentions.forEach(username => {
        const u = db.users.find(x => x.username === username);
        if (u && u.username !== author) {
            u.notifications.push({ text: `תויגת על ידי ${author} באשכול: "${postTitle}"`, threadId: threadId });
        }
    });
}

// === משתמשים והתחברות ===
app.post('/api/register', (req, res) => {
    const { username, password } = req.body; const db = readDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "שם המשתמש כבר קיים." });
    db.users.push({ 
        username, password, isApproved: false, role: db.users.length === 0 ? 'admin' : 'user', 
        joinDate: new Date().toLocaleDateString('he-IL'), lastSeen: Date.now(), lastActive: Date.now(),
        notifications: [], totalLikes: 0, veteranProgress: 0
    });
    writeDB(db); res.json({ message: "נרשמת בהצלחה. המתן לאישור מנהל." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && user.role !== 'admin') return res.status(403).json({ error: "ממתין לאישור מנהל." });
    user.lastSeen = Date.now(); user.lastActive = Date.now(); writeDB(db);
    res.json({ message: "התחברת בהצלחה!", username: user.username, role: user.role });
});

app.get('/api/users/info', (req, res) => {
    const db = readDB(); const info = {};
    db.users.forEach(u => { info[u.username] = { role: u.role || 'user', joinDate: u.joinDate || '', totalLikes: u.totalLikes || 0, isVeteran: isVeteran(u) }; });
    res.json(info);
});

// === מחוברים והתראות ===
app.post('/api/ping', (req, res) => {
    const { username } = req.body; const db = readDB();
    let unreadCount = 0, unreadMessages = 0;
    if (username) {
        const user = db.users.find(u => u.username === username);
        if (user) {
            const now = Date.now(); const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
            if (now - user.lastActive > FIVE_DAYS) user.veteranProgress = 0;
            user.lastSeen = now; user.lastActive = now;
            unreadCount = user.notifications ? user.notifications.length : 0;
            unreadMessages = db.messages.filter(m => m.to === username && !m.read).length;
        }
        writeDB(db);
    }
    const threeMinsAgo = Date.now() - 3 * 60 * 1000;
    const onlineUsers = db.users.filter(u => u.lastSeen > threeMinsAgo).map(u => u.username);
    const registeredUsers = db.users.filter(u => u.isApproved || u.role === 'admin').map(u => u.username);
    res.json({ onlineUsers, registeredUsers, unreadCount, unreadMessages });
});

app.post('/api/notifications/clear', (req, res) => {
    const { username } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    let myNotifs = [];
    if (user) { myNotifs = [...user.notifications]; user.notifications = []; writeDB(db); }
    res.json({ notifications: myNotifs });
});

app.get('/api/messages/:username', (req, res) => {
    const db = readDB(); const msgs = db.messages.filter(m => m.to === req.params.username).reverse();
    msgs.forEach(m => m.read = true); writeDB(db); res.json(msgs);
});

app.post('/api/messages', (req, res) => {
    const { from, to, content } = req.body; const db = readDB();
    const sender = db.users.find(u => u.username === from), receiver = db.users.find(u => u.username === to);
    if (!receiver) return res.status(404).json({ error: "משתמש לא קיים." });
    if (!isVeteran(sender)) return res.status(403).json({ error: "רק 'משתמש ותיק' יכול לשלוח פרטיות." });

    db.messages.push({ id: Date.now(), from, to, content, date: new Date().toLocaleString('he-IL'), read: false });
    if (receiver) receiver.notifications.push({ text: `קיבלת הודעה פרטית חדשה מ-${from}!`, threadId: null });
    writeDB(db); res.json({ success: true, message: "ההודעה נשלחה!" });
});

// === פוסטים ותגובות ===
app.get('/api/categories', (req, res) => res.json(readDB().categories));
app.get('/api/posts', (req, res) => res.json(readDB().posts));

app.post('/api/posts', upload.single('attachedFile'), (req, res) => {
    const { author, title, content, category } = req.body; const db = readDB();
    const newPost = { id: Date.now(), author, title, category, content, date: new Date().toLocaleString('he-IL'), fileUrl: req.file ? `/uploads/${req.file.filename}` : null, likes: [], replies: [], followers: [author], isLocked: false };
    db.posts.push(newPost);
    notifyMentions(content, author, title, newPost.id, db); 
    writeDB(db); res.status(201).json(newPost);
});

app.post('/api/posts/:id/follow', (req, res) => {
    const { username } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: "לא נמצא" });
    const idx = post.followers.indexOf(username);
    if (idx > -1) post.followers.splice(idx, 1); else post.followers.push(username);
    writeDB(db); res.json({ success: true, followers: post.followers });
});

app.post('/api/posts/:id/reply', upload.single('attachedFile'), (req, res) => {
    const { author, content } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: "אשכול לא נמצא." });
    if (post.isLocked) return res.status(403).json({ error: "האשכול נעול לתגובות." });

    const newReply = { id: Date.now(), author, content, date: new Date().toLocaleString('he-IL'), fileUrl: req.file ? `/uploads/${req.file.filename}` : null, likes: [] };
    post.replies.push(newReply);
    
    post.followers.forEach(follower => {
        if (follower !== author) {
            const user = db.users.find(u => u.username === follower);
            if (user) user.notifications.push({ text: `תגובה חדשה מ-${author} באשכול: "${post.title}"`, threadId: post.id });
        }
    });
    notifyMentions(content, author, post.title, post.id, db);
    writeDB(db); res.status(201).json(newReply);
});

app.delete('/api/posts/:id', (req, res) => {
    const db = readDB(); db.posts = db.posts.filter(p => p.id !== parseInt(req.params.id)); writeDB(db); res.json({ success: true });
});

app.post('/api/like', (req, res) => {
    const { username, postId, replyId } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "לא נמצא" });
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    
    if (target.author === username) return res.status(400).json({ error: "אי אפשר לעשות לייק לעצמך! 😊" });

    const targetUser = db.users.find(u => u.username === target.author);
    const likeIndex = target.likes.indexOf(username);
    
    if (likeIndex > -1) { target.likes.splice(likeIndex, 1); if (targetUser) { targetUser.totalLikes--; targetUser.veteranProgress--; } } 
    else { target.likes.push(username); if (targetUser) { targetUser.totalLikes++; targetUser.veteranProgress++; } }
    writeDB(db); res.json({ success: true });
});

// === ניהול ודיווחים ===
app.put('/api/posts/move', (req, res) => {
    const { username, postId, newCategory } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "רק מנהל יכול להעביר אשכולות." });
    const post = db.posts.find(p => p.id === postId);
    if (post) { post.category = newCategory; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "אשכול לא נמצא." });
});

app.put('/api/posts/lock', (req, res) => {
    const { username, postId } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    if (post) { post.isLocked = !post.isLocked; writeDB(db); res.json({ success: true, isLocked: post.isLocked }); } else res.status(404).json({ error: "אשכול לא נמצא." });
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

app.post('/api/report', (req, res) => {
    const { reporter, postId, replyId, reason } = req.body; const db = readDB();
    if (!db.reports) db.reports = [];
    db.reports.push({ id: Date.now(), reporter, postId, replyId, reason, date: new Date().toLocaleString('he-IL') });
    writeDB(db); res.json({ success: true, message: "הדיווח נשלח לצוות ההנהלה." });
});

// אלו השורות שנחתכו בטעות בגרסה הקודמת!
app.get('/api/admin/reports', (req, res) => res.json(readDB().reports || []));

app.delete('/api/admin/reports/:id', (req, res) => {
    const db = readDB();
    db.reports = (db.reports || []).filter(r => r.id !== parseInt(req.params.id));
    writeDB(db); res.json({ success: true });
});

app.get('/api/admin/pending-users', (req, res) => res.json(readDB().users.filter(u => !u.isApproved && u.role !== 'admin').map(u => u.username)));

app.post('/api/admin/approve', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.username === req.body.username);
    if (user) { user.isApproved = true; writeDB(db); res.json({ success: true }); } 
    else res.status(404).json({ error: "לא נמצא." });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
