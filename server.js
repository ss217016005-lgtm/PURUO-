const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

// הגדרות נתיבים ל-Railway
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
    settings: { rules: "ברוכים הבאים לפורום פרומרקייט!", floatingMessage: { text: "", color: "#f59e0b", id: 0 } }
};

const MONGODB_URI = "mongodb+srv://w217016005_db_user:771fEhHF0z26gIGl@cluster0.e7lsmeb.mongodb.net/ForumDB?retryWrites=true&w=majority";

const dbSchema = new mongoose.Schema({}, { strict: false });
const DBModel = mongoose.model('Database', dbSchema);

// פונקציות גישה ישירה למסד הנתונים (בלי Cache)
async function getDB() {
    let doc = await DBModel.findOne();
    if (!doc) {
        doc = new DBModel(defaultDB);
        await doc.save();
    }
    return doc.toObject();
}

async function saveDB(dbData) {
    const { _id, ...updateData } = dbData;
    await DBModel.updateOne({ _id }, { $set: updateData });
}

const onlineTracker = {}; 

app.use(express.json()); 
app.use(express.static(__dirname)); 
app.use('/uploads', express.static(UPLOADS_DIR));
app.set('trust proxy', true);

const upload = multer({ dest: '/tmp/' });

function isVeteran(user) { return (user.role === 'admin' || user.role === 'mod' || user.role === 'editor' || (user.totalLikes >= 10)); }

// --- פונקציות עזר להתראות ---
function notifyMentionsAndQuotes(content, author, postTitle, threadId, replyId, db) {
    db.users.forEach(u => {
        if (u.username !== author && content.includes('@' + u.username)) { 
            const exist = u.notifications.find(n => n.threadId === threadId && n.isNew);
            if (exist) { exist.text = `התראות חדשות באשכול: "${postTitle}"`; }
            else { u.notifications.push({ text: `תויגת ע"י ${author} באשכול: "${postTitle}"`, threadId, replyId, isNew: true }); }
        }
    });
    const quotes = [...new Set((content.match(/\[quote="(.*?)"\]/gi) || []).map(m => m.match(/\[quote="(.*?)"\]/i)[1]))];
    quotes.forEach(username => {
        const u = db.users.find(x => x.username === username);
        if (u && u.username !== author) {
            const exist = u.notifications.find(n => n.threadId === threadId && n.isNew);
            if (exist) { exist.text = `ציטוטים חדשים באשכול: "${postTitle}"`; }
            else { u.notifications.push({ text: `${author} ציטט אותך באשכול: "${postTitle}"`, threadId, replyId, isNew: true }); }
        }
    });
}

function notifyFollowers(post, replyAuthor, replyId, db) {
    post.followers.forEach(follower => { 
        if (follower !== replyAuthor) { 
            const fu = db.users.find(u => u.username === follower); 
            if (fu) {
                const exist = fu.notifications.find(n => n.threadId === post.id && n.isNew);
                if (exist) { exist.text = `תגובות חדשות באשכול: "${post.title}"`; }
                else { fu.notifications.push({ text: `תגובה חדשה מ-${replyAuthor} באשכול: "${post.title}"`, threadId: post.id, replyId: replyId, isNew: true }); }
            } 
        } 
    });
}

// ==========================================
// נתיבי ה-API של הפורום (עבודה ישירה מול מונגו)
// ==========================================

app.get('/api/settings', async (req, res) => res.json((await getDB()).settings));

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body; const db = await getDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "שם המשתמש תפוס." });
    db.users.push({ username, password, role: db.users.length === 0 ? 'admin' : 'user', joinDate: getILTime().split(',')[0], notifications: [], totalLikes: 0, postCount: 0, lastSeen: Date.now() });
    await saveDB(db); res.json({ message: "נרשמת בהצלחה!" });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; const db = await getDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    res.json({ message: "התחברת!", username: user.username, role: user.role });
});

app.get('/api/users/info', async (req, res) => { 
    const db = await getDB(); const info = {}; 
    db.users.forEach(u => { info[u.username] = { role: u.role, joinDate: u.joinDate, totalLikes: u.totalLikes || 0, postCount: u.postCount || 0, avatar: u.avatar }; });
    res.json(info);
});

app.get('/api/posts', async (req, res) => {
    const db = await getDB();
    res.json(db.posts.sort((a, b) => b.lastUpdated - a.lastUpdated));
});

app.post('/api/posts', upload.array('attachedFiles', 5), async (req, res) => { 
    const { author, title, content, category, tag } = req.body; const db = await getDB(); 
    const user = db.users.find(u => u.username === author); 
    if (!user) return res.status(401).json({ error: "משתמש לא נמצא." });
    const newPost = { id: Date.now(), lastUpdated: Date.now(), views: 0, author, title, category, tag, content, date: getILTime(), replies: [], followers: [author], isApproved: true }; 
    db.posts.push(newPost); user.postCount = (user.postCount || 0) + 1;
    await saveDB(db); res.status(201).json(newPost); 
});

app.post('/api/posts/:id/reply', upload.array('attachedFiles', 5), async (req, res) => { 
    const { author, content } = req.body; const db = await getDB(); 
    const user = db.users.find(u => u.username === author); 
    const post = db.posts.find(p => p.id === parseInt(req.params.id)); 
    if (!post || !user) return res.status(404).json({ error: "שגיאה." });
    const newReply = { id: Date.now(), author, content, date: getILTime(), likes: [], isApproved: true }; 
    post.replies.push(newReply); post.lastUpdated = Date.now(); user.postCount = (user.postCount || 0) + 1;
    notifyFollowers(post, author, newReply.id, db);
    await saveDB(db); res.status(201).json(newReply); 
});

app.post('/api/like', async (req, res) => { 
    const { username, postId, replyId } = req.body; const db = await getDB(); 
    const post = db.posts.find(p => p.id === postId); if (!post) return res.status(404).json({ error: "לא נמצא" }); 
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    const targetUser = db.users.find(u => u.username === target.author);
    if (!target.likes) target.likes = [];
    const idx = target.likes.indexOf(username);
    if (idx > -1) { target.likes.splice(idx, 1); if (targetUser) targetUser.totalLikes--; } 
    else { target.likes.push(username); if (targetUser) { targetUser.totalLikes++; targetUser.notifications.push({ text: `${username} עשה לייק להודעה שלך!`, threadId: post.id, isNew: true }); } } 
    await saveDB(db); res.json({ success: true }); 
});

app.post('/api/ping', async (req, res) => {
    const { username } = req.body; if (username) onlineTracker[username] = { lastSeen: Date.now() };
    const onlineUsers = Object.keys(onlineTracker).filter(u => Date.now() - onlineTracker[u].lastSeen < 180000);
    const db = await getDB();
    const user = db.users.find(u => u.username === username);
    res.json({ onlineUsers, unreadCount: user ? user.notifications.filter(n => n.isNew).length : 0, allNotifs: user ? user.notifications : [] });
});

// ==========================================
// אזור הענן (חיבור ל-VPS)
// ==========================================
const VPS_URL = "http://161.97.116.66:8000";
const VPS_API_KEY = "your_secret_password_123";

app.get('/api/cloud/list/:category', async (req, res) => {
    try {
        const response = await axios.get(`${VPS_URL}/list/${req.params.category}`, { headers: { 'x-api-key': VPS_API_KEY } });
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: "שגיאה מול ה-VPS" }); }
});

app.post('/api/cloud/upload/:category', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "אין קובץ" });
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(req.file.path), req.file.originalname);
        const response = await axios.post(`${VPS_URL}/upload/${req.params.category}`, form, { headers: { ...form.getHeaders(), 'x-api-key': VPS_API_KEY } });
        fs.unlinkSync(req.file.path); res.json(response.data);
    } catch (e) { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); res.status(500).json({ error: "העלאה נכשלה" }); }
});

// ==========================================
// הפעלה סופית
// ==========================================
mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ מחובר ל-MongoDB - הנתונים נטענים בזמן אמת');
        app.listen(PORT, () => console.log(`🚀 השרת רץ בפורט ${PORT}`));
    })
    .catch(err => console.error('❌ שגיאת התחברות למונגו:', err));
