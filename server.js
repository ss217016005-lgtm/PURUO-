 const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.PORT;
const DATA_DIR = isRailway ? '/app/data' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
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

// מנגנון חדש: אין יותר Cache! הכל נשמר ונמשך ישירות מ-MongoDB
async function getDB() {
    let doc = await DBModel.findOne();
    if (!doc) {
        doc = new DBModel(defaultDB);
        await doc.save();
    }
    return doc.toObject();
}

async function saveDB(dbData) {
    await DBModel.updateOne({ _id: dbData._id }, { $set: dbData });
}

// סטטוס אונליין נשמר רק בזיכרון הזמני כדי לא לחנוק את מונגו כל 3 שניות
const onlineTracker = {}; 

app.use(express.json()); app.use(express.static(__dirname)); app.use('/uploads', express.static(UPLOADS_DIR));
app.set('trust proxy', true);

async function startServer() {
    try {
        console.log("מתחבר ל-MongoDB...");
        await mongoose.connect(MONGODB_URI);
        console.log('✅ מחובר למסד הנתונים בענן (מצב גישה ישירה ללא Cache)');

        if (fs.existsSync(DATA_FILE)) {
            console.log("⚠️ נמצא קובץ נתונים ישן (db.json)! מתחיל העברה אוטומטית לענן...");
            try {
                const rawData = fs.readFileSync(DATA_FILE, 'utf8');
                const oldData = JSON.parse(rawData);
                await DBModel.deleteMany({});
                const newDoc = new DBModel(oldData);
                await newDoc.save();
                fs.renameSync(DATA_FILE, DATA_FILE + '.backup');
                console.log("✅ הנתונים הועברו בהצלחה לענן!");
            } catch (migErr) {
                console.error("שגיאה במהלך העברת הנתונים:", migErr);
            }
        }

        // ודא שהמסד קיים ומוכן
        await getDB();
        
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

    } catch (e) {
        console.error("❌ שגיאה קריטית בעליית השרת:", e);
    }
}

const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, UPLOADS_DIR), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage });

function isVeteran(user) { return (user.role === 'admin' || user.role === 'mod' || user.role === 'editor' || user.veteranProgress >= 10); }

function notifyMentionsAndQuotes(content, author, postTitle, threadId, replyId, db) {
    db.users.forEach(u => {
        if (u.username !== author && content.includes('@' + u.username)) { 
            const exist = u.notifications.find(n => n.threadId === threadId && n.isNew);
            if (exist) { exist.text = `ישנן מספר התראות ותיוגים חדשים באשכול: "${postTitle}"`; }
            else { u.notifications.push({ text: `תויגת על ידי ${author} באשכול: "${postTitle}"`, threadId, replyId, isNew: true }); }
        }
    });
    const quotes = [...new Set((content.match(/\[quote="(.*?)"\]/gi) || []).map(m => m.match(/\[quote="(.*?)"\]/i)[1]))];
    quotes.forEach(username => {
        const u = db.users.find(x => x.username === username);
        if (u && u.username !== author) {
            const exist = u.notifications.find(n => n.threadId === threadId && n.isNew);
            if (exist) { exist.text = `ישנן מספר התראות וציטוטים חדשים באשכול: "${postTitle}"`; }
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
                if (exist) {
                    exist.text = `ישנן מספר תגובות חדשות באשכול: "${post.title}"`;
                } else {
                    fu.notifications.push({ text: `תגובה חדשה מ-${replyAuthor} באשכול: "${post.title}"`, threadId: post.id, replyId: replyId, isNew: true }); 
                }
            } 
        } 
    });
}

// נתיבי ה-API שעודכנו לעבוד באופן ישיר ואסינכרוני מול DB

app.get('/api/settings', async (req, res) => res.json((await getDB()).settings));

app.put('/api/admin/settings', async (req, res) => {
    const { username, rules, floatingMessageText, floatingMessageColor } = req.body; 
    const db = await getDB();
    const user = db.users.find(u => u.username === username);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה." });
    db.settings.rules = rules;
    if (db.settings.floatingMessage.text !== floatingMessageText || db.settings.floatingMessage.color !== floatingMessageColor) {
        db.settings.floatingMessage = { text: floatingMessageText, color: floatingMessageColor || "#f59e0b", id: Date.now() }; 
    }
    await saveDB(db); 
    res.json({ success: true });
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body; 
    const db = await getDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ error: "שם המשתמש כבר קיים." });

    db.users.push({ 
        username, password, email: '', avatar: '', pendingAvatar: null, signature: '',
        isApproved: false, requiresApproval: false, restrictedCats: [],
        role: db.users.length === 0 ? 'admin' : 'user', 
        joinDate: getILTime().split(',')[0], lastSeen: Date.now(), lastActive: Date.now(), 
        notifications: [], totalLikes: 0, postCount: 0, veteranProgress: 0, typingTo: null, typingExpires: 0 
    });
    await saveDB(db); 
    res.json({ message: "נרשמת בהצלחה! חשבונך ממתין כעת לאישור מנהל." });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; 
    const db = await getDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: "שם משתמש או סיסמה שגויים." });
    if (!user.isApproved && user.role !== 'admin') return res.status(403).json({ error: "חשבונך עדיין ממתין לאישור מנהל." });
    
    user.lastSeen = Date.now(); user.lastActive = Date.now(); 
    await saveDB(db);
    res.json({ message: "התחברת!", username: user.username, role: user.role });
});

app.put('/api/user/profile', upload.single('avatarFile'), async (req, res) => {
    const { username, oldPassword, newPassword, email, signature } = req.body; 
    const db = await getDB();
    const user = db.users.find(u => u.username === username);
    if(!user) return res.status(404).json({error: "משתמש לא נמצא."});
    
    if(newPassword) {
        if(user.password !== oldPassword) return res.status(401).json({error: "הסיסמה הישנה שגויה."});
        user.password = newPassword;
    }
    user.email = email || user.email;
    user.signature = signature || user.signature;
    
    if (req.file) { user.pendingAvatar = `/uploads/${req.file.filename}`; }
    
    await saveDB(db); 
    res.json({success: true, message: req.file ? "הפרופיל עודכן. תמונת הפרופיל ממתינה לאישור מנהל." : "הפרופיל עודכן."});
});

app.get('/api/users/info', async (req, res) => { 
    const db = await getDB(); 
    const info = {}; 
    db.users.forEach(u => { 
        const tracker = onlineTracker[u.username] || {};
        info[u.username] = { 
            role: u.role || 'user', joinDate: u.joinDate || '', 
            totalLikes: u.totalLikes || 0, postCount: u.postCount || 0, 
            isVeteran: isVeteran(u), lastSeen: tracker.lastSeen || u.lastSeen || Date.now(), 
            avatar: u.avatar, signature: u.signature 
        }; 
    }); 
    res.json(info); 
});

app.post('/api/ping', async (req, res) => { 
    const { username, typingTo, currentActivity } = req.body; 
    const now = Date.now();
    
    if (username) {
        if (!onlineTracker[username]) onlineTracker[username] = {};
        onlineTracker[username].lastSeen = now;
        onlineTracker[username].currentActivity = currentActivity || 'גולש בפורום';
        if (typingTo !== undefined) {
            onlineTracker[username].typingTo = typingTo;
            onlineTracker[username].typingExpires = now + 4000;
        }
    }
    
    const threeMinsAgo = now - 180000; 
    const onlineUsers = Object.keys(onlineTracker).filter(u => onlineTracker[u].lastSeen > threeMinsAgo); 
    const typingUsers = Object.keys(onlineTracker).filter(u => onlineTracker[u].typingTo === username && onlineTracker[u].typingExpires > now); 

    const db = await getDB();
    let unreadCount = 0, unreadMessages = 0, allNotifs = []; 
    if (username) {
        const user = db.users.find(u => u.username === username);
        if (user) {
            unreadCount = user.notifications ? user.notifications.filter(n => n.isNew !== false).length : 0; 
            allNotifs = user.notifications || []; 
            unreadMessages = db.messages.filter(m => m.to === username && !m.read).length; 
        }
    }
    res.json({ onlineUsers, unreadCount, unreadMessages, typingUsers, allNotifs }); 
});

app.post('/api/notifications/mark-read', async (req, res) => { const { username } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (user && user.notifications) { user.notifications.forEach(n => n.isNew = false); await saveDB(db); } res.json({ success: true }); });
app.post('/api/notifications/clear', async (req, res) => { const { username } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (user) { user.notifications = []; await saveDB(db); } res.json({ success: true }); });

app.get('/api/messages/:username', async (req, res) => { const db = await getDB(); const msgs = db.messages.filter(m => m.to === req.params.username || m.from === req.params.username); res.json(msgs); });
app.post('/api/messages/read', async (req, res) => { const { username, partner, subject } = req.body; const db = await getDB(); db.messages.forEach(m => { if (m.to === username && m.from === partner && m.subject === subject) m.read = true; }); await saveDB(db); res.json({ success: true }); });
app.delete('/api/messages/:id', async (req, res) => { const { username } = req.body; const db = await getDB(); const idx = db.messages.findIndex(m => m.id === parseInt(req.params.id) && m.from === username); if (idx > -1) { db.messages.splice(idx, 1); await saveDB(db); res.json({success: true}); } else res.status(403).json({error: "לא מורשה."}); });

app.post('/api/messages', upload.array('attachedFiles', 5), async (req, res) => { 
    const { from, to, content, subject } = req.body; const db = await getDB(); 
    const receiver = db.users.find(u => u.username === to); 
    if (!receiver) return res.status(404).json({ error: "משתמש לא קיים." }); 
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : []; 
    db.messages.push({ id: Date.now(), subject: subject || 'שיחה כללית', from, to, content, fileUrls, date: getILTime(), read: false, likes: [] }); 
    await saveDB(db); res.json({ success: true }); 
});
app.post('/api/messages/:id/like', async (req, res) => { const { username } = req.body; const id = parseInt(req.params.id); const db = await getDB(); const msg = db.messages.find(m => m.id === id); if (msg && msg.from !== username) { const idx = msg.likes.indexOf(username); if (idx > -1) msg.likes.splice(idx, 1); else msg.likes.push(username); await saveDB(db); res.json({ success: true }); } else res.status(400).json({ error: "שגיאה." }); });

app.get('/api/links', async (req, res) => res.json((await getDB()).links || []));
app.post('/api/links', async (req, res) => { const { username, title, url } = req.body; const db = await getDB(); if(!db.links) db.links = []; db.links.push({ id: Date.now(), title, url, author: username, date: getILTime() }); await saveDB(db); res.json({success: true}); });
app.delete('/api/links/:id', async (req, res) => { const { username } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if(!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({error: "אין הרשאה"}); db.links = db.links.filter(l => l.id !== parseInt(req.params.id)); await saveDB(db); res.json({success: true}); });
app.get('/api/all-files', async (req, res) => { const db = await getDB(); const files = []; db.posts.forEach(p => { if (p.fileUrls && p.fileUrls.length > 0 && !p.isHidden && p.isApproved) files.push({ urls: p.fileUrls, author: p.author, threadId: p.id, threadTitle: p.title, date: p.date }); p.replies.forEach(r => { if (r.fileUrls && r.fileUrls.length > 0 && !r.isHidden && r.isApproved) files.push({ urls: r.fileUrls, author: r.author, threadId: p.id, replyId: r.id, threadTitle: p.title, date: r.date }); }); }); res.json(files.reverse()); });

app.get('/api/tags', async (req, res) => res.json((await getDB()).tags));
app.post('/api/admin/tags', async (req, res) => { const { username, name, color } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); if (!db.tags.find(t => t.name === name)) { db.tags.push({name, color}); await saveDB(db); } res.json({ success: true }); });
app.delete('/api/admin/tags', async (req, res) => { const { username, tagName } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); db.tags = db.tags.filter(t => t.name !== tagName); await saveDB(db); res.json({ success: true }); });

app.get('/api/categories', async (req, res) => res.json((await getDB()).categories));
app.put('/api/admin/categories/reorder', async (req, res) => { const { username, categories } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); db.categories = categories; await saveDB(db); res.json({ success: true }); });

app.get('/api/posts', async (req, res) => { res.json((await getDB()).posts.sort((a, b) => b.lastUpdated - a.lastUpdated)); });
app.post('/api/posts/:id/view', async (req, res) => { const db = await getDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id)); if (post) { post.views = (post.views || 0) + 1; await saveDB(db); res.json({ views: post.views }); } else res.status(404).json({ error: "לא נמצא" }); });

app.post('/api/posts', upload.array('attachedFiles', 5), async (req, res) => { 
    const { author, title, content, category, tag, pollData } = req.body; const db = await getDB(); 
    const user = db.users.find(u => u.username === author); 
    
    if (!user) return res.status(401).json({ error: "שגיאה: המשתמש שלך נמחק או לא מורשה." });
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
    
    if(isAppr) {
        user.postCount = (user.postCount || 0) + 1;
        notifyMentionsAndQuotes(content, author, title, newPost.id, null, db); 
    }
    await saveDB(db); res.status(201).json(newPost); 
});

app.post('/api/posts/:id/vote', async (req, res) => {
    const { username, optionId } = req.body; const db = await getDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id));
    if(!post || !post.poll) return res.status(404).json({error: "סקר לא נמצא"});
    post.poll.options.forEach(opt => { const idx = opt.votes.indexOf(username); if(idx > -1) opt.votes.splice(idx, 1); });
    const selectedOpt = post.poll.options.find(o => o.id === parseInt(optionId));
    if(selectedOpt) selectedOpt.votes.push(username);
    await saveDB(db); res.json({success: true});
});

app.post('/api/posts/:id/follow', async (req, res) => { const { username } = req.body; const db = await getDB(); const post = db.posts.find(p => p.id === parseInt(req.params.id)); if (!post) return res.status(404).json({ error: "לא נמצא" }); const idx = post.followers.indexOf(username); if (idx > -1) post.followers.splice(idx, 1); else post.followers.push(username); await saveDB(db); res.json({ success: true, followers: post.followers }); });

app.post('/api/posts/:id/reply', upload.array('attachedFiles', 5), async (req, res) => { 
    const { author, content } = req.body; const db = await getDB(); 
    const user = db.users.find(u => u.username === author); 
    if (!user) return res.status(401).json({ error: "שגיאה: המשתמש שלך נמחק או לא מורשה." });
    
    const post = db.posts.find(p => p.id === parseInt(req.params.id)); 
    if (!post || post.isLocked) return res.status(403).json({ error: "שגיאה או אשכול נעול." }); 
    if (user.restrictedCats && user.restrictedCats.includes(post.category)) return res.status(403).json({ error: "אינך מורשה להגיב בקטגוריה זו." });
    
    const isAppr = !user.requiresApproval;
    const fileUrls = req.files ? req.files.map(f => `/uploads/${f.filename}`) : []; 
    const newReply = { id: Date.now(), author, content, date: getILTime(), fileUrls, likes: [], dislikes: [], isHidden: false, isApproved: isAppr }; 
    post.replies.push(newReply); 
    
    if (post.isArchived) { post.isArchived = false; db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: 'מערכת', action: 'החזרה לראשי', details: `האשכול "${post.title}" חזר אוטומטית עקב תגובה.` }); }
    
    if(isAppr) {
        user.postCount = (user.postCount || 0) + 1;
        post.lastUpdated = Date.now(); 
        notifyFollowers(post, author, newReply.id, db);
        notifyMentionsAndQuotes(content, author, post.title, post.id, newReply.id, db); 
    }
    await saveDB(db); res.status(201).json(newReply); 
});

app.put('/api/posts/archive', async (req, res) => {
    const { username, postId } = req.body; const db = await getDB();
    const user = db.users.find(u => u.username === username);
    if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." });
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({error: "לא נמצא"});
    
    post.isArchived = !post.isArchived;
    db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: post.isArchived ? 'סומן כפחות רלוונטי' : 'הוחזר לראשי', details: `האשכול "${post.title}"` });
    await saveDB(db); res.json({success: true, isArchived: post.isArchived});
});

app.post('/api/posts/delete-reply', async (req, res) => { 
    const { username, postId, replyId } = req.body; 
    const db = await getDB(); 
    const user = db.users.find(u => u.username === username); 
    const post = db.posts.find(p => p.id === postId); 
    
    if (post) { 
        const replyIndex = post.replies.findIndex(r => r.id === replyId);
        if (replyIndex !== -1) {
            const reply = post.replies[replyIndex];
            if (user && user.role !== 'admin' && reply.author !== username) return res.status(403).json({ error: "אין הרשאה למחוק תגובה זו." });
            
            const authorUser = db.users.find(u => u.username === reply.author);
            if(authorUser && authorUser.postCount > 0) authorUser.postCount--;
            
            db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'מחיקת תגובה', details: `תגובה של ${reply.author} באשכול "${post.title}" נמחקה.` });
            post.replies.splice(replyIndex, 1);
            await saveDB(db);
            return res.json({ success: true });
        }
    } 
    res.status(404).json({ error: "לא נמצא." }); 
});

app.post('/api/posts/delete-main', async (req, res) => { 
    const { username, postId } = req.body; 
    const db = await getDB(); 
    const user = db.users.find(u => u.username === username); 
    const postIndex = db.posts.findIndex(p => p.id === postId); 
    
    if (postIndex !== -1) { 
        const post = db.posts[postIndex];
        if (user && user.role !== 'admin' && post.author !== username) return res.status(403).json({ error: "אין הרשאה למחוק אשכול זה." });
        
        const authorUser = db.users.find(u => u.username === post.author);
        if(authorUser && authorUser.postCount > 0) authorUser.postCount--;
        
        post.replies.forEach(r => {
            const ru = db.users.find(u => u.username === r.author);
            if(ru && ru.postCount > 0) ru.postCount--;
        });

        db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'מחיקת אשכול שלם', details: `האשכול "${post.title}" נמחק.` });
        db.posts.splice(postIndex, 1);
        await saveDB(db);
        return res.json({ success: true });
    } 
    res.status(404).json({ error: "לא נמצא." }); 
});

app.post('/api/like', async (req, res) => { 
    const { username, postId, replyId } = req.body; const db = await getDB(); const post = db.posts.find(p => p.id === postId); if (!post) return res.status(404).json({ error: "לא נמצא" }); 
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
    await saveDB(db); res.json({ success: true }); 
});

app.post('/api/dislike', async (req, res) => {
    const { username, postId, replyId } = req.body; 
    const db = await getDB(); 
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
    await saveDB(db); 
    res.json({ success: true }); 
});

app.delete('/api/admin/dislike-reset', async (req, res) => {
    const { adminUser, postId, replyId } = req.body;
    const db = await getDB();
    const admin = db.users.find(u => u.username === adminUser);
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: "אין הרשאה." });
    
    const post = db.posts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ error: "לא נמצא" });
    
    let target = replyId ? post.replies.find(r => r.id === replyId) : post;
    if(target && target.dislikes && target.dislikes.length > 0) {
        const targetUser = db.users.find(u => u.username === target.author);
        if(targetUser) targetUser.totalLikes += target.dislikes.length;
        target.dislikes = [];
        await saveDB(db);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "אין דיסלייקים לאיפוס." });
    }
});

app.put('/api/posts/edit', async (req, res) => { 
    const { username, postId, replyId, newContent } = req.body; const db = await getDB(); 
    const user = db.users.find(u => u.username === username); 
    const post = db.posts.find(p => p.id === postId); 
    let target = replyId ? post.replies.find(r => r.id === replyId) : post; 
    if (!target) return res.status(404).json({ error: "לא נמצא" }); 
    if (!user || (user.role !== 'admin' && user.role !== 'mod' && user.role !== 'editor' && target.author !== username)) return res.status(403).json({ error: "אין הרשאה." }); 
    
    let cleanContent = newContent.replace(/\[edit\].*?\[\/edit\]/g, '').trim();
    target.content = cleanContent + `\n[edit]נערך לאחרונה ב-${getILTime()}[/edit]`; 
    await saveDB(db); res.json({ success: true }); 
});

app.put('/api/posts/rename', async (req, res) => { const { username, postId, newTitle } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'editor')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (post) { db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'שינוי כותרת', details: `מ: "${post.title}" ל: "${newTitle}"` }); post.title = newTitle; await saveDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/posts/split', async (req, res) => { const { username, postId, replyIds, newTitle } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (!post) return res.status(404).json({error: "לא נמצא"}); const repliesToMove = post.replies.filter(r => replyIds.includes(r.id)); if (repliesToMove.length === 0) return res.status(400).json({error: "לא נבחרו תגובות לפיצול"}); post.replies = post.replies.filter(r => !replyIds.includes(r.id)); const firstMsg = repliesToMove.shift(); const newPost = { id: Date.now(), lastUpdated: Date.now(), views: 0, author: firstMsg.author, title: newTitle, category: post.category, content: firstMsg.content, date: firstMsg.date, fileUrls: firstMsg.fileUrls || [], likes: firstMsg.likes || [], dislikes: [], replies: repliesToMove, followers: [firstMsg.author], isLocked: false, isHidden: false, isApproved: true, isArchived: false }; db.posts.push(newPost); post.lastUpdated = Date.now(); db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'פיצול אשכול מסומנים', details: `מתוך: "${post.title}" -> לאשכול חדש: "${newTitle}"` }); await saveDB(db); res.json({ success: true, newPostId: newPost.id }); });
app.put('/api/posts/move', async (req, res) => { const { username, postId, newCategory } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'editor')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (post) { db.auditLogs.push({ id: Date.now(), date: getILTime(), editor: username, action: 'העברת קטגוריה', details: `האשכול "${post.title}" הועבר מ: ${post.category} ל: ${newCategory}` }); post.category = newCategory; await saveDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.put('/api/posts/lock', async (req, res) => { const { username, postId } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({ error: "אין הרשאה." }); const post = db.posts.find(p => p.id === postId); if (post) { post.isLocked = !post.isLocked; await saveDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/report', async (req, res) => { const { reporter, postId, replyId, reason } = req.body; const db = await getDB(); if (!db.reports) db.reports = []; db.reports.push({ id: Date.now(), reporter, postId, replyId, reason, date: getILTime() }); await saveDB(db); res.json({ success: true }); });

app.get('/api/admin/pending-avatars', async (req, res) => { const db = await getDB(); res.json(db.users.filter(u => u.pendingAvatar).map(u => ({ username: u.username, pendingAvatar: u.pendingAvatar }))); });
app.post('/api/admin/approve-avatar', async (req, res) => { const { adminUser, targetUser, approve } = req.body; const db = await getDB(); const admin = db.users.find(u => u.username === adminUser); if (!admin || (admin.role !== 'admin' && admin.role !== 'mod')) return res.status(403).json({error: "אין הרשאה"}); const target = db.users.find(u => u.username === targetUser); if(target && target.pendingAvatar) { if(approve) target.avatar = target.pendingAvatar; target.pendingAvatar = null; await saveDB(db); res.json({success: true}); } else res.status(404).json({error: "לא נמצא"}); });

app.get('/api/admin/pending-content', async (req, res) => { const db = await getDB(); const pending = []; db.posts.forEach(p => { if(!p.isApproved) pending.push({ type: 'post', postId: p.id, author: p.author, date: p.date, title: p.title, content: p.content }); p.replies.forEach(r => { if(!r.isApproved) pending.push({ type: 'reply', postId: p.id, replyId: r.id, author: r.author, date: r.date, title: `תגובה ב: ${p.title}`, content: r.content }); }); }); res.json(pending); });
app.post('/api/admin/approve-content', async (req, res) => { const { username, type, postId, replyId } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || (user.role !== 'admin' && user.role !== 'mod')) return res.status(403).json({error: "אין הרשאה"}); const post = db.posts.find(p => p.id === postId); if(post) { if(type === 'post') { post.isApproved = true; post.lastUpdated = Date.now(); const au = db.users.find(u => u.username === post.author); if(au) au.postCount = (au.postCount || 0) + 1; notifyMentionsAndQuotes(post.content, post.author, post.title, post.id, null, db); } if(type === 'reply') { const reply = post.replies.find(r => r.id === replyId); if(reply) { reply.isApproved = true; post.lastUpdated = Date.now(); const ru = db.users.find(u => u.username === reply.author); if(ru) ru.postCount = (ru.postCount || 0) + 1; notifyFollowers(post, reply.author, reply.id, db); notifyMentionsAndQuotes(reply.content, reply.author, post.title, post.id, reply.id, db); } } await saveDB(db); res.json({success: true}); } else res.status(404).json({error: "לא נמצא"}); });
app.put('/api/admin/users/:username/restrictions', async (req, res) => { const { adminUser, requiresApproval, restrictedCats } = req.body; const db = await getDB(); const admin = db.users.find(u => u.username === adminUser); if (!admin || admin.role !== 'admin') return res.status(403).json({error: "אין הרשאה"}); const target = db.users.find(u => u.username === req.params.username); if(target) { target.requiresApproval = requiresApproval; target.restrictedCats = restrictedCats; await saveDB(db); res.json({success: true}); } else res.status(404).json({error: "לא נמצא"}); });

app.put('/api/admin/users/:username/rename', async (req, res) => {
    const { adminUser, newUsername } = req.body; const oldUsername = req.params.username; const db = await getDB();
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
        await saveDB(db); res.json({ success: true });
    } else res.status(404).json({ error: "משתמש לא נמצא" });
});

app.put('/api/admin/users/:username/likes', async (req, res) => {
    const { adminUser, amount } = req.body; const db = await getDB();
    const admin = db.users.find(u => u.username === adminUser);
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" });
    const targetUser = db.users.find(u => u.username === req.params.username);
    if(targetUser) {
        targetUser.totalLikes = (targetUser.totalLikes || 0) + amount;
        await saveDB(db); res.json({ success: true });
    } else res.status(404).json({ error: "משתמש לא נמצא" });
});

app.put('/api/admin/users/:username/role', async (req, res) => { 
    const { adminUser, role } = req.body; const db = await getDB(); 
    const admin = db.users.find(u => u.username === adminUser); 
    if (!admin || admin.role !== 'admin') return res.status(403).json({error: "אין הרשאה לפעולה זו."}); 
    
    const user = db.users.find(u => u.username === req.params.username); 
    if (user && user.role !== 'admin') { 
        user.role = role; 
        await saveDB(db); res.json({success: true}); 
    } else res.status(400).json({error: "שגיאה או שניסית לשנות תפקיד למנהל קיים"});
});

app.post('/api/admin/categories', async (req, res) => { const { username, newCat } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); if (!db.categories.includes(newCat)) { db.categories.push(newCat); await saveDB(db); } res.json({ success: true }); });
app.put('/api/admin/categories', async (req, res) => { const { username, oldCat, newCat } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); const idx = db.categories.indexOf(oldCat); if (idx > -1) { db.categories[idx] = newCat; db.posts.forEach(p => { if (p.category === oldCat) p.category = newCat; }); await saveDB(db); } res.json({ success: true }); });
app.delete('/api/admin/categories', async (req, res) => { const { username, catName } = req.body; const db = await getDB(); const user = db.users.find(u => u.username === username); if (!user || user.role !== 'admin') return res.status(403).json({ error: "אין הרשאה" }); db.categories = db.categories.filter(c => c !== catName); await saveDB(db); res.json({ success: true }); });
app.get('/api/admin/reports', async (req, res) => res.json((await getDB()).reports || []));
app.delete('/api/admin/reports/:id', async (req, res) => { const db = await getDB(); db.reports = (db.reports || []).filter(r => r.id !== parseInt(req.params.id)); await saveDB(db); res.json({ success: true }); });
app.get('/api/admin/audit', async (req, res) => res.json((await getDB()).auditLogs.reverse() || []));
app.get('/api/admin/all-users', async (req, res) => { res.json((await getDB()).users.map(u => ({ username: u.username, role: u.role, isApproved: u.isApproved, joinDate: u.joinDate, ip: u.ip, currentActivity: (onlineTracker[u.username]||{}).currentActivity || 'לא מחובר', lastActive: u.lastActive, requiresApproval: u.requiresApproval, restrictedCats: u.restrictedCats }))); });
app.get('/api/admin/all-messages', async (req, res) => res.json((await getDB()).messages.reverse()));
app.get('/api/admin/pending-users', async (req, res) => res.json((await getDB()).users.filter(u => !u.isApproved && u.role !== 'admin').map(u => u.username)));
app.post('/api/admin/approve', async (req, res) => { const db = await getDB(); const user = db.users.find(u => u.username === req.body.username); if (user) { user.isApproved = true; await saveDB(db); res.json({ success: true }); } else res.status(404).json({ error: "לא נמצא." }); });
app.post('/api/admin/delete-user', async (req, res) => { const db = await getDB(); const { username } = req.body; const user = db.users.find(u => u.username === username); if (user && user.role === 'admin') return res.status(400).json({error:"אי אפשר למחוק מנהל."}); db.users = db.users.filter(u => u.username !== username); await saveDB(db); res.json({ success: true }); });

startServer();
// ==========================================
// אזור הענן (חיבור ל-VPS)
// ==========================================
const VPS_URL = "http://161.97.116.66:8000";
const VPS_API_KEY = "your_secret_password_123";

app.get('/api/cloud/list/:category', async (req, res) => {
    try {
        const response = await axios.get(`${VPS_URL}/list/${req.params.category}`, {
            headers: { 'x-api-key': VPS_API_KEY }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "שגיאה בתקשורת מול השרת המרכזי" });
    }
});

app.get('/api/cloud/download/:category/:filename', async (req, res) => {
    try {
        const response = await axios.get(`${VPS_URL}/download/${req.params.category}/${req.params.filename}`, {
            headers: { 'x-api-key': VPS_API_KEY },
            responseType: 'stream'
        });
        res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send("שגיאה בהורדת הקובץ");
    }
});

app.post('/api/cloud/upload/:category', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "לא נבחר קובץ" });
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(req.file.path), req.file.originalname);

        const response = await axios.post(`${VPS_URL}/upload/${req.params.category}`, form, {
            headers: { ...form.getHeaders(), 'x-api-key': VPS_API_KEY }
        });

        fs.unlinkSync(req.file.path);
        res.json(response.data);
    } catch (error) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "שגיאה בהעלאה" });
    }
});

app.get('/cloud', (req, res) => {
    res.sendFile(path.join(__dirname, 'cloud.html'));
});

// ==========================================
// הפעלת השרת הראשי
// ==========================================
startServer();
