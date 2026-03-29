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

const getILTime = () => new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

const newCategoriesList = ["תמונות והסרטות", "עזרה הדדית", "בית המדרש", "הלכה למעשה", "כתבי רבותינו", "קורות דורות", "אקטואליה", "הפורום שלנו", "חדשות בציבור"];
const defaultDB = { 
    users: [], categories: newCategoriesList, posts: [], reports: [], messages: [], auditLogs: [],
    settings: { rules: "ברוכים הבאים לפורום פרומרקייט!\n\n1. יש לשמור על שפה נקייה ומכבדת.\n2. אין לפרסם תוכן פוגעני.\n3. פתיחת נושאים צריכה להיעשות בקטגוריה המתאימה.\n\nגלישה נעימה!", floatingMessage: { text: "", color: "#f59e0b", id: 0 } }
};

let dbCache = null;

function initDB() {
    if (!fs.existsSync(DATA_FILE)) { dbCache = defaultDB; fs.writeFileSync(DATA_FILE, JSON.stringify(dbCache, null, 2)); return; }
    dbCache = JSON.parse(fs.readFileSync(DATA_FILE));
    let needsSave = false;

    if (!dbCache.reports) { dbCache.reports = []; needsSave = true; }
    if (!dbCache.messages) { dbCache.messages = []; needsSave = true; }
    if (!dbCache.auditLogs) { dbCache.auditLogs = []; needsSave = true; }
    if (!dbCache.categories) { dbCache.categories = newCategoriesList; needsSave = true; }
    if (!dbCache.settings) { dbCache.settings = defaultDB.settings; needsSave = true; }
    if (!dbCache.settings.floatingMessage.color) { dbCache.settings.floatingMessage.color = "#f59e0b"; needsSave = true; }
    
    if (dbCache.users) {
        dbCache.users.forEach(user => {
            if (!user.role) { user.role = user.isAdmin ? 'admin' : 'user'; needsSave = true; }
            if (!user.joinDate || user.joinDate === "משתמש ותיק") { user.joinDate = getILTime().split(',')[0]; needsSave = true; }
            if (!user.notifications) { user.notifications = []; needsSave = true; }
            if (user.totalLikes === undefined) { user.totalLikes = 0; needsSave = true; }
            if (user.veteranProgress === undefined) { user.veteranProgress = 0; needsSave = true; }
            if (user.lastActive === undefined) { user.lastActive = user.lastSeen || Date.now(); needsSave = true; }
        });
    }
    if (dbCache.messages) {
        dbCache.messages.forEach(m => { 
            if (!m.likes) { m.likes = []; needsSave = true; } 
            if (!m.fileUrls) { m.fileUrls = []; needsSave = true; }
            if (!m.subject) { m.subject = 'שיחה כללית'; needsSave = true; }
        });
    }
    if (dbCache.posts) {
        dbCache.posts.forEach(post => { 
            if (!post.followers) { post.followers = [post.author]; needsSave = true; } 
            if (post.isLocked === undefined) { post.isLocked = false; needsSave = true; }
            if (!post.lastUpdated) { post.lastUpdated = post.id; needsSave = true; }
            if (post.views === undefined) { post.views = 0; needsSave = true; }
            if (post.fileUrls === undefined) { post.fileUrls = post.fileUrl ? [post.fileUrl] : []; needsSave = true; }
            post.replies.forEach(r => { if (r.fileUrls === undefined) { r.fileUrls = r.fileUrl ? [r.fileUrl] : []; needsSave = true; } });
        });
    }
    if (needsSave) fs.writeFileSync(DATA_FILE, JSON.stringify(dbCache, null, 2));
}

const readDB = () => dbCache;
const writeDB = (data) => { dbCache = data; fs.writeFile(DATA_FILE, JSON.stringify(dbCache, null, 2), (err) => { if(err) console.error(err); }); };

initDB();

const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, UPLOADS_DIR), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage });
app.use(express.json()); app.use(express.static(__dirname)); app.use('/uploads', express.static(UPLOADS_DIR));
app.set('trust proxy', true);

function isVeteran(user) { return (user.role === 'admin' || user.role === 'mod' || user.role === 'editor' || user.veteranProgress >= 10); }

function notifyMentionsAndQuotes(content, author, postTitle, threadId, db) {
    db.users.forEach(u => {
        if (u.username !== author && content.includes('@' + u.username)) { u.notifications.push({ text: `תויגת על ידי ${author} באשכול: "${postTitle}"`, threadId, isNew: true }); }
    });
    const quotes = [...new Set((content.match(/\[quote="(.*?)"\]/gi) || []).map(m => m.match(/\[quote="(.*?)"\]/i)[1]))];
    quotes.forEach(username => {
        const u = db.users.find(x => x.username === username);
        if (u && u.username !== author) u.notifications.push({ text: `${author} ציטט אותך באשכול: "${postTitle}"`, threadId, isNew: true });
    });
}

// === הגדרות וכללים ===
app.get('/api/settings', (req, res) => res.json(readDB().settings));
app.put('/api/admin/settings', (req, res) => {
    const { username, rules, floatingMessageText, floatingMessageColor } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה." });
    
    db.settings.rules = rules;
    if (db.settings.floatingMessage.text !== floatingMessageText || db.settings.floatingMessage.color !== floatingMessageColor) {
        db.settings.floatingMessage = { text: floatingMessageText, color: floatingMessageColor || "#f59e0b", id: Date.now() }; 
    }
    writeDB(db); res.json({ success: true });
});

app.post('/api/register', (req, res) => {
    const { username, password } = req.body; const db = readDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "שם המשתמש כבר קיים." });
    db.users.push({ username, password, isApproved: false, role: db.users.length === 0 ? 'admin' : 'user', joinDate: getILTime().split(',')[0], lastSeen: Date.now(), lastActive: Date.now(), notifications: [], totalLikes: 0, veteranProgress: 0, typingTo: null, typingExpires: 0 });
    writeDB(db); res.json({ message: "נרשמת בהצלחה. המתן לאישור מנהל." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && user.role !== 'admin') return res.status(403).json({ error: "ממתין לאישור מנהל." });
    user.lastSeen = Date.now(); user.lastActive = Date.now(); writeDB(db);
    res.json({ message: "התחברת!", username: user.username, role: user.role });
});

app.get('/api/users/info', (req, res) => {
    const db = readDB(); const info = {};
    db.users.forEach(u => { info[u.username] = { role: u.role || 'user', joinDate: u.joinDate || '', totalLikes: u.totalLikes || 0, isVeteran: isVeteran(u), lastSeen: u.lastSeen }; });
    res.json(info);
});

app.post('/api/ping', (req, res) => {
    const { username, typingTo, currentActivity } = req.body; const db = readDB(); 
    let unreadCount = 0, unreadMessages = 0, allNotifs = [];
    
    if (username) {
        const user = db.users.find(u => u.username === username);
        if (user) {
            user.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            user.currentActivity = currentActivity || 'גולש בפורום הראשי';
            const now = Date.now(); if (now - user.lastActive > 432000000) user.veteranProgress = 0; 
            user.lastSeen = now; user.lastActive = now;
            if (typingTo !== undefined) { user.typingTo = typingTo; user.typingExpires = now + 4000; }
            unreadCount = user.notifications ? user.notifications.filter(n => n.isNew !== false).length : 0;
            allNotifs = user.notifications || [];
            unreadMessages = db.messages.filter(m => m.to === username && !m.read).length;
        }
        writeDB(db);
    }
    
    const threeMinsAgo = Date.now() - 180000;
    const onlineUsers = db.users.filter(u => u.lastSeen > threeMinsAgo).map(u => u.username);
    const typingUsers = db.users.filter(u => u.typingTo === username && u.typingExpires > Date.now()).map(u => u.username);
    res.json({ onlineUsers, unreadCount, unreadMessages, typingUsers, allNotifs });
});

app.post('/api/notifications/mark-read', (req, res) => {
    const { username } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (user && user.notifications) { user.notifications.forEach(n => n.isNew = false); writeDB(db); }
    res.json({ success: true });
});

app.post('/api/notifications/clear', (req, res) => {
    const { username } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (user) { user.notifications = []; writeDB(db); }
    res.json({ success: true });
});

app.get('/api/messages/:username', (req, res) => {
    const db = readDB(); const msgs = db.messages.filter(m => m.to === req.params.username || m.from === req.params.username);
    res.json(msgs);
});

app.post('/api/messages/read', (req, res) => {
    const { username, partner, subject } = req.body; const db = readDB();
    db.messages.forEach(m => { if (m.to === username && m.from === partner && m.subject === subject) m.read = true; });
    writeDB(db); res.json({ success: true });
});

app.post('/api/messages', upload.array('attachedFiles', 5), (req, res) => {
    const { from, to, content, subject } = req.body; const db = readDB();
    const sender = db.users.find(u => u.username === from), receiver = db.users.find(u => u.username === to);
    if (!receiver) return res.status(404).json({ error: "משתמש לא קיים." });
    
    const hasHistory = db.messages.some(m => (m.from === from && m.to === to) || (m.from === to && m.to === from));
    if (!isVeteran(sender) && !hasHistory) return res.status(403).json({ error: "רק משתמש ותיק יכול ליזום שיחה." });

    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
    db.messages.push({ id: Date.now(), subject: subject || 'שיחה כללית', from, to, content, fileUrls, date: getILTime(), read: false, likes: [] });
    writeDB(db); res.json({ success: true });
});

app.post('/api/messages/:id/like', (req, res) => {
    const { username } = req.body; const id = parseInt(req.params.id); const db = readDB();
    const msg = db.messages.find(m => m.id === id);
    if (msg && msg.from !== username) {
        const idx = msg.likes.indexOf(username);
        if (idx > -1) msg.likes.splice(idx, 1); else msg.likes.push(username);
        writeDB(db); res.json({ success: true });
    } else res.status(400).json({ error: "שגיאה." });
});

// === פוסטים ===
app.get('/api/categories', (req, res) => res.json(readDB().categories));
app.get('/api/posts', (req, res) => { res.json(readDB().posts.sort((a, b) => b.lastUpdated - a.lastUpdated)); });

app.post('/api/posts/:id/view', (req, res) => {
    const db = readDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (post) { post.views = (post.views || 0) + 1; writeDB(db); res.json({ views: post.views }); } else res.status(404).json({ error: "לא נמצא" });
});

app.post('/api/posts', upload.array('attachedFiles', 5), (req, res) => {
    const { author, title, content, category } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === author);
    if (category === "אקטואליה" && !isVeteran(user)) return res.status(403).json({ error: "אקטואליה סגורה." });
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
    const newPost = { id: Date.now(), lastUpdated: Date.now(), views: 0, author, title, category, content, date: getILTime(), fileUrls, likes: [], replies: [], followers: [author], isLocked: false };
    db.posts.push(newPost); notifyMentionsAndQuotes(content, author, title, newPost.id, db); 
    writeDB(db); res.status(201).json(newPost);
});

app.post('/api/posts/:id/follow', (req, res) => {
    const { username } = req.body; const db = readDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (!post) return res.status(404).json({ error: "לא נמצא" });
    const idx = post.followers.indexOf(username);
    if (idx > -1) post.followers.splice(idx, 1); else post.followers.push(username);
    writeDB(db); res.json({ success: true, followers: post.followers });
});

app.post('/api/posts/:id/reply', upload.array('attachedFiles', 5), (req, res) => {
    const { author, content } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if (!post || post.isLocked) return res.status(403).json({ error: "שגיאה או אשכול נעול." });

    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];
    const newReply = { id: Date.now(), author, content, date: getILTime(), fileUrls, likes: [] };
    post.replies.push(newReply); post.lastUpdated = Date.now();

    post.followers.forEach(follower => {
        if (follower !== author) {
            const user = db.users.find(u => u.username === follower);
            if (user) user.notifications.push({ text: `תגובה חדשה מ-${author} באשכול: "${post.title}"`, threadId: post.id, isNew: true });
        }
    });
    notifyMentionsAndQuotes(content, author, post.title, post.id, db);
    writeDB(db); res.status(201).json(newReply);
});

app.delete('/api/posts/:id', (req, res) => { const db = readDB(); db.posts = db.posts.filter(p => p.id !== parseInt(req.params.id)); writeDB(db); res.json({ success: true }); });
app.post('/api/posts/delete-reply', (req, res) => {
    const { username, postId, replyId } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "רק מנהל יכול למחוק." });
    const post = db.posts.find(p => p.id === postId);
    if (post) { post.replies = post.replies.filter(r => r.id !== replyId); writeDB(db); } res.json({ success: true });
});

app.post('/api/like', (req, res) => {
    const { username, postId, replyId } = req.body; const db = readDB();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "לא נמצא" });
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    if (target.author === username) return res.status(400).json({ error: "לייק עצמי חסום!" });

    const targetUser = db.users.find(u => u.username === target.author);
    const likeIndex = target.likes.indexOf(username);
    if (likeIndex > -1) { 
        target.likes.splice(likeIndex, 1); 
        if (targetUser) { targetUser.totalLikes--; targetUser.veteranProgress--; } 
    } else { 
        target.likes.push(username); 
        if (targetUser) { 
            targetUser.totalLikes++; targetUser.veteranProgress++; 
            targetUser.notifications.push({ text: `${username} עשה לייק להודעה שלך!`, threadId: post.id, isNew: true });
        } 
    }
    writeDB(db); res.json({ success: true });
});

app.put('/api/posts/edit', (req, res) => {
    const { username, postId, replyId, newContent } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    const post = db.posts.find(p => p.id === postId);
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    if (!target) return res.status(404).json({ error: "לא נמצא" });

    if (!user || (user.role !== 'admin' && user.role !== 'mod' && user.role !== 'editor' && target.author !== username)) return res.status(403).json({ error: "אין הרשאה." });
    target.content = newContent + `\n\n[נערך לאחרונה ב-${getILTime()}]`; writeDB(db); res.json({ success: true });
});

// === עורכי תוכן ומנהלים ===
app.put('/api/posts/rename', (req, res) => {
    const { username, postId, newTitle } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'editor')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    if (post) { 
        db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'שינוי כותרת', details: `מ: "${post.title}" ל: "${newTitle}"` });
        post.title = newTitle; writeDB(db); res.json({ success: true }); 
    } else res.status(404).json({ error: "לא נמצא." });
});

app.put('/api/posts/move', (req, res) => {
    const { username, postId, newCategory } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'editor')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    if (post) { 
        db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'העברת קטגוריה', details: `האשכול "${post.title}" הועבר מ: ${post.category} ל: ${newCategory}` });
        post.category = newCategory; writeDB(db); res.json({ success: true }); 
    } else res.status(404).json({ error: "לא נמצא." });
});

app.put('/api/posts/lock', (req, res) => {
    const { username, postId } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    if (post) { post.isLocked = !post.isLocked; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." });
});

app.post('/api/report', (req, res) => {
    const { reporter, postId, replyId, reason } = req.body; const db = readDB();
    if (!db.reports) db.reports = []; db.reports.push({ id: Date.now(), reporter, postId, replyId, reason, date: getILTime() }); writeDB(db); res.json({ success: true });
});

// קטגוריות
app.post('/api/admin/categories', (req, res) => {
    const { username, newCat } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" });
    if (!db.categories.includes(newCat)) { db.categories.push(newCat); writeDB(db); }
    res.json({ success: true });
});
app.put('/api/admin/categories', (req, res) => {
    const { username, oldCat, newCat } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" });
    const idx = db.categories.indexOf(oldCat);
    if (idx > -1) { db.categories[idx] = newCat; db.posts.forEach(p => { if (p.category === oldCat) p.category = newCat; }); writeDB(db); }
    res.json({ success: true });
});
app.delete('/api/admin/categories', (req, res) => {
    const { username, catName } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" });
    db.categories = db.categories.filter(c => c !== catName); writeDB(db); res.json({ success: true });
});

// נתיבי הנהלה
app.get('/api/admin/reports', (req, res) => res.json(readDB().reports || []));
app.delete('/api/admin/reports/:id', (req, res) => { const db = readDB(); db.reports = (db.reports || []).filter(r => r.id !== parseInt(req.params.id)); writeDB(db); res.json({ success: true }); });
app.get('/api/admin/audit', (req, res) => res.json(readDB().auditLogs.reverse() || []));
app.get('/api/admin/all-users', (req, res) => { res.json(readDB().users.map(u => ({ username: u.username, role: u.role, isApproved: u.isApproved, joinDate: u.joinDate, ip: u.ip, currentActivity: u.currentActivity, lastActive: u.lastActive }))); });
app.get('/api/admin/all-messages', (req, res) => res.json(readDB().messages.reverse()));
app.get('/api/admin/pending-users', (req, res) => res.json(readDB().users.filter(u => !u.isApproved && u.role !== 'admin').map(u => u.username)));
app.post('/api/admin/approve', (req, res) => { const db = readDB(); const user = db.users.find(u => u.username === req.body.username); if (user) { user.isApproved = true; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/admin/delete-user', (req, res) => { const db = readDB(); const { username } = req.body; const user = db.users.find(u => u.username === username); if (user && user.role === 'admin') return res.status(400).json({error:"אי אפשר למחוק מנהל."}); db.users = db.users.filter(u => u.username !== username); writeDB(db); res.json({ success: true }); });
app.put('/api/admin/users/:username/role', (req, res) => { const db = readDB(); const user = db.users.find(u => u.username === req.params.username); if (user && user.role !== 'admin') { user.role = req.body.role; writeDB(db); res.json({success: true}); } else res.status(400).json({error: "שגיאה"}); });

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
