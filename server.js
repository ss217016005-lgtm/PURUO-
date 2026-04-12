const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.PORT;
const DATA_DIR = isRailway ? '/app/data' : path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const getILTime = () => new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

const newCategoriesList = ["תמונות והסרטות", "הלכה למעשה", "תורת רבותינו", "בית המדרש", "השקפה", "מחשבים וטכנולגיה", "זיכרון להולכים", "סלבודקא", "עזרה הדדית", "קורות דורות", "אקטואליה", "הפורום שלנו", "חדשות בציבור"];
const defaultTags = [{ name: 'שיתוף', color: '#3b82f6' }, { name: 'באג', color: '#ef4444' }, { name: 'שאלה', color: '#f59e0b' }, { name: 'להורדה', color: '#10b981' }];

const defaultDB = { 
    users: [], categories: newCategoriesList, tags: defaultTags, posts: [], reports: [], messages: [], auditLogs: [], links: [],
    settings: { rules: "ברוכים הבאים לפורום פרומרקייט!\n\n1. יש לשמור על שפה נקייה ומכבדת.", floatingMessage: { text: "", color: "#f59e0b", id: 0 } }
};

const MONGODB_URI = "mongodb+srv://w217016005_db_user:771fEhHF0z26gIGl@cluster0.e7lsmeb.mongodb.net/ForumDB?retryWrites=true&w=majority";

const dbSchema = new mongoose.Schema({
    users: Array, categories: Array, tags: Array, posts: Array,
    reports: Array, messages: Array, auditLogs: Array, links: Array, settings: Object
}, { strict: false });

const DBModel = mongoose.model('Database', dbSchema);

let dbCache = null;
let dbDocId = null;
let isSaving = false;
let pendingSave = false;

app.use(express.json()); app.use(express.static(__dirname)); app.use('/uploads', express.static(UPLOADS_DIR));
app.set('trust proxy', true);

async function startServer() {
    try {
        console.log("מתחבר ל-MongoDB...");
        await mongoose.connect(MONGODB_URI);
        console.log('✅ מחובר למסד הנתונים בענן');

        let doc = await DBModel.findOne();
        if (!doc) {
            console.log("יוצר מסד נתונים חדש בענן...");
            doc = new DBModel(defaultDB);
            await doc.save();
        }
        dbCache = doc.toObject();
        dbDocId = doc._id;
        
        let needsSave = false;
        if (!dbCache.reports) { dbCache.reports = []; needsSave = true; }
        if (!dbCache.messages) { dbCache.messages = []; needsSave = true; }
        if (!dbCache.auditLogs) { dbCache.auditLogs = []; needsSave = true; }
        if (!dbCache.categories) { dbCache.categories = newCategoriesList; needsSave = true; }
        if (!dbCache.tags) { dbCache.tags = defaultTags; needsSave = true; }
        if (!dbCache.settings) { dbCache.settings = defaultDB.settings; needsSave = true; }
        if (!dbCache.links) { dbCache.links = []; needsSave = true; }
        if (!dbCache.settings.floatingMessage) dbCache.settings.floatingMessage = { text: "", color: "#f59e0b", id: 0 };
        if (!dbCache.settings.floatingMessage.color) { dbCache.settings.floatingMessage.color = "#f59e0b"; needsSave = true; }
        
        if (dbCache.users) {
            dbCache.users.forEach(user => {
                if (!user.role) { user.role = user.isAdmin ? 'admin' : 'user'; needsSave = true; }
                if (!user.joinDate || user.joinDate === "משתמש ותיק") { user.joinDate = getILTime().split(',')[0]; needsSave = true; }
                if (!user.notifications) { user.notifications = []; needsSave = true; }
                if (user.totalLikes === undefined) { user.totalLikes = 0; needsSave = true; }
                if (user.veteranProgress === undefined) { user.veteranProgress = 0; needsSave = true; }
                if (user.lastActive === undefined) { user.lastActive = user.lastSeen || Date.now(); needsSave = true; }
                if (user.avatar === undefined) { user.avatar = ''; needsSave = true; }
                if (user.pendingAvatar === undefined) { user.pendingAvatar = null; needsSave = true; }
                if (user.signature === undefined) { user.signature = ''; needsSave = true; }
                if (user.requiresApproval === undefined) { user.requiresApproval = false; needsSave = true; }
                if (user.restrictedCats === undefined) { user.restrictedCats = []; needsSave = true; }
            });
        }
        
        if (dbCache.messages) { dbCache.messages.forEach(m => { if (!m.likes) { m.likes = []; needsSave = true; } if (!m.fileUrls) { m.fileUrls = []; needsSave = true; } if (!m.subject) { m.subject = 'שיחה כללית'; needsSave = true; } }); }
        if (dbCache.posts) { dbCache.posts.forEach(post => { 
            if (!post.followers) { post.followers = [post.author]; needsSave = true; } 
            if (post.isLocked === undefined) { post.isLocked = false; needsSave = true; } 
            if (post.isHidden === undefined) { post.isHidden = false; needsSave = true; } 
            if (post.isApproved === undefined) { post.isApproved = true; needsSave = true; } 
            if (post.isArchived === undefined) { post.isArchived = false; needsSave = true; }
            if (!post.lastUpdated) { post.lastUpdated = post.id; needsSave = true; } 
            if (post.views === undefined) { post.views = 0; needsSave = true; } 
            if (post.fileUrls === undefined) { post.fileUrls = post.fileUrl ? [post.fileUrl] : []; needsSave = true; } 
            if (post.dislikes === undefined) { post.dislikes = []; needsSave = true; }
            post.replies.forEach(r => { 
                if (r.fileUrls === undefined) { r.fileUrls = r.fileUrl ? [r.fileUrl] : []; needsSave = true; } 
                if (r.isHidden === undefined) { r.isHidden = false; needsSave = true; }
                if (r.isApproved === undefined) { r.isApproved = true; needsSave = true; }
                if (r.dislikes === undefined) { r.dislikes = []; needsSave = true; }
            }); 
        }); }
        
        if (needsSave) writeDB(dbCache);
        console.log("🚀 נתונים נטענו לזיכרון!");

        // רק אחרי שהנתונים נטענו, אנחנו מפעילים את השרת
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

    } catch (e) {
        console.error("❌ שגיאה קריטית בעליית השרת:", e);
    }
}

const readDB = () => dbCache;

const writeDB = (data) => {
    dbCache = data;
    if (isSaving) {
        pendingSave = true;
        return;
    }
    saveToMongo();
};

async function saveToMongo() {
    if (!dbDocId) return;
    isSaving = true;
    try {
        await DBModel.updateOne({ _id: dbDocId }, { $set: dbCache });
    } catch (e) {
        console.error("שגיאה בשמירה לענן:", e);
    }
    isSaving = false;
    if (pendingSave) {
        pendingSave = false;
        saveToMongo();
    }
}

const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, UPLOADS_DIR), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage });

function isVeteran(user) { return (user.role === 'admin' || user.role === 'mod' || user.role === 'editor' || user.veteranProgress >= 10); }

function notifyMentionsAndQuotes(content, author, postTitle, threadId, replyId, db) {
    db.users.forEach(u => {
        if (u.username !== author && content.includes('@' + u.username)) { u.notifications.push({ text: `תויגת על ידי ${author} באשכול: "${postTitle}"`, threadId, replyId, isNew: true }); }
    });
    const quotes = [...new Set((content.match(/\[quote="(.*?)"\]/gi) || []).map(m => m.match(/\[quote="(.*?)"\]/i)[1]))];
    quotes.forEach(username => {
        const u = db.users.find(x => x.username === username);
        if (u && u.username !== author) u.notifications.push({ text: `${author} ציטט אותך באשכול: "${postTitle}"`, threadId, replyId, isNew: true });
    });
}

// מחכה שה-dbCache יהיה מוכן לפני כל קריאת API
app.use('/api', (req, res, next) => {
    if (!dbCache) {
        return res.status(503).json({ error: "השרת עדיין טוען נתונים, נסה שוב בעוד רגע." });
    }
    next();
});


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

    db.users.push({ 
        username, password, email: '', avatar: '', pendingAvatar: null, signature: '',
        isApproved: false, requiresApproval: false, restrictedCats: [],
        role: db.users.length === 0 ? 'admin' : 'user', 
        joinDate: getILTime().split(',')[0], lastSeen: Date.now(), lastActive: Date.now(), 
        notifications: [], totalLikes: 0, veteranProgress: 0, typingTo: null, typingExpires: 0 
    });
    writeDB(db); 
    res.json({ message: "נרשמת בהצלחה! חשבונך ממתין כעת לאישור מנהל." });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && user.role !== 'admin') return res.status(403).json({ error: "חשבונך עדיין ממתין לאישור מנהל." });
    
    user.lastSeen = Date.now(); user.lastActive = Date.now(); writeDB(db);
    res.json({ message: "התחברת!", username: user.username, role: user.role });
});

app.put('/api/user/profile', upload.single('avatarFile'), (req, res) => {
    const { username, oldPassword, newPassword, email, signature } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if(!user) return res.status(404).json({error: "משתמש לא נמצא."});
    
    if(newPassword) {
        if(user.password !== oldPassword) return res.status(401).json({error: "הסיסמה הישנה שגויה."});
        user.password = newPassword;
    }
    user.email = email || user.email;
    user.signature = signature || user.signature;
    
    if (req.file) {
        user.pendingAvatar = `/uploads/${req.file.filename}`;
    }
    
    writeDB(db); 
    res.json({success: true, message: req.file ? "הפרופיל עודכן. תמונת הפרופיל ממתינה לאישור מנהל לפני שתוצג." : "הפרופיל עודכן בהצלחה."});
});

app.get('/api/users/info', (req, res) => { const db = readDB(); const info = {}; db.users.forEach(u => { info[u.username] = { role: u.role || 'user', joinDate: u.joinDate || '', totalLikes: u.totalLikes || 0, isVeteran: isVeteran(u), lastSeen: u.lastSeen, avatar: u.avatar, signature: u.signature }; }); res.json(info); });
app.post('/api/ping', (req, res) => { const { username, typingTo, currentActivity } = req.body; const db = readDB(); let unreadCount = 0, unreadMessages = 0, allNotifs = []; if (username) { const user = db.users.find(u => u.username === username); if (user) { user.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; user.currentActivity = currentActivity || 'גולש בפורום הראשי'; const now = Date.now(); if (now - user.lastActive > 432000000) user.veteranProgress = 0; user.lastSeen = now; user.lastActive = now; if (typingTo !== undefined) { user.typingTo = typingTo; user.typingExpires = now + 4000; } unreadCount = user.notifications ? user.notifications.filter(n => n.isNew !== false).length : 0; allNotifs = user.notifications || []; unreadMessages = db.messages.filter(m => m.to === username && !m.read).length; } writeDB(db); } const threeMinsAgo = Date.now() - 180000; const onlineUsers = db.users.filter(u => u.lastSeen > threeMinsAgo).map(u => u.username); const typingUsers = db.users.filter(u => u.typingTo === username && u.typingExpires > Date.now()).map(u => u.username); res.json({ onlineUsers, unreadCount, unreadMessages, typingUsers, allNotifs }); });
app.post('/api/notifications/mark-read', (req, res) => { const { username } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (user && user.notifications) { user.notifications.forEach(n => n.isNew = false); writeDB(db); } res.json({ success: true }); });
app.post('/api/notifications/clear', (req, res) => { const { username } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (user) { user.notifications = []; writeDB(db); } res.json({ success: true }); });

app.get('/api/messages/:username', (req, res) => { const db = readDB(); const msgs = db.messages.filter(m => m.to === req.params.username || m.from === req.params.username); res.json(msgs); });
app.post('/api/messages/read', (req, res) => { const { username, partner, subject } = req.body; const db = readDB(); db.messages.forEach(m => { if (m.to === username && m.from === partner && m.subject === subject) m.read = true; }); writeDB(db); res.json({ success: true }); });
app.delete('/api/messages/:id', (req, res) => { const { username } = req.body; const db = readDB(); const idx = db.messages.findIndex(m => m.id === parseInt(req.params.id) && m.from === username); if (idx > -1) { db.messages.splice(idx, 1); writeDB(db); res.json({success: true}); } else res.status(403).json({error: "לא מורשה."}); });
app.post('/api/messages', upload.array('attachedFiles', 5), (req, res) => { 
    const { from, to, content, subject } = req.body; const db = readDB(); 
    const receiver = db.users.find(u => u.username === to); 
    if (!receiver) return res.status(404).json({ error: "משתמש לא קיים." }); 
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : []; 
    db.messages.push({ id: Date.now(), subject: subject || 'שיחה כללית', from, to, content, fileUrls, date: getILTime(), read: false, likes: [] }); 
    writeDB(db); res.json({ success: true }); 
});
app.post('/api/messages/:id/like', (req, res) => { const { username } = req.body; const id = parseInt(req.params.id); const db = readDB(); const msg = db.messages.find(m => m.id === id); if (msg && msg.from !== username) { const idx = msg.likes.indexOf(username); if (idx > -1) msg.likes.splice(idx, 1); else msg.likes.push(username); writeDB(db); res.json({ success: true }); } else res.status(400).json({ error: "שגיאה." }); });

app.get('/api/links', (req, res) => res.json(readDB().links || []));
app.post('/api/links', (req, res) => { const { username, title, url } = req.body; const db = readDB(); if(!db.links) db.links = []; db.links.push({ id: Date.now(), title, url, author: username, date: getILTime() }); writeDB(db); res.json({success: true}); });
app.delete('/api/links/:id', (req, res) => { const { username } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if(!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({error: "אין הרשאה"}); db.links = db.links.filter(l => l.id !== parseInt(req.params.id)); writeDB(db); res.json({success: true}); });
app.get('/api/all-files', (req, res) => { const db = readDB(); const files = []; db.posts.forEach(p => { if (p.fileUrls && p.fileUrls.length > 0 && !p.isHidden && p.isApproved) files.push({ urls: p.fileUrls, author: p.author, threadId: p.id, threadTitle: p.title, date: p.date }); p.replies.forEach(r => { if (r.fileUrls && r.fileUrls.length > 0 && !r.isHidden && r.isApproved) files.push({ urls: r.fileUrls, author: r.author, threadId: p.id, replyId: r.id, threadTitle: p.title, date: r.date }); }); }); res.json(files.reverse()); });

app.get('/api/tags', (req, res) => res.json(readDB().tags));
app.post('/api/admin/tags', (req, res) => { const { username, name, color } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); if (!db.tags.find(t => t.name === name)) { db.tags.push({name, color}); writeDB(db); } res.json({ success: true }); });
app.delete('/api/admin/tags', (req, res) => { const { username, tagName } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); db.tags = db.tags.filter(t => t.name !== tagName); writeDB(db); res.json({ success: true }); });

app.get('/api/categories', (req, res) => res.json(readDB().categories));
app.put('/api/admin/categories/reorder', (req, res) => { const { username, categories } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); db.categories = categories; writeDB(db); res.json({ success: true }); });

app.get('/api/posts', (req, res) => { res.json(readDB().posts.sort((a, b) => b.lastUpdated - a.lastUpdated)); });
app.post('/api/posts/:id/view', (req, res) => { const db = readDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id)); if (post) { post.views = (post.views || 0) + 1; writeDB(db); res.json({ views: post.views }); } else res.status(404).json({ error: "לא נמצא" }); });

app.post('/api/posts', upload.array('attachedFiles', 5), (req, res) => { 
    const { author, title, content, category, tag, pollData } = req.body; const db = readDB(); 
    const user = db.users.find(u => u.username === author); 
    
    if (user.restrictedCats && user.restrictedCats.includes(category)) return res.status(403).json({ error: "אינך מורשה להגיב בקטגוריה זו." });
    if (category === "אקטואליה" && !isVeteran(user)) return res.status(403).json({ error: "אקטואליה סגורה." }); 
    
    let poll = null;
    if (pollData) {
        const pd = JSON.parse(pollData);
        if(pd.question && pd.options.length > 0) { poll = { question: pd.question, options: pd.options.map((opt, i) => ({ id: i, text: opt, votes: [] })) }; }
    }

    const isAppr = !user.requiresApproval;
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : []; 
    const newPost = { id: Date.now(), lastUpdated: Date.now(), views: 0, author, title, category, tag: tag || null, content, date: getILTime(), fileUrls, poll, likes: [], dislikes: [], replies: [], followers: [author], isLocked: false, isHidden: false, isApproved: isAppr, isArchived: false }; 
    db.posts.push(newPost); 
    if(isAppr) notifyMentionsAndQuotes(content, author, title, newPost.id, null, db); 
    writeDB(db); res.status(201).json(newPost); 
});

app.post('/api/posts/:id/vote', (req, res) => {
    const { username, optionId } = req.body; const db = readDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if(!post || !post.poll) return res.status(404).json({error: "סקר לא נמצא"});
    post.poll.options.forEach(opt => { const idx = opt.votes.indexOf(username); if(idx > -1) opt.votes.splice(idx, 1); });
    const selectedOpt = post.poll.options.find(o => o.id === parseInt(optionId));
    if(selectedOpt) selectedOpt.votes.push(username);
    writeDB(db); res.json({success: true});
});

app.post('/api/posts/:id/follow', (req, res) => { const { username } = req.body; const db = readDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id)); if (!post) return res.status(404).json({ error: "לא נמצא" }); const idx = post.followers.indexOf(username); if (idx > -1) post.followers.splice(idx, 1); else post.followers.push(username); writeDB(db); res.json({ success: true, followers: post.followers }); });

app.post('/api/posts/:id/reply', upload.array('attachedFiles', 5), (req, res) => { 
    const { author, content } = req.body; const db = readDB(); 
    const user = db.users.find(u => u.username === author); 
    const post = db.posts.find(p => p.id === parseInt(req.params.id)); 
    if (!post || post.isLocked) return res.status(403).json({ error: "שגיאה או אשכול נעול." }); 
    if (user.restrictedCats && user.restrictedCats.includes(post.category)) return res.status(403).json({ error: "אינך מורשה להגיב בקטגוריה זו." });
    
    const isAppr = !user.requiresApproval;
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : []; 
    const newReply = { id: Date.now(), author, content, date: getILTime(), fileUrls, likes: [], dislikes: [], isHidden: false, isApproved: isAppr }; 
    post.replies.push(newReply); 
    
    if (post.isArchived) { post.isArchived = false; db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: 'מערכת', action: 'החזרה לראשי', details: `האשכול "${post.title}" חזר אוטומטית עקב תגובה.` }); }
    
    if(isAppr) {
        post.lastUpdated = Date.now(); 
        post.followers.forEach(follower => { if (follower !== author) { const fu = db.users.find(u => u.username === follower); if (fu) fu.notifications.push({ text: `תגובה חדשה מ-${author} באשכול: "${post.title}"`, threadId: post.id, replyId: newReply.id, isNew: true }); } }); 
        notifyMentionsAndQuotes(content, author, post.title, post.id, newReply.id, db); 
    }
    writeDB(db); res.status(201).json(newReply); 
});

app.put('/api/posts/archive', (req, res) => {
    const { username, postId } = req.body; const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({error: "לא נמצא"});
    
    post.isArchived = !post.isArchived;
    db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: post.isArchived ? 'סומן כפחות רלוונטי' : 'הוחזר לראשי', details: `האשכול "${post.title}"` });
    writeDB(db); res.json({success: true, isArchived: post.isArchived});
});

app.post('/api/posts/delete-reply', (req, res) => { 
    const { username, postId, replyId } = req.body; 
    const db = readDB(); 
    const user = db.users.find(u => u.username === username); 
    
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "רק מנהל יכול למחוק." }); 
    
    const post = db.posts.find(p => p.id === postId); 
    if (post) { 
        const replyIndex = post.replies.findIndex(r => r.id === replyId);
        if (replyIndex !== -1) {
            const reply = post.replies[replyIndex];
            db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'מחיקת תגובה', details: `תגובה של ${reply.author} באשכול "${post.title}" נמחקה.` });
            post.replies.splice(replyIndex, 1);
            writeDB(db);
            return res.json({ success: true });
        }
    } 
    res.status(404).json({ error: "לא נמצא." }); 
});

app.post('/api/like', (req, res) => { 
    const { username, postId, replyId } = req.body; const db = readDB(); const post = db.posts.find(p => p.id === postId); if (!post) return res.status(404).json({ error: "לא נמצא" }); 
    let target = replyId ? post.replies.find(r => r.id === replyId) : post; if (target.author === username) return res.status(400).json({ error: "לייק עצמי חסום!" }); 
    const targetUser = db.users.find(u => u.username === target.author); const likeIndex = target.likes.indexOf(username); 
    if (likeIndex > -1) { 
        target.likes.splice(likeIndex, 1); 
        if (targetUser) { targetUser.totalLikes--; targetUser.veteranProgress--; } 
    } else { 
        target.likes.push(username); 
        if (targetUser) { 
            targetUser.totalLikes++; targetUser.veteranProgress++; 
            targetUser.notifications.push({ text: `${username} עשה לייק להודעה שלך!`, threadId: post.id, replyId: replyId, isNew: true }); 
        } 
    } 
    writeDB(db); res.json({ success: true }); 
});

app.post('/api/dislike', (req, res) => {
    const { username, postId, replyId } = req.body; 
    const db = readDB(); 
    const post = db.posts.find(p => p.id === postId); 
    if (!post) return res.status(404).json({ error: "לא נמצא" }); 
    
    let target = replyId ? post.replies.find(r => r.id === replyId) : post; 
    if (target.author === username) return res.status(400).json({ error: "פעולה לא חוקית על עצמך!" }); 
    
    if (!target.dislikes) target.dislikes = [];
    const targetUser = db.users.find(u => u.username === target.author); 
    const dislikeIndex = target.dislikes.indexOf(username); 
    
    if (dislikeIndex > -1) { 
        target.dislikes.splice(dislikeIndex, 1); 
        if (targetUser) targetUser.totalLikes++; 
    } else { 
        target.dislikes.push(username); 
        if (targetUser && targetUser.totalLikes > 0) targetUser.totalLikes--; 
    } 
    writeDB(db); 
    res.json({ success: true }); 
});

app.delete('/api/admin/dislike-reset', (req, res) => {
    const { adminUser, postId, replyId } = req.body;
    const db = readDB();
    const admin = db.users.find(u => u.username === adminUser);
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: "אין הרשאה." });
    
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "לא נמצא" });
    
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    if(target && target.dislikes && target.dislikes.length > 0) {
        const targetUser = db.users.find(u => u.username === target.author);
        if(targetUser) targetUser.totalLikes += target.dislikes.length;
        target.dislikes = [];
        writeDB(db);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "אין דיסלייקים לאיפוס." });
    }
});

app.put('/api/posts/edit', (req, res) => { 
    const { username, postId, replyId, newContent } = req.body; const db = readDB(); 
    const user = db.users.find(u => u.username === username); 
    const post = db.posts.find(p => p.id === postId); 
    let target = replyId ? post.replies.find(r => r.id === replyId) : post; 
    if (!target) return res.status(404).json({ error: "לא נמצא" }); 
    if (!user || (user.role !== 'admin' && user.role !== 'mod' && user.role !== 'editor' && target.author !== username)) return res.status(403).json({ error: "אין הרשאה." }); 
    
    let cleanContent = newContent.replace(/\[edit\].*?\[\/edit\]/g, '').trim();
    target.content = cleanContent + `\n[edit]נערך לאחרונה ב-${getILTime()}[/edit]`; 
    writeDB(db); res.json({ success: true }); 
});

app.put('/api/posts/rename', (req, res) => { const { username, postId, newTitle } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'editor')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (post) { db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'שינוי כותרת', details: `מ: "${post.title}" ל: "${newTitle}"` }); post.title = newTitle; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/posts/split', (req, res) => { const { username, postId, replyIds, newTitle } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (!post) return res.status(404).json({error: "לא נמצא"}); const repliesToMove = post.replies.filter(r => replyIds.includes(r.id)); if (repliesToMove.length === 0) return res.status(400).json({error: "לא נבחרו תגובות לפיצול"}); post.replies = post.replies.filter(r => !replyIds.includes(r.id)); const firstMsg = repliesToMove.shift(); const newPost = { id: Date.now(), lastUpdated: Date.now(), views: 0, author: firstMsg.author, title: newTitle, category: post.category, content: firstMsg.content, date: firstMsg.date, fileUrls: firstMsg.fileUrls || [], likes: firstMsg.likes || [], dislikes: [], replies: repliesToMove, followers: [firstMsg.author], isLocked: false, isHidden: false, isApproved: true, isArchived: false }; db.posts.push(newPost); post.lastUpdated = Date.now(); db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'פיצול אשכול מסומנים', details: `מתוך: "${post.title}" -> לאשכול חדש: "${newTitle}"` }); writeDB(db); res.json({ success: true, newPostId: newPost.id }); });
app.put('/api/posts/move', (req, res) => { const { username, postId, newCategory } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'editor')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (post) { db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'העברת קטגוריה', details: `האשכול "${post.title}" הועבר מ: ${post.category} ל: ${newCategory}` }); post.category = newCategory; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.put('/api/posts/lock', (req, res) => { const { username, postId } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (post) { post.isLocked = !post.isLocked; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/report', (req, res) => { const { reporter, postId, replyId, reason } = req.body; const db = readDB(); if (!db.reports) db.reports = []; db.reports.push({ id: Date.now(), reporter, postId, replyId, reason, date: getILTime() }); writeDB(db); res.json({ success: true }); });

app.get('/api/admin/pending-avatars', (req, res) => { const db = readDB(); res.json(db.users.filter(u => u.pendingAvatar).map(u => ({ username: u.username, pendingAvatar: u.pendingAvatar }))); });
app.post('/api/admin/approve-avatar', (req, res) => { const { adminUser, targetUser, approve } = req.body; const db = readDB(); const admin = db.users.find(u => u.username === adminUser); if (!admin || (admin.role !== 'admin' && admin.role !== 'mod')) return res.status(403).json({error: "אין הרשאה"}); const target = db.users.find(u => u.username === targetUser); if(target && target.pendingAvatar) { if(approve) target.avatar = target.pendingAvatar; target.pendingAvatar = null; writeDB(db); res.json({success: true}); } else res.status(404).json({error: "לא נמצא"}); });

app.get('/api/admin/pending-content', (req, res) => { const db = readDB(); const pending = []; db.posts.forEach(p => { if(!p.isApproved) pending.push({ type: 'post', postId: p.id, author: p.author, date: p.date, title: p.title, content: p.content }); p.replies.forEach(r => { if(!r.isApproved) pending.push({ type: 'reply', postId: p.id, replyId: r.id, author: r.author, date: r.date, title: `תגובה ב: ${p.title}`, content: r.content }); }); }); res.json(pending); });
app.post('/api/admin/approve-content', (req, res) => { const { username, type, postId, replyId } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({error: "אין הרשאה"}); const post = db.posts.find(p => p.id === postId); if(post) { if(type === 'post') { post.isApproved = true; post.lastUpdated = Date.now(); notifyMentionsAndQuotes(post.content, post.author, post.title, post.id, null, db); } if(type === 'reply') { const reply = post.replies.find(r => r.id === replyId); if(reply) { reply.isApproved = true; post.lastUpdated = Date.now(); post.followers.forEach(follower => { if (follower !== reply.author) { const fu = db.users.find(u => u.username === follower); if (fu) fu.notifications.push({ text: `תגובה חדשה מ-${reply.author} באשכול: "${post.title}"`, threadId: post.id, replyId: reply.id, isNew: true }); } }); notifyMentionsAndQuotes(reply.content, reply.author, post.title, post.id, reply.id, db); } } writeDB(db); res.json({success: true}); } else res.status(404).json({error: "לא נמצא"}); });
app.put('/api/admin/users/:username/restrictions', (req, res) => { const { adminUser, requiresApproval, restrictedCats } = req.body; const db = readDB(); const admin = db.users.find(u => u.username === adminUser); if (!admin || admin.role !== 'admin') return res.status(403).json({error: "אין הרשאה"}); const target = db.users.find(u => u.username === req.params.username); if(target) { target.requiresApproval = requiresApproval; target.restrictedCats = restrictedCats; writeDB(db); res.json({success: true}); } else res.status(404).json({error: "לא נמצא"}); });

app.put('/api/admin/users/:username/rename', (req, res) => {
    const { adminUser, newUsername } = req.body;
    const oldUsername = req.params.username;
    const db = readDB();
    const admin = db.users.find(u => u.username === adminUser);
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" });
    if (db.users.find(u => u.username === newUsername)) return res.status(400).json({ error: "השם החדש כבר תפוס!" });
    const userToChange = db.users.find(u => u.username === oldUsername);
    if(userToChange) {
        userToChange.username = newUsername;
        db.posts.forEach(p => {
            if(p.author === oldUsername) p.author = newUsername;
            p.replies.forEach(r => { if(r.author === oldUsername) r.author = newUsername; });
        });
        writeDB(db);
        res.json({ success: true });
    } else res.status(404).json({ error: "משתמש לא נמצא" });
});

app.put('/api/admin/users/:username/likes', (req, res) => {
    const { adminUser, amount } = req.body;
    const db = readDB();
    const admin = db.users.find(u => u.username === adminUser);
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" });
    const targetUser = db.users.find(u => u.username === req.params.username);
    if(targetUser) {
        targetUser.totalLikes = (targetUser.totalLikes || 0) + amount;
        writeDB(db);
        res.json({ success: true });
    } else res.status(404).json({ error: "משתמש לא נמצא" });
});

app.post('/api/admin/categories', (req, res) => { const { username, newCat } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); if (!db.categories.includes(newCat)) { db.categories.push(newCat); writeDB(db); } res.json({ success: true }); });
app.put('/api/admin/categories', (req, res) => { const { username, oldCat, newCat } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); const idx = db.categories.indexOf(oldCat); if (idx > -1) { db.categories[idx] = newCat; db.posts.forEach(p => { if (p.category === oldCat) p.category = newCat; }); writeDB(db); } res.json({ success: true }); });
app.delete('/api/admin/categories', (req, res) => { const { username, catName } = req.body; const db = readDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); db.categories = db.categories.filter(c => c !== catName); writeDB(db); res.json({ success: true }); });
app.get('/api/admin/reports', (req, res) => res.json(readDB().reports || []));
app.delete('/api/admin/reports/:id', (req, res) => { const db = readDB(); db.reports = (db.reports || []).filter(r => r.id !== parseInt(req.params.id)); writeDB(db); res.json({ success: true }); });
app.get('/api/admin/audit', (req, res) => res.json(readDB().auditLogs.reverse() || []));
app.get('/api/admin/all-users', (req, res) => { res.json(readDB().users.map(u => ({ username: u.username, role: u.role, isApproved: u.isApproved, joinDate: u.joinDate, ip: u.ip, currentActivity: u.currentActivity, lastActive: u.lastActive, requiresApproval: u.requiresApproval, restrictedCats: u.restrictedCats }))); });
app.get('/api/admin/all-messages', (req, res) => res.json(readDB().messages.reverse()));
app.get('/api/admin/pending-users', (req, res) => res.json(readDB().users.filter(u => !u.isApproved && u.role !== 'admin').map(u => u.username)));
app.post('/api/admin/approve', (req, res) => { const db = readDB(); const user = db.users.find(u => u.username === req.body.username); if (user) { user.isApproved = true; writeDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/admin/delete-user', (req, res) => { const db = readDB(); const { username } = req.body; const user = db.users.find(u => u.username === username); if (user && user.role === 'admin') return res.status(400).json({error:"אי אפשר למחוק מנהל."}); db.users = db.users.filter(u => u.username !== username); writeDB(db); res.json({ success: true }); });
app.put('/api/admin/users/:username/role', (req, res) => { const db = readDB(); const user = db.users.find(u => u.username === req.params.username); if (user && user.role !== 'admin') { user.role = req.body.role; writeDB(db); res.json({success: true}); } else res.status(400).json({error: "שגיאה"}); });

// קריאה לפונקציית ההפעלה במקום app.listen ישירות
startServer();
app.get('/download-backup', (req, res) => {
    res.download(DATA_FILE);
});
